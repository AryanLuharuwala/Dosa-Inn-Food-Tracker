'use client';

import React, { useState } from 'react';
import { usePrinter } from './usePrinter';
import { useEspPrinterStatus } from './useEspPrinterStatus';

/**
 * Small pill in the admin top bar showing printer availability and gating
 * the browser-BLE connect flow.
 *
 * Two paths feed into "printer available":
 *   1. Browser Web Bluetooth pairing (direct BLE)
 *   2. ESP32 bridge online (any registered device with last_seen < 60s)
 *
 * If neither is available the button still lets you trigger Web Bluetooth.
 * If only the ESP is online we render a non-interactive green badge —
 * print jobs flow through the server queue, no browser pairing needed.
 */
export default function PrinterHeaderButton() {
    const { isSupported, isConnected, isReconnecting, deviceName, connect, disconnect } = usePrinter();
    const esp = useEspPrinterStatus();
    const [busy, setBusy] = useState(false);

    // No Web Bluetooth AND no ESP → hide entirely (incompatible env, no devices)
    if (!isSupported && !esp.online) {
        return null;
    }

    const onClick = async () => {
        if (!isSupported) return; // can't pair browser BLE here
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
            if (/cancel/i.test(msg) || /No matching|chooser/i.test(msg)) return;
            alert(msg + '\n\nTip: open Admin → WA tab → Bluetooth Printer for the full troubleshooting checklist.');
        } finally {
            setBusy(false);
        }
    };

    // "any path connected" → green
    const anyConnected = isConnected || esp.online;
    const label =
        busy            ? '…'                          :
        isReconnecting  ? 'Reconnecting…'              :
        isConnected     ? (deviceName ?? 'Printer')    :
        esp.online      ? `ESP: ${esp.label ?? 'online'}` :
        'Connect Printer';
    const title =
        isConnected && esp.online ? `Connected to ${deviceName} (browser BLE) + ESP ${esp.label} online` :
        isConnected               ? `Connected to ${deviceName ?? 'printer'} — click to disconnect` :
        esp.online                ? `ESP bridge ${esp.label ?? ''} online (printing via server queue)` :
        isReconnecting            ? 'Reconnecting to printer…' :
                                    'Connect Bluetooth printer';

    return (
        <button
            type="button"
            onClick={onClick}
            disabled={busy || isReconnecting || (!isSupported)}
            title={title}
            style={{
                marginRight: 8,
                padding: '6px 12px',
                background: anyConnected ? '#16a34a' : isReconnecting ? '#d97706' : '#374151',
                color: 'white',
                border: 'none',
                borderRadius: 6,
                fontSize: 14,
                fontWeight: 600,
                cursor: !isSupported ? 'default' : (busy || isReconnecting) ? 'wait' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                opacity: busy ? 0.6 : 1,
            }}
        >
            <span aria-hidden style={{ fontSize: 14 }}>🖨</span>
            <span>{label}</span>
            <span aria-hidden style={{
                width: 8, height: 8, borderRadius: '50%',
                background: anyConnected ? '#86efac' : isReconnecting ? '#fde68a' : '#9ca3af',
            }} />
        </button>
    );
}
