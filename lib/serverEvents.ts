/**
 * Server-side event bus — backed by Redis Pub/Sub.
 *
 * emit()     → publishes to Redis channel (works across all Azure instances)
 * subscribe()→ subscribes a local SSE listener via a dedicated Redis subscriber client
 *
 * Falls back to in-process Map if Redis is unavailable (single-instance dev mode).
 */

import { createClient } from 'redis';
import { getRedis } from './db';

type Listener = (resource: string) => void;

// ── Local in-process listeners (SSE connections on THIS instance) ─────────────

declare global {
    var __sseListeners: Map<string, Set<Listener>> | undefined;
    var __sseRedisSubscriber: ReturnType<typeof createClient> | undefined;
}

const listeners: Map<string, Set<Listener>> =
    globalThis.__sseListeners ?? (globalThis.__sseListeners = new Map());

// ── Redis subscriber (one dedicated client for subscriptions) ─────────────────

function getSubscriberClient() {
    if (globalThis.__sseRedisSubscriber) return globalThis.__sseRedisSubscriber;

    const pub = getRedis();
    // Redis subscribe requires a duplicate client — the original stays in command mode
    const sub = pub.duplicate();
    sub.on('error', (e) => console.error('[SSE redis sub]', e.message));
    sub.connect().catch((e) => console.error('[SSE redis sub connect]', e.message));

    // Route all incoming Redis messages to local listeners
    sub.pSubscribe('sse:*', (message, channel) => {
        // channel = "sse:menu", "sse:kitchen", etc.
        const ch = channel.replace(/^sse:/, '');
        const resource = message;
        listeners.get(ch)?.forEach(fn => fn(resource));
        if (ch !== '*') listeners.get('*')?.forEach(fn => fn(resource));
    }).catch((e) => console.error('[SSE pSubscribe]', e.message));

    globalThis.__sseRedisSubscriber = sub;
    return sub;
}

// Ensure the subscriber is wired up when this module loads (server-side)
if (typeof window === 'undefined') {
    try { getSubscriberClient(); } catch { /* Redis may not be available in build */ }
}

// ── Public API ────────────────────────────────────────────────────────────────

/** Register a listener for a channel. Returns an unsubscribe function. */
export function subscribe(channel: string, fn: Listener): () => void {
    if (!listeners.has(channel)) listeners.set(channel, new Set());
    listeners.get(channel)!.add(fn);
    return () => listeners.get(channel)?.delete(fn);
}

/** Publish an event — reaches SSE clients on ALL instances via Redis. */
export function emit(channel: string, resource: string) {
    // Publish to Redis (async, fire-and-forget)
    getRedis()
        .publish(`sse:${channel}`, resource)
        .catch(() => {
            // Redis unavailable — fall back to local dispatch (single-instance only)
            listeners.get(channel)?.forEach(fn => fn(resource));
            if (channel !== '*') listeners.get('*')?.forEach(fn => fn(resource));
        });
}
