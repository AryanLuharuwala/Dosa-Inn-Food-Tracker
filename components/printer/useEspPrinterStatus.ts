'use client';

import { useEffect, useState } from 'react';

/**
 * Polls /api/print/devices and reports whether any ESP32 printer bridge has
 * checked in recently. Used by the admin UI so the printer availability
 * indicator goes green when the ESP is online even if the browser hasn't
 * paired over Web Bluetooth.
 *
 * Online threshold: 60s — twice the ESP's long-poll window so a single missed
 * cycle doesn't flap the indicator.
 */
export interface EspPrinterStatus {
    online: boolean;
    label: string | null;
    lastSeenMs: number | null;
}

// Long-poll cycle is ~30s on the ESP, plus DB write latency + UI poll latency.
// 120s threshold means we forgive 1 missed cycle before flipping to offline,
// 5s UI poll keeps the indicator fresh.
const ONLINE_THRESHOLD_MS = 120_000;
const POLL_INTERVAL_MS    = 5_000;

interface DeviceRow {
    id: string;
    label: string;
    last_seen_at: string | null;
    revoked: boolean;
}

export function useEspPrinterStatus(): EspPrinterStatus {
    const [status, setStatus] = useState<EspPrinterStatus>({ online: false, label: null, lastSeenMs: null });

    useEffect(() => {
        let cancelled = false;
        const tick = async () => {
            try {
                const res = await fetch('/api/print/devices');
                if (!res.ok) return;
                const devices: DeviceRow[] = await res.json();
                const active = devices.filter(d => !d.revoked && d.last_seen_at);
                let bestAgo = Infinity;
                let bestLabel: string | null = null;
                for (const d of active) {
                    const ago = Date.now() - new Date(d.last_seen_at!).getTime();
                    if (ago < bestAgo) { bestAgo = ago; bestLabel = d.label; }
                }
                if (cancelled) return;
                setStatus({
                    online: bestAgo < ONLINE_THRESHOLD_MS,
                    label: bestLabel,
                    lastSeenMs: bestAgo === Infinity ? null : bestAgo,
                });
            } catch {
                // network blip — keep previous state silently
            }
        };
        tick();
        const t = setInterval(tick, POLL_INTERVAL_MS);
        return () => { cancelled = true; clearInterval(t); };
    }, []);

    return status;
}
