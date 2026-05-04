'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import styles from './page.module.css';

interface Device {
    id: string;
    label: string;
    created_at: string;
    last_seen_at: string | null;
    revoked: boolean;
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
    const [loading, setLoading] = useState(true);
    const [newLabel, setNewLabel] = useState('');
    const [creating, setCreating] = useState(false);
    const [newToken, setNewToken] = useState<{ label: string; token: string } | null>(null);
    const [revoking, setRevoking] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async () => {
        const res = await fetch('/api/print/devices');
        if (res.ok) setDevices(await res.json());
        setLoading(false);
    }, []);

    useEffect(() => {
        load();
        const t = setInterval(load, 10_000);
        return () => clearInterval(t);
    }, [load]);

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

            {/* One-time token display */}
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
                    <button className={styles.dismissBtn} onClick={() => setNewToken(null)}>
                        I've copied it — dismiss
                    </button>
                </div>
            )}

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
                                return (
                                    <tr key={d.id}>
                                        <td>{d.label}</td>
                                        <td>
                                            <span className={online ? styles.online : styles.offline}>
                                                {online ? '●' : '○'} {statusLabel}
                                            </span>
                                        </td>
                                        <td>{new Date(d.created_at).toLocaleDateString('en-IN')}</td>
                                        <td>
                                            <button
                                                className={styles.revokeBtn}
                                                onClick={() => handleRevoke(d.id)}
                                                disabled={revoking === d.id}
                                            >
                                                {revoking === d.id ? 'Revoking…' : 'Revoke'}
                                            </button>
                                        </td>
                                    </tr>
                                );
                            })}
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
