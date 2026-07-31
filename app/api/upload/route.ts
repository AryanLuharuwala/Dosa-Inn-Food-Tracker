import { NextRequest, NextResponse } from 'next/server';
import { BlobServiceClient } from '@azure/storage-blob';
import { isAdminRequest } from '@/lib/apiAuth';
import fs from 'fs';
import path from 'path';

const MAX_SIZE_BYTES = 5 * 1024 * 1024;
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

const UPLOAD_DIR = path.join(process.cwd(), 'public', 'uploads');

export async function POST(req: NextRequest) {
    if (!await isAdminRequest(req)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const formData = await req.formData();
    const file = formData.get('file') as File | null;

    if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    if (file.size > MAX_SIZE_BYTES) return NextResponse.json({ error: 'File too large (max 5 MB)' }, { status: 413 });
    if (!ALLOWED_TYPES.includes(file.type)) return NextResponse.json({ error: 'Invalid file type' }, { status: 400 });

    // Strip to bare alphanumerics — the raw extension ends up in a real
    // filesystem path for the local fallback below, so anything else
    // (slashes, dots, ..) is a path-traversal risk.
    const rawExt = (file.name.split('.').pop() ?? '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 10);
    const ext = rawExt || 'jpg';
    const safeName = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

    const buffer = Buffer.from(await file.arrayBuffer());
    const connStr = process.env.AZURE_STORAGE_CONNECTION_STRING;

    if (connStr) {
        const containerName = process.env.AZURE_STORAGE_CONTAINER_NAME || 'uploads';
        const blobService = BlobServiceClient.fromConnectionString(connStr);
        const container = blobService.getContainerClient(containerName);
        await container.createIfNotExists({ access: 'blob' });

        const blob = container.getBlockBlobClient(safeName);
        await blob.upload(buffer, buffer.length, {
            blobHTTPHeaders: {
                blobContentType: file.type,
                blobCacheControl: 'public, max-age=31536000, immutable',
            },
        });

        return NextResponse.json({ url: blob.url });
    }

    // No Azure Blob configured (e.g. self-hosted locally) — write to
    // public/uploads and serve it back through /api/uploads/[filename]
    // (app/api/uploads/[filename]/route.ts), NOT Next's static public/
    // handling — that only recognizes files present at build time, so
    // anything written here at runtime would 404 until the next rebuild.
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    fs.writeFileSync(path.join(UPLOAD_DIR, safeName), buffer);

    const base = process.env.NEXT_PUBLIC_BASE_URL?.trim().replace(/\/$/, '') ?? '';
    return NextResponse.json({ url: `${base}/api/uploads/${safeName}` });
}
