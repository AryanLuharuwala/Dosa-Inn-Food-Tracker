import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export async function GET() {
    const env = {
        MONGO_URL_set: !!process.env.MONGO_URL,
        MONGO_DB_NAME: process.env.MONGO_DB_NAME ?? '(default: pollys-database)',
        AZURE_STORAGE_CONNECTION_STRING_set: !!process.env.AZURE_STORAGE_CONNECTION_STRING,
        AZURE_STORAGE_CONTAINER_NAME: process.env.AZURE_STORAGE_CONTAINER_NAME ?? '(default: uploads)',
    };

    try {
        const db = await getDb();
        const collections = await db.listCollections().toArray();
        const counts: Record<string, number> = {};
        for (const c of collections) {
            counts[c.name] = await db.collection(c.name).countDocuments();
        }
        return NextResponse.json({ ok: true, env, dbName: db.databaseName, collections: counts });
    } catch (e) {
        return NextResponse.json({ ok: false, env, error: String(e) }, { status: 500 });
    }
}
