import { randomBytes } from 'crypto';
import { getDb } from './db';

const TTL_MS = 10 * 60 * 1000;

export async function issuePaymentToken(params: {
    merchantOrderId: string;
    amountRupees: number;
    visitorId: string;
}): Promise<string> {
    const db = getDb();
    const now = new Date();
    const nowIso = now.toISOString();

    // Reuse ANY existing token for this merchantOrderId — consumed or not,
    // expired or not. This is a hard one-token-per-payment cap: without it,
    // the client can poll /api/*/status again after the Cashfree/PhonePe
    // link is already PAID and consumed once, getting a fresh unconsumed
    // token for the SAME real payment every time — enough to place unlimited
    // free orders from a single payment. A paid link's status never reverts,
    // so nothing legitimate needs a second token once one has been issued.
    const existing = db.prepare(
        'SELECT token FROM payment_tokens WHERE merchant_order_id = ?'
    ).get(params.merchantOrderId) as { token: string } | undefined;
    if (existing) return existing.token;

    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(now.getTime() + TTL_MS).toISOString();
    db.prepare(
        'INSERT INTO payment_tokens (token, merchant_order_id, amount_rupees, visitor_id, consumed, expires_at, created_at) VALUES (?, ?, ?, ?, 0, ?, ?)'
    ).run(token, params.merchantOrderId, params.amountRupees, params.visitorId, expiresAt, nowIso);
    return token;
}

/** `expectedMerchantOrderId`, when given, ties the token to the exact order
 *  it was issued for — so a token minted for one paid link can't be used to
 *  authorize a different order request even if the amounts happen to match. */
export async function consumePaymentToken(
    token: string,
    orderAmountRupees: number,
    expectedMerchantOrderId?: string,
): Promise<boolean> {
    const db = getDb();
    const nowIso = new Date().toISOString();
    const row = db.prepare(
        'SELECT amount_rupees, merchant_order_id FROM payment_tokens WHERE token = ? AND consumed = 0 AND expires_at > ?'
    ).get(token, nowIso) as { amount_rupees: number; merchant_order_id: string | null } | undefined;

    if (!row) return false;

    // Burn the token regardless of the checks below — matches the old Mongo
    // behavior (findOneAndUpdate always set consumed:true), so a mismatched
    // attempt can't be retried either.
    db.prepare('UPDATE payment_tokens SET consumed = 1 WHERE token = ?').run(token);

    if (expectedMerchantOrderId && row.merchant_order_id !== expectedMerchantOrderId) {
        console.warn(`[paymentTokens] merchantOrderId mismatch: token belongs to=${row.merchant_order_id} order claims=${expectedMerchantOrderId}`);
        return false;
    }

    if (Math.abs(row.amount_rupees - orderAmountRupees) > 0.5) {
        console.warn(`[paymentTokens] amount mismatch: stored=${row.amount_rupees} order=${orderAmountRupees}`);
        return false;
    }
    return true;
}

export async function getTokenMerchantOrderId(token: string): Promise<string | null> {
    const db = getDb();
    const row = db.prepare('SELECT merchant_order_id FROM payment_tokens WHERE token = ?').get(token) as { merchant_order_id: string | null } | undefined;
    return row ? row.merchant_order_id : null;
}

export async function purgeExpiredTokens() {
    const db = getDb();
    db.prepare('DELETE FROM payment_tokens WHERE expires_at < ?').run(new Date().toISOString());
}
