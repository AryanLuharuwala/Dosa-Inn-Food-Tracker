import { randomBytes } from 'crypto';
import { getDb } from './db';

const TTL_MS = 10 * 60 * 1000;

export function issuePaymentToken(params: {
    merchantOrderId: string;
    amountRupees: number;
    visitorId: string;
}): string {
    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + TTL_MS);

    getDb().then(db =>
        db.collection('payment_tokens').insertOne({
            token,
            amountRupees: params.amountRupees,
            visitorId: params.visitorId,
            merchantOrderId: params.merchantOrderId,
            consumed: false,
            expiresAt,
            createdAt: new Date(),
        })
    ).catch(e => console.error('[paymentTokens] insert failed:', e.message));

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

export async function purgeExpiredTokens() {
    const db = await getDb();
    await db.collection('payment_tokens').deleteMany({ expiresAt: { $lt: new Date() } });
}
