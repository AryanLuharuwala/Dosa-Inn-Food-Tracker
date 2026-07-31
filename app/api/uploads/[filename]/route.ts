import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

// Next's static `public/` serving only recognizes files that existed at
// build time — anything written there at runtime (see app/api/upload's
// local-disk fallback) 404s through the page router instead. This route
// serves them directly off disk so uploads work without a rebuild/restart.

const UPLOAD_DIR = path.join(process.cwd(), 'public', 'uploads');

const CONTENT_TYPES: Record<string, string> = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif',
};

export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ filename: string }> },
) {
    const { filename } = await params;

    // Only bare alphanumeric-dot-dash names are ever written by the upload
    // route — reject anything else outright (path traversal, absolute paths).
    if (!/^[a-z0-9][a-z0-9.-]*$/i.test(filename)) {
        return NextResponse.json({ error: 'Invalid filename' }, { status: 400 });
    }

    const filePath = path.join(UPLOAD_DIR, filename);
    if (path.dirname(filePath) !== UPLOAD_DIR) {
        return NextResponse.json({ error: 'Invalid filename' }, { status: 400 });
    }

    let data: Buffer;
    try {
        data = fs.readFileSync(filePath);
    } catch {
        return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const ext = filename.split('.').pop()?.toLowerCase() ?? '';
    const contentType = CONTENT_TYPES[ext] ?? 'application/octet-stream';

    return new NextResponse(new Uint8Array(data), {
        headers: {
            'Content-Type': contentType,
            'Cache-Control': 'public, max-age=31536000, immutable',
        },
    });
}
