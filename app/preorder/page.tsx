'use client';

import React, { useState, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCart } from '@/lib/cartContext';
import { useMenu } from '@/lib/menuContext';
import LeafLoader from '@/components/LeafLoader';
import styles from './page.module.css';

// Generate arrival time slots (15-min intervals, next 2 hours only)
function generateTimeSlots(): string[] {
    const slots: string[] = [];
    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();

    // Operating hours: 10 AM to 10 PM (22:00)
    const openTime = 10 * 60;
    const closeTime = 22 * 60;

    // Start from next 15-min slot after 20 min prep time
    let startMinutes = currentMinutes + 20;
    startMinutes = Math.ceil(startMinutes / 15) * 15;

    if (startMinutes < openTime) {
        startMinutes = openTime;
    }

    // End time: 2 hours from now (or closing)
    const maxEndMinutes = currentMinutes + 120;
    const endMinutes = Math.min(maxEndMinutes, closeTime - 15);

    for (let mins = startMinutes; mins <= endMinutes; mins += 15) {
        const hours = Math.floor(mins / 60);
        const minutes = mins % 60;
        const ampm = hours >= 12 ? 'PM' : 'AM';
        const displayHours = hours > 12 ? hours - 12 : hours === 0 ? 12 : hours;
        slots.push(`${displayHours}:${minutes.toString().padStart(2, '0')} ${ampm}`);
    }

    return slots;
}

export default function PreorderPage() {
    const router = useRouter();
    const { setOrderType, setPreorderDetails, setTableNumber } = useCart();
    const { restaurantName } = useMenu();
    const [name, setName] = useState('');
    const [phone, setPhone] = useState('');
    const [selectedTime, setSelectedTime] = useState<string | null>(null);
    const [showLoader, setShowLoader] = useState(false);
    const [errors, setErrors] = useState<{ name?: string; phone?: string; time?: string }>({});

    const timeSlots = useMemo(() => generateTimeSlots(), []);
    const isAfterHours = timeSlots.length === 0;

    const validateForm = () => {
        const newErrors: { name?: string; phone?: string; time?: string } = {};

        if (!name.trim()) {
            newErrors.name = 'Please enter your name';
        }

        if (!phone.trim()) {
            newErrors.phone = 'Please enter your phone number';
        } else if (!/^[6-9]\d{9}$/.test(phone.replace(/\s/g, ''))) {
            newErrors.phone = 'Enter valid 10-digit number';
        }

        if (!selectedTime) {
            newErrors.time = 'Please select arrival time';
        }

        setErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    };

    const handleContinue = () => {
        if (!validateForm()) return;

        setOrderType('preorder');
        setTableNumber(null);
        setPreorderDetails({
            pickupTime: selectedTime!,
            customerName: name.trim(),
            customerPhone: phone.replace(/\s/g, ''),
        });

        setShowLoader(true);
    };

    const handleLoaderComplete = () => {
        router.push('/menu');
    };

    return (
        <>
            <LeafLoader
                isVisible={showLoader}
                variant="transition"
                onComplete={handleLoaderComplete}
            />

            <div className={styles.container}>
                {/* Header */}
                <div className={styles.header}>
                    <Link href="/" className={styles.backBtn}>
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M19 12H5M12 19l-7-7 7-7" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                    </Link>
                    <Link href="/" className={styles.logoLink}>
                        <img src="/logo.png" alt={restaurantName} className={styles.logo} />
                    </Link>
                </div>

                {/* Content */}
                <div className={styles.content}>
                    <div className={styles.titleSection}>
                        <h1 className={styles.title}>Skip the Wait</h1>
                        <p className={styles.subtitle}>Order now, food ready when you arrive!</p>
                    </div>

                    {isAfterHours ? (
                        <div className={styles.closedMessage}>
                            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                                <circle cx="12" cy="12" r="10" />
                                <path d="M12 6v6l4 2" />
                            </svg>
                            <h2>We're Closed</h2>
                            <p>Available from 10 AM to 10 PM</p>
                            <Link href="/" className={styles.backHomeBtn}>Back to Home</Link>
                        </div>
                    ) : (
                        <>
                            {/* Name Input */}
                            <div className={styles.inputGroup}>
                                <label className={styles.label}>Your Name</label>
                                <div className={`${styles.inputWrapper} ${errors.name ? styles.inputError : ''}`}>
                                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                        <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
                                        <circle cx="12" cy="7" r="4" />
                                    </svg>
                                    <input
                                        type="text"
                                        placeholder="Enter your name"
                                        value={name}
                                        onChange={(e) => {
                                            setName(e.target.value);
                                            if (errors.name) setErrors(prev => ({ ...prev, name: undefined }));
                                        }}
                                        className={styles.input}
                                    />
                                </div>
                                {errors.name && <p className={styles.errorText}>{errors.name}</p>}
                            </div>

                            {/* Phone Input */}
                            <div className={styles.inputGroup}>
                                <label className={styles.label}>Phone Number</label>
                                <div className={`${styles.inputWrapper} ${errors.phone ? styles.inputError : ''}`}>
                                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                        <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.127.96.362 1.903.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.574 2.81.7A2 2 0 0122 16.92z" />
                                    </svg>
                                    <input
                                        type="tel"
                                        placeholder="10-digit mobile number"
                                        value={phone}
                                        onChange={(e) => {
                                            const value = e.target.value.replace(/\D/g, '').slice(0, 10);
                                            setPhone(value);
                                            if (errors.phone) setErrors(prev => ({ ...prev, phone: undefined }));
                                        }}
                                        className={styles.input}
                                    />
                                </div>
                                {errors.phone && <p className={styles.errorText}>{errors.phone}</p>}
                            </div>

                            {/* Time Slots */}
                            <div className={styles.inputGroup}>
                                <label className={styles.label}>Arrival Time (next 2 hours)</label>
                                {errors.time && <p className={styles.errorText}>{errors.time}</p>}
                                <div className={styles.timeGrid}>
                                    {timeSlots.map((slot) => (
                                        <button
                                            key={slot}
                                            className={`${styles.timeSlot} ${selectedTime === slot ? styles.timeSlotSelected : ''}`}
                                            onClick={() => {
                                                setSelectedTime(slot);
                                                if (errors.time) setErrors(prev => ({ ...prev, time: undefined }));
                                            }}
                                        >
                                            {slot}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </>
                    )}
                </div>

                {/* CTA */}
                {!isAfterHours && (
                    <div className={styles.ctaWrapper}>
                        <button className={styles.ctaBtn} onClick={handleContinue}>
                            Start Ordering
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                <path d="M5 12h14M12 5l7 7-7 7" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                        </button>
                    </div>
                )}
            </div>
        </>
    );
}
