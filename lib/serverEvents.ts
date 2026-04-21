/**
 * Server-side event bus. API routes call `emit(channel)` after mutating data.
 * The SSE endpoint holds open responses and flushes them when notified.
 * Works in Node.js runtime only (not Edge).
 */

type Listener = () => void;

const listeners = new Map<string, Set<Listener>>();

export function subscribe(channel: string, fn: Listener): () => void {
    if (!listeners.has(channel)) listeners.set(channel, new Set());
    listeners.get(channel)!.add(fn);
    return () => listeners.get(channel)?.delete(fn);
}

export function emit(channel: string) {
    listeners.get(channel)?.forEach(fn => fn());
    // Always emit on the wildcard channel so global listeners get notified
    if (channel !== '*') listeners.get('*')?.forEach(fn => fn());
}
