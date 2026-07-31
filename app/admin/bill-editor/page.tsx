'use client';

import React, { useState, useCallback, useRef } from 'react';
import Link from 'next/link';
import { useMenu } from '@/lib/menuContext';
import { BillTemplate, DEFAULT_BILL_TEMPLATE } from '@/lib/billTemplate';
import styles from './page.module.css';

// ── Mock order for live preview ───────────────────────────────────────────────
const PREVIEW_ORDER = {
    orderId: 'ORD-A1B2',
    tokenNumber: 42,
    tableNumber: '5',
    orderType: 'dine-in',
    timestamp: new Date().toISOString(),
    customerName: 'Raj Kumar',
    paymentMethod: 'counter',
    totalAmount: 385,
    items: [
        { menuItem: { name: 'Paneer Butter Masala', price: 180 }, quantity: 1, selectedAddOns: [{ name: 'Extra Gravy', price: 20 }], totalPrice: 200 },
        { menuItem: { name: 'Plain Paratha', price: 30 }, quantity: 3, selectedAddOns: [], totalPrice: 90 },
        { menuItem: { name: 'Masala Chai', price: 30 }, quantity: 3, selectedAddOns: [], totalPrice: 90 },
    ],
};

// ── Helper components ─────────────────────────────────────────────────────────

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
    return (
        <button
            type="button"
            role="switch"
            aria-checked={checked}
            className={`${styles.toggle} ${checked ? styles.toggleOn : ''}`}
            onClick={() => onChange(!checked)}
        >
            <span className={styles.toggleThumb} />
        </button>
    );
}

function Section({ title, icon, children }: { title: string; icon: string; children: React.ReactNode }) {
    const [open, setOpen] = useState(true);
    return (
        <div className={styles.section}>
            <button className={styles.sectionHeader} onClick={() => setOpen(o => !o)}>
                <span className={styles.sectionIcon}>{icon}</span>
                <span className={styles.sectionTitle}>{title}</span>
                <span className={styles.sectionChevron} style={{ transform: open ? 'rotate(180deg)' : 'rotate(0deg)' }}>▾</span>
            </button>
            {open && <div className={styles.sectionBody}>{children}</div>}
        </div>
    );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div className={styles.row}>
            <span className={styles.rowLabel}>{label}</span>
            <div className={styles.rowControl}>{children}</div>
        </div>
    );
}

function SizeSelect({ value, onChange, options }: {
    value: string;
    onChange: (v: string) => void;
    options: { value: string; label: string }[];
}) {
    return (
        <div className={styles.sizeSelect}>
            {options.map(o => (
                <button
                    key={o.value}
                    className={`${styles.sizeBtn} ${value === o.value ? styles.sizeBtnActive : ''}`}
                    onClick={() => onChange(o.value)}
                    type="button"
                >
                    {o.label}
                </button>
            ))}
        </div>
    );
}

// ── Receipt Preview ───────────────────────────────────────────────────────────

function ReceiptPreview({ template, restaurantName, tagline }: {
    template: BillTemplate;
    restaurantName: string;
    tagline: string;
}) {
    const order = PREVIEW_ORDER;
    const displayTagline = template.header.taglineOverride || tagline;

    const nameSizeClass = {
        sm: styles.previewNameSm,
        md: styles.previewNameMd,
        lg: styles.previewNameLg,
        xl: styles.previewNameXl,
    }[template.header.restaurantNameSize];

    const itemSizeClass = {
        sm: styles.previewItemSm,
        md: styles.previewItemMd,
        lg: styles.previewItemLg,
    }[template.items.fontSize];

    const totalSizeClass = {
        md: styles.previewTotalMd,
        lg: styles.previewTotalLg,
        xl: styles.previewTotalXl,
    }[template.total.fontSize];

    return (
        <div className={styles.receiptWrap}>
            <div className={styles.receipt}>
                {/* Watermark */}
                {template.watermark.enabled && template.watermark.text && (
                    <div className={styles.watermark} aria-hidden="true">
                        {template.watermark.text}
                    </div>
                )}

                {/* Header */}
                {template.header.showLogo && (
                    <div className={styles.previewCenter}>
                        <img
                            src={template.header.logoUrl || '/logo.png'}
                            alt="logo"
                            className={styles.previewLogo}
                        />
                    </div>
                )}
                <div className={`${styles.previewRestaurantName} ${nameSizeClass}`}>
                    {restaurantName}
                </div>
                {template.header.showTagline && (
                    <div className={styles.previewTagline}>{displayTagline}</div>
                )}
                {template.header.showDivider && <div className={styles.previewDivider}>{'─'.repeat(32)}</div>}

                {/* Order Info */}
                <div className={styles.previewMeta}>
                    {template.orderInfo.showToken && (
                        <div className={styles.previewMetaRow}>
                            <span>Token</span><span>#{order.tokenNumber}</span>
                        </div>
                    )}
                    {template.orderInfo.showOrderId && (
                        <div className={styles.previewMetaRow}>
                            <span>Order</span><span>{order.orderId}</span>
                        </div>
                    )}
                    {template.orderInfo.showTable && (
                        <div className={styles.previewMetaRow}>
                            <span>Table</span><span>{order.tableNumber}</span>
                        </div>
                    )}
                    {template.orderInfo.showDateTime && (
                        <div className={styles.previewMetaRow}>
                            <span>Time</span>
                            <span>{new Date(order.timestamp).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</span>
                        </div>
                    )}
                    {template.orderInfo.showCustomerName && (
                        <div className={styles.previewMetaRow}>
                            <span>Name</span><span>{order.customerName}</span>
                        </div>
                    )}
                    {template.orderInfo.showCustomerPhone && (
                        <div className={styles.previewMetaRow}>
                            <span>Phone</span><span>+91 98765 43210</span>
                        </div>
                    )}
                </div>
                <div className={styles.previewDivider}>{'─'.repeat(32)}</div>

                {/* Items */}
                <div className={styles.previewItems}>
                    {order.items.map((item, i) => (
                        <div key={i} className={`${styles.previewItemRow} ${itemSizeClass}`}>
                            <span className={styles.previewItemName}>
                                {item.quantity}x {item.menuItem.name}
                            </span>
                            {template.items.showPrices && (
                                <span className={styles.previewItemPrice}>₹{item.totalPrice}</span>
                            )}
                            {template.items.showAddOns && item.selectedAddOns.length > 0 && (
                                <div className={styles.previewAddOn}>
                                    + {item.selectedAddOns.map(a => a.name).join(', ')}
                                </div>
                            )}
                        </div>
                    ))}
                </div>
                <div className={styles.previewDivider}>{'─'.repeat(32)}</div>

                {/* Total */}
                <div className={`${styles.previewTotal} ${totalSizeClass}`}>
                    <span>TOTAL</span>
                    <span>₹{order.totalAmount}</span>
                </div>
                {template.total.showItemCount && (
                    <div className={styles.previewSubInfo}>
                        {order.items.reduce((s, i) => s + i.quantity, 0)} items
                    </div>
                )}
                {template.total.showPaymentMethod && (
                    <div className={styles.previewPayment}>
                        {order.paymentMethod === 'online' ? '✓ PAID ONLINE' : 'PAY AT COUNTER'}
                    </div>
                )}

                {/* Footer */}
                {(template.footer.customMessage || template.footer.footerNote || template.footer.showQrCode) && (
                    <div className={styles.previewDivider}>{'─'.repeat(32)}</div>
                )}
                {template.footer.customMessage && (
                    <div className={styles.previewThankYou}>{template.footer.customMessage}</div>
                )}
                {template.footer.showQrCode && template.footer.upiId && (
                    <div className={styles.previewQr}>
                        <img
                            src={`https://api.qrserver.com/v1/create-qr-code/?size=100x100&data=${encodeURIComponent(`upi://pay?pa=${template.footer.upiId}`)}`}
                            alt="UPI QR Code"
                            width={80}
                            height={80}
                            style={{ objectFit: 'contain' }}
                        />
                        {template.footer.qrLabel && (
                            <div className={styles.previewQrLabel}>{template.footer.qrLabel}</div>
                        )}
                    </div>
                )}
                {template.footer.footerNote && (
                    <div className={styles.previewFooterNote}>{template.footer.footerNote}</div>
                )}
                {template.footer.contactLine && (
                    <div className={styles.previewFooterNote}>{template.footer.contactLine}</div>
                )}
                {template.footer.trackOrderQr && (
                    <div className={styles.previewQr}>
                        <img
                            src={`https://api.qrserver.com/v1/create-qr-code/?size=100x100&data=${encodeURIComponent(`/track-order?orderId=${order.orderId}`)}`}
                            alt="Track-order QR Code"
                            width={80}
                            height={80}
                            style={{ objectFit: 'contain' }}
                        />
                        <div className={styles.previewQrLabel}>Scan to track your order</div>
                    </div>
                )}

                <div className={styles.previewTear} />
            </div>
        </div>
    );
}

// ── Main Editor ───────────────────────────────────────────────────────────────

// Merges section-by-section, not a flat spread — a template saved before a
// new field (e.g. footer.trackOrderQr) existed would otherwise have that
// whole section replaced wholesale, leaving the new field undefined instead
// of defaulted.
function mergeBillTemplate(saved: Partial<BillTemplate> | undefined | null): BillTemplate {
    return {
        header: { ...DEFAULT_BILL_TEMPLATE.header, ...saved?.header },
        orderInfo: { ...DEFAULT_BILL_TEMPLATE.orderInfo, ...saved?.orderInfo },
        items: { ...DEFAULT_BILL_TEMPLATE.items, ...saved?.items },
        total: { ...DEFAULT_BILL_TEMPLATE.total, ...saved?.total },
        footer: { ...DEFAULT_BILL_TEMPLATE.footer, ...saved?.footer },
        watermark: { ...DEFAULT_BILL_TEMPLATE.watermark, ...saved?.watermark },
    };
}

export default function BillEditorPage() {
    const { restaurantName, tagline, billTemplate: savedTemplate, saveBillTemplate } = useMenu();
    const [template, setTemplate] = useState<BillTemplate>(() => mergeBillTemplate(savedTemplate));
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // React to saved template loading from server (first render has defaults)
    React.useEffect(() => {
        setTemplate(mergeBillTemplate(savedTemplate));
    }, [savedTemplate]);

    const set = useCallback(<K extends keyof BillTemplate>(section: K, updates: Partial<BillTemplate[K]>) => {
        setTemplate(prev => ({
            ...prev,
            [section]: { ...prev[section] as object, ...updates },
        }));
    }, []);

    const handleSave = async () => {
        setSaving(true);
        await saveBillTemplate(template);
        setSaving(false);
        setSaved(true);
        setTimeout(() => setSaved(false), 2500);
    };

    const handleReset = () => {
        if (confirm('Reset to default template? This will undo unsaved changes.')) {
            setTemplate(DEFAULT_BILL_TEMPLATE);
        }
    };

    const handleLogoUpload = async (file: File) => {
        const form = new FormData();
        form.append('file', file);
        try {
            const res = await fetch('/api/upload', { method: 'POST', body: form });
            if (!res.ok) throw new Error('Upload failed');
            const { url } = await res.json();
            set('header', { logoUrl: url });
        } catch {
            alert('Failed to upload logo image.');
        }
    };

    return (
        <div className={styles.container}>
            <header className={styles.header}>
                <div className={styles.headerLeft}>
                    <Link href="/admin" className={styles.backLink}>← Admin</Link>
                    <h1 className={styles.title}>
                        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                            <polyline points="14 2 14 8 20 8" />
                            <line x1="16" y1="13" x2="8" y2="13" />
                            <line x1="16" y1="17" x2="8" y2="17" />
                            <polyline points="10 9 9 9 8 9" />
                        </svg>
                        Bill Editor
                    </h1>
                </div>
                <div className={styles.headerActions}>
                    <button className={styles.resetBtn} onClick={handleReset} type="button">Reset</button>
                    <button
                        className={`${styles.saveBtn} ${saved ? styles.saveBtnSaved : ''}`}
                        onClick={handleSave}
                        disabled={saving}
                        type="button"
                    >
                        {saving ? 'Saving…' : saved ? '✓ Saved' : 'Save Template'}
                    </button>
                </div>
            </header>

            <div className={styles.layout}>
                {/* ── Left: Editor ── */}
                <div className={styles.editor}>

                    <Section title="Header" icon="🏷️">
                        <Row label="Show Logo">
                            <Toggle checked={template.header.showLogo} onChange={v => set('header', { showLogo: v })} />
                        </Row>
                        {template.header.showLogo && (
                            <Row label="Logo Image">
                                <div className={styles.logoUpload}>
                                    <input
                                        type="text"
                                        className={styles.textInput}
                                        placeholder="/logo.png or paste URL"
                                        value={template.header.logoUrl}
                                        onChange={e => set('header', { logoUrl: e.target.value })}
                                    />
                                    <button
                                        className={styles.uploadBtn}
                                        type="button"
                                        onClick={() => fileInputRef.current?.click()}
                                    >Upload</button>
                                    <input
                                        ref={fileInputRef}
                                        type="file"
                                        accept="image/*"
                                        className={styles.hidden}
                                        onChange={e => {
                                            const f = e.target.files?.[0];
                                            if (f) handleLogoUpload(f);
                                        }}
                                    />
                                </div>
                            </Row>
                        )}
                        <Row label="Restaurant Name Size">
                            <SizeSelect
                                value={template.header.restaurantNameSize}
                                onChange={v => set('header', { restaurantNameSize: v as BillTemplate['header']['restaurantNameSize'] })}
                                options={[
                                    { value: 'sm', label: 'S' },
                                    { value: 'md', label: 'M' },
                                    { value: 'lg', label: 'L' },
                                    { value: 'xl', label: 'XL' },
                                ]}
                            />
                        </Row>
                        <Row label="Show Tagline">
                            <Toggle checked={template.header.showTagline} onChange={v => set('header', { showTagline: v })} />
                        </Row>
                        {template.header.showTagline && (
                            <Row label="Tagline Override">
                                <input
                                    className={styles.textInput}
                                    type="text"
                                    placeholder={`Default: "${tagline}"`}
                                    value={template.header.taglineOverride}
                                    onChange={e => set('header', { taglineOverride: e.target.value })}
                                />
                            </Row>
                        )}
                        <Row label="Show Divider Line">
                            <Toggle checked={template.header.showDivider} onChange={v => set('header', { showDivider: v })} />
                        </Row>
                    </Section>

                    <Section title="Order Info" icon="📋">
                        <Row label="Show Token #">
                            <Toggle checked={template.orderInfo.showToken} onChange={v => set('orderInfo', { showToken: v })} />
                        </Row>
                        <Row label="Show Order ID">
                            <Toggle checked={template.orderInfo.showOrderId} onChange={v => set('orderInfo', { showOrderId: v })} />
                        </Row>
                        <Row label="Show Table #">
                            <Toggle checked={template.orderInfo.showTable} onChange={v => set('orderInfo', { showTable: v })} />
                        </Row>
                        <Row label="Show Date/Time">
                            <Toggle checked={template.orderInfo.showDateTime} onChange={v => set('orderInfo', { showDateTime: v })} />
                        </Row>
                        <Row label="Show Customer Name">
                            <Toggle checked={template.orderInfo.showCustomerName} onChange={v => set('orderInfo', { showCustomerName: v })} />
                        </Row>
                        <Row label="Show Customer Phone">
                            <Toggle checked={template.orderInfo.showCustomerPhone} onChange={v => set('orderInfo', { showCustomerPhone: v })} />
                        </Row>
                    </Section>

                    <Section title="Items List" icon="🍽️">
                        <Row label="Font Size">
                            <SizeSelect
                                value={template.items.fontSize}
                                onChange={v => set('items', { fontSize: v as BillTemplate['items']['fontSize'] })}
                                options={[
                                    { value: 'sm', label: 'S' },
                                    { value: 'md', label: 'M' },
                                    { value: 'lg', label: 'L' },
                                ]}
                            />
                        </Row>
                        <Row label="Show Prices">
                            <Toggle checked={template.items.showPrices} onChange={v => set('items', { showPrices: v })} />
                        </Row>
                        <Row label="Show Add-ons">
                            <Toggle checked={template.items.showAddOns} onChange={v => set('items', { showAddOns: v })} />
                        </Row>
                    </Section>

                    <Section title="Total" icon="💰">
                        <Row label="Total Font Size">
                            <SizeSelect
                                value={template.total.fontSize}
                                onChange={v => set('total', { fontSize: v as BillTemplate['total']['fontSize'] })}
                                options={[
                                    { value: 'md', label: 'M' },
                                    { value: 'lg', label: 'L' },
                                    { value: 'xl', label: 'XL' },
                                ]}
                            />
                        </Row>
                        <Row label="Show Item Count">
                            <Toggle checked={template.total.showItemCount} onChange={v => set('total', { showItemCount: v })} />
                        </Row>
                        <Row label="Show Payment Method">
                            <Toggle checked={template.total.showPaymentMethod} onChange={v => set('total', { showPaymentMethod: v })} />
                        </Row>
                    </Section>

                    <Section title="Footer" icon="✉️">
                        <Row label="Thank-you Message">
                            <input
                                className={styles.textInput}
                                type="text"
                                placeholder="Thank you! Visit again!"
                                value={template.footer.customMessage}
                                onChange={e => set('footer', { customMessage: e.target.value })}
                            />
                        </Row>
                        <Row label="Footer Note">
                            <input
                                className={styles.textInput}
                                type="text"
                                placeholder="e.g. FSSAI: 12345678"
                                value={template.footer.footerNote}
                                onChange={e => set('footer', { footerNote: e.target.value })}
                            />
                        </Row>
                        <Row label="Contact Line">
                            <input
                                className={styles.textInput}
                                type="text"
                                placeholder="e.g. 98765 43210 · @rockydaadda"
                                value={template.footer.contactLine}
                                onChange={e => set('footer', { contactLine: e.target.value })}
                            />
                        </Row>
                        <Row label="Show QR Code">
                            <Toggle checked={template.footer.showQrCode} onChange={v => set('footer', { showQrCode: v })} />
                        </Row>
                        {template.footer.showQrCode && (
                            <>
                                <Row label="UPI ID">
                                    <input
                                        className={styles.textInput}
                                        type="text"
                                        placeholder="yourname@okbizaxis"
                                        value={template.footer.upiId}
                                        onChange={e => set('footer', { upiId: e.target.value })}
                                    />
                                </Row>
                                <Row label="QR Label">
                                    <input
                                        className={styles.textInput}
                                        type="text"
                                        placeholder="Scan to pay via UPI"
                                        value={template.footer.qrLabel}
                                        onChange={e => set('footer', { qrLabel: e.target.value })}
                                    />
                                </Row>
                            </>
                        )}
                        <Row label="Track-Order QR">
                            <Toggle checked={template.footer.trackOrderQr} onChange={v => set('footer', { trackOrderQr: v })} />
                        </Row>
                        {template.footer.trackOrderQr && (
                            <p className={styles.sectionNote}>Prints a second QR linking to this order's live status page — separate from the payment QR above.</p>
                        )}
                    </Section>

                    <Section title="Watermark" icon="🌊">
                        <p className={styles.sectionNote}>
                            Prints an extra centered line near the bottom — e.g. a tagline, promo code, or slogan.
                        </p>
                        <Row label="Enable Watermark">
                            <Toggle checked={template.watermark.enabled} onChange={v => set('watermark', { enabled: v })} />
                        </Row>
                        {template.watermark.enabled && (
                            <Row label="Watermark Text">
                                <input
                                    className={styles.textInput}
                                    type="text"
                                    placeholder={restaurantName}
                                    value={template.watermark.text}
                                    onChange={e => set('watermark', { text: e.target.value })}
                                />
                            </Row>
                        )}
                    </Section>
                </div>

                {/* ── Right: Live Preview ── */}
                <div className={styles.previewPanel}>
                    <div className={styles.previewHeader}>
                        <span>Live Preview</span>
                        <span className={styles.previewHint}>58mm thermal paper</span>
                    </div>
                    <ReceiptPreview
                        template={template}
                        restaurantName={restaurantName}
                        tagline={tagline}
                    />
                </div>
            </div>
        </div>
    );
}
