'use client';

import React, { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Header from '@/components/Header';
import { useCart } from '@/lib/cartContext';
import SharedCartPanel from '@/components/SharedCartPanel';
import styles from './page.module.css';

const PARTICIPANT_COLORS = ['#1a4d2e', '#2563eb', '#d97706', '#7c3aed', '#dc2626', '#059669'];

export default function CartPage() {
    const router = useRouter();
    const {
        items,
        extras,
        tableNumber,
        orderType,
        preorderDetails,
        updateItemQuantity,
        removeItem,
        updateExtraQuantity,
        removeExtra,
        totalAmount,
        sharedCartCode,
        sharedCart,
        visitorId,
        updateParticipantItem,
        removeParticipantItem,
    } = useCart();

    // Compute grand total across all participants when in a shared cart
    const grandTotal = sharedCart
        ? sharedCart.participants.reduce((sum, p) => {
            return sum + p.items.reduce((s, i) => s + i.totalPrice, 0)
                + p.extras.reduce((s, e) => s + e.extra.price * e.quantity, 0);
        }, 0)
        : totalAmount;

    // Redirect if no table number (only for dine-in, preorders don't need a table)
    useEffect(() => {
        if (!tableNumber && orderType !== 'preorder' && !preorderDetails) {
            router.push('/table');
        }
    }, [tableNumber, orderType, preorderDetails, router]);

    // Checkout is the primary forward step from here — warm it ahead of the click.
    useEffect(() => {
        router.prefetch('/checkout');
    }, [router]);

    const handleQuantityChange = (cartItemId: string, newQuantity: number) => {
        if (newQuantity < 1) {
            removeItem(cartItemId);
        } else {
            updateItemQuantity(cartItemId, newQuantity);
        }
    };

    const handleExtraQuantityChange = (extraId: string, newQuantity: number) => {
        if (newQuantity < 1) {
            removeExtra(extraId);
        } else {
            updateExtraQuantity(extraId, newQuantity);
        }
    };

    const isEmpty = items.length === 0 && extras.length === 0;

    // In shared cart mode, show all participants; otherwise show own items only
    const isShared = !!(sharedCartCode && sharedCart);

    return (
        <div className={styles.container}>
            <Header
                showBack
                onBack={() => router.back()}
                title="Your Cart"
            />

            {/* Shared cart panel — always visible when dine-in */}
            {orderType === 'dine-in' && <SharedCartPanel />}

            {isEmpty && !isShared ? (
                <div className={styles.emptyState}>
                    <div className={styles.emptyIcon}>
                        <svg width="80" height="80" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                            <path d="M6 6h15l-1.5 9h-12z" strokeLinecap="round" strokeLinejoin="round" />
                            <circle cx="9" cy="20" r="1" />
                            <circle cx="18" cy="20" r="1" />
                            <path d="M6 6L5 3H2" />
                        </svg>
                    </div>
                    <h2 className={styles.emptyTitle}>Your cart is empty</h2>
                    <p className={styles.emptyText}>Add some delicious items from the menu</p>
                    <button className={styles.browseBtn} onClick={() => router.push('/menu')}>
                        Browse Menu
                    </button>
                </div>
            ) : (
                <>
                    {/* Table / Preorder Info */}
                    <div className={styles.tableInfo}>
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            {orderType === 'preorder' ? (
                                <>
                                    <circle cx="12" cy="12" r="10" />
                                    <path d="M12 6v6l4 2" />
                                </>
                            ) : (
                                <>
                                    <rect x="3" y="11" width="18" height="10" rx="2" />
                                    <path d="M7 11V7a5 5 0 0110 0v4" />
                                </>
                            )}
                        </svg>
                        <span>
                            {orderType === 'preorder' && preorderDetails
                                ? `Pickup at ${preorderDetails.pickupTime} — ${preorderDetails.customerName}`
                                : `Delivering to Table ${tableNumber}`
                            }
                        </span>
                    </div>

                    <div className={styles.cartContent}>
                        {isShared ? (
                            /* ── Shared cart: render each participant's section ── */
                            <div className={styles.itemsList}>
                                {sharedCart!.participants.map((participant, pIdx) => {
                                    const isMe = participant.visitorId === visitorId;
                                    const color = PARTICIPANT_COLORS[pIdx % PARTICIPANT_COLORS.length];
                                    const pTotal = participant.items.reduce((s, i) => s + i.totalPrice, 0)
                                        + participant.extras.reduce((s, e) => s + e.extra.price * e.quantity, 0);
                                    if (participant.items.length === 0 && participant.extras.length === 0) return null;
                                    return (
                                        <React.Fragment key={participant.visitorId}>
                                            <div className={styles.sectionDivider} style={{ color, borderLeft: `3px solid ${color}`, paddingLeft: 10 }}>
                                                <span>{isMe ? 'You' : `Guest ${pIdx + 1}`}</span>
                                                <span style={{ marginLeft: 'auto', fontWeight: 700 }}>₹{pTotal}</span>
                                            </div>
                                            {participant.items.map(item => (
                                                <div key={item.id} className={styles.cartItem}>
                                                    <div className={styles.itemLeft}>
                                                        <div className={styles.vegBadge} />
                                                        <div className={styles.itemDetails}>
                                                            <h3 className={styles.itemName}>{item.menuItem.name}</h3>
                                                            {item.selectedAddOns.length > 0 && (
                                                                <p className={styles.addOns}>+ {item.selectedAddOns.map(a => a.name).join(', ')}</p>
                                                            )}
                                                            <p className={styles.itemPrice}>₹{item.totalPrice}</p>
                                                        </div>
                                                    </div>
                                                    {isMe ? (
                                                        <div className={styles.quantityControl}>
                                                            <button className={styles.qtyBtn} onClick={() => {
                                                                if (item.quantity - 1 < 1) removeParticipantItem(participant.visitorId, item.id);
                                                                else updateParticipantItem(participant.visitorId, item.id, item.quantity - 1);
                                                            }}>
                                                                {item.quantity === 1 ? (
                                                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                                                        <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                                                                    </svg>
                                                                ) : '−'}
                                                            </button>
                                                            <span className={styles.qtyValue}>{item.quantity}</span>
                                                            <button className={styles.qtyBtn} onClick={() => updateParticipantItem(participant.visitorId, item.id, item.quantity + 1)}>+</button>
                                                        </div>
                                                    ) : (
                                                        <span className={styles.qtyValue} style={{ color: 'var(--color-text-muted)', minWidth: 28, textAlign: 'center' }}>{item.quantity}×</span>
                                                    )}
                                                </div>
                                            ))}
                                            {participant.extras.map(extra => (
                                                <div key={extra.id} className={styles.cartItem}>
                                                    <div className={styles.itemLeft}>
                                                        <div className={styles.vegBadge} />
                                                        <div className={styles.itemDetails}>
                                                            <h3 className={styles.itemName}>{extra.extra.name}</h3>
                                                            <p className={styles.itemPrice}>₹{extra.extra.price * extra.quantity}</p>
                                                        </div>
                                                    </div>
                                                    <span className={styles.qtyValue} style={{ color: 'var(--color-text-muted)', minWidth: 28, textAlign: 'center' }}>{extra.quantity}×</span>
                                                </div>
                                            ))}
                                        </React.Fragment>
                                    );
                                })}
                            </div>
                        ) : (
                            /* ── Solo cart ── */
                            <div className={styles.itemsList}>
                                {items.map(item => (
                                    <div key={item.id} className={styles.cartItem}>
                                        <div className={styles.itemLeft}>
                                            <div className={styles.vegBadge} />
                                            <div className={styles.itemDetails}>
                                                <h3 className={styles.itemName}>{item.menuItem.name}</h3>
                                                {item.selectedAddOns.length > 0 && (
                                                    <p className={styles.addOns}>
                                                        + {item.selectedAddOns.map(a => a.name).join(', ')}
                                                    </p>
                                                )}
                                                <p className={styles.itemPrice}>₹{item.totalPrice}</p>
                                            </div>
                                        </div>
                                        <div className={styles.quantityControl}>
                                            <button
                                                className={styles.qtyBtn}
                                                onClick={() => handleQuantityChange(item.id, item.quantity - 1)}
                                            >
                                                {item.quantity === 1 ? (
                                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                                        <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                                                    </svg>
                                                ) : '−'}
                                            </button>
                                            <span className={styles.qtyValue}>{item.quantity}</span>
                                            <button
                                                className={styles.qtyBtn}
                                                onClick={() => handleQuantityChange(item.id, item.quantity + 1)}
                                            >
                                                +
                                            </button>
                                        </div>
                                    </div>
                                ))}

                                {extras.length > 0 && (
                                    <>
                                        <div className={styles.sectionDivider}>
                                            <span>Extras</span>
                                        </div>
                                        {extras.map(extra => (
                                            <div key={extra.id} className={styles.cartItem}>
                                                <div className={styles.itemLeft}>
                                                    <div className={styles.vegBadge} />
                                                    <div className={styles.itemDetails}>
                                                        <h3 className={styles.itemName}>{extra.extra.name}</h3>
                                                        <p className={styles.itemPrice}>₹{extra.extra.price * extra.quantity}</p>
                                                    </div>
                                                </div>
                                                <div className={styles.quantityControl}>
                                                    <button
                                                        className={styles.qtyBtn}
                                                        onClick={() => handleExtraQuantityChange(extra.id, extra.quantity - 1)}
                                                    >
                                                        {extra.quantity === 1 ? (
                                                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                                                <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                                                            </svg>
                                                        ) : '−'}
                                                    </button>
                                                    <span className={styles.qtyValue}>{extra.quantity}</span>
                                                    <button
                                                        className={styles.qtyBtn}
                                                        onClick={() => handleExtraQuantityChange(extra.id, extra.quantity + 1)}
                                                    >
                                                        +
                                                    </button>
                                                </div>
                                            </div>
                                        ))}
                                    </>
                                )}
                            </div>
                        )}

                        {/* Bill Summary */}
                        <div className={styles.billSummary}>
                            <h3 className={styles.billTitle}>Bill Summary</h3>
                            <div className={styles.billRow}>
                                <span>Item Total</span>
                                <span>₹{isShared ? grandTotal : totalAmount}</span>
                            </div>
                            <div className={styles.billDivider} />
                            <div className={`${styles.billRow} ${styles.billTotal}`}>
                                <span>To Pay</span>
                                <span>₹{isShared ? grandTotal : totalAmount}</span>
                            </div>
                        </div>
                    </div>

                    {/* Checkout CTA */}
                    <div className={styles.ctaWrapper}>
                        {sharedCartCode && sharedCart && grandTotal > totalAmount ? (
                            <>
                                <button
                                    className={styles.checkoutBtn}
                                    onClick={() => router.push('/checkout?pay=share')}
                                >
                                    <span>Pay my share</span>
                                    <span className={styles.checkoutAmount}>₹{totalAmount}</span>
                                </button>
                                <button
                                    className={styles.checkoutBtnSecondary}
                                    onClick={() => router.push(`/checkout?pay=full&code=${sharedCartCode}`)}
                                >
                                    <span>Pay full bill</span>
                                    <span className={styles.checkoutAmount}>₹{grandTotal}</span>
                                </button>
                            </>
                        ) : (
                            <button
                                className={styles.checkoutBtn}
                                onClick={() => router.push('/order-summary')}
                            >
                                <span>Proceed</span>
                                <span className={styles.checkoutAmount}>₹{isShared ? grandTotal : totalAmount}</span>
                            </button>
                        )}
                    </div>
                </>
            )}
        </div>
    );
}
