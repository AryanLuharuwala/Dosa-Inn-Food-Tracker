// Session = visitor UUID stored in a cookie (set client-side on first visit).
// Used to associate orders with the visitor for order tracking.

const VISITOR_COOKIE = 'visitor_id';

function generateId(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = Math.random() * 16 | 0;
        return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
}

function getCookie(name: string): string | null {
    if (typeof document === 'undefined') return null;
    const match = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
    return match ? decodeURIComponent(match[1]) : null;
}

function setCookie(name: string, value: string, days = 365) {
    const expires = new Date(Date.now() + days * 864e5).toUTCString();
    document.cookie = `${name}=${encodeURIComponent(value)}; expires=${expires}; path=/; SameSite=Lax`;
}

export async function ensureSession(): Promise<string | null> {
    if (typeof document === 'undefined') return null;
    let id = getCookie(VISITOR_COOKIE);
    if (!id) {
        id = generateId();
        setCookie(VISITOR_COOKIE, id);
    }
    return id;
}

export async function getSessionUserId(): Promise<string | null> {
    if (typeof document === 'undefined') return null;
    return getCookie(VISITOR_COOKIE);
}
