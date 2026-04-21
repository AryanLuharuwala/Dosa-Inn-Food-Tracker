'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Header from '@/components/Header';
import LeafLoader from '@/components/LeafLoader';
import { useCart } from '@/lib/cartContext';
import { ensureSession } from '@/lib/auth';
import { fetchSharedCart } from '@/lib/useSharedCart';
import type { SharedCart } from '@/lib/useSharedCart';
import styles from './page.module.css';

export default function CheckoutPage() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const payMode = searchParams.get('pay'); // 'share' | 'full' | null
    const sharedCode = searchParams.get('code');
    const { items, extras, tableNumber, orderType, preorderDetails, totalAmount, sharedCartCode } = useCart();
    const [isProcessing, setIsProcessing] = useState(false);
    const [error, setError] = useState('');
    const [fullBillCart, setFullBillCart] = useState<SharedCart | null>(null);
    const orderCompleted = useRef(false);

    // Load full shared cart when paying full bill
    useEffect(() => {
        if (payMode === 'full' && (sharedCode || sharedCartCode)) {
            fetchSharedCart((sharedCode || sharedCartCode)!).then(setFullBillCart);
        }
    }, [payMode, sharedCode, sharedCartCode]);

    useEffect(() => {
        if (orderCompleted.current) return;
        if (items.length === 0 && extras.length === 0) {
            router.push('/menu');
        }
    }, [items, extras, router]);

    // For full bill: aggregate all participants' items
    const billItems = payMode === 'full' && fullBillCart
        ? fullBillCart.participants.flatMap(p => p.items)
        : items;
    const billExtras = payMode === 'full' && fullBillCart
        ? fullBillCart.participants.flatMap(p => p.extras)
        : extras;
    const billAmount = payMode === 'full' && fullBillCart
        ? fullBillCart.participants.reduce((sum, p) => {
            return sum + p.items.reduce((s, i) => s + i.totalPrice, 0)
                + p.extras.reduce((s, e) => s + e.extra.price * e.quantity, 0);
        }, 0)
        : totalAmount;

    const handlePhonePePayment = async () => {
        setError('');
        setIsProcessing(true);

        try {
            const tokenId = await ensureSession();

            // Build a temporary merchant order ID (final order ID assigned after payment success)
            const tempOrderId = `TMP-${Date.now()}-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;

            // Stash order data so payment-result page can finalise the order
            const pendingOrder = {
                orderType,
                tableNumber: orderType === 'dine-in' ? (tableNumber || '0') : null,
                preorderDetails: orderType === 'preorder' ? preorderDetails : null,
                items: billItems.map(item => ({
                    menuItem: {
                        id: item.menuItem.id,
                        name: item.menuItem.name,
                        price: item.menuItem.price,
                    },
                    quantity: item.quantity,
                    selectedAddOns: item.selectedAddOns.map(a => ({
                        id: a.id,
                        name: a.name,
                        price: a.price,
                    })),
                    totalPrice: item.totalPrice,
                })),
                extras: billExtras.map(e => ({
                    extra: {
                        id: e.extra.id,
                        name: e.extra.name,
                        price: e.extra.price,
                    },
                    quantity: e.quantity,
                })),
                totalAmount: billAmount,
                timestamp: new Date().toISOString(),
                tokenId: tokenId || '',
            };
            sessionStorage.setItem('pendingOrder', JSON.stringify(pendingOrder));

            const res = await fetch('/api/phonepe/initiate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ merchantOrderId: tempOrderId, amount: billAmount }),
            });

            const data = await res.json();

            if (!res.ok || data.error) {
                throw new Error(typeof data.error === 'string' ? data.error : 'Failed to initiate payment');
            }

            // Store both IDs: merchantOrderId for status check, phonePeOrderId for reference
            const stored = JSON.parse(sessionStorage.getItem('pendingOrder') || '{}');
            stored.merchantOrderId = tempOrderId;
            stored.phonePeOrderId = data.phonePeOrderId;
            sessionStorage.setItem('pendingOrder', JSON.stringify(stored));

            orderCompleted.current = true;
            window.location.href = data.redirectUrl;
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : 'Something went wrong';
            setError(message);
            setIsProcessing(false);
        }
    };

    const totalItemsCount = billItems.reduce((sum, i) => sum + i.quantity, 0) +
        billExtras.reduce((sum, e) => sum + e.quantity, 0);

    return (
        <>
            <LeafLoader isVisible={isProcessing} variant="payment" />

            <div className={styles.container}>
                <Header
                    showBack
                    onBack={() => router.back()}
                    title="Checkout"
                    showServing={false}
                />

                <div className={styles.content}>
                    {/* Order Summary */}
                    <div className={styles.section}>
                        <h2 className={styles.sectionTitle}>Order Summary</h2>
                        <div className={styles.summaryCard}>
                            <div className={styles.tableRow}>
                                {orderType === 'preorder' ? (
                                    <>
                                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                            <circle cx="12" cy="12" r="10" />
                                            <path d="M12 6v6l4 2" />
                                        </svg>
                                        <div className={styles.preorderInfo}>
                                            <span>Arrive at {preorderDetails?.pickupTime}</span>
                                            <span className={styles.preorderCustomer}>{preorderDetails?.customerName} • {preorderDetails?.customerPhone}</span>
                                        </div>
                                    </>
                                ) : (
                                    <>
                                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                            <rect x="3" y="11" width="18" height="10" rx="2" />
                                            <path d="M7 11V7a5 5 0 0110 0v4" />
                                        </svg>
                                        <span>Token No {tableNumber}</span>
                                    </>
                                )}
                            </div>
                            <div className={styles.divider} />

                            {payMode === 'full' && (
                                <div style={{ fontSize: '0.75rem', color: 'var(--color-primary)', fontWeight: 700, marginBottom: 8 }}>
                                    Full group bill
                                </div>
                            )}
                            <div className={styles.orderPreview}>
                                {billItems.slice(0, 3).map((item, i) => (
                                    <div key={i} className={styles.previewItem}>
                                        <span className={styles.previewQty}>{item.quantity}x</span>
                                        <span className={styles.previewName}>{item.menuItem.name}</span>
                                    </div>
                                ))}
                                {billItems.length > 3 && (
                                    <span className={styles.moreItems}>+ {billItems.length - 3} more items</span>
                                )}
                            </div>

                            <div className={styles.divider} />
                            <div className={styles.totalRow}>
                                <div>
                                    <span className={styles.itemsCount}>{totalItemsCount} items</span>
                                    <span className={styles.totalLabel}>Total Amount</span>
                                </div>
                                <span className={styles.totalAmount}>₹{billAmount}</span>
                            </div>
                        </div>
                    </div>

                    {/* PhonePe Payment */}
                    <div className={styles.section}>
                        <h2 className={styles.sectionTitle}>Pay Securely</h2>
                        <p className={styles.sectionSubtitle}>You'll be redirected to PhonePe to complete payment via UPI, cards, or net banking.</p>

                        {error && (
                            <div className={styles.errorBox}>
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <circle cx="12" cy="12" r="10" />
                                    <path d="M12 8v4M12 16h.01" strokeLinecap="round" />
                                </svg>
                                {error}
                            </div>
                        )}

                        <button
                            className={styles.phonePeBtn}
                            onClick={handlePhonePePayment}
                            disabled={isProcessing}
                        >
                            <span className={styles.phonePeLogo}>Pe</span>
                            <span>Pay ₹{billAmount} with PhonePe</span>
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                <path d="M5 12h14M12 5l7 7-7 7" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                        </button>
                    </div>

                    {/* Security Info */}
                    <div className={styles.infoBox}>
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                            <path d="M7 11V7a5 5 0 0110 0v4" />
                        </svg>
                        <div>
                            <p className={styles.infoTitle}>Secure Payment</p>
                            <p className={styles.infoText}>Powered by PhonePe — supports UPI, credit/debit cards, and net banking. 256-bit encrypted.</p>
                        </div>
                    </div>
                </div>
            </div>
        </>
    );
}
