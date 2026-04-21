'use client';

import React, { useEffect, useState, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import LeafLoader from '@/components/LeafLoader';
import { getUniqueToken } from '@/lib/tokens';
import { useMenu } from '@/lib/menuContext';
import { useCart } from '@/lib/cartContext';

type PayState = 'checking' | 'success' | 'failed' | 'expired';

export default function PaymentResultPage() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const { addOrder } = useMenu();
    const { clearCart } = useCart();
    const [payState, setPayState] = useState<PayState>('checking');
    const [errorMsg, setErrorMsg] = useState('');
    const processed = useRef(false);

    useEffect(() => {
        if (processed.current) return;
        processed.current = true;

        const pending = sessionStorage.getItem('pendingOrder');
        const pendingData = pending ? JSON.parse(pending) : null;
        // Status API takes merchantOrderId, not PhonePe's internal orderId
        const merchantOrderId = pendingData?.merchantOrderId || searchParams.get('orderId');

        if (!merchantOrderId) {
            setErrorMsg('No pending payment found. If you paid, contact support.');
            setPayState('failed');
            return;
        }

        async function finaliseOrder(orderData: Record<string, unknown>) {
            let tokenNumberValue: number;
            if (orderData.orderType === 'dine-in' && orderData.tableNumber) {
                tokenNumberValue = parseInt(orderData.tableNumber as string);
            } else {
                tokenNumberValue = await getUniqueToken();
            }
            const randomSuffix = Math.random().toString(36).substring(2, 6).toUpperCase();
            orderData.orderId = `#${tokenNumberValue}-RDA-${randomSuffix}`;
            orderData.tokenNumber = tokenNumberValue;
            orderData.status = 'preparing';
            orderData.estimatedTime = 15;
            addOrder(orderData as Parameters<typeof addOrder>[0]);
            sessionStorage.setItem('lastOrder', JSON.stringify(orderData));
            sessionStorage.removeItem('pendingOrder');
            clearCart();
            setPayState('success');
        }

        async function checkStatus(attempt = 0): Promise<void> {
            console.log('[payment-result] checking status attempt', attempt, 'merchantOrderId:', merchantOrderId);
            const res = await fetch(`/api/phonepe/status?orderId=${encodeURIComponent(merchantOrderId)}`);
            const data = await res.json();
            console.log('[payment-result] status response:', data);

            if (!res.ok || data.error) {
                setErrorMsg(typeof data.error === 'string' ? data.error : 'Payment verification failed');
                setPayState('failed');
                return;
            }

            if (data.state === 'COMPLETED') {
                await finaliseOrder(pendingData);
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
                onComplete={() => router.replace('/order-confirmed')}
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
