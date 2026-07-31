'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useCart } from '@/lib/cartContext';
import { useMenu } from '@/lib/menuContext';
import SidebarToggleButton from '@/components/nav/SidebarToggleButton';
import styles from './Header.module.css';
import Link from 'next/link';

interface HeaderProps {
    showCart?: boolean;
    showBack?: boolean;
    onBack?: () => void;
    title?: string;
    showServing?: boolean;
}

export default function Header({ showCart = true, showBack = false, onBack, title, showServing = true }: HeaderProps) {
    const router = useRouter();
    const { totalItems, tableNumber, orderType } = useCart();
    const { restaurantName } = useMenu();
    const [activeTrackingLabel, setActiveTrackingLabel] = useState<string | null>(null);
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        setMounted(true);
    }, []);

    useEffect(() => {
        // Check for active order in session
        const lastOrderStr = sessionStorage.getItem('lastOrder');
        if (lastOrderStr) {
            try {
                const orderData = JSON.parse(lastOrderStr);
                // Only show active token if it's not delivered yet
                if (orderData.status !== 'delivered' && orderData.status !== 'served') {
                    const isParcel = orderData.orderType === 'preorder';

                    if (isParcel) {
                        setActiveTrackingLabel(`Parcel ${orderData.orderId ? '#' + orderData.orderId.slice(-4).toUpperCase() : ''}`);
                    } else if (orderData.tableNumber && orderData.tableNumber !== '0') {
                        setActiveTrackingLabel(`Table ${orderData.tableNumber}`);
                    } else if (orderData.tokenNumber) {
                        setActiveTrackingLabel(`Token No. ${orderData.tokenNumber}`);
                    }
                }
            } catch (e) {
                // Ignore parse errors
            }
        }
    }, []);

    return (
        <header className={styles.header}>
            <div className={styles.left}>
                {showBack && (
                    <button className={styles.backBtn} onClick={onBack} aria-label="Go back">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M19 12H5M12 19l-7-7 7-7" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                    </button>
                )}
                {title ? (
                    <h1 className={styles.title}>{title}</h1>
                ) : (
                    <Link href="/" className={styles.logoLink}>
                        <img src="/logo.png" alt={restaurantName} className={styles.logo} />
                        {showServing && (
                            <div className={styles.servingText}>
                                <span className={styles.brandName}>{restaurantName}</span>
                                <span className={styles.servingStatus}>is serving</span>
                            </div>
                        )}
                    </Link>
                )}
            </div>

            <div className={styles.right}>
                <SidebarToggleButton variant="inline" />

                {/* Track Order Button */}
                <Link href="/track-order" className={styles.trackOrderBtn} aria-label="Track orders">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="12" cy="12" r="10" />
                        <path d="M12 6v6l4 2" />
                    </svg>
                </Link>

                {/* Active Tracking Display */}
                {mounted && activeTrackingLabel && (
                    <Link href="/track-order" className={styles.tableTag} style={{ background: '#ffeb3b', color: '#000', textDecoration: 'none' }} title="Track Active Order">
                        <span style={{ fontWeight: 'bold' }}>
                            {activeTrackingLabel}
                        </span>
                    </Link>
                )}

                {/* Current Cart Table Number */}
                {mounted && tableNumber && orderType !== 'preorder' && (
                    <div className={styles.tableTag}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                            <rect x="3" y="11" width="18" height="10" rx="2" />
                            <path d="M7 11V7a5 5 0 0110 0v4" />
                        </svg>
                        {tableNumber}
                    </div>
                )}

                {showCart && (
                    <Link href="/cart" className={styles.cartBtn} aria-label="View cart">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M6 6h15l-1.5 9h-12z" strokeLinecap="round" strokeLinejoin="round" />
                            <circle cx="9" cy="20" r="1" />
                            <circle cx="18" cy="20" r="1" />
                            <path d="M6 6L5 3H2" />
                        </svg>
                        {mounted && totalItems > 0 && (
                            <span className={styles.cartBadge}>{totalItems}</span>
                        )}
                    </Link>
                )}
            </div>
        </header>
    );
}
