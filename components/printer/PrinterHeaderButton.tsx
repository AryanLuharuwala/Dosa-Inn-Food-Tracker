'use client';

import React, { useState } from 'react';
import { usePrinter } from './usePrinter';

/**
 * Small pill that lives in the admin top bar so the printer connect flow is
 * one tap from any tab. Clicking when disconnected opens the OS device
 * picker; clicking when connected shows the device name + a disconnect
 * affordance via tooltip.
 */
export default function PrinterHeaderButton() {
    const { isSupported, isConnected, deviceName, connect, disconnect } = usePrinter();
    const [busy, setBusy] = useState(false);

    if (!isSupported) {
        return null; // header stays clean on incompatible browsers
    }

    const onClick = async () => {
        setBusy(true);
        try {
            if (isConnected) {
                if (confirm(`Disconnect from "${deviceName ?? 'printer'}"?`)) {
                    await disconnect();
                }
            } else {
                await connect();
            }
        } catch (e) {
            const msg = (e as Error).message;
            // Picker cancel = harmless; everything else (incl. GATT failures
            // from connectGattWithRetry) gets surfaced. The thrown message
            // already includes a remediation hint.
            if (/cancel/i.test(msg) || /No matching|chooser/i.test(msg)) {
                return;
            }
            alert(msg + '\n\nTip: open Admin → WA tab → Bluetooth Printer for the full troubleshooting checklist.');
        } finally {
            setBusy(false);
        }
    };

    return (
        <button
            type="button"
            onClick={onClick}
            disabled={busy}
            title={isConnected ? `Connected to ${deviceName ?? 'printer'} — click to disconnect` : 'Connect Bluetooth printer'}
            style={{
                marginRight: 8,
                padding: '6px 12px',
                background: isConnected ? '#16a34a' : '#374151',
                color: 'white',
                border: 'none',
                borderRadius: 6,
                fontSize: 14,
                fontWeight: 600,
                cursor: busy ? 'wait' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                opacity: busy ? 0.6 : 1,
            }}
        >
            <span aria-hidden style={{ fontSize: 14 }}>🖨</span>
            <span>{busy ? '…' : isConnected ? (deviceName ?? 'Printer') : 'Connect Printer'}</span>
            <span aria-hidden style={{
                width: 8, height: 8, borderRadius: '50%',
                background: isConnected ? '#86efac' : '#9ca3af',
            }} />
        </button>
    );
}
