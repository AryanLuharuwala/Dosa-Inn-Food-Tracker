'use client';

import React, { Suspense, useState, useEffect, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Header from '@/components/Header';
import LeafLoader from '@/components/LeafLoader';
import { useCart } from '@/lib/cartContext';
import { useMenu } from '@/lib/menuContext';
import { ensureSession } from '@/lib/auth';
import { fetchSharedCart } from '@/lib/useSharedCart';
import type { SharedCart } from '@/lib/useSharedCart';
import { getUniqueToken } from '@/lib/tokens';
import styles from './page.module.css';

export default function CheckoutPage() {
    return (
        <Suspense fallback={<LeafLoader isVisible variant="payment" />}>
            <CheckoutPageInner />
        </Suspense>
    );
}

function CheckoutPageInner() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const payMode = searchParams.get('pay'); // 'share' | 'full' | null
    const sharedCode = searchParams.get('code');
    const { items, extras, tableNumber, orderType, preorderDetails, totalAmount, sharedCartCode, clearCart } = useCart();
    const { paymentsEnabled, addOrder, billTemplate } = useMenu();
    const [isProcessing, setIsProcessing] = useState(false);
    const [error, setError] = useState('');
    const [fullBillCart, setFullBillCart] = useState<SharedCart | null>(null);
    const [whatsappPhone, setWhatsappPhone] = useState('');
    const [marketingOptIn, setMarketingOptIn] = useState(false);
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

    // Counter-payment orders land here immediately on success — warm it
    // ahead of the click. (Online-payment orders leave the app entirely for
    // Cashfree's checkout and return via a fresh page load, so prefetching
    // /payment-result from here wouldn't help that leg.)
    useEffect(() => {
        router.prefetch('/order-confirmed');
    }, [router]);

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

    /**
     * Counter-payment flow: skip PhonePe entirely, place the order on the server,
     * navigate to confirmation. Server still gates this — order_add only accepts
     * a token-less request when paymentsEnabled === false in DB settings.
     */
    const handleCounterOrder = async () => {
        if (orderCompleted.current) return;
        setError('');
        setIsProcessing(true);

        try {
            const tokenId = await ensureSession();
            const tokenNumberValue =
                orderType === 'dine-in' && tableNumber
                    ? parseInt(tableNumber, 10)
                    : await getUniqueToken();
            const randomSuffix = Math.random().toString(36).substring(2, 6).toUpperCase();
            const orderId = `#${tokenNumberValue}-RDA-${randomSuffix}`;

            const orderData = {
                orderId,
                orderType,
                tableNumber: orderType === 'dine-in' ? (tableNumber || '0') : null,
                preorderDetails: orderType === 'preorder' ? preorderDetails : null,
                tokenNumber: tokenNumberValue,
                items: billItems.map(item => ({
                    menuItem: { id: item.menuItem.id, name: item.menuItem.name, price: item.menuItem.price },
                    quantity: item.quantity,
                    selectedAddOns: item.selectedAddOns.map(a => ({ id: a.id, name: a.name, price: a.price })),
                    totalPrice: item.totalPrice,
                })),
                extras: billExtras.map(e => ({
                    extra: { id: e.extra.id, name: e.extra.name, price: e.extra.price },
                    quantity: e.quantity,
                })),
                totalAmount: billAmount,
                timestamp: new Date().toISOString(),
                status: 'pending' as const,
                tokenId: tokenId || '',
                paymentMethod: 'counter' as const,
                ...(orderType === 'preorder' && preorderDetails?.customerPhone
                    ? { customerPhone: preorderDetails.customerPhone, customerName: preorderDetails.customerName }
                    : {}),
                ...(orderType !== 'preorder' && whatsappPhone
                    ? { customerPhone: whatsappPhone.replace(/\D/g, '') }
                    : {}),
            };

            const res = await fetch('/api/db', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'order_add', order: orderData }),
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error((err as { error?: string }).error || 'Failed to place order');
            }

            const result = await res.json().catch(() => ({} as { orderId?: string }));
            const finalId = (result as { orderId?: string }).orderId || orderId;
            const placedOrder = { ...orderData, orderId: finalId };

            // Update local state so kitchen/admin pages see the new order immediately
            addOrder(placedOrder as Parameters<typeof addOrder>[0]);
            localStorage.setItem('lastOrder', JSON.stringify(placedOrder));
            clearCart();

            orderCompleted.current = true;
            router.replace(`/order-confirmed`);
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : 'Something went wrong';
            setError(message);
            setIsProcessing(false);
        }
    };

    const handleCashfreePayment = async () => {
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
                // dine-in WhatsApp opt-in; preorder uses preorderDetails.customerPhone
                ...(orderType !== 'preorder' && whatsappPhone
                    ? { customerPhone: whatsappPhone.replace(/\D/g, '') }
                    : {}),
            };
            localStorage.setItem('pendingOrder', JSON.stringify(pendingOrder));

            const customerPhone = orderType === 'preorder'
                ? preorderDetails?.customerPhone
                : whatsappPhone || undefined;
            const customerName = orderType === 'preorder'
                ? preorderDetails?.customerName
                : undefined;

            const res = await fetch('/api/cashfree/initiate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    merchantOrderId: tempOrderId,
                    amount: billAmount,
                    customerPhone,
                    customerName,
                }),
            });

            const data = await res.json();

            if (!res.ok || data.error) {
                throw new Error(typeof data.error === 'string' ? data.error : 'Failed to initiate payment');
            }

            // Store merchantOrderId for status check on return
            const stored = JSON.parse(localStorage.getItem('pendingOrder') || '{}');
            stored.merchantOrderId = tempOrderId;
            const storedStr = JSON.stringify(stored);
            localStorage.setItem('pendingOrder', storedStr);
            // Backup keyed by merchantOrderId — survives if 'pendingOrder' gets cleared
            localStorage.setItem(`pendingOrder_${tempOrderId}`, storedStr);

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

                    {/* WhatsApp updates opt-in — only for dine-in (preorder already has phone) */}
                    {orderType !== 'preorder' && (
                        <div className={styles.section}>
                            <h2 className={styles.sectionTitle}>
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" style={{ color: '#25D366', flexShrink: 0 }}>
                                    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                                </svg>
                                WhatsApp Updates
                            </h2>
                            <p className={styles.sectionSubtitle}>Get notified when your order is ready. Optional.</p>
                            <div className={styles.phoneInputRow}>
                                <span className={styles.phonePrefix}>+91</span>
                                <input
                                    type="tel"
                                    className={styles.phoneInput}
                                    placeholder="10-digit mobile number"
                                    value={whatsappPhone}
                                    onChange={e => setWhatsappPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
                                    maxLength={10}
                                />
                            </div>
                            {whatsappPhone.length === 10 && (
                                <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, fontSize: '0.85rem', color: '#666', cursor: 'pointer' }}>
                                    <input
                                        type="checkbox"
                                        checked={marketingOptIn}
                                        onChange={e => {
                                            const checked = e.target.checked;
                                            setMarketingOptIn(checked);
                                            // Consent is independent of whether this particular
                                            // order succeeds — fire immediately rather than
                                            // threading it through every order-completion path
                                            // (counter-pay here, online-pay via payment-result).
                                            if (checked) {
                                                fetch('/api/marketing/subscribe', {
                                                    method: 'POST',
                                                    headers: { 'Content-Type': 'application/json' },
                                                    body: JSON.stringify({ phone: whatsappPhone }),
                                                }).catch(() => {});
                                            }
                                        }}
                                    />
                                    Also send me occasional offers &amp; updates on WhatsApp
                                </label>
                            )}
                        </div>
                    )}

                    {/* Payment context / info (button moved to sticky bottom bar) */}
                    <div className={styles.infoBox}>
                        {paymentsEnabled ? (
                            <>
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                                    <path d="M7 11V7a5 5 0 0110 0v4" />
                                </svg>
                                <div>
                                    <p className={styles.infoTitle}>Secure Payment</p>
                                    <p className={styles.infoText}>Powered by Cashfree — supports UPI, credit/debit cards, and net banking. 256-bit encrypted.</p>
                                </div>
                            </>
                        ) : (
                            <div style={{ width: '100%' }}>
                                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px', marginBottom: '16px' }}>
                                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ flexShrink: 0, marginTop: 2 }}>
                                        <circle cx="12" cy="12" r="10" />
                                        <path d="M12 6v6l4 2" strokeLinecap="round" />
                                    </svg>
                                    <div>
                                        <p className={styles.infoTitle}>Pay at the Counter</p>
                                        <p className={styles.infoText}>Place your order now and pay when you collect — show your token number at the counter.</p>
                                    </div>
                                </div>
                                {billTemplate?.footer?.showQrCode && billTemplate.footer.upiId && (
                                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', padding: '16px', background: 'rgba(255,255,255,0.05)', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.1)' }}>
                                        <p style={{ margin: 0, fontSize: '0.8rem', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>Or pay now via UPI</p>
                                        <img
                                            src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(`upi://pay?pa=${billTemplate.footer.upiId}`)}`}
                                            alt="UPI QR Code"
                                            style={{ width: 160, height: 160, objectFit: 'contain', borderRadius: 8, background: '#fff', padding: 4 }}
                                        />
                                        {billTemplate.footer.qrLabel && (
                                            <p style={{ margin: 0, fontSize: '0.85rem', color: '#cbd5e1' }}>{billTemplate.footer.qrLabel}</p>
                                        )}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>

                {/* Sticky bottom action bar — always visible, safe-area aware */}
                <div className={styles.actionBar}>
                    {error && (
                        <div className={styles.errorBox} style={{ marginBottom: 0 }}>
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <circle cx="12" cy="12" r="10" />
                                <path d="M12 8v4M12 16h.01" strokeLinecap="round" />
                            </svg>
                            {error}
                        </div>
                    )}
                    <div className={styles.actionBarTotal}>
                        <span>{totalItemsCount} item{totalItemsCount !== 1 ? 's' : ''}</span>
                        <strong>₹{billAmount}</strong>
                    </div>
                    <button
                        className={styles.payBtn}
                        onClick={paymentsEnabled ? handleCashfreePayment : handleCounterOrder}
                        disabled={isProcessing}
                    >
                        <span className={styles.payBtnLabel}>
                            <small>{paymentsEnabled ? 'Pay securely' : 'Place order'}</small>
                            <span className={styles.payBtnAmount}>
                                {paymentsEnabled ? `Pay ₹${billAmount}` : `Confirm · ₹${billAmount}`}
                            </span>
                        </span>
                        <svg className={styles.payBtnArrow} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                            <path d="M5 12h14M12 5l7 7-7 7" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                    </button>
                    {paymentsEnabled && (
                        <p className={styles.actionBarHint}>You&apos;ll be redirected to Cashfree to complete payment.</p>
                    )}
                </div>
            </div>
        </>
    );
}
