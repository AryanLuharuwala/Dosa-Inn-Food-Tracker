'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import styles from './page.module.css';

interface Session {
    shortId: string;
    ip: string;
    userAgent: string;
    createdAt: string;
    lastSeenAt: string;
    current: boolean;
}

function parseDevice(ua: string): string {
    if (!ua || ua === 'unknown') return 'Unknown device';
    const mobile = /iPhone|Android.*Mobile|iPad/.test(ua);
    const tablet = /iPad|Android(?!.*Mobile)/.test(ua);
    const os =
        /iPhone|iPad/.test(ua) ? 'iOS' :
        /Android/.test(ua) ? 'Android' :
        /Windows/.test(ua) ? 'Windows' :
        /Mac OS X/.test(ua) ? 'macOS' :
        /Linux/.test(ua) ? 'Linux' : '';
    const browser =
        /Edg\//.test(ua) ? 'Edge' :
        /OPR\/|Opera/.test(ua) ? 'Opera' :
        /Chrome\//.test(ua) ? 'Chrome' :
        /Firefox\//.test(ua) ? 'Firefox' :
        /Safari\//.test(ua) ? 'Safari' : 'Browser';
    const type = tablet ? 'Tablet' : mobile ? 'Phone' : 'Desktop';
    return [browser, os, type].filter(Boolean).join(' · ');
}

function relTime(iso: string): string {
    const ms = Date.now() - new Date(iso).getTime();
    if (ms < 10_000) return 'just now';
    if (ms < 60_000) return `${Math.round(ms / 1000)}s ago`;
    if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`;
    if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h ago`;
    return `${Math.round(ms / 86_400_000)}d ago`;
}

export default function SessionsPage() {
    const [sessions, setSessions] = useState<Session[]>([]);
    const [loading, setLoading] = useState(true);
    const [revoking, setRevoking] = useState<string | null>(null);
    const [revokingAll, setRevokingAll] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async () => {
        const res = await fetch('/api/auth/sessions');
        if (res.ok) setSessions(await res.json());
        setLoading(false);
    }, []);

    useEffect(() => {
        load();
        const t = setInterval(load, 10_000);
        return () => clearInterval(t);
    }, [load]);

    const handleRevoke = async (shortId: string) => {
        setRevoking(shortId);
        setError(null);
        try {
            const res = await fetch(`/api/auth/sessions/${shortId}`, { method: 'DELETE' });
            if (!res.ok) throw new Error(await res.text());
            await load();
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setRevoking(null);
        }
    };

    const handleRevokeAll = async () => {
        if (!confirm('Sign out all other devices?')) return;
        setRevokingAll(true);
        setError(null);
        try {
            const res = await fetch('/api/auth/sessions', { method: 'DELETE' });
            if (!res.ok) throw new Error(await res.text());
            await load();
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setRevokingAll(false);
        }
    };

    const others = sessions.filter(s => !s.current);

    return (
        <div className={styles.page}>
            <header className={styles.header}>
                <Link href="/admin" className={styles.back}>← Admin</Link>
                <h1>Active Sessions</h1>
                {others.length > 0 && (
                    <button
                        className={styles.revokeAllBtn}
                        onClick={handleRevokeAll}
                        disabled={revokingAll}
                    >
                        {revokingAll ? 'Signing out…' : `Sign out other ${others.length} device${others.length > 1 ? 's' : ''}`}
                    </button>
                )}
            </header>

            {error && <div className={styles.error}>{error}</div>}

            {loading ? (
                <p className={styles.empty}>Loading…</p>
            ) : sessions.length === 0 ? (
                <p className={styles.empty}>No active sessions.</p>
            ) : (
                <table className={styles.table}>
                    <thead>
                        <tr>
                            <th>Device / Browser</th>
                            <th>IP</th>
                            <th>Signed in</th>
                            <th>Last seen</th>
                            <th></th>
                        </tr>
                    </thead>
                    <tbody>
                        {sessions.map(s => (
                            <tr key={s.shortId} className={s.current ? styles.currentRow : ''}>
                                <td>
                                    <span className={styles.device}>{parseDevice(s.userAgent)}</span>
                                    {s.current && <span className={styles.badge}>This device</span>}
                                </td>
                                <td className={styles.ip}>{s.ip}</td>
                                <td className={styles.time}>{relTime(s.createdAt)}</td>
                                <td className={styles.time}>{relTime(s.lastSeenAt)}</td>
                                <td>
                                    {!s.current && (
                                        <button
                                            className={styles.revokeBtn}
                                            onClick={() => handleRevoke(s.shortId)}
                                            disabled={revoking === s.shortId}
                                        >
                                            {revoking === s.shortId ? '…' : 'Sign out'}
                                        </button>
                                    )}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}
        </div>
    );
}
