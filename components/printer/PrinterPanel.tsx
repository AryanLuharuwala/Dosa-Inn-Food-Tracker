'use client';

import React, { useState } from 'react';
import { usePrinter } from './usePrinter';

interface Props {
    restaurantName: string;
    /** Optional CSS class for the outer container (so it can match host styles). */
    className?: string;
    /** Current configured KOT copies. If omitted, copies UI is hidden. */
    kotCopies?: number;
    /** Current configured Bill copies. If omitted, copies UI is hidden. */
    billCopies?: number;
    /** Persist new copy counts. Required if kotCopies/billCopies are passed. */
    onCopiesChange?: (kot: number, bill: number) => Promise<void> | void;
    /** Auto-print every newly-arrived order as a KOT. */
    autoPrintOrders?: boolean;
    /** Persist the auto-print toggle state. */
    onAutoPrintChange?: (enabled: boolean) => Promise<void> | void;
    /** Optional handler — when wired, shows a "Print Today's Stats" button. */
    onPrintStats?: () => Promise<void> | void;
}

/**
 * Bluetooth printer connection card. Drop into any admin surface — it manages
 * its own state via the singleton printer client.
 */
export default function PrinterPanel({
    restaurantName,
    className,
    kotCopies,
    billCopies,
    onCopiesChange,
    autoPrintOrders,
    onAutoPrintChange,
    onPrintStats,
}: Props) {
    const { isSupported, isConnected, deviceName, diagnostics, connect, connectShowAll, disconnect, printTest } = usePrinter();
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [testStatus, setTestStatus] = useState<'idle' | 'printing' | 'sent'>('idle');
    const [savingCopies, setSavingCopies] = useState(false);

    const showCopiesUI = typeof kotCopies === 'number' && typeof billCopies === 'number' && !!onCopiesChange;
    const handleCopiesChange = async (kind: 'kot' | 'bill', value: number) => {
        if (!showCopiesUI) return;
        const k = kind === 'kot' ? value : (kotCopies as number);
        const b = kind === 'bill' ? value : (billCopies as number);
        setSavingCopies(true);
        try { await onCopiesChange!(k, b); }
        finally { setSavingCopies(false); }
    };

    const handleConnect = async () => {
        setError(null);
        setBusy(true);
        try { await connect(); }
        catch (e) {
            const msg = (e as Error).message;
            // User cancelling the device picker is harmless — don't surface it.
            // The picker emits "User cancelled the requestDevice() chooser." or
            // a NotFoundError when no device is selected.
            if (/cancel/i.test(msg) || /No matching|chooser/i.test(msg)) return;
            setError(msg);
        }
        finally { setBusy(false); }
    };

    const handleConnectShowAll = async () => {
        setError(null);
        setBusy(true);
        try { await connectShowAll(); }
        catch (e) {
            const msg = (e as Error).message;
            if (/cancel/i.test(msg) || /No matching|chooser/i.test(msg)) return;
            setError(msg);
        }
        finally { setBusy(false); }
    };

    const handleDisconnect = async () => {
        setBusy(true);
        try { await disconnect(); } finally { setBusy(false); }
    };

    const handleTest = async () => {
        setError(null);
        setTestStatus('printing');
        try {
            await printTest(restaurantName);
            setTestStatus('sent');
            setTimeout(() => setTestStatus('idle'), 2500);
        } catch (e) {
            setError((e as Error).message);
            setTestStatus('idle');
        }
    };

    if (!isSupported) {
        return (
            <div className={className} style={{ padding: 16 }}>
                <h3 style={{ marginTop: 0 }}>Bluetooth Printer</h3>
                <p style={{ fontSize: '0.875rem', color: '#666', margin: 0 }}>
                    Web Bluetooth isn&apos;t supported in this browser. Use Chrome or Edge on
                    desktop, or Chrome on Android. (iOS Safari does not support Web Bluetooth.)
                </p>
            </div>
        );
    }

    return (
        <div className={className} style={{ padding: 16 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 8 }}>
                <div style={{ flex: 1 }}>
                    <h3 style={{ marginTop: 0, marginBottom: 4 }}>Bluetooth Printer</h3>
                    <p style={{ fontSize: '0.875rem', color: '#666', margin: 0 }}>
                        {isConnected
                            ? <>Connected to <strong>{deviceName ?? 'printer'}</strong>. Use the Print buttons on each order to print KOTs and bills.</>
                            : 'Connect a BLE thermal printer (most 58mm/80mm POS printers work). Bluetooth Classic / SPP-only printers won\'t appear in the picker.'}
                    </p>
                </div>
                <span style={{
                    flexShrink: 0,
                    width: 10, height: 10, borderRadius: '50%',
                    background: isConnected ? '#22c55e' : '#9ca3af',
                    boxShadow: isConnected ? '0 0 0 4px rgba(34,197,94,0.15)' : undefined,
                    marginTop: 8,
                }} aria-label={isConnected ? 'Connected' : 'Disconnected'} />
            </div>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                {!isConnected ? (
                    <>
                        <button
                            type="button"
                            onClick={handleConnect}
                            disabled={busy}
                            style={btnPrimary}
                        >
                            {busy ? 'Connecting…' : 'Connect Printer'}
                        </button>
                        <button
                            type="button"
                            onClick={handleConnectShowAll}
                            disabled={busy}
                            style={{
                                background: 'transparent',
                                color: '#666',
                                border: 'none',
                                fontSize: '0.8rem',
                                padding: '8px 4px',
                                textDecoration: 'underline',
                                cursor: busy ? 'wait' : 'pointer',
                            }}
                            title="Bypass the name-prefix filter and show every nearby BLE device"
                        >
                            don&apos;t see your printer?
                        </button>
                    </>
                ) : (
                    <>
                        <button
                            type="button"
                            onClick={handleTest}
                            disabled={testStatus === 'printing'}
                            style={btnPrimary}
                        >
                            {testStatus === 'printing' ? 'Printing…' : testStatus === 'sent' ? 'Sent ✓' : 'Print Test Page'}
                        </button>
                        {onPrintStats && (
                            <button
                                type="button"
                                onClick={async () => {
                                    setError(null);
                                    try { await onPrintStats(); }
                                    catch (e) { setError((e as Error).message); }
                                }}
                                style={btnSecondary}
                            >
                                Print Today&apos;s Stats
                            </button>
                        )}
                        <button
                            type="button"
                            onClick={handleDisconnect}
                            disabled={busy}
                            style={btnSecondary}
                        >
                            Disconnect
                        </button>
                    </>
                )}
            </div>

            {error && (
                <div style={{ marginTop: 12, padding: '10px 14px', background: '#fef2f2', color: '#991b1b', borderRadius: 6, fontSize: '0.85rem', lineHeight: 1.5 }}>
                    <div style={{ fontWeight: 600, marginBottom: 6 }}>Couldn&apos;t connect</div>
                    <div style={{ whiteSpace: 'pre-wrap' }}>{error}</div>
                    <details style={{ marginTop: 10 }}>
                        <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Troubleshooting checklist</summary>
                        <ol style={{ margin: '8px 0 0 18px', padding: 0 }}>
                            <li>Close the <strong>iPrint</strong> app on your phone if it&apos;s open — most thermal printers only allow one connection.</li>
                            <li>Open your phone/computer Bluetooth settings → if the printer is listed there, <strong>unpair / forget</strong> it. Web Bluetooth needs to handle the pairing itself.</li>
                            <li>Press the printer&apos;s power button briefly to wake it (the LED should be solid, not blinking).</li>
                            <li>Click <strong>Connect Printer</strong> again — the first attempt sometimes fails immediately after another app released the printer.</li>
                            <li>If still nothing: try a hard reset of the printer (hold power for 5+ sec until it beeps), then retry.</li>
                            <li>If it consistently fails after pairing: this printer model may use Bluetooth Classic / SPP (not BLE), which the browser cannot reach. Tell me the model and we&apos;ll figure out next steps.</li>
                        </ol>
                    </details>
                </div>
            )}

            {isConnected && diagnostics && (
                <details style={{ marginTop: 12, fontSize: '0.75rem', color: '#666' }}>
                    <summary style={{ cursor: 'pointer' }}>
                        Diagnostics ({diagnostics.protocol === 'catprinter' ? 'iPrint / cat-printer protocol' : 'ESC/POS'})
                    </summary>
                    <div style={{ marginTop: 6, padding: 8, background: '#f9fafb', borderRadius: 4, fontFamily: 'monospace' }}>
                        <div>Protocol: {diagnostics.protocol}</div>
                        <div>Service: {diagnostics.service}</div>
                        <div>Characteristic: {diagnostics.characteristic}</div>
                        <div>Properties: {diagnostics.properties.join(', ') || '—'}</div>
                    </div>
                    <p style={{ marginTop: 6 }}>
                        {diagnostics.protocol === 'catprinter'
                            ? 'Receipts render to a 384-px bitmap and ship as framed packets. If output is blank, try lowering print speed in lib/catPrinter.ts (DEFAULT_SPEED).'
                            : 'Receipts ship as raw ESC/POS bytes. If output is garbled, the printer may need a different code page.'}
                    </p>
                </details>
            )}

            {typeof autoPrintOrders === 'boolean' && onAutoPrintChange && (
                <div style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid rgba(0,0,0,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                    <div style={{ flex: 1 }}>
                        <p style={{ fontSize: '0.85rem', color: '#444', margin: '0 0 2px 0', fontWeight: 600 }}>
                            Auto-print incoming orders
                        </p>
                        <p style={{ fontSize: '0.75rem', color: '#888', margin: 0 }}>
                            When ON, every new order auto-prints a KOT (uses the KOT copies setting). Requires a connected printer.
                        </p>
                    </div>
                    <button
                        type="button"
                        role="switch"
                        aria-checked={autoPrintOrders}
                        onClick={() => onAutoPrintChange(!autoPrintOrders)}
                        style={{
                            position: 'relative', flexShrink: 0,
                            width: 48, height: 26, borderRadius: 999, border: 'none', cursor: 'pointer',
                            background: autoPrintOrders ? 'var(--color-primary, #1a4d2e)' : '#ccc',
                            transition: 'background 0.15s',
                        }}
                    >
                        <span style={{
                            position: 'absolute', top: 2,
                            left: autoPrintOrders ? 24 : 2,
                            width: 22, height: 22, borderRadius: '50%',
                            background: '#fff',
                            transition: 'left 0.15s',
                            boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                        }} />
                    </button>
                </div>
            )}

            {showCopiesUI && (
                <div style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid rgba(0,0,0,0.08)' }}>
                    <p style={{ fontSize: '0.85rem', color: '#444', margin: '0 0 8px 0', fontWeight: 600 }}>
                        Copies per print
                    </p>
                    <p style={{ fontSize: '0.75rem', color: '#888', margin: '0 0 10px 0' }}>
                        Multiple prints are queued — one finishes before the next starts.
                    </p>
                    <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                        <CopiesField
                            label="KOT (Kitchen)"
                            value={kotCopies as number}
                            disabled={savingCopies}
                            onChange={v => handleCopiesChange('kot', v)}
                        />
                        <CopiesField
                            label="Bill"
                            value={billCopies as number}
                            disabled={savingCopies}
                            onChange={v => handleCopiesChange('bill', v)}
                        />
                    </div>
                </div>
            )}
        </div>
    );
}

function CopiesField({ label, value, disabled, onChange }: { label: string; value: number; disabled: boolean; onChange: (v: number) => void }) {
    return (
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.85rem', color: '#444' }}>
            <span>{label}</span>
            <select
                value={value}
                disabled={disabled}
                onChange={e => onChange(parseInt(e.target.value, 10))}
                style={{ padding: '4px 8px', borderRadius: 4, border: '1px solid #ccc', fontSize: '0.85rem' }}
            >
                {[1, 2, 3, 4, 5].map(n => (
                    <option key={n} value={n}>{n} {n === 1 ? 'copy' : 'copies'}</option>
                ))}
            </select>
        </label>
    );
}

const btnPrimary: React.CSSProperties = {
    padding: '8px 16px',
    borderRadius: 6,
    border: 'none',
    background: 'var(--color-primary, #1a4d2e)',
    color: 'white',
    fontSize: '0.875rem',
    fontWeight: 600,
    cursor: 'pointer',
};

const btnSecondary: React.CSSProperties = {
    padding: '8px 16px',
    borderRadius: 6,
    border: '1px solid #ddd',
    background: 'white',
    color: '#333',
    fontSize: '0.875rem',
    fontWeight: 500,
    cursor: 'pointer',
};
