'use client';

import React, { useState } from 'react';
import { useCart } from '@/lib/cartContext';
import styles from './SharedCartPanel.module.css';

export default function SharedCartPanel() {
    const {
        sharedCartCode,
        sharedCart,
        visitorId,
        startSharedCart,
        joinSharedCart,
        leaveSharedCart,
        tableNumber,
    } = useCart();

    const [joinCode, setJoinCode] = useState('');
    const [joinError, setJoinError] = useState('');
    const [copied, setCopied] = useState(false);
    const [loading, setLoading] = useState(false);
    const [mode, setMode] = useState<'idle' | 'join'>('idle');

    const handleStart = async () => {
        setLoading(true);
        await startSharedCart();
        setLoading(false);
    };

    const handleJoin = async () => {
        if (!joinCode.trim()) return;
        setLoading(true);
        setJoinError('');
        const ok = await joinSharedCart(joinCode.trim());
        setLoading(false);
        if (!ok) setJoinError('Invalid or expired code');
        else setMode('idle');
    };

    const handleCopy = () => {
        if (!sharedCartCode) return;
        navigator.clipboard.writeText(sharedCartCode);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const otherParticipants = sharedCart?.participants.filter(p => p.visitorId !== visitorId) ?? [];
    const myItems = sharedCart?.participants.find(p => p.visitorId === visitorId);
    const myTotal = (myItems?.items ?? []).reduce((s, i) => s + i.totalPrice, 0)
        + (myItems?.extras ?? []).reduce((s, e) => s + e.extra.price * e.quantity, 0);
    const grandTotal = sharedCart?.participants.reduce((sum, p) => {
        const t = p.items.reduce((s, i) => s + i.totalPrice, 0) + p.extras.reduce((s, e) => s + e.extra.price * e.quantity, 0);
        return sum + t;
    }, 0) ?? 0;

    // Not in a shared cart yet
    if (!sharedCartCode) {
        if (mode === 'join') {
            return (
                <div className={styles.panel}>
                    <p className={styles.label}>Enter the code from a friend's cart</p>
                    <div className={styles.joinRow}>
                        <input
                            className={styles.codeInput}
                            placeholder="e.g. A3B9KZ"
                            value={joinCode}
                            onChange={e => setJoinCode(e.target.value.toUpperCase())}
                            maxLength={6}
                        />
                        <button className={styles.joinBtn} onClick={handleJoin} disabled={loading}>
                            {loading ? '...' : 'Join'}
                        </button>
                    </div>
                    {joinError && <p className={styles.error}>{joinError}</p>}
                    <button className={styles.cancelBtn} onClick={() => setMode('idle')}>Cancel</button>
                </div>
            );
        }

        return (
            <div className={styles.panel}>
                <p className={styles.label}>Order together</p>
                <div className={styles.actionRow}>
                    {tableNumber && (
                        <button className={styles.startBtn} onClick={handleStart} disabled={loading}>
                            {loading ? '...' : '+ Start group cart'}
                        </button>
                    )}
                    <button className={styles.joinLinkBtn} onClick={() => setMode('join')}>
                        Join a cart
                    </button>
                </div>
            </div>
        );
    }

    // Active shared cart
    return (
        <div className={styles.panelActive}>
            <div className={styles.codeRow}>
                <div className={styles.codeBlock}>
                    <span className={styles.codeLabel}>Share code</span>
                    <span className={styles.code}>{sharedCartCode}</span>
                </div>
                <button className={styles.copyBtn} onClick={handleCopy}>
                    {copied ? '✓ Copied' : 'Copy'}
                </button>
            </div>

            <div className={styles.participants}>
                <div className={styles.participantRow}>
                    <div className={styles.avatar} style={{ background: '#1a4d2e' }}>You</div>
                    <span className={styles.participantLabel}>You</span>
                    <span className={styles.participantTotal}>₹{myTotal}</span>
                </div>
                {otherParticipants.map((p, i) => {
                    const t = p.items.reduce((s, item) => s + item.totalPrice, 0)
                        + p.extras.reduce((s, e) => s + e.extra.price * e.quantity, 0);
                    const itemCount = p.items.reduce((s, item) => s + item.quantity, 0) + p.extras.reduce((s, e) => s + e.quantity, 0);
                    return (
                        <div key={p.visitorId} className={styles.participantRow}>
                            <div className={styles.avatar} style={{ background: ['#5F259F', '#E65100', '#006064', '#4A148C'][i % 4] }}>
                                {i + 2}
                            </div>
                            <span className={styles.participantLabel}>
                                Guest {i + 2} {itemCount > 0 ? `· ${itemCount} item${itemCount !== 1 ? 's' : ''}` : '· browsing'}
                            </span>
                            <span className={styles.participantTotal}>₹{t}</span>
                        </div>
                    );
                })}
            </div>

            {grandTotal > 0 && (
                <div className={styles.grandTotal}>
                    <span>Group total</span>
                    <span>₹{grandTotal}</span>
                </div>
            )}

            <button className={styles.leaveBtn} onClick={leaveSharedCart}>Leave group</button>
        </div>
    );
}
