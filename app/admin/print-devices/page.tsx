'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import styles from './page.module.css';
import EspConfigurator from './EspConfigurator';

interface DeviceSettings {
    role: 'all' | 'kot' | 'bill';
    speed: number;
    energy: number;
    ring: 'short' | 'long';
}

interface Device {
    id: string;
    label: string;
    created_at: string;
    last_seen_at: string | null;
    revoked: boolean;
    settings?: DeviceSettings;
}

interface Job {
    id: string;
    device_id: string | null;
    width: number;
    height: number;
    status: 'queued' | 'inflight' | 'dead';
    attempts: number;
    created_at: string;
    visible_after: string;
}

interface PendingRegistration {
    euidHash: string;
    firstSeenAt: string;
    lastSeenAt: string;
    ip: string | null;
}

function onlineStatus(last_seen_at: string | null): { label: string; online: boolean } {
    if (!last_seen_at) return { label: 'Never seen', online: false };
    const ago = Date.now() - new Date(last_seen_at).getTime();
    if (ago < 30_000) return { label: `Online (${Math.round(ago / 1000)}s ago)`, online: true };
    if (ago < 60_000) return { label: `${Math.round(ago / 1000)}s ago`, online: false };
    if (ago < 3_600_000) return { label: `${Math.round(ago / 60_000)}m ago`, online: false };
    return { label: `${Math.round(ago / 3_600_000)}h ago`, online: false };
}

export default function PrintDevicesPage() {
    const [devices, setDevices] = useState<Device[]>([]);
    const [jobs, setJobs] = useState<Job[]>([]);
    const [loading, setLoading] = useState(true);
    const [newLabel, setNewLabel] = useState('');
    const [creating, setCreating] = useState(false);
    const [newToken, setNewToken] = useState<{ label: string; token: string } | null>(null);
    const [revoking, setRevoking] = useState<string | null>(null);
    const [deletingJob, setDeletingJob] = useState<string | null>(null);
    const [openSettings, setOpenSettings] = useState<string | null>(null);
    const [savingSettings, setSavingSettings] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [pending, setPending] = useState<PendingRegistration[]>([]);
    const [pendingLabels, setPendingLabels] = useState<Record<string, string>>({});
    const [approving, setApproving] = useState<string | null>(null);

    const saveSettings = async (id: string, patch: Partial<DeviceSettings>) => {
        setSavingSettings(true);
        try {
            const res = await fetch(`/api/print/devices/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(patch),
            });
            if (!res.ok) throw new Error(await res.text());
            await load();
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setSavingSettings(false);
        }
    };

    const load = useCallback(async () => {
        const [dRes, jRes, pRes] = await Promise.all([
            fetch('/api/print/devices'),
            fetch('/api/print/jobs'),
            fetch('/api/print/devices/register'),
        ]);
        if (dRes.ok) setDevices(await dRes.json());
        if (jRes.ok) setJobs(await jRes.json());
        if (pRes.ok) setPending(await pRes.json());
        setLoading(false);
    }, []);

    const handleAccept = async (euidHash: string) => {
        const label = pendingLabels[euidHash]?.trim() || `ESP-${euidHash.slice(0, 8)}`;
        setApproving(euidHash);
        setError(null);
        try {
            const res = await fetch(`/api/print/devices/register/${euidHash}/approve`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ label }),
            });
            if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Failed to accept');
            await load();
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setApproving(null);
        }
    };

    useEffect(() => {
        load();
        const t = setInterval(load, 5_000); // tighter refresh — queue moves fast
        return () => clearInterval(t);
    }, [load]);

    const handleDeleteJob = async (id: string) => {
        if (!confirm('Remove this print job from the queue?')) return;
        setDeletingJob(id);
        try {
            const res = await fetch(`/api/print/jobs/${id}`, { method: 'DELETE' });
            if (!res.ok) throw new Error(await res.text());
            await load();
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setDeletingJob(null);
        }
    };

    const handleCreate = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newLabel.trim()) return;
        setCreating(true);
        setError(null);
        try {
            const res = await fetch('/api/print/devices', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ label: newLabel.trim() }),
            });
            if (!res.ok) throw new Error(await res.text());
            const { token } = await res.json();
            setNewToken({ label: newLabel.trim(), token });
            setNewLabel('');
            await load();
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setCreating(false);
        }
    };

    const handleRevoke = async (id: string) => {
        if (!confirm('Revoke this device? It will stop being able to poll for jobs.')) return;
        setRevoking(id);
        try {
            await fetch(`/api/print/devices/${id}/revoke`, { method: 'POST' });
            await load();
        } finally {
            setRevoking(null);
        }
    };

    const active = devices.filter(d => !d.revoked);
    const revoked = devices.filter(d => d.revoked);

    return (
        <div className={styles.page}>
            <header className={styles.header}>
                <Link href="/admin" className={styles.back}>← Admin</Link>
                <h1>Printer Devices</h1>
            </header>

            {error && <div className={styles.error}>{error}</div>}

            {/* WPS-style pairing: an ESP32 with WiFi but no working token polls
                /api/print/devices/register on its own and shows up here. No
                Bluetooth needed for the token handoff — press Accept and the
                device picks up its token on its next poll. */}
            {pending.length > 0 && (
                <section className={styles.section}>
                    <h2>Pending ESP Requests</h2>
                    <div className={styles.pendingGrid}>
                        {pending.map(p => (
                            <div key={p.euidHash} className={styles.pendingCard}>
                                <code>{p.euidHash.slice(0, 12)}…</code>
                                <div className={styles.pendingMeta}>
                                    First seen {new Date(p.firstSeenAt).toLocaleTimeString('en-IN')} from {p.ip ?? 'unknown IP'}
                                </div>
                                <input
                                    className={styles.input}
                                    type="text"
                                    placeholder={`ESP-${p.euidHash.slice(0, 8)}`}
                                    value={pendingLabels[p.euidHash] ?? ''}
                                    onChange={e => setPendingLabels(v => ({ ...v, [p.euidHash]: e.target.value }))}
                                />
                                <button
                                    className={styles.acceptBtn}
                                    onClick={() => handleAccept(p.euidHash)}
                                    disabled={approving === p.euidHash}
                                >
                                    {approving === p.euidHash ? 'Accepting…' : '✓ Accept'}
                                </button>
                            </div>
                        ))}
                    </div>
                </section>
            )}

            {/* One-time token display — appears BEFORE the configurator so the
                user can click "Send to ESP" and scroll right into a pre-filled
                configurator. */}
            {newToken && (
                <div className={styles.tokenBanner}>
                    <strong>Token for "{newToken.label}" — copy now, it will not be shown again.</strong>
                    <div className={styles.tokenBox}>
                        <code>{newToken.token}</code>
                        <button
                            className={styles.copyBtn}
                            onClick={() => navigator.clipboard.writeText(newToken.token)}
                        >
                            Copy
                        </button>
                    </div>
                    <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                        <button
                            onClick={() => {
                                document.getElementById('esp-configurator')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                            }}
                            style={{
                                padding: '8px 16px',
                                background: '#14b8a6',
                                color: 'white',
                                border: 'none',
                                borderRadius: 6,
                                fontWeight: 700,
                                cursor: 'pointer',
                            }}
                        >
                            📡 Send to ESP via Bluetooth
                        </button>
                        <button className={styles.dismissBtn} onClick={() => setNewToken(null)}>
                            I've copied it — dismiss
                        </button>
                    </div>
                </div>
            )}

            <div style={{ margin: '12px 0 24px' }}>
                {/* `key` forces a fresh mount when newToken changes so the
                    configurator's internal `values` state picks up the new
                    prefill (device id + token). */}
                <EspConfigurator
                    key={newToken?.token ?? 'default'}
                    prefill={newToken ? { device_id: newToken.label, device_token: newToken.token } : undefined}
                    highlight={!!newToken}
                />
            </div>

            {/* Create form */}
            <section className={styles.section}>
                <h2>Add Device</h2>
                <form className={styles.createForm} onSubmit={handleCreate}>
                    <input
                        className={styles.input}
                        type="text"
                        placeholder="e.g. Kitchen Printer"
                        value={newLabel}
                        onChange={e => setNewLabel(e.target.value)}
                        disabled={creating}
                    />
                    <button className={styles.createBtn} type="submit" disabled={creating || !newLabel.trim()}>
                        {creating ? 'Creating…' : 'Create'}
                    </button>
                </form>
            </section>

            {/* Active devices */}
            <section className={styles.section}>
                <h2>Active Devices</h2>
                {loading ? (
                    <p className={styles.empty}>Loading…</p>
                ) : active.length === 0 ? (
                    <p className={styles.empty}>No devices yet. Add one above.</p>
                ) : (
                    <table className={styles.table}>
                        <thead>
                            <tr>
                                <th>Label</th>
                                <th>Status</th>
                                <th>Created</th>
                                <th></th>
                            </tr>
                        </thead>
                        <tbody>
                            {active.map(d => {
                                const { label: statusLabel, online } = onlineStatus(d.last_seen_at);
                                const isOpen = openSettings === d.id;
                                const s: DeviceSettings = d.settings ?? { role: 'all', speed: 34, energy: 13500, ring: 'short' };
                                return (
                                    <React.Fragment key={d.id}>
                                        <tr>
                                            <td>{d.label}</td>
                                            <td>
                                                <span className={online ? styles.online : styles.offline}>
                                                    {online ? '●' : '○'} {statusLabel}
                                                </span>
                                                <span style={{ marginLeft: 8, fontSize: 12, color: '#6b7280' }}>
                                                    role: <b>{s.role}</b>
                                                </span>
                                            </td>
                                            <td>{new Date(d.created_at).toLocaleDateString('en-IN')}</td>
                                            <td style={{ display: 'flex', gap: 6 }}>
                                                <button
                                                    onClick={() => setOpenSettings(isOpen ? null : d.id)}
                                                    style={{
                                                        padding: '6px 12px',
                                                        background: isOpen ? '#0f766e' : '#374151',
                                                        color: 'white', border: 'none', borderRadius: 6,
                                                        fontWeight: 600, cursor: 'pointer',
                                                    }}
                                                >
                                                    {isOpen ? 'Close' : 'Settings'}
                                                </button>
                                                <button
                                                    className={styles.revokeBtn}
                                                    onClick={() => handleRevoke(d.id)}
                                                    disabled={revoking === d.id}
                                                >
                                                    {revoking === d.id ? 'Revoking…' : 'Revoke'}
                                                </button>
                                            </td>
                                        </tr>
                                        {isOpen && (
                                            <tr>
                                                <td colSpan={4} style={{ background: '#f9fafb', padding: 16 }}>
                                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24, alignItems: 'center' }}>
                                                        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                                            <span style={{ fontSize: 12, fontWeight: 600, color: '#374151' }}>Role</span>
                                                            <select
                                                                value={s.role}
                                                                onChange={e => saveSettings(d.id, { role: e.target.value as DeviceSettings['role'] })}
                                                                disabled={savingSettings}
                                                                style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid #d1d5db' }}
                                                            >
                                                                <option value="all">All (KOT + Bill + everything)</option>
                                                                <option value="kot">KOT only (kitchen printer)</option>
                                                                <option value="bill">Bill only (cashier printer)</option>
                                                            </select>
                                                        </label>
                                                        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 200 }}>
                                                            <span style={{ fontSize: 12, fontWeight: 600, color: '#374151' }}>
                                                                Speed: <b>{s.speed}</b> {s.speed < 30 ? '(slow, dark)' : s.speed > 50 ? '(fast, light)' : ''}
                                                            </span>
                                                            <input
                                                                type="range" min={10} max={80} step={1} value={s.speed}
                                                                onChange={e => saveSettings(d.id, { speed: parseInt(e.target.value, 10) })}
                                                                disabled={savingSettings}
                                                            />
                                                        </label>
                                                        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 220 }}>
                                                            <span style={{ fontSize: 12, fontWeight: 600, color: '#374151' }}>
                                                                Energy (darkness): <b>{s.energy}</b>
                                                            </span>
                                                            <input
                                                                type="range" min={6000} max={20000} step={500} value={s.energy}
                                                                onChange={e => saveSettings(d.id, { energy: parseInt(e.target.value, 10) })}
                                                                disabled={savingSettings}
                                                            />
                                                        </label>
                                                        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                                            <span style={{ fontSize: 12, fontWeight: 600, color: '#374151' }}>New-order tone</span>
                                                            <select
                                                                value={s.ring}
                                                                onChange={e => saveSettings(d.id, { ring: e.target.value as DeviceSettings['ring'] })}
                                                                disabled={savingSettings}
                                                                style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid #d1d5db' }}
                                                            >
                                                                <option value="short">Short (one chime)</option>
                                                                <option value="long">Long (loops until acknowledged)</option>
                                                            </select>
                                                        </label>
                                                        {savingSettings && <span style={{ fontSize: 12, color: '#6b7280' }}>Saving…</span>}
                                                    </div>
                                                    <p style={{ marginTop: 8, fontSize: 12, color: '#6b7280' }}>
                                                        Changes apply on the device's next long-poll cycle (~25s).
                                                    </p>
                                                </td>
                                            </tr>
                                        )}
                                    </React.Fragment>
                                );
                            })}
                        </tbody>
                    </table>
                )}
            </section>

            {/* Pending print jobs */}
            <section className={styles.section}>
                <h2>Pending Print Jobs <span style={{ color: '#6b7280', fontWeight: 400, fontSize: '0.85em' }}>({jobs.length})</span></h2>
                {jobs.length === 0 ? (
                    <p className={styles.empty}>No jobs in the queue.</p>
                ) : (
                    <table className={styles.table}>
                        <thead>
                            <tr>
                                <th>ID</th>
                                <th>Status</th>
                                <th>Size</th>
                                <th>Attempts</th>
                                <th>Created</th>
                                <th></th>
                            </tr>
                        </thead>
                        <tbody>
                            {jobs.map(j => (
                                <tr key={j.id}>
                                    <td><code style={{ fontSize: 12 }}>{j.id.slice(0, 8)}…</code></td>
                                    <td>
                                        <span style={{
                                            display: 'inline-block',
                                            padding: '2px 8px',
                                            borderRadius: 4,
                                            fontSize: 12,
                                            fontWeight: 600,
                                            background: j.status === 'queued'   ? '#dbeafe' :
                                                        j.status === 'inflight' ? '#fef3c7' :
                                                                                   '#fee2e2',
                                            color:      j.status === 'queued'   ? '#1e40af' :
                                                        j.status === 'inflight' ? '#92400e' :
                                                                                   '#991b1b',
                                        }}>{j.status}</span>
                                    </td>
                                    <td>{j.width} × {j.height}</td>
                                    <td>{j.attempts}</td>
                                    <td>{new Date(j.created_at).toLocaleTimeString('en-IN')}</td>
                                    <td>
                                        <button
                                            onClick={() => handleDeleteJob(j.id)}
                                            disabled={deletingJob === j.id}
                                            style={{
                                                padding: '6px 14px',
                                                background: '#dc2626',
                                                color: 'white',
                                                border: 'none',
                                                borderRadius: 6,
                                                fontWeight: 600,
                                                cursor: deletingJob === j.id ? 'wait' : 'pointer',
                                                opacity: deletingJob === j.id ? 0.6 : 1,
                                            }}
                                        >
                                            {deletingJob === j.id ? '…' : 'Remove'}
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </section>

            {/* Revoked devices */}
            {revoked.length > 0 && (
                <section className={styles.section}>
                    <h2>Revoked Devices</h2>
                    <table className={styles.table}>
                        <thead>
                            <tr><th>Label</th><th>Created</th></tr>
                        </thead>
                        <tbody>
                            {revoked.map(d => (
                                <tr key={d.id} className={styles.revokedRow}>
                                    <td>{d.label}</td>
                                    <td>{new Date(d.created_at).toLocaleDateString('en-IN')}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </section>
            )}
        </div>
    );
}
