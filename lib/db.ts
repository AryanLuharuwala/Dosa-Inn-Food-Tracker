import { MongoClient, Db } from 'mongodb';

declare global {
    var __mongoClient: MongoClient | undefined;
    var __mongoDb: Db | undefined;
    var __mongoConnecting: Promise<Db> | undefined;
}

const uri = process.env.MONGO_URL!;
const dbName = process.env.MONGO_DB_NAME ?? 'pollys-database';

async function ensureIndexes(db: Db) {
    await Promise.all([
        db.collection('orders').createIndex({ orderId: 1 }, { unique: true }),
        db.collection('orders').createIndex({ createdAt: -1 }),
        db.collection('shared_carts').createIndex({ code: 1 }, { unique: true }),
        db.collection('shared_carts').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
        db.collection('payment_tokens').createIndex({ token: 1 }, { unique: true }),
        db.collection('payment_tokens').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    ]);
}

export async function getDb(): Promise<Db> {
    if (globalThis.__mongoDb) return globalThis.__mongoDb;

    if (globalThis.__mongoConnecting) return globalThis.__mongoConnecting;

    globalThis.__mongoConnecting = (async () => {
        const client = new MongoClient(uri, {
            tls: true,
            tlsAllowInvalidCertificates: false,
            retryWrites: false,
            maxPoolSize: 10,
            connectTimeoutMS: 10_000,
            socketTimeoutMS: 30_000,
            serverSelectionTimeoutMS: 10_000,
        });

        await client.connect();
        const db = client.db(dbName);

        // Create indexes (no-op if they already exist)
        await ensureIndexes(db).catch(e => console.error('[db] ensureIndexes failed:', e.message));

        globalThis.__mongoClient = client;
        globalThis.__mongoDb = db;
        globalThis.__mongoConnecting = undefined;
        return db;
    })();

    return globalThis.__mongoConnecting;
}
