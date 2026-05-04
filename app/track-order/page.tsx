'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { getSessionUserId } from '@/lib/auth';
import { useSound } from '@/lib/useSound';
import { useMenu } from '@/lib/menuContext';
import styles from './page.module.css';

interface OrderItem {
    menuItem: { name: string };
    quantity: number;
    selectedAddOns: Array<{ name: string }>;
    totalPrice: number;
}

interface OrderExtra {
    extra: { name: string; price: number };
    quantity: number;
}

interface OrderData {
    orderId: string;
    orderType?: 'dine-in' | 'preorder';
    tableNumber: string | null;
    tokenNumber: number;
    items: OrderItem[];
    extras: OrderExtra[];
    totalAmount: number;
    timestamp: string;
    status: 'pending' | 'preparing' | 'ready' | 'delivered' | 'served';
    estimatedTime?: number;
    preorderDetails?: { pickupTime: string } | null;
}

export default function TrackOrderPage() {
    const router = useRouter();
    const { restaurantName } = useMenu();
    const [orders, setOrders] = useState<OrderData[]>([]);
    const [currentTime, setCurrentTime] = useState(new Date());
    const [cancellingId, setCancellingId] = useState<string | null>(null);
    const [cancelConfirm, setCancelConfirm] = useState<string | null>(null);
    const prevStatuses = useRef<Record<string, string>>({});

    const playReady = useSound('/sounds/ready.mp3');
    const playDelivered = useSound('/sounds/delivered.mp3');
    const playCancel = useSound('/sounds/cancel.mp3', 0.5);

    // Clock tick
    useEffect(() => {
        const t = setInterval(() => setCurrentTime(new Date()), 1000);
        return () => clearInterval(t);
    }, []);

    const fetchOrders = useCallback(async () => {
        const visitorId = await getSessionUserId();
        if (!visitorId) { setOrders([]); return; }

        const urlParams = new URLSearchParams(window.location.search);
        const urlOrderId = urlParams.get('id');
        const lastOrderStr = localStorage.getItem('lastOrder');
        const sessionOrderId = lastOrderStr ? JSON.parse(lastOrderStr).orderId : null;
        const targetOrderId = urlOrderId || sessionOrderId;

        let data: OrderData[] = [];

        try {
            const params = new URLSearchParams({ resource: 'orders', tokenId: visitorId });
            if (targetOrderId) params.set('orderId', targetOrderId);
            const res = await fetch(`/api/db?${params}`);
            if (res.ok) {
                data = await res.json();
            }
        } catch {
            // API unavailable — will fallback to localStorage
        }

        // Fallback: if API returned nothing, use localStorage
        if (data.length === 0 && lastOrderStr) {
            try {
                const localOrder = JSON.parse(lastOrderStr) as OrderData;
                if (localOrder.orderId) {
                    data = [localOrder];
                }
            } catch { /* invalid JSON */ }
        }

        const deliveredMapStr = localStorage.getItem('deliveredOrdersTime');
        const deliveredMap: Record<string, number> = deliveredMapStr ? JSON.parse(deliveredMapStr) : {};
        let mapChanged = false;

        const mapped: OrderData[] = [];
        data.forEach(row => {
            if (row.status === 'delivered' || row.status === 'served') {
                if (!deliveredMap[row.orderId]) { deliveredMap[row.orderId] = Date.now(); mapChanged = true; }
                if (Date.now() - deliveredMap[row.orderId] > 60000) return;
            }
            mapped.push(row);
        });

        if (mapChanged) localStorage.setItem('deliveredOrdersTime', JSON.stringify(deliveredMap));

        // Play sounds on status transitions
        mapped.forEach(order => {
            const prev = prevStatuses.current[order.orderId];
            if (prev && prev !== order.status) {
                if (order.status === 'ready') playReady();
                if (order.status === 'delivered') playDelivered();
            }
            prevStatuses.current[order.orderId] = order.status;
        });

        const active = mapped.find(o => o.status !== 'delivered' && o.status !== 'served') || mapped[0];
        if (active) localStorage.setItem('lastOrder', JSON.stringify(active));
        setOrders(mapped);
    }, [playReady, playDelivered]);

    // Initial load
    useEffect(() => { fetchOrders(); }, [fetchOrders]);

    // SSE for live updates — only re-fetches when orders resource changes
    useEffect(() => {
        let es: EventSource;
        let retryTimeout: ReturnType<typeof setTimeout>;

        const connect = () => {
            es = new EventSource('/api/events?channel=menu');
            es.addEventListener('change', (e: MessageEvent) => {
                try {
                    const { resource } = JSON.parse(e.data) as { resource: string };
                    if (resource === 'orders') fetchOrders();
                } catch { fetchOrders(); }
            });
            es.addEventListener('error', () => {
                es.close();
                retryTimeout = setTimeout(connect, 3000);
            });
        };
        connect();
        return () => { es?.close(); clearTimeout(retryTimeout); };
    }, [fetchOrders]);

    const handleCancel = async (orderId: string) => {
        setCancellingId(orderId);
        try {
            await fetch('/api/db', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'order_status', orderId, status: 'delivered' }),
            });
            playCancel();
            setCancelConfirm(null);
            await fetchOrders();
        } finally {
            setCancellingId(null);
        }
    };

    const getTimeSince = (ts: string) => {
        const diff = currentTime.getTime() - new Date(ts).getTime();
        const mins = Math.floor(diff / 60000);
        const secs = Math.floor((diff % 60000) / 1000);
        if (mins < 1) return `${secs}s ago`;
        if (mins < 60) return `${mins}m ago`;
        return `${Math.floor(mins / 60)}h ${mins % 60}m ago`;
    };

    const getEstimatedRemaining = (order: OrderData) => {
        const elapsed = (currentTime.getTime() - new Date(order.timestamp).getTime()) / 60000;
        return Math.max(0, Math.ceil((order.estimatedTime || 15) - elapsed));
    };

    const getProgress = (order: OrderData) => {
        const elapsed = (currentTime.getTime() - new Date(order.timestamp).getTime()) / 60000;
        return Math.min(100, (elapsed / (order.estimatedTime || 15)) * 100);
    };

    if (orders.length === 0) {
        return (
            <div className={styles.container}>
                <header className={styles.header}>
                    <Link href="/" className={styles.logoLink}><img src="/logo.png" alt={restaurantName} className={styles.logo} /></Link>
                    <h2 className={styles.headerTitle}>Track Orders</h2>
                </header>
                <div className={styles.emptyState}>
                    <div className={styles.emptyIcon}>📦</div>
                    <h2>No Orders Yet</h2>
                    <p>You haven't placed any orders recently.</p>
                    <Link href="/menu" className={styles.orderNowBtn}>Start Ordering</Link>
                </div>
            </div>
        );
    }

    return (
        <div className={styles.container}>
            <header className={styles.header}>
                <Link href="/" className={styles.logoLink}><img src="/logo.png" alt={restaurantName} className={styles.logo} /></Link>
                <h2 className={styles.headerTitle}>Track Orders</h2>
            </header>

            <div className={styles.content}>
                <div className={styles.ordersGrid}>
                    {orders.map(order => {
                        const status = order.status || 'preparing';
                        const remaining = getEstimatedRemaining(order);
                        const progress = getProgress(order);
                        const canCancel = status === 'pending';

                        return (
                            <div key={order.orderId} className={styles.orderCard}>
                                {/* Header */}
                                <div className={styles.orderHeader}>
                                    <div className={styles.orderIdSection}>
                                        <span className={styles.orderLabel}>
                                            {order.orderType === 'preorder' ? 'Parcel'
                                                : (order.tableNumber && order.tableNumber !== '0') ? 'Table' : 'Token No.'}
                                        </span>
                                        <span className={styles.orderId}>
                                            {order.orderType === 'preorder'
                                                ? '#' + (order.orderId?.slice(-4).toUpperCase() || '')
                                                : (order.tableNumber && order.tableNumber !== '0')
                                                    ? '#' + order.tableNumber
                                                    : '#' + order.tokenNumber}
                                        </span>
                                    </div>
                                    {order.orderType === 'preorder' ? (
                                        <div className={styles.tableTag}>
                                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
                                            Pickup: {order.preorderDetails?.pickupTime || 'N/A'}
                                        </div>
                                    ) : (
                                        <div className={styles.tableTag}>
                                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="11" width="18" height="10" rx="2" /><path d="M7 11V7a5 5 0 0110 0v4" /></svg>
                                            Dine-In
                                        </div>
                                    )}
                                </div>

                                {/* Time */}
                                <div className={styles.timeInfo}>
                                    <div className={styles.orderTimeDetail}>
                                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" /></svg>
                                        <span>{new Date(order.timestamp).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })}</span>
                                    </div>
                                    <span className={styles.timeSince}>{getTimeSince(order.timestamp)}</span>
                                </div>

                                {/* Status */}
                                <div className={`${styles.statusSection} ${styles[status]}`}>
                                    <div className={styles.statusHeader}>
                                        <div className={styles.statusIndicator}>
                                            {status === 'pending' && <span className={styles.steam}>⏳</span>}
                                            {status === 'preparing' && <div className={styles.cookingAnimation}><span className={styles.steam}>🍳</span></div>}
                                            {status === 'ready' && <span className={styles.readyIcon}>✅</span>}
                                            {(status === 'served' || status === 'delivered') && <span className={styles.servedIcon}>🎉</span>}
                                        </div>
                                        <div className={styles.statusText}>
                                            <span className={styles.statusLabel}>
                                                {status === 'pending' && 'Order Received'}
                                                {status === 'preparing' && 'Preparing Your Order'}
                                                {status === 'ready' && 'Ready for Pickup!'}
                                                {(status === 'served' || status === 'delivered') && 'Order Complete'}
                                            </span>
                                            {status === 'preparing' && remaining > 0 && (
                                                <span className={styles.estimatedTime}>~{remaining} min remaining</span>
                                            )}
                                        </div>
                                    </div>
                                    {status === 'preparing' && (
                                        <div className={styles.progressBar}>
                                            <div className={styles.progressFill} style={{ width: `${progress}%` }} />
                                        </div>
                                    )}
                                </div>

                                {/* Items */}
                                <div className={styles.itemsList}>
                                    {order.items.map((item, idx) => (
                                        <div key={idx} className={styles.orderItem}>
                                            <div className={styles.itemQty}>{item.quantity}×</div>
                                            <div className={styles.itemDetails}>
                                                <span className={styles.itemName}>{item.menuItem.name}</span>
                                                {item.selectedAddOns.length > 0 && (
                                                    <span className={styles.itemAddOns}>+ {item.selectedAddOns.map(a => a.name).join(', ')}</span>
                                                )}
                                            </div>
                                            <span className={styles.itemPrice}>₹{item.totalPrice}</span>
                                        </div>
                                    ))}
                                    {order.extras?.map((extra, idx) => (
                                        <div key={`x${idx}`} className={styles.orderItem}>
                                            <div className={styles.itemQty}>{extra.quantity}×</div>
                                            <div className={styles.itemDetails}><span className={styles.itemName}>{extra.extra.name}</span></div>
                                            <span className={styles.itemPrice}>₹{extra.extra.price * extra.quantity}</span>
                                        </div>
                                    ))}
                                </div>

                                {/* Total + cancel */}
                                <div className={styles.totalSection}>
                                    <span className={styles.totalLabel}>Total</span>
                                    <span className={styles.totalAmount}>₹{order.totalAmount}</span>
                                </div>

                                {/* Cancel Order button — disabled/hidden */}
                            </div>
                        );
                    })}
                </div>

                <div className={styles.quickActions}>
                    <button className={styles.orderMoreBtn} onClick={() => router.push('/menu')}>
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
                        Order More
                    </button>
                    <Link href="/menu" className={styles.homeBtn}>
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 12H5M12 19l-7-7 7-7" strokeLinecap="round" strokeLinejoin="round" /></svg>
                        Back to Menu
                    </Link>
                </div>
            </div>
        </div>
    );
}
