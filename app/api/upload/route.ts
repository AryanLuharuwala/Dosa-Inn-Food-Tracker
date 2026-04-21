import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { isAdminRequest } from '@/lib/apiAuth';

const MAX_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

export async function POST(req: NextRequest) {
    if (!isAdminRequest(req)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const formData = await req.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
        return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    if (file.size > MAX_SIZE_BYTES) {
        return NextResponse.json({ error: 'File too large (max 5 MB)' }, { status: 413 });
    }

    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (!allowedTypes.includes(file.type)) {
        return NextResponse.json({ error: 'Invalid file type' }, { status: 400 });
    }

    const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg';
    const safeName = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
    const uploadDir = path.join(process.cwd(), 'public', 'uploads');
    fs.mkdirSync(uploadDir, { recursive: true });

    const bytes = await file.arrayBuffer();
    fs.writeFileSync(path.join(uploadDir, safeName), Buffer.from(bytes));

    return NextResponse.json({ url: `/uploads/${safeName}` });
}
