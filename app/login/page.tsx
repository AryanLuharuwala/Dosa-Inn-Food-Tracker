'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMenu } from '@/lib/menuContext';
import styles from './page.module.css';
import Link from 'next/link';


export default function LoginPage() {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [password, setPassword] = useState('');
    const router = useRouter();
    const { restaurantName } = useMenu();

    // Password login
    const handleGoogleLogin = async () => { /* removed */ };
    const handlePasswordLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError(null);
        const res = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password }),
        });
        setLoading(false);
        if (res.ok) {
            router.push('/admin');
            router.refresh();
        } else {
            setError('Invalid password');
        }
    };

    return (
        <div className={styles.container}>
            <div className={styles.card}>
                <img src="/logo.png" alt={restaurantName} className={styles.logo} />
                <h1 className={styles.title}>Admin Login</h1>
                <p className={styles.subtitle}>Secure access for management</p>

                {error && <div className={styles.error}>{error}</div>}

                <form className={styles.form} onSubmit={handlePasswordLogin}>
                    <div className={styles.inputGroup}>
                        <label className={styles.label}>Password</label>
                        <input
                            type="password"
                            className={styles.input}
                            placeholder="Enter admin password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            required
                            autoFocus
                        />
                    </div>
                    <button type="submit" className={styles.btnPrimary} disabled={loading}>
                        {loading ? 'Logging in...' : 'Login'} ➝
                    </button>
                </form>

                <div style={{ marginTop: '24px' }}>
                    <Link href="/" className={styles.btnLink}>← Back to Home</Link>
                </div>
            </div>
        </div>
    );
}
