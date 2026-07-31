'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSidebar } from './SidebarContext';
import SidebarToggleButton from './SidebarToggleButton';
import styles from './SiteSidebar.module.css';

interface NavLink {
    href: string;
    label: string;
    icon: string;
}

// Pages that embed <SidebarToggleButton variant="inline"> in their own
// shared navbar (Header.tsx) — the floating fallback button would be a
// redundant, overlapping second trigger on these, so it's suppressed there.
const HEADER_ROUTES = ['/menu', '/cart', '/checkout', '/order-summary'];

const CUSTOMER_LINKS: NavLink[] = [
    { href: '/', label: 'Home', icon: '🏠' },
    { href: '/menu', label: 'Menu', icon: '🍽️' },
    { href: '/cart', label: 'Cart', icon: '🛒' },
    { href: '/track-order', label: 'Track Order', icon: '📍' },
    { href: '/about', label: 'About', icon: 'ℹ️' },
];

// Only ever shown to a browser holding a valid admin session (see the
// isAdmin check below) — a customer's hamburger menu has no business
// surfacing internal staff tooling as an option.
const STAFF_LINKS: NavLink[] = [
    { href: '/admin', label: 'Admin Dashboard', icon: '🧭' },
    { href: '/kitchen', label: 'Kitchen', icon: '🍳' },
    { href: '/cook', label: 'Cook', icon: '🔥' },
    { href: '/admin/analytics', label: 'Analytics', icon: '📊' },
    { href: '/admin/pricing', label: 'Pricing', icon: '💰' },
    { href: '/admin/bill-editor', label: 'Bill Editor', icon: '🧾' },
    { href: '/admin/marketing', label: 'Marketing', icon: '📣' },
    { href: '/admin/print-devices', label: 'Print Devices', icon: '🖨️' },
    { href: '/admin/sessions', label: 'Sessions', icon: '🔐' },
    { href: '/admin/debug', label: 'Debug', icon: '🐞' },
];

export default function SiteSidebar() {
    const { open, setOpen } = useSidebar();
    const pathname = usePathname();
    const [isAdmin, setIsAdmin] = useState(false);

    useEffect(() => {
        fetch('/api/auth/me').then(r => r.ok ? r.json() : null).then(data => setIsAdmin(!!data?.isAdmin)).catch(() => {});
    }, []);

    useEffect(() => {
        if (!open) return;
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [open, setOpen]);

    const showFab = !HEADER_ROUTES.some(r => pathname === r || pathname.startsWith(`${r}/`));

    return (
        <>
            {showFab && <SidebarToggleButton variant="fab" />}

            {open && <div className={styles.overlay} onClick={() => setOpen(false)} />}

            <nav className={`${styles.sidebar} ${open ? styles.sidebarOpen : ''}`} aria-hidden={!open}>
                <div className={styles.sidebarHeader}>Rocky Da Adda</div>

                <div className={styles.section}>
                    <span className={styles.sectionLabel}>Customer</span>
                    <div className={styles.grid}>
                        {CUSTOMER_LINKS.map(l => (
                            <Link key={l.href} href={l.href} className={styles.card} onClick={() => setOpen(false)}>
                                <span className={styles.cardIcon}>{l.icon}</span>
                                <span className={styles.cardLabel}>{l.label}</span>
                            </Link>
                        ))}
                    </div>
                </div>

                {isAdmin && (
                    <div className={styles.section}>
                        <span className={styles.sectionLabel}>Staff</span>
                        <div className={styles.grid}>
                            {STAFF_LINKS.map(l => (
                                <Link key={l.href} href={l.href} className={styles.card} onClick={() => setOpen(false)}>
                                    <span className={styles.cardIcon}>{l.icon}</span>
                                    <span className={styles.cardLabel}>{l.label}</span>
                                </Link>
                            ))}
                        </div>
                    </div>
                )}
            </nav>
        </>
    );
}
