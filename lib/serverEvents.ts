// In-process SSE event bus (single-instance).
// For multi-instance deployments, swap emit() to use a message broker.

type Listener = (resource: string) => void;

declare global {
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
