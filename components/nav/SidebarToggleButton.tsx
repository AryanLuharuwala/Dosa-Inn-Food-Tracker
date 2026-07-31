'use client';

import React from 'react';
import { useSidebar } from './SidebarContext';
import styles from './SidebarToggleButton.module.css';

interface SidebarToggleButtonProps {
    /** 'inline' sits in-flow inside a page's own navbar (e.g. Header's icon
     *  row). 'fab' is the fixed-position fallback for pages with no shared
     *  navbar to stitch into. */
    variant?: 'inline' | 'fab';
}

export default function SidebarToggleButton({ variant = 'inline' }: SidebarToggleButtonProps) {
    const { open, toggle } = useSidebar();

    return (
        <button
            type="button"
            aria-label={open ? 'Close navigation' : 'Open navigation'}
            aria-expanded={open}
            className={`${styles.btn} ${variant === 'fab' ? styles.fab : styles.inline}`}
            onClick={toggle}
        >
            <span className={styles.line} />
            <span className={styles.line} />
            <span className={styles.line} />
        </button>
    );
}
