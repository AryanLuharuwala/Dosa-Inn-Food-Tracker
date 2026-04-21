/**
 * Server-side payment token registry — backed by PostgreSQL.
 *
 * Flow:
 *   1. /api/phonepe/status verifies COMPLETED with PhonePe → calls issuePaymentToken()
 *   2. payment-result page → calls /api/db order_add with the paymentToken
 *   3. /api/db order_add   → calls consumePaymentToken() — single-use, amount-locked, TTL 10 min
 *
 * Tokens live in the payment_tokens table so they survive instance restarts
 * and work correctly across multiple Azure Web App instances.
 */

import { randomBytes } from 'crypto';
import { query, queryOne } from './db';

const TTL_MS = 10 * 60 * 1000; // 10 minutes

/** Called by /api/phonepe/status after confirming COMPLETED with PhonePe. */
export function issuePaymentToken(params: {
    merchantOrderId: string;
    amountRupees: number;
    visitorId: string;
}): string {
    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + TTL_MS);

    // Insert async — the caller (status route) is already in an async context
    // but issuePaymentToken is called synchronously in the response path,
    // so we fire-and-forget and the token will be ready before the client
    // can possibly call order_add (network round-trip takes longer).
    query(
        `INSERT INTO payment_tokens (token, amount_rupees, visitor_id, merchant_order_id, expires_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [token, params.amountRupees, params.visitorId, params.merchantOrderId, expiresAt]
    ).catch((e) => console.error('[paymentTokens] insert failed:', e.message));

    return token;
}

/**
 * Validates and consumes a payment token (atomic UPDATE … RETURNING).
 * Returns true only if the token exists, is not consumed, is not expired,
 * and the amount matches within ₹0.50 (float tolerance).
 */
export async function consumePaymentToken(
    token: string,
    orderAmountRupees: number
): Promise<boolean> {
    const row = await queryOne<{ amount_rupees: string }>(
        `UPDATE payment_tokens
         SET consumed = TRUE
         WHERE token      = $1
           AND consumed   = FALSE
           AND expires_at > NOW()
         RETURNING amount_rupees`,
        [token]
    );

    if (!row) return false;

    const storedAmount = parseFloat(row.amount_rupees);
    if (Math.abs(storedAmount - orderAmountRupees) > 0.5) {
        console.warn(`[paymentTokens] amount mismatch: stored=${storedAmount} order=${orderAmountRupees}`);
        return false;
    }
    return true;
}

/** Housekeeping — call from a scheduled job or on-demand. */
export async function purgeExpiredTokens() {
    await query(`DELETE FROM payment_tokens WHERE expires_at < NOW()`);
}
