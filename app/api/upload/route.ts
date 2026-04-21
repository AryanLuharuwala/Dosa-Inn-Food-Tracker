import { NextRequest, NextResponse } from 'next/server';
import { BlobServiceClient } from '@azure/storage-blob';
import { isAdminRequest } from '@/lib/apiAuth';

const MAX_SIZE_BYTES = 5 * 1024 * 1024;
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

export async function POST(req: NextRequest) {
    if (!isAdminRequest(req)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const formData = await req.formData();
    const file = formData.get('file') as File | null;

    if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    if (file.size > MAX_SIZE_BYTES) return NextResponse.json({ error: 'File too large (max 5 MB)' }, { status: 413 });
    if (!ALLOWED_TYPES.includes(file.type)) return NextResponse.json({ error: 'Invalid file type' }, { status: 400 });

    const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg';
    const safeName = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

    const connStr = process.env.AZURE_STORAGE_CONNECTION_STRING;
    if (!connStr) return NextResponse.json({ error: 'Storage not configured' }, { status: 500 });

    const containerName = process.env.AZURE_STORAGE_CONTAINER_NAME || 'uploads';
    const buffer = Buffer.from(await file.arrayBuffer());

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
