'use client';

import React, { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useMenu } from '@/lib/menuContext';
import styles from './page.module.css';
import LeafLoader from '@/components/LeafLoader';

const ADMIN_PASSWORD = 'rocky123'; // Simple password for demo - in production use proper auth

export default function LandingPage() {
  const router = useRouter();
  const { restaurantName, tagline, legalName } = useMenu();
  const [showLoader, setShowLoader] = useState(false);
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement>(null);

  // Both CTAs on this page lead here — warm the router cache for whichever
  // the visitor picks so the transition feels instant instead of waiting on
  // a fresh network round-trip, especially over flaky campus WiFi.
  useEffect(() => {
    router.prefetch('/table');
    router.prefetch('/preorder');
  }, [router]);

  // Parallax effect on mouse/touch move
  const handleMouseMove = (e: React.MouseEvent | React.TouchEvent) => {
    if (!containerRef.current) return;

    const rect = containerRef.current.getBoundingClientRect();
    let clientX, clientY;

    if ('touches' in e) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else {
      clientX = e.clientX;
      clientY = e.clientY;
    }

    const x = (clientX - rect.left - rect.width / 2) / 25;
    const y = (clientY - rect.top - rect.height / 2) / 25;

    setMousePosition({ x, y });
  };

  const handleStart = () => {
    setShowLoader(true);
  };

  const handleLoaderComplete = () => {
    router.push('/table');
  };

  const handlePreorder = () => {
    router.push('/preorder');
  };

  const handleAdminClick = () => {
    router.push('/login');
  };

  return (
    <>
      <LeafLoader
        isVisible={showLoader}
        variant="transition"
        onComplete={handleLoaderComplete}
      />

      {/* Password Modal Removed - using /login page now */}

      <div
        ref={containerRef}
        className={styles.container}
        onMouseMove={handleMouseMove}
        onTouchMove={handleMouseMove}
      >
        {/* Admin Icon - Top Right */}
        <button className={styles.adminBtn} onClick={handleAdminClick} aria-label="Admin Login">
          <img src="/admin-icon.png" alt="Admin" className={styles.adminIcon} />
        </button>

        {/* Animated background elements */}
        <div className={styles.bgElements}>
          <div className={styles.bgCircle1} />
          <div className={styles.bgCircle2} />
          <div className={styles.bgCircle3} />
        </div>

        {/* Floating leaves decoration */}
        <div className={styles.floatingLeaves}>
          <svg
            className={styles.floatingLeaf1}
            style={{ transform: `translate(${mousePosition.x * 2}px, ${mousePosition.y * 2}px)` }}
            viewBox="0 0 40 50"
            fill="none"
          >
            <path
              d="M20 2C10 12 4 25 4 38C4 43 6 47 10 49C15 51 18 51 20 51C22 51 25 51 30 49C34 47 36 43 36 38C36 25 30 12 20 2Z"
              fill="#7cb342"
              opacity="0.3"
            />
          </svg>
          <svg
            className={styles.floatingLeaf2}
            style={{ transform: `translate(${-mousePosition.x * 1.5}px, ${-mousePosition.y * 1.5}px)` }}
            viewBox="0 0 40 50"
            fill="none"
          >
            <path
              d="M20 2C10 12 4 25 4 38C4 43 6 47 10 49C15 51 18 51 20 51C22 51 25 51 30 49C34 47 36 43 36 38C36 25 30 12 20 2Z"
              fill="#9ccc65"
              opacity="0.4"
            />
          </svg>
          <svg
            className={styles.floatingLeaf3}
            style={{ transform: `translate(${mousePosition.x}px, ${-mousePosition.y}px)` }}
            viewBox="0 0 40 50"
            fill="none"
          >
            <path
              d="M20 2C10 12 4 25 4 38C4 43 6 47 10 49C15 51 18 51 20 51C22 51 25 51 30 49C34 47 36 43 36 38C36 25 30 12 20 2Z"
              fill="#558b2f"
              opacity="0.25"
            />
          </svg>
        </div>

        {/* Main content */}
        <div className={styles.content}>
          {/* Logo with 3D effect */}
          <div
            className={styles.logoContainer}
            style={{
              transform: `perspective(1000px) rotateY(${mousePosition.x * 0.5}deg) rotateX(${-mousePosition.y * 0.5}deg)`
            }}
          >
            <img
              src="/logo.png"
              alt={`${restaurantName}${tagline ? ` - ${tagline}` : ''}`}
              className={styles.logo}
            />
            <div className={styles.logoGlow} />
          </div>

          {/* Tagline */}
          <p className={styles.tagline}>
            Mess ka trauma is real.<br />
            <span className={styles.taglineHighlight}>Food shouldn't be.</span>
          </p>

          {/* Veg badge */}
          <div className={styles.vegBadgeWrapper}>
            <div className={styles.vegBadgeLarge}>
              <div className={styles.vegDot} />
            </div>
            <span className={styles.vegText}>100% Pure Vegetarian</span>
          </div>
        </div>

        {/* CTA Buttons */}
        <div className={styles.ctaWrapper}>
          <button className={styles.ctaBtn} onClick={handleStart}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="11" width="18" height="10" rx="2" />
              <path d="M7 11V7a5 5 0 0110 0v4" />
            </svg>
            <span>Order at Table</span>
          </button>
          <button className={styles.ctaBtnSecondary} onClick={handlePreorder}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <path d="M12 6v6l4 2" />
            </svg>
            <span>Takeaway</span>
          </button>
          <p className={styles.ctaSubtext}>Scan. Order. Eat. Repeat.</p>
        </div>

        {/* Legal footer — sits inside .container (position:relative) so absolute bottom works */}
        <footer style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          padding: '12px 24px',
          textAlign: 'center',
          fontSize: '0.72rem',
          color: 'rgba(255,255,255,0.45)',
          letterSpacing: '0.02em',
        }}>
          {(legalName || restaurantName) && (
            <span itemScope itemType="https://schema.org/FoodEstablishment">
              <span itemProp="legalName">{legalName || restaurantName}</span>
              {' · '}
            </span>
          )}
          <a href="/about" style={{ color: 'inherit', textDecoration: 'underline' }}>
            About &amp; Policies
          </a>
        </footer>
      </div>
    </>
  );
}
