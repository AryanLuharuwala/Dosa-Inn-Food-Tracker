import { NextRequest, NextResponse } from 'next/server';

const PROTECTED = ['/admin', '/kitchen', '/cook'];

export function middleware(request: NextRequest) {
    const { pathname } = request.nextUrl;
    const isProtected = PROTECTED.some(p => pathname.startsWith(p));

    if (isProtected) {
        const session = request.cookies.get('admin_session')?.value;
        if (session !== 'authenticated') {
            return NextResponse.redirect(new URL('/login', request.url));
        }
    }

    return NextResponse.next();
}

export const config = {
    matcher: [
        '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
    ],
};
