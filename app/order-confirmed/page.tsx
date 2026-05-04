'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMenu } from '@/lib/menuContext';
import styles from './page.module.css';

interface OrderData {
    orderId: string;
    orderType?: 'dine-in' | 'preorder';
    tableNumber: string | null;
    tokenNumber: number;
    preorderDetails?: { pickupTime: string; customerName?: string; customerPhone?: string } | null;
    items: Array<{
        menuItem: { name: string };
        quantity: number;
        selectedAddOns: Array<{ name: string }>;
        totalPrice: number;
    }>;
    extras: Array<{
        extra: { name: string; price: number };
        quantity: number;
    }>;
    totalAmount: number;
    timestamp: string;
}

export default function OrderConfirmedPage() {
    const router = useRouter();
    const { restaurantName } = useMenu();
    const [order, setOrder] = useState<OrderData | null>(null);
    const [showConfetti, setShowConfetti] = useState(true);

    useEffect(() => {
        const orderData = localStorage.getItem('lastOrder');
        if (orderData) {
            setOrder(JSON.parse(orderData));
        } else {
            router.push('/');
        }

        // Hide confetti after animation
        const timer = setTimeout(() => setShowConfetti(false), 3000);
        return () => clearTimeout(timer);
    }, [router]);

    if (!order) return null;

    return (
        <div className={styles.container}>
            {/* Header with Logo */}
            <header className={styles.header}>
                <Link href="/" className={styles.logoLink}>
                    <img src="/logo.png" alt={restaurantName} className={styles.logo} />
                </Link>
            </header>
            {/* Confetti Animation */}
            {showConfetti && (
                <div className={styles.confetti}>
                    {[...Array(20)].map((_, i) => (
                        <div
                            key={i}
                            className={styles.confettiPiece}
                            style={{
                                left: `${Math.random() * 100}%`,
                                animationDelay: `${Math.random() * 0.5}s`,
                                backgroundColor: ['#7cb342', '#1a4d2e', '#9ccc65', '#558b2f'][Math.floor(Math.random() * 4)],
                            }}
                        />
                    ))}
                </div>
            )}

            {/* Success Content */}
            <div className={styles.content}>
                {/* Success Animation */}
                <div className={styles.successIcon}>
                    <svg viewBox="0 0 100 120" className={styles.leafSuccess}>
                        <defs>
                            <linearGradient id="successGradient" x1="50%" y1="100%" x2="50%" y2="0%">
                                <stop offset="0%" stopColor="#558b2f" />
                                <stop offset="50%" stopColor="#7cb342" />
                                <stop offset="100%" stopColor="#9ccc65" />
                            </linearGradient>
                        </defs>
                        <path
                            d="M50 5C25 25 10 55 10 85C10 95 15 105 25 110C35 115 45 115 50 115C55 115 65 115 75 110C85 105 90 95 90 85C90 55 75 25 50 5Z"
                            fill="url(#successGradient)"
                        />
                        <path
                            className={styles.checkmark}
                            d="M35 60L45 70L65 50"
                            fill="none"
                            stroke="white"
                            strokeWidth="5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                        />
                    </svg>
                </div>

                <h1 className={styles.title}>Order Confirmed!</h1>
                <p className={styles.subtitle}>Your food is being prepared with love</p>

                {/* Order Details Card */}
                <div className={styles.orderCard}>
                    <div className={styles.orderId}>
                        <span className={styles.orderLabel}>
                            {order.orderType === 'preorder' ? 'Parcel' : 'Token No.'}
                        </span>
                        <span className={styles.orderValue}>
                            {order.orderType === 'preorder'
                                ? '#' + (order.orderId?.slice(-4).toUpperCase() || '')
                                : '#' + order.tokenNumber}
                        </span>
                    </div>

                    <div className={styles.divider} />

                    <div className={styles.tableInfo}>
                        {order.orderType === 'preorder' ? (
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" />
                            </svg>
                        ) : (
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <rect x="3" y="11" width="18" height="10" rx="2" />
                                <path d="M7 11V7a5 5 0 0110 0v4" />
                            </svg>
                        )}
                        <div>
                            {order.orderType === 'preorder' ? (
                                <>
                                    <span className={styles.tableLabel}>Pickup time</span>
                                    <span className={styles.tableNumber}>{order.preorderDetails?.pickupTime || 'N/A'}</span>
                                </>
                            ) : (
                                <>
                                    <span className={styles.tableLabel}>
                                        {order.tableNumber && order.tableNumber !== '0' ? 'Table' : 'Token'}
                                    </span>
                                    <span className={styles.tableNumber}>
                                        {order.tableNumber && order.tableNumber !== '0'
                                            ? `Table ${order.tableNumber}`
                                            : `Token No. ${order.tokenNumber}`}
                                    </span>
                                </>
                            )}
                        </div>
                    </div>

                    <div className={styles.divider} />

                    {/* Order Items */}
                    <div className={styles.itemsList}>
                        {order.items.map((item, index) => (
                            <div key={index} className={styles.orderItem}>
                                <div className={styles.itemQty}>{item.quantity}x</div>
                                <div className={styles.itemInfo}>
                                    <span className={styles.itemName}>{item.menuItem.name}</span>
                                    {item.selectedAddOns.length > 0 && (
                                        <span className={styles.itemAddOns}>
                                            + {item.selectedAddOns.map(a => a.name).join(', ')}
                                        </span>
                                    )}
                                </div>
                                <span className={styles.itemPrice}>₹{item.totalPrice}</span>
                            </div>
                        ))}
                        {order.extras.map((extra, index) => (
                            <div key={`extra-${index}`} className={styles.orderItem}>
                                <div className={styles.itemQty}>{extra.quantity}x</div>
                                <div className={styles.itemInfo}>
                                    <span className={styles.itemName}>{extra.extra.name}</span>
                                </div>
                                <span className={styles.itemPrice}>₹{extra.extra.price * extra.quantity}</span>
                            </div>
                        ))}
                    </div>

                    <div className={styles.divider} />

                    <div className={styles.totalRow}>
                        <span>Total</span>
                        <span className={styles.totalAmount}>₹{order.totalAmount}</span>
                    </div>

                    <div className={styles.paidBadge}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                            <path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                        Pay at Counter
                    </div>
                </div>

                {/* Message */}
                <div className={styles.message}>
                    <p>{order.orderType === 'preorder'
                        ? `See you at ${order.preorderDetails?.pickupTime || 'pickup time'}! Your parcel will be ready.`
                        : 'Sit back and relax. We\'ll bring your order to your table.'}</p>
                </div>

                {/* CTAs */}
                <div className={styles.ctaButtons}>
                    <Link href={`/track-order?id=${order.orderId}`} className={styles.trackOrderBtn}>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <circle cx="12" cy="12" r="10" />
                            <path d="M12 6v6l4 2" />
                        </svg>
                        Track Order
                    </Link>
                    <button className={styles.orderMoreBtn} onClick={() => router.push('/menu')}>
                        Order More
                    </button>
                </div>
                <Link href="/" className={styles.homeBtn}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" strokeLinecap="round" strokeLinejoin="round" />
                        <polyline points="9 22 9 12 15 12 15 22" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    Back to Home
                </Link>
            </div>
        </div>
    );
}
