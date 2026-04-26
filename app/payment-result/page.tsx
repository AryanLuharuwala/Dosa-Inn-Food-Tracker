'use client';

import React, { Suspense, useEffect, useState, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import LeafLoader from '@/components/LeafLoader';
import { getUniqueToken } from '@/lib/tokens';
import { useMenu } from '@/lib/menuContext';
import { useCart } from '@/lib/cartContext';
import { useSound } from '@/lib/useSound';

type PayState = 'checking' | 'success' | 'failed' | 'expired';

export default function PaymentResultPage() {
    return (
        <Suspense fallback={<LeafLoader isVisible variant="payment" />}>
            <PaymentResultPageInner />
        </Suspense>
    );
}

function PaymentResultPageInner() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const { addOrder } = useMenu();
    const { clearCart } = useCart();
    const [payState, setPayState] = useState<PayState>('checking');
    const [errorMsg, setErrorMsg] = useState('');
    const [finalOrderId, setFinalOrderId] = useState<string | null>(null);
    const processed = useRef(false);
    const playOrderPlaced = useSound('/sounds/order-placed.mp3', 0.7);

    useEffect(() => {
        if (processed.current) return;
        processed.current = true;

        const urlOrderId = searchParams.get('orderId');
        // Primary key, then backup keyed by merchantOrderId, then fall back to URL param
        const pending =
            localStorage.getItem('pendingOrder') ||
            (urlOrderId ? localStorage.getItem(`pendingOrder_${urlOrderId}`) : null);
        const pendingData = pending ? JSON.parse(pending) : null;
        const merchantOrderId = pendingData?.merchantOrderId || urlOrderId;

        if (!merchantOrderId) {
            setErrorMsg('No pending payment found. If you paid, contact support.');
            setPayState('failed');
            return;
        }

        async function finaliseOrder(orderData: Record<string, unknown>, paymentToken: string) {
            let tokenNumberValue: number;
            if (orderData.orderType === 'dine-in' && orderData.tableNumber) {
                tokenNumberValue = parseInt(orderData.tableNumber as string);
            } else {
                tokenNumberValue = await getUniqueToken();
            }
            const randomSuffix = Math.random().toString(36).substring(2, 6).toUpperCase();
            const orderId = `#${tokenNumberValue}-RDA-${randomSuffix}`;
            orderData.orderId = orderId;
            orderData.tokenNumber = tokenNumberValue;
            orderData.status = 'preparing';
            orderData.estimatedTime = 15;
            if (orderData.orderType === 'preorder') {
                const pd = orderData.preorderDetails as { customerPhone?: string; customerName?: string } | null;
                if (pd?.customerPhone) orderData.customerPhone = pd.customerPhone;
                if (pd?.customerName) orderData.customerName = pd.customerName;
            }
            // POST directly with the server-issued paymentToken — required by /api/db
            const res = await fetch('/api/db', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'order_add',
                    order: orderData,
                    paymentToken,
                    merchantOrderId,
                }),
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error((err as { error?: string }).error || 'Failed to place order');
            }
            // If another device already placed this order, the server returns its orderId
            const result = await res.json().catch(() => ({} as { orderId?: string; duplicate?: boolean }));
            const finalId = (result as { orderId?: string }).orderId || orderId;
            // Update local context state so kitchen/admin pages reflect new order
            addOrder({ ...orderData, orderId: finalId } as Parameters<typeof addOrder>[0]);
            localStorage.setItem('lastOrder', JSON.stringify({ ...orderData, orderId: finalId }));
            localStorage.removeItem('pendingOrder');
            if (pendingData?.merchantOrderId) localStorage.removeItem(`pendingOrder_${pendingData.merchantOrderId}`);
            clearCart();
            playOrderPlaced();
            setFinalOrderId(finalId);
            setPayState('success');
        }

        async function recoverExistingOrder(): Promise<boolean> {
            // The other device already placed the order — look it up and
            // navigate instead of showing "order data was lost".
            const res = await fetch(`/api/db?resource=order_by_merchant&merchantOrderId=${encodeURIComponent(merchantOrderId)}`);
            if (!res.ok) return false;
            const { order } = (await res.json()) as { order: { orderId: string } | null };
            if (!order) return false;
            localStorage.removeItem('pendingOrder');
            if (urlOrderId) localStorage.removeItem(`pendingOrder_${urlOrderId}`);
            setFinalOrderId(order.orderId);
            setPayState('success');
            return true;
        }

        async function checkStatus(attempt = 0): Promise<void> {
            const res = await fetch(`/api/phonepe/status?orderId=${encodeURIComponent(merchantOrderId)}`);
            const data = await res.json();
            console.log('[payment-result] status response:', data);

            if (!res.ok || data.error) {
                setErrorMsg(typeof data.error === 'string' ? data.error : 'Payment verification failed');
                setPayState('failed');
                return;
            }

            if (data.state === 'COMPLETED') {
                if (!pendingData) {
                    // No cart data on this device (the other device placed the order).
                    // Try to recover by looking up the existing order.
                    const recovered = await recoverExistingOrder();
                    if (!recovered) {
                        setErrorMsg('Payment succeeded but order data was lost. Please contact support with order ID: ' + merchantOrderId);
                        setPayState('failed');
                    }
                    return;
                }
                try {
                    await finaliseOrder(pendingData, data.paymentToken);
                } catch (err: unknown) {
                    // If finalise failed because the order already exists elsewhere,
                    // try to pick it up instead of showing an error.
                    const recovered = await recoverExistingOrder();
                    if (!recovered) {
                        setErrorMsg((err instanceof Error ? err.message : 'Order placement failed') + ' — payment ref: ' + merchantOrderId);
                        setPayState('failed');
                    }
                }
                return;
            } else if (data.state === 'FAILED') {
                setPayState('failed');
                setErrorMsg('Payment was declined. Please try again.');
            } else if (data.state === 'EXPIRED') {
                setPayState('expired');
                setErrorMsg('Payment session expired. Please try again.');
            } else {
                // PENDING — retry up to 5 times with 3s gap
                if (attempt < 5) {
                    setTimeout(() => checkStatus(attempt + 1), 3000);
                } else {
                    setPayState('failed');
                    setErrorMsg('Payment could not be confirmed. If you paid, contact support with your order reference.');
                }
            }
        }

        checkStatus();
    }, [searchParams, router, addOrder, clearCart]);

    if (payState === 'success') {
        return (
            <LeafLoader
                isVisible
                variant="success"
                onComplete={() => router.replace(finalOrderId ? `/track-order?id=${encodeURIComponent(finalOrderId)}` : '/track-order')}
            />
        );
    }

    if (payState === 'checking') {
        return <LeafLoader isVisible variant="payment" />;
    }

    // failed or expired
    return (
        <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '24px', background: 'var(--color-bg)' }}>
            <div style={{ fontSize: 64 }}>✗</div>
            <h1 style={{ fontSize: '1.5rem', fontWeight: 700, marginTop: 16, color: 'var(--color-text)' }}>
                {payState === 'expired' ? 'Session Expired' : 'Payment Failed'}
            </h1>
            <p style={{ color: 'var(--color-text-muted)', marginTop: 8, textAlign: 'center' }}>{errorMsg}</p>
            <button
                onClick={() => router.replace('/checkout')}
                style={{ marginTop: 32, padding: '14px 32px', background: 'var(--color-primary)', color: 'white', borderRadius: 'var(--radius-lg)', fontWeight: 600, fontSize: '1rem', border: 'none', cursor: 'pointer' }}
            >
                Try Again
            </button>
            <button
                onClick={() => router.replace('/menu')}
                style={{ marginTop: 12, padding: '14px 32px', background: 'transparent', color: 'var(--color-text-muted)', borderRadius: 'var(--radius-lg)', fontWeight: 500, fontSize: '1rem', border: '1px solid rgba(0,0,0,0.12)', cursor: 'pointer' }}
            >
                Back to Menu
            </button>
        </div>
    );
}
