'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCart } from '@/lib/cartContext';
import { useMenu } from '@/lib/menuContext';
import LeafLoader from '@/components/LeafLoader';
import { getUniqueToken } from '@/lib/tokens';
import styles from './page.module.css';

export default function TablePage() {
    const router = useRouter();
    const { setTableNumber, setOrderType } = useCart();
    const { restaurantName } = useMenu();
    const [table, setTable] = useState('');
    const [showLoader, setShowLoader] = useState(false);
    const [isAssigning, setIsAssigning] = useState(true);

    useEffect(() => {
        const assignToken = async () => {
            const token = await getUniqueToken();
            setTable(token.toString());
            setIsAssigning(false);
        };
        assignToken();
    }, []);

    const handleContinue = () => {
        if (!table) return;

        // Check if there's an existing session for a different table
        const existingOrders = localStorage.getItem('customerOrders');
        if (existingOrders) {
            const orders = JSON.parse(existingOrders);
            const hasDifferentTableOrders = orders.some((order: { tableNumber: string }) =>
                order.tableNumber !== table
            );

            if (hasDifferentTableOrders) {
                const sameTableOrders = orders.filter((order: { tableNumber: string }) =>
                    order.tableNumber === table
                );
                if (sameTableOrders.length > 0) {
                    localStorage.setItem('customerOrders', JSON.stringify(sameTableOrders));
                } else {
                    localStorage.removeItem('customerOrders');
                }
                sessionStorage.removeItem('lastOrder');
            }
        }

        setTableNumber(table);
        setOrderType('dine-in');
        setShowLoader(true);
    };

    const handleLoaderComplete = () => {
        router.push('/menu');
    };

    return (
        <>
            <LeafLoader
                isVisible={showLoader}
                variant="transition"
                onComplete={handleLoaderComplete}
            />

            <div className={styles.container}>
                {/* Header */}
                <div className={styles.header}>
                    <Link href="/" className={styles.logoLink}>
                        <img src="/logo.png" alt={restaurantName} className={styles.logo} />
                    </Link>
                </div>

                {/* Content */}
                <div className={styles.content}>
                    <div className={styles.titleSection}>
                        <h1 className={styles.title}>Welcome to {restaurantName}</h1>
                        <p className={styles.subtitle}>
                            {isAssigning ? 'Assigning your token...' : 'Your unique token number has been assigned'}
                        </p>
                    </div>

                    {/* Token number display */}
                    <div className={styles.displayWrapper}>
                        <div className={styles.display}>
                            {isAssigning ? (
                                <span className={styles.placeholder}>...</span>
                            ) : (
                                `#${table}`
                            )}
                        </div>
                        {!isAssigning && (
                            <p className={styles.helperText}>Please remember this token for your visit</p>
                        )}
                    </div>
                </div>

                {/* CTA */}
                <div className={styles.ctaWrapper}>
                    <button
                        className={`${styles.ctaBtn} ${isAssigning ? styles.ctaBtnDisabled : ''}`}
                        onClick={handleContinue}
                        disabled={isAssigning}
                    >
                        {isAssigning ? 'Generating Token...' : 'Continue to Menu'}
                        {!isAssigning && (
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                <path d="M5 12h14M12 5l7 7-7 7" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                        )}
                    </button>
                </div>
            </div>
        </>
    );
}
