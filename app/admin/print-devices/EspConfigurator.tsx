'use client';

import React, { useState } from 'react';

/**
 * Web Bluetooth client that talks to the ESP32 bridge's BLE config GATT
 * service (advertised as "ESP32-printer-cfg"). Used for first-time setup
 * (WiFi creds, server URL, device token) without needing to re-flash.
 *
 * The ESP exposes:
 *   CFG_SVC     daa10001-…
 *   CFG_STATUS  daa10002-…  read+notify   JSON status
 *   CFG_WRITE   daa10003-…  write         JSON { field, value }
 *   CFG_APPLY   daa10004-…  write         "reboot" | "wifi"
 */

const CFG_SVC    = 'daa10001-1234-1234-1234-123456789abc';
const CFG_STATUS = 'daa10002-1234-1234-1234-123456789abc';
const CFG_WRITE  = 'daa10003-1234-1234-1234-123456789abc';
const CFG_APPLY  = 'daa10004-1234-1234-1234-123456789abc';

const FIELDS: { key: string; label: string; secret?: boolean; help?: string }[] = [
    { key: 'wifi_ssid',     label: 'WiFi SSID' },
    { key: 'wifi_identity', label: 'WiFi Identity (WPA2-E)', help: 'Leave blank for plain WPA2' },
    { key: 'wifi_username', label: 'WiFi Username (WPA2-E)' },
    { key: 'wifi_password', label: 'WiFi Password',  secret: true },
    { key: 'server_base',   label: 'Server URL',     help: 'e.g. http://pollys.food' },
    { key: 'device_id',     label: 'Device label' },
    { key: 'device_token',  label: 'Device token',   secret: true, help: 'From the device row above' },
];

interface Status {
    label?: string;
    ip?: string;
    rssi?: number;
    wifiOk?: boolean;
    fw?: string;
    hasToken?: boolean;
}

export interface EspConfiguratorProps {
    /** Initial values to pre-fill the form (e.g. when a device was just
     *  created and we know its label + token). Re-rendering with a new
     *  prefill object resets the form via the parent's `key` prop. */
    prefill?: Record<string, string>;
    /** Highlight the section (e.g. when scrolled to it after creating a device). */
    highlight?: boolean;
}

export default function EspConfigurator({ prefill, highlight }: EspConfiguratorProps = {}) {
    const [device, setDevice] = useState<BluetoothDevice | null>(null);
    const [server, setServer] = useState<BluetoothRemoteGATTServer | null>(null);
    const [chars, setChars] = useState<{ status?: BluetoothRemoteGATTCharacteristic; write?: BluetoothRemoteGATTCharacteristic; apply?: BluetoothRemoteGATTCharacteristic }>({});
    const [status, setStatus] = useState<Status | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [values, setValues] = useState<Record<string, string>>(prefill ?? {});

    const supported = typeof navigator !== 'undefined' && 'bluetooth' in navigator;

    const onConnect = async () => {
        setBusy(true); setError(null);
        try {
            const dev = await navigator.bluetooth.requestDevice({
                filters: [{ services: [CFG_SVC] }],
                optionalServices: [CFG_SVC],
            });
            const srv = await dev.gatt!.connect();
            const svc = await srv.getPrimaryService(CFG_SVC);
            const status  = await svc.getCharacteristic(CFG_STATUS);
            const write   = await svc.getCharacteristic(CFG_WRITE);
            const apply   = await svc.getCharacteristic(CFG_APPLY);
            await status.startNotifications();
            // TS lib for Web Bluetooth is incomplete (no addEventListener,
            // no `value` property declared) — use a minimal structural type.
            type CharLike = EventTarget & { value?: DataView };
            (status as unknown as CharLike).addEventListener('characteristicvaluechanged', (e: Event) => {
                const v = (e.target as unknown as CharLike)?.value;
                if (!v) return;
                try { setStatus(JSON.parse(new TextDecoder().decode(v))); } catch {}
            });
            const initial = await status.readValue();
            try { setStatus(JSON.parse(new TextDecoder().decode(initial))); } catch {}

            setDevice(dev); setServer(srv); setChars({ status, write, apply });
        } catch (e) {
            const msg = (e as Error).message;
            if (!/cancel|chooser/i.test(msg)) setError(msg);
        } finally {
            setBusy(false);
        }
    };

    const onDisconnect = () => {
        try { server?.disconnect(); } catch {}
        setDevice(null); setServer(null); setChars({}); setStatus(null);
    };

    const writeField = async (key: string, value: string) => {
        if (!chars.write) return;
        const enc = new TextEncoder();
        const payload = enc.encode(JSON.stringify({ field: key, value }));
        await chars.write.writeValueWithResponse(payload);
    };

    const onSaveAll = async () => {
        setBusy(true); setError(null);
        try {
            for (const f of FIELDS) {
                const v = values[f.key];
                if (typeof v === 'string' && v.length > 0) {
                    await writeField(f.key, v);
                }
            }
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setBusy(false);
        }
    };

    const onApply = async (cmd: 'reboot' | 'wifi' | 'wipe') => {
        if (!chars.apply) return;
        setBusy(true); setError(null);
        try {
            await chars.apply.writeValueWithResponse(new TextEncoder().encode(cmd));
            if (cmd === 'reboot' || cmd === 'wipe') {
                // Device will disconnect us as it reboots
                setTimeout(onDisconnect, 1500);
            }
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setBusy(false);
        }
    };

    if (!supported) {
        return (
            <section style={{ padding: 16, background: '#fef3c7', border: '1px solid #f59e0b', borderRadius: 8 }}>
                <strong>Web Bluetooth not available.</strong> Open this page in Chrome or Edge on desktop / Android.
            </section>
        );
    }

    return (
        <section
            id="esp-configurator"
            style={{
                padding: 16,
                background: highlight ? '#fef9c3' : '#f0fdfa',
                border: highlight ? '2px solid #eab308' : '1px solid #14b8a6',
                borderRadius: 8,
                transition: 'background 200ms, border 200ms',
            }}
        >
            <h2 style={{ marginTop: 0 }}>Configure ESP via Bluetooth</h2>
            {highlight && (
                <p style={{ margin: '0 0 12px', fontWeight: 600, color: '#854d0e' }}>
                    Token pre-filled below — click "Search & Connect to ESP", then "Save fields", then "Reboot ESP".
                </p>
            )}
            <p style={{ fontSize: 13, color: '#475569' }}>
                Use this to provision a new ESP32 printer bridge or change its WiFi / server / token.
                Power on the ESP within range and click "Search & Connect" — Chrome will show a picker.
            </p>

            {!device ? (
                <button
                    onClick={onConnect}
                    disabled={busy}
                    style={{
                        padding: '10px 20px',
                        background: '#14b8a6', color: 'white', border: 'none',
                        borderRadius: 8, fontWeight: 700, fontSize: 14,
                        cursor: busy ? 'wait' : 'pointer',
                    }}
                >
                    {busy ? 'Searching…' : '🔍 Search & Connect to ESP'}
                </button>
            ) : (
                <>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                        <div>
                            <strong>Connected:</strong> {device.name ?? 'ESP32-printer-cfg'}
                            {status && (
                                <div style={{ fontSize: 12, color: '#475569', marginTop: 4 }}>
                                    label: <code>{status.label ?? '?'}</code> ·
                                    ip: <code>{status.ip ?? '?'}</code> ·
                                    wifi: {status.wifiOk ? '✓' : '✗'} ·
                                    rssi: {status.rssi ?? '?'} dBm ·
                                    token: {status.hasToken ? '✓' : '✗'} ·
                                    fw: <code>{status.fw ?? '?'}</code>
                                </div>
                            )}
                        </div>
                        <button onClick={onDisconnect} style={{
                            padding: '6px 12px', background: '#dc2626', color: 'white',
                            border: 'none', borderRadius: 6, cursor: 'pointer',
                        }}>Disconnect</button>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12, marginTop: 12 }}>
                        {FIELDS.map(f => (
                            <label key={f.key} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                <span style={{ fontSize: 12, fontWeight: 600, color: '#374151' }}>{f.label}</span>
                                <input
                                    type={f.secret ? 'password' : 'text'}
                                    placeholder={f.help ?? `(leave blank to keep current)`}
                                    value={values[f.key] ?? ''}
                                    onChange={e => setValues(v => ({ ...v, [f.key]: e.target.value }))}
                                    style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid #cbd5e1', fontSize: 14 }}
                                />
                                {f.help && <span style={{ fontSize: 11, color: '#94a3b8' }}>{f.help}</span>}
                            </label>
                        ))}
                    </div>

                    <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
                        <button onClick={onSaveAll} disabled={busy} style={{
                            padding: '10px 16px', background: '#0f766e', color: 'white',
                            border: 'none', borderRadius: 6, fontWeight: 700, cursor: busy ? 'wait' : 'pointer',
                        }}>Save fields</button>
                        <button onClick={() => onApply('wifi')} disabled={busy} style={{
                            padding: '10px 16px', background: '#3b82f6', color: 'white',
                            border: 'none', borderRadius: 6, fontWeight: 700, cursor: busy ? 'wait' : 'pointer',
                        }}>Reconnect WiFi</button>
                        <button onClick={() => onApply('reboot')} disabled={busy} style={{
                            padding: '10px 16px', background: '#ea580c', color: 'white',
                            border: 'none', borderRadius: 6, fontWeight: 700, cursor: busy ? 'wait' : 'pointer',
                        }}>Reboot ESP</button>
                        <button
                            onClick={() => {
                                if (!confirm('Wipe ALL stored config on this ESP? It will reboot and use the compiled-in defaults.')) return;
                                onApply('wipe');
                            }}
                            disabled={busy}
                            style={{
                                padding: '10px 16px', background: '#7f1d1d', color: 'white',
                                border: 'none', borderRadius: 6, fontWeight: 700, cursor: busy ? 'wait' : 'pointer',
                                marginLeft: 'auto',
                            }}
                            title="Clear NVS so the ESP uses the firmware's compiled-in defaults on next boot"
                        >
                            ⚠ Wipe NVS
                        </button>
                    </div>
                </>
            )}

            {error && (
                <div style={{ marginTop: 12, padding: 10, background: '#fee2e2', border: '1px solid #ef4444', borderRadius: 6, color: '#991b1b', fontSize: 13 }}>
                    {error}
                </div>
            )}
        </section>
    );
}
