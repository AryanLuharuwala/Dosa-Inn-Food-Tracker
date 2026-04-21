'use client';

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import Link from 'next/link';
import { useMenu } from '@/lib/menuContext';
import styles from './page.module.css';

interface OrderItem {
    menuItem: { id: string; name: string; price: number };
    quantity: number;
    selectedAddOns: Array<{ id: string; name: string; price: number }>;
    totalPrice: number;
    ready?: boolean;
}

interface CookOrder {
    orderId: string;
    orderType: string;
    tableNumber: string | null;
    tokenNumber: number;
    items: OrderItem[];
    status: 'pending' | 'preparing' | 'ready' | 'delivered';
    timestamp: string;
}

function getTimeAgo(ts: string) {
    const mins = Math.floor((Date.now() - new Date(ts).getTime()) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m`;
    return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

function getUrgencyClass(ts: string, styles: Record<string, string>) {
    const mins = Math.floor((Date.now() - new Date(ts).getTime()) / 60000);
    if (mins >= 15) return styles.urgentHigh;
    if (mins >= 8) return styles.urgentMed;
    return '';
}

// Circular progress ring
function ProgressRing({ done, total }: { done: number; total: number }) {
    const r = 22;
    const circ = 2 * Math.PI * r;
    const pct = total === 0 ? 0 : done / total;
    const dash = circ * pct;
    return (
        <svg width="56" height="56" viewBox="0 0 56 56" style={{ transform: 'rotate(-90deg)' }}>
            <circle cx="28" cy="28" r={r} fill="none" stroke="rgba(0,0,0,0.08)" strokeWidth="5" />
            <circle
                cx="28" cy="28" r={r} fill="none"
                stroke={pct === 1 ? '#22c55e' : '#f59e0b'}
                strokeWidth="5"
                strokeDasharray={`${dash} ${circ}`}
                strokeLinecap="round"
                style={{ transition: 'stroke-dasharray 0.4s ease' }}
            />
            <text
                x="28" y="28"
                textAnchor="middle"
                dominantBaseline="central"
                style={{ transform: 'rotate(90deg)', transformOrigin: '28px 28px', fontSize: '11px', fontWeight: 800, fill: pct === 1 ? '#22c55e' : '#92400e' }}
            >
                {done}/{total}
            </text>
        </svg>
    );
}

export default function CookPage() {
    const { orders: allOrders, updateOrderStatus } = useMenu();
    const [tickedItems, setTickedItems] = useState<Record<string, Set<number>>>({});
    const [completedOrders, setCompletedOrders] = useState<Set<string>>(new Set());
    const [now, setNow] = useState(Date.now());
    const prevOrderIds = useRef<Set<string>>(new Set());
    const bellRef = useRef<HTMLAudioElement | null>(null);

    // Tick clock every 30s to refresh time-ago labels
    useEffect(() => {
        const t = setInterval(() => setNow(Date.now()), 30000);
        return () => clearInterval(t);
    }, []);

    // Active orders: pending + preparing, oldest first
    const orders = useMemo<CookOrder[]>(() => {
        return allOrders
            .filter(o => o.status === 'pending' || o.status === 'preparing')
            .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
            .map(o => ({
                orderId: o.orderId,
                orderType: o.orderType,
                tableNumber: o.tableNumber,
                tokenNumber: o.tokenNumber,
                items: o.items as OrderItem[],
                status: o.status,
                timestamp: o.timestamp,
            }));
    }, [allOrders, now]); // include `now` so urgency classes refresh

    // Ring bell when new order arrives
    useEffect(() => {
        const currentIds = new Set(orders.map(o => o.orderId));
        const isNew = orders.some(o => !prevOrderIds.current.has(o.orderId));
        if (isNew && prevOrderIds.current.size > 0) {
            bellRef.current?.play().catch(() => {});
        }
        prevOrderIds.current = currentIds;
    }, [orders]);

    // Done count comes purely from server-persisted ready flags
    const getDoneCount = useCallback((order: CookOrder) => {
        return order.items.filter(it => it.ready).length;
    }, []);

    const handleTick = useCallback(async (order: CookOrder, idx: number) => {
        const updatedItems = order.items.map((it, i) => ({
            ...it,
            ready: i === idx ? true : it.ready,
        }));
        const allDone = updatedItems.every(it => it.ready);

        // Optimistic local update via tickedItems for instant UI feedback
        setTickedItems(prev => {
            const next = { ...prev };
            const set = new Set(prev[order.orderId] ?? []);
            set.add(idx);
            next[order.orderId] = set;
            return next;
        });

        if (allDone) {
            setCompletedOrders(prev => new Set([...prev, order.orderId]));
            setTimeout(async () => {
                // Pass updatedItems so server persists ready flags, then move to ready
                await updateOrderStatus(order.orderId, 'ready', updatedItems);
                setTickedItems(prev => { const n = { ...prev }; delete n[order.orderId]; return n; });
                setCompletedOrders(prev => { const n = new Set(prev); n.delete(order.orderId); return n; });
            }, 1200);
        } else {
            await updateOrderStatus(order.orderId, 'preparing', updatedItems);
        }
    }, [updateOrderStatus]);

    const handleUntick = useCallback(async (order: CookOrder, idx: number) => {
        const updatedItems = order.items.map((it, i) => ({
            ...it,
            ready: i === idx ? false : it.ready,
        }));
        setTickedItems(prev => {
            const next = { ...prev };
            const set = new Set(prev[order.orderId] ?? []);
            set.delete(idx);
            next[order.orderId] = set;
            return next;
        });
        await updateOrderStatus(order.orderId, 'preparing', updatedItems);
    }, [updateOrderStatus]);

    return (
        <div className={styles.page}>
            {/* hidden bell audio */}
            <audio ref={bellRef} src="/sounds/bell.mp3" preload="auto" />

            <header className={styles.header}>
                <Link href="/kitchen" className={styles.backBtn}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <path d="M19 12H5M12 19l-7-7 7-7" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                </Link>
                <div className={styles.headerTitle}>
                    <span className={styles.fireIcon}>🔥</span>
                    <h1>Cooking</h1>
                </div>
                <div className={styles.orderBadge}>
                    {orders.length} order{orders.length !== 1 ? 's' : ''}
                </div>
            </header>

            {orders.length === 0 ? (
                <div className={styles.emptyState}>
                    <div className={styles.emptyIcon}>✅</div>
                    <h2>All clear!</h2>
                    <p>No orders waiting. Enjoy the break.</p>
                </div>
            ) : (
                <div className={styles.board}>
                    {orders.map(order => {
                        const done = getDoneCount(order);
                        const total = order.items.length;
                        const isComplete = completedOrders.has(order.orderId);
                        const ticked = tickedItems[order.orderId] ?? new Set<number>();
                        const urgencyClass = getUrgencyClass(order.timestamp, styles);

                        return (
                            <div
                                key={order.orderId}
                                className={`${styles.card} ${urgencyClass} ${isComplete ? styles.cardDone : ''}`}
                            >
                                {/* Card header */}
                                <div className={styles.cardHeader}>
                                    <div className={styles.cardLeft}>
                                        <span className={styles.tokenNum}>
                                            #{order.tokenNumber}
                                        </span>
                                        <div className={styles.cardMeta}>
                                            <span className={styles.orderLabel}>
                                                {order.orderType === 'preorder'
                                                    ? '📦 Parcel'
                                                    : `Token ${order.tableNumber ?? order.tokenNumber}`}
                                            </span>
                                            <span className={styles.timeAgo}>
                                                {getTimeAgo(order.timestamp)} ago
                                            </span>
                                        </div>
                                    </div>
                                    <div className={styles.cardRight}>
                                        <ProgressRing done={done} total={total} />
                                    </div>
                                </div>

                                {/* Status bar */}
                                <div className={styles.statusBar}>
                                    <div
                                        className={styles.statusFill}
                                        style={{
                                            width: `${total === 0 ? 0 : (done / total) * 100}%`,
                                            background: done === total ? '#22c55e' : '#f59e0b',
                                        }}
                                    />
                                </div>

                                {/* Item list */}
                                <div className={styles.itemList}>
                                    {order.items.map((item, i) => {
                                        const isDone = item.ready || ticked.has(i);
                                        return (
                                            <button
                                                key={i}
                                                className={`${styles.itemRow} ${isDone ? styles.itemDone : ''}`}
                                                onClick={() => isDone ? handleUntick(order, i) : handleTick(order, i)}
                                            >
                                                <span className={styles.itemCheck}>
                                                    {isDone
                                                        ? <svg width="18" height="18" viewBox="0 0 24 24" fill="#22c55e" stroke="#22c55e" strokeWidth="2"><circle cx="12" cy="12" r="10" /><path d="M8 12l3 3 5-5" stroke="white" fill="none" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                                                        : <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /></svg>
                                                    }
                                                </span>
                                                <span className={styles.itemQty}>{item.quantity}×</span>
                                                <span className={styles.itemName}>{item.menuItem.name}</span>
                                                {item.selectedAddOns.length > 0 && (
                                                    <span className={styles.itemAddons}>
                                                        +{item.selectedAddOns.map(a => a.name).join(', ')}
                                                    </span>
                                                )}
                                            </button>
                                        );
                                    })}
                                </div>

                                {/* Done overlay flash */}
                                {isComplete && (
                                    <div className={styles.doneFlash}>
                                        <span>✅ Ready!</span>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
