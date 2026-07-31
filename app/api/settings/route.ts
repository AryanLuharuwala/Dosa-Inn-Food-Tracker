import { NextRequest, NextResponse } from 'next/server';
import { isAdminRequest } from '@/lib/apiAuth';
import fs from 'fs';
import path from 'path';

const ENV_FILE = path.join(process.cwd(), '.env.local');

const EDITABLE_KEYS = [
    'ADMIN_PASSWORD',
    'CASHFREE_APP_ID',
    'CASHFREE_SECRET_KEY',
    'CASHFREE_ENV',
    'NEXT_PUBLIC_BASE_URL',
    'DEBUG_TEST_PHONES',
] as const;

const SENSITIVE_KEYS = new Set(['ADMIN_PASSWORD', 'CASHFREE_SECRET_KEY']);

function readEnvFile(): Record<string, string> {
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

function writeEnvFile(env: Record<string, string>) {
    try {
        const lines = Object.entries(env).map(([k, v]) => `${k}=${v}`);
        fs.writeFileSync(ENV_FILE, lines.join('\n') + '\n', 'utf8');
    } catch {
        // On Azure Web App the working directory is read-only — silently skip.
        // Settings are applied via Azure App Configuration, not .env.local.
    }
}

function mask(key: string, val: string): string {
    if (SENSITIVE_KEYS.has(key) && val.length > 4) {
        return '•'.repeat(val.length - 4) + val.slice(-4);
    }
    return val;
}

// GET — return current values from process.env (works on both local and Azure)
export async function GET(req: NextRequest) {
    if (!await isAdminRequest(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const result: Record<string, string> = {};
    for (const key of EDITABLE_KEYS) {
        const val = process.env[key] ?? '';
        result[key] = mask(key, val);
    }
    return NextResponse.json(result);
}

// POST — update one or more editable keys
export async function POST(req: NextRequest) {
    if (!await isAdminRequest(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json() as Record<string, string>;

    const updates: Record<string, string> = {};
    for (const key of EDITABLE_KEYS) {
        const v = body[key];
        if (typeof v !== 'string') continue;
        if (!v.trim()) continue;                     // skip blank fields
        if (/^•+.{0,4}$/.test(v)) continue;         // skip masked values (unchanged)
        updates[key] = v;
    }

    if (!Object.keys(updates).length) {
        return NextResponse.json({ ok: true, updated: 0 });
    }

    // Apply to process.env so the running instance picks them up immediately
    for (const [k, v] of Object.entries(updates)) {
        process.env[k] = v;
    }

    // Persist to .env.local for local dev (no-op on Azure)
    const env = readEnvFile();
    Object.assign(env, updates);
    writeEnvFile(env);

    return NextResponse.json({ ok: true, updated: Object.keys(updates).length });
}
