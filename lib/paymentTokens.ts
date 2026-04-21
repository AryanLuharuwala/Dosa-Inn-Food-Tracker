/**
 * Server-side payment token registry.
 *
 * Flow:
 *   1. /api/phonepe/initiate  → issues a signed paymentToken tied to {merchantOrderId, amount, visitorId}
 *   2. PhonePe redirects back → /api/phonepe/status verifies COMPLETED, then calls issuePaymentToken()
 *   3. payment-result page    → calls /api/db order_add with the paymentToken
 *   4. /api/db order_add      → calls consumePaymentToken() — single-use, amount-locked, TTL 10 min
 *
 * Tokens are in-memory (globalThis so hot-reload safe). They expire after 10 minutes
 * and are destroyed on first use, preventing replay attacks.
 */

import crypto from 'crypto';

interface TokenEntry {
    amount: number;       // paisa — must match order total exactly
    visitorId: string;
    expiresAt: number;
    merchantOrderId: string;
}

declare global {
    // eslint-disable-next-line no-var
    var __paymentTokens: Map<string, TokenEntry> | undefined;
}

const tokens: Map<string, TokenEntry> =
    globalThis.__paymentTokens ?? (globalThis.__paymentTokens = new Map());

const TOKEN_TTL_MS = 10 * 60 * 1000; // 10 minutes

/** Called by /api/phonepe/status after confirming COMPLETED with PhonePe. */
export function issuePaymentToken(params: {
    merchantOrderId: string;
    amountRupees: number;
    visitorId: string;
}): string {
    // Purge expired tokens
    const now = Date.now();
    for (const [k, v] of tokens) {
        if (now > v.expiresAt) tokens.delete(k);
    }

    const token = crypto.randomBytes(32).toString('hex');
    tokens.set(token, {
        amount: Math.round(params.amountRupees * 100), // store in paisa
        visitorId: params.visitorId,
        expiresAt: now + TOKEN_TTL_MS,
        merchantOrderId: params.merchantOrderId,
    });
    return token;
}

/**
 * Validates and consumes a payment token.
 * Returns true only if token exists, amount matches, and not expired.
 * Deletes the token on success (single-use).
 */
export function consumePaymentToken(token: string, orderAmountRupees: number): boolean {
    const entry = tokens.get(token);
    if (!entry) return false;
    if (Date.now() > entry.expiresAt) { tokens.delete(token); return false; }
    if (Math.round(orderAmountRupees * 100) !== entry.amount) { return false; }
    tokens.delete(token); // single-use
    return true;
}
