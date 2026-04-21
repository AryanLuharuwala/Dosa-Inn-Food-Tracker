import { MongoClient, Db } from 'mongodb';

declare global {
    var __mongoClient: MongoClient | undefined;
    var __mongoDb: Db | undefined;
    var __mongoConnecting: Promise<Db> | undefined;
}

const uri = process.env.MONGO_URL!;
const dbName = process.env.MONGO_DB_NAME ?? 'pollys-database';

export async function getDb(): Promise<Db> {
    if (globalThis.__mongoDb) return globalThis.__mongoDb;

    // Deduplicate concurrent connect calls during cold start
    if (globalThis.__mongoConnecting) return globalThis.__mongoConnecting;

    globalThis.__mongoConnecting = (async () => {
        const client = new MongoClient(uri, {
            tls: true,
            tlsAllowInvalidCertificates: false,
            retryWrites: false,       // Cosmos DB requirement
            maxPoolSize: 10,
            connectTimeoutMS: 10_000,
            socketTimeoutMS: 30_000,
            serverSelectionTimeoutMS: 10_000,
        });

        await client.connect();
        globalThis.__mongoClient = client;
        globalThis.__mongoDb = client.db(dbName);
        globalThis.__mongoConnecting = undefined;
        return globalThis.__mongoDb;
    })();

    return globalThis.__mongoConnecting;
}
