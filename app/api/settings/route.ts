import { NextRequest, NextResponse } from 'next/server';
import { isAdminRequest } from '@/lib/apiAuth';
import fs from 'fs';
import path from 'path';

const ENV_FILE = path.join(process.cwd(), '.env.local');

const EDITABLE_KEYS = new Set([
    'ADMIN_PASSWORD',
    'PHONEPE_CLIENT_ID',
    'PHONEPE_CLIENT_SECRET',
    'PHONEPE_CLIENT_VERSION',
    'PHONEPE_ENV',
    'PHONEPE_MERCHANT_ID',
    'NEXT_PUBLIC_BASE_URL',
]);

function readEnv(): Record<string, string> {
    try {
        return fs.readFileSync(ENV_FILE, 'utf8')
            .split('\n')
            .reduce<Record<string, string>>((acc, line) => {
                const trimmed = line.trim();
                if (!trimmed || trimmed.startsWith('#')) return acc;
                const eq = trimmed.indexOf('=');
                if (eq === -1) return acc;
                acc[trimmed.slice(0, eq)] = trimmed.slice(eq + 1);
                return acc;
            }, {});
    } catch { return {}; }
}

function writeEnv(env: Record<string, string>) {
    const lines = Object.entries(env).map(([k, v]) => `${k}=${v}`);
    fs.writeFileSync(ENV_FILE, lines.join('\n') + '\n', 'utf8');
}

// GET — return editable keys (mask secrets)
export async function GET(req: NextRequest) {
    if (!isAdminRequest(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const env = readEnv();
    const result: Record<string, string> = {};
    for (const key of EDITABLE_KEYS) {
        const val = env[key] ?? '';
        // Mask sensitive values — show only last 4 chars
        const isSensitive = key.includes('SECRET') || key === 'ADMIN_PASSWORD';
        result[key] = isSensitive && val.length > 4 ? '•'.repeat(val.length - 4) + val.slice(-4) : val;
    }
    return NextResponse.json(result);
}

// POST — update one or more editable keys
export async function POST(req: NextRequest) {
    if (!isAdminRequest(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const body = await req.json() as Record<string, string>;

    // Only allow whitelisted keys
    const updates: Record<string, string> = {};
    for (const [k, v] of Object.entries(body)) {
        if (!EDITABLE_KEYS.has(k)) continue;
        if (typeof v !== 'string') continue;
        // Ignore if still masked (user didn't change the value)
        if (/^•+.{0,4}$/.test(v)) continue;
        updates[k] = v;
    }

    if (!Object.keys(updates).length) {
        return NextResponse.json({ ok: true, updated: 0 });
    }

    const env = readEnv();
    Object.assign(env, updates);
    writeEnv(env);

    return NextResponse.json({ ok: true, updated: Object.keys(updates).length });
}
