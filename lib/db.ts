import { Pool } from 'pg';
import { createClient } from 'redis';

// ── PostgreSQL ────────────────────────────────────────────────────────────────

declare global {
    // Hot-reload safe: reuse pool across Next.js module re-evaluations
    var __pgPool: Pool | undefined;
}

function createPool() {
    return new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false },
        max: parseInt(process.env.DATABASE_POOL_SIZE ?? '10'),
        idleTimeoutMillis: 30_000,
        connectionTimeoutMillis: 5_000,
    });
}

export const pool: Pool = globalThis.__pgPool ?? (globalThis.__pgPool = createPool());

export async function query<T = Record<string, unknown>>(
    sql: string,
    params?: unknown[]
): Promise<T[]> {
    const { rows } = await pool.query(sql, params);
    return rows as T[];
}

export async function queryOne<T = Record<string, unknown>>(
    sql: string,
    params?: unknown[]
): Promise<T | null> {
    const rows = await query<T>(sql, params);
    return rows[0] ?? null;
}

// ── Redis ─────────────────────────────────────────────────────────────────────

declare global {
    var __redisClient: ReturnType<typeof createClient> | undefined;
    var __redisConnecting: boolean | undefined;
}

export function getRedis() {
    if (globalThis.__redisClient) return globalThis.__redisClient;

    const useTls = process.env.REDIS_TLS !== 'false';
    const client = createClient({
        url: process.env.REDIS_URL,
        socket: {
            ...(useTls ? { tls: true as const } : {}),
            reconnectStrategy: (retries: number) => Math.min(retries * 100, 3000),
        },
    });

    client.on('error', (err) => console.error('[Redis] error:', err.message));

    if (!globalThis.__redisConnecting) {
        globalThis.__redisConnecting = true;
        client.connect().catch((e) => console.error('[Redis] connect failed:', e.message));
    }

    globalThis.__redisClient = client;
    return client;
}
