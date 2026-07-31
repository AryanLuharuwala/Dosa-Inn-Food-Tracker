import { NextRequest, NextResponse } from 'next/server';
import { isAdminRequest } from '@/lib/apiAuth';

// GET /api/auth/me — cheap, public probe so client UI (e.g. the sidebar's
// Staff section) can tell whether this browser holds a valid admin session,
// without exposing anything about the session itself.
export async function GET(req: NextRequest) {
    return NextResponse.json({ isAdmin: await isAdminRequest(req) });
}
