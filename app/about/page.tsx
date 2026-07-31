import { getSettings } from '@/lib/localDb';
import type { Metadata } from 'next';
import Link from 'next/link';

// Never statically pre-render — settings can change at runtime via the admin panel
export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
    const s = await getSettings();
    const name = s.legalName || s.restaurantName || 'Restaurant';
    return {
        title: `About Us — ${s.restaurantName || name}`,
        description: `${name} is a registered food business.`,
    };
}

export default async function AboutPage() {
    const s = await getSettings();
    const displayName = s.restaurantName || 'Our Restaurant';
    const legalName  = s.legalName || displayName;

    return (
        <main style={{
            minHeight: '100vh',
            background: 'var(--color-bg, #f9f6f0)',
            color: 'var(--color-text, #1a1a1a)',
            fontFamily: 'inherit',
            padding: '48px 24px',
            maxWidth: 640,
            margin: '0 auto',
        }}>
            <Link href="/" style={{ color: 'var(--color-primary, #1a4d2e)', fontSize: '0.9rem', textDecoration: 'none' }}>
                ← Back
            </Link>

            <h1 style={{ fontSize: '2rem', fontWeight: 800, margin: '32px 0 8px' }}>{displayName}</h1>
            {s.tagline && (
                <p style={{ fontSize: '1rem', color: '#666', margin: '0 0 40px' }}>{s.tagline}</p>
            )}

            <section style={{ marginBottom: 40 }}>
                <h2 style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#555' }}>
                    About Us
                </h2>
                <p style={{ lineHeight: 1.7 }}>
                    We are a 100% pure vegetarian food outlet committed to serving fresh, homestyle
                    meals. All orders are freshly prepared and served with care.
                </p>
            </section>

            <section style={{ marginBottom: 40 }}>
                <h2 style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#555' }}>
                    Business Information
                </h2>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <tbody>
                        <tr style={{ borderBottom: '1px solid #e5e5e5' }}>
                            <td style={{ padding: '12px 0', color: '#666', width: '40%' }}>Legal Name</td>
                            <td style={{ padding: '12px 0', fontWeight: 600 }}>{legalName}</td>
                        </tr>
                        <tr style={{ borderBottom: '1px solid #e5e5e5' }}>
                            <td style={{ padding: '12px 0', color: '#666' }}>Brand Name</td>
                            <td style={{ padding: '12px 0' }}>{displayName}</td>
                        </tr>
                        <tr style={{ borderBottom: '1px solid #e5e5e5' }}>
                            <td style={{ padding: '12px 0', color: '#666' }}>Type</td>
                            <td style={{ padding: '12px 0' }}>Food &amp; Beverage — 100% Vegetarian</td>
                        </tr>
                        <tr>
                            <td style={{ padding: '12px 0', color: '#666' }}>Website</td>
                            <td style={{ padding: '12px 0' }}>pollys.food</td>
                        </tr>
                    </tbody>
                </table>
            </section>

            <section style={{ marginBottom: 40 }}>
                <h2 style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#555' }}>
                    Refund &amp; Cancellation Policy
                </h2>
                <p style={{ lineHeight: 1.7, marginBottom: 12 }}>
                    Orders once placed and confirmed cannot be cancelled. If your order is not delivered
                    or there is a quality issue, please contact us at the counter or through our support
                    channel and we will resolve it promptly.
                </p>
                <p style={{ lineHeight: 1.7 }}>
                    Payments made online are fully refunded within 5–7 business days if the order
                    cannot be fulfilled due to reasons on our side.
                </p>
            </section>

            <section style={{ marginBottom: 40 }}>
                <h2 style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#555' }}>
                    Privacy Policy
                </h2>
                <p style={{ lineHeight: 1.7 }}>
                    We collect only the information needed to process your order (phone number, order
                    details). We do not share your personal data with third parties except as required
                    to process payments via Cashfree Payments. Payment information is handled
                    securely by Cashfree and is never stored on our servers.
                </p>
            </section>

            <footer style={{ borderTop: '1px solid #e5e5e5', paddingTop: 24, fontSize: '0.85rem', color: '#999' }}>
                &copy; {new Date().getFullYear()} {legalName}. All rights reserved.
            </footer>
        </main>
    );
}
