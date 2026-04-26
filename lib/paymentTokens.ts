import { randomBytes } from 'crypto';
import { getDb } from './db';

const TTL_MS = 10 * 60 * 1000;

export async function issuePaymentToken(params: {
    merchantOrderId: string;
    amountRupees: number;
    visitorId: string;
}): Promise<string> {
    const db = await getDb();
    const now = new Date();

    // Reuse an existing unconsumed, unexpired token for the same merchantOrderId.
    // This makes status polls idempotent across devices/tabs — both sides get the
    // same token, so only one order can ever be placed.
    const existing = await db.collection('payment_tokens').findOne({
        merchantOrderId: params.merchantOrderId,
        consumed: false,
        expiresAt: { $gt: now },
    });
    if (existing) return existing.token as string;

    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(now.getTime() + TTL_MS);
    await db.collection('payment_tokens').insertOne({
        token,
        amountRupees: params.amountRupees,
        visitorId: params.visitorId,
        merchantOrderId: params.merchantOrderId,
        consumed: false,
        expiresAt,
        createdAt: now,
    });
    return token;
}

export async function consumePaymentToken(token: string, orderAmountRupees: number): Promise<boolean> {
    const db = await getDb();
    const doc = await db.collection('payment_tokens').findOneAndUpdate(
        { token, consumed: false, expiresAt: { $gt: new Date() } },
        { $set: { consumed: true } },
        { returnDocument: 'before' }
    );

    if (!doc) return false;

    const storedAmount = doc.amountRupees as number;
    if (Math.abs(storedAmount - orderAmountRupees) > 0.5) {
        console.warn(`[paymentTokens] amount mismatch: stored=${storedAmount} order=${orderAmountRupees}`);
        return false;
    }
    return true;
}

export async function getTokenMerchantOrderId(token: string): Promise<string | null> {
    const db = await getDb();
    const doc = await db.collection('payment_tokens').findOne({ token });
    return doc ? (doc.merchantOrderId as string) : null;
}

export async function purgeExpiredTokens() {
    const db = await getDb();
    await db.collection('payment_tokens').deleteMany({ expiresAt: { $lt: new Date() } });
}
