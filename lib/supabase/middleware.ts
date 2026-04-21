// Stub — Supabase removed. Auth handled by middleware.ts cookie check.
import { NextRequest, NextResponse } from 'next/server';
export async function updateSession(request: NextRequest) {
    return NextResponse.next({ request: { headers: request.headers } });
}
