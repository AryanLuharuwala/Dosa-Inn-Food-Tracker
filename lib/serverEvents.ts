/**
 * Server-side event bus. API routes call `emit(channel, resource)` after mutating data.
 * The SSE endpoint holds open responses and flushes them when notified.
 * Works in Node.js runtime only (not Edge).
 *
 * Stored on `globalThis` so that Next.js hot-reload in dev (which re-evaluates
 * modules but reuses the same Node process) doesn't create a fresh Map and lose
 * all existing SSE subscribers.
 */

type Listener = (resource: string) => void;

declare global {
    // eslint-disable-next-line no-var
    var __sseListeners: Map<string, Set<Listener>> | undefined;
}

const listeners: Map<string, Set<Listener>> =
    globalThis.__sseListeners ?? (globalThis.__sseListeners = new Map());

export function subscribe(channel: string, fn: Listener): () => void {
    if (!listeners.has(channel)) listeners.set(channel, new Set());
    listeners.get(channel)!.add(fn);
    return () => listeners.get(channel)?.delete(fn);
}

export function emit(channel: string, resource: string) {
    listeners.get(channel)?.forEach(fn => fn(resource));
    if (channel !== '*') listeners.get('*')?.forEach(fn => fn(resource));
}
