'use client';

import React, { useState, useMemo, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCart } from '@/lib/cartContext';
import { useMenu } from '@/lib/menuContext';
import LeafLoader from '@/components/LeafLoader';
import styles from './page.module.css';

type TimeSlot = { value: string; tomorrow: boolean };

// Generate arrival time slots (15-min intervals). If the current time is past
// today's window (or within the prep-time buffer of closing), roll over to
// tomorrow's opening so the user never sees "We're Closed".
function generateTimeSlots(): TimeSlot[] {
    const slots: TimeSlot[] = [];
    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();

    // Operating hours: 7 AM to 11 PM
    const openTime = 7 * 60;
    const closeTime = 23 * 60;
    const PREP_BUFFER_MIN = 20;
    const WINDOW_MIN = 120;

    // Start from next 15-min slot after prep time
    let startMinutes = Math.ceil((currentMinutes + PREP_BUFFER_MIN) / 15) * 15;
    let tomorrow = false;

    // Before opening today → start at today's opening
    if (startMinutes < openTime) {
        startMinutes = openTime;
    }

    // Past today's latest viable slot → roll over to tomorrow's opening
    if (startMinutes > closeTime - 15) {
        startMinutes = openTime;
        tomorrow = true;
    }

    const endMinutes = tomorrow
        ? Math.min(startMinutes + WINDOW_MIN, closeTime - 15)
        : Math.min(currentMinutes + WINDOW_MIN, closeTime - 15);

    for (let mins = startMinutes; mins <= endMinutes; mins += 15) {
        const hours = Math.floor(mins / 60);
        const minutes = mins % 60;
        const ampm = hours >= 12 ? 'PM' : 'AM';
        const displayHours = hours > 12 ? hours - 12 : hours === 0 ? 12 : hours;
        const label = `${displayHours}:${minutes.toString().padStart(2, '0')} ${ampm}`;
        slots.push({ value: label, tomorrow });
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

    // Every preorder ends up at /menu next — warm it ahead of the click.
    useEffect(() => {
        router.prefetch('/menu');
    }, [router]);
    const [errors, setErrors] = useState<{ name?: string; phone?: string; time?: string }>({});

    const timeSlots = useMemo(() => generateTimeSlots(), []);
    const allTomorrow = timeSlots.length > 0 && timeSlots.every(s => s.tomorrow);

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
                        <h1 className={styles.title}>Takeaway</h1>
                        <p className={styles.subtitle}>Order ahead, pick up when ready!</p>
                    </div>

                    {(
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
                                <label className={styles.label}>
                                    Arrival Time {allTomorrow ? '(tomorrow)' : '(next 2 hours)'}
                                </label>
                                {errors.time && <p className={styles.errorText}>{errors.time}</p>}
                                <div className={styles.timeGrid}>
                                    {timeSlots.map((slot) => {
                                        const fullLabel = slot.tomorrow ? `Tomorrow ${slot.value}` : slot.value;
                                        return (
                                            <button
                                                key={fullLabel}
                                                className={`${styles.timeSlot} ${selectedTime === fullLabel ? styles.timeSlotSelected : ''}`}
                                                onClick={() => {
                                                    setSelectedTime(fullLabel);
                                                    if (errors.time) setErrors(prev => ({ ...prev, time: undefined }));
                                                }}
                                            >
                                                {slot.value}
                                                {slot.tomorrow && <span style={{ display: 'block', fontSize: '0.65rem', opacity: 0.7, marginTop: 2 }}>tomorrow</span>}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        </>
                    )}
                </div>

                {/* CTA */}
                <div className={styles.ctaWrapper}>
                    <button className={styles.ctaBtn} onClick={handleContinue}>
                        Start Ordering
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                            <path d="M5 12h14M12 5l7 7-7 7" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                    </button>
                    {allTomorrow && (
                        <p className={styles.closedNote}>We&apos;re wrapping up for today — book a slot for tomorrow morning.</p>
                    )}
                </div>
            </div>
        </>
    );
}
