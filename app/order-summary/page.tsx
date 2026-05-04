'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import Header from '@/components/Header';
import { useCart } from '@/lib/cartContext';
import styles from './page.module.css';

export default function OrderSummaryPage() {
    const router = useRouter();
    const { items, extras, tableNumber, orderType, preorderDetails, totalAmount } = useCart();

    const totalItems = items.reduce((s, i) => s + i.quantity, 0)
        + extras.reduce((s, e) => s + e.quantity, 0);

    if (items.length === 0 && extras.length === 0) {
        router.replace('/menu');
        return null;
    }

    const orderLabel =
        orderType === 'preorder'
            ? `Pickup at ${preorderDetails?.pickupTime}`
            : tableNumber && tableNumber !== '0'
                ? `Table ${tableNumber}`
                : 'Token';

    return (
        <div className={styles.page}>
            <Header showBack onBack={() => router.back()} title="Order Summary" showServing={false} />

            <div className={styles.content}>
                {/* Order type badge */}
                <div className={styles.orderMeta}>
                    <span className={styles.orderBadge}>
                        {orderType === 'preorder' ? (
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" />
                            </svg>
                        ) : (
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <rect x="3" y="11" width="18" height="10" rx="2" /><path d="M7 11V7a5 5 0 0110 0v4" />
                            </svg>
                        )}
                        {orderLabel}
                    </span>
                    {orderType === 'preorder' && preorderDetails?.customerName && (
                        <span className={styles.customerName}>{preorderDetails.customerName}</span>
                    )}
                </div>

                {/* Items */}
                <div className={styles.itemsList}>
                    {items.map((item, i) => (
                        <div key={i} className={styles.itemRow}>
                            <div className={styles.itemLeft}>
                                <span className={styles.qty}>{item.quantity}×</span>
                                <div>
                                    <p className={styles.itemName}>{item.menuItem.name}</p>
                                    {item.selectedAddOns?.map((a, j) => (
                                        <p key={j} className={styles.addOn}>+ {a.name}  <span className={styles.addOnPrice}>₹{a.price}</span></p>
                                    ))}
                                </div>
                            </div>
                            <span className={styles.itemPrice}>₹{item.totalPrice}</span>
                        </div>
                    ))}
                    {extras.map((e, i) => (
                        <div key={i} className={styles.itemRow}>
                            <div className={styles.itemLeft}>
                                <span className={styles.qty}>{e.quantity}×</span>
                                <p className={styles.itemName}>{e.extra.name}</p>
                            </div>
                            <span className={styles.itemPrice}>₹{e.extra.price * e.quantity}</span>
                        </div>
                    ))}
                </div>

                {/* Total */}
                <div className={styles.totalRow}>
                    <span className={styles.totalLabel}>{totalItems} item{totalItems !== 1 ? 's' : ''}</span>
                    <span className={styles.totalAmount}>₹{totalAmount}</span>
                </div>
            </div>

            {/* CTA */}
            <div className={styles.cta}>
                <button className={styles.confirmBtn} onClick={() => router.push('/checkout')}>
                    Proceed to Pay
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <path d="M5 12h14M12 5l7 7-7 7" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                </button>
            </div>
        </div>
    );
}
