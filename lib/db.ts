import { MongoClient, Db } from 'mongodb';

declare global {
    var __mongoClient: MongoClient | undefined;
    var __mongoDb: Db | undefined;
}

const uri = process.env.MONGO_URL!;
const dbName = process.env.MONGO_DB_NAME ?? 'pollys-database';

function createClient() {
    return new MongoClient(uri, {
        tls: true,
        tlsAllowInvalidCertificates: false,
        retryWrites: false,           // Cosmos DB requirement
        maxPoolSize: 10,
    });
}

export async function getDb(): Promise<Db> {
    if (globalThis.__mongoDb) return globalThis.__mongoDb;

    const client = globalThis.__mongoClient ?? (globalThis.__mongoClient = createClient());
    if (!client.connect) throw new Error('MongoClient not initialized');

    await client.connect();
    globalThis.__mongoDb = client.db(dbName);
    return globalThis.__mongoDb;
}
