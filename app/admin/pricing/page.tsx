'use client';

import React, { useState, useMemo, useCallback } from 'react';
import Link from 'next/link';
import { useMenu } from '@/lib/menuContext';
import { AddOn, Extra } from '@/lib/menuData';
import styles from './page.module.css';

type DraftPrices = Record<string, { base: number; addOns: Record<string, number>; extras: Record<string, number> }>;

function parsePosInt(val: string): number | null {
    const n = parseInt(val, 10);
    return !isNaN(n) && n >= 0 ? n : null;
}

export default function PricingPage() {
    const { menuItems, categories, updateMenuItem } = useMenu();

    const [selectedCategory, setSelectedCategory] = useState('all');
    const [search, setSearch] = useState('');
    const [draft, setDraft] = useState<DraftPrices>({});
    const [expandedAddOns, setExpandedAddOns] = useState<Set<string>>(new Set());
    const [saving, setSaving] = useState(false);
    const [savedIds, setSavedIds] = useState<Set<string>>(new Set());

    // Bulk adjust state
    const [bulkPercent, setBulkPercent] = useState('');
    const [bulkDirection, setBulkDirection] = useState<'increase' | 'decrease'>('increase');

    const filtered = useMemo(() => {
        const q = search.toLowerCase();
        return menuItems.filter(item => {
            const matchesCat = selectedCategory === 'all' || item.categoryId === selectedCategory;
            const matchesSearch = !q || item.name.toLowerCase().includes(q);
            return matchesCat && matchesSearch;
        });
    }, [menuItems, selectedCategory, search]);

    const getDraft = useCallback((itemId: string) => {
        const item = menuItems.find(i => i.id === itemId)!;
        return draft[itemId] ?? {
            base: item.price,
            addOns: Object.fromEntries((item.addOns ?? []).map(a => [a.id, a.price])),
            extras: Object.fromEntries((item.extras ?? []).map(e => [e.id, e.price])),
        };
    }, [draft, menuItems]);

    const setBase = (itemId: string, val: string) => {
        const n = parsePosInt(val);
        if (n === null) return;
        setDraft(prev => ({ ...prev, [itemId]: { ...getDraft(itemId), base: n } }));
    };

    const setAddOnPrice = (itemId: string, addOnId: string, val: string) => {
        const n = parsePosInt(val);
        if (n === null) return;
        const d = getDraft(itemId);
        setDraft(prev => ({
            ...prev,
            [itemId]: { ...d, addOns: { ...d.addOns, [addOnId]: n } },
        }));
    };

    const setExtraPrice = (itemId: string, extraId: string, val: string) => {
        const n = parsePosInt(val);
        if (n === null) return;
        const d = getDraft(itemId);
        setDraft(prev => ({
            ...prev,
            [itemId]: { ...d, extras: { ...d.extras, [extraId]: n } },
        }));
    };

    const isDirty = (itemId: string) => {
        if (!draft[itemId]) return false;
        const item = menuItems.find(i => i.id === itemId)!;
        const d = draft[itemId];
        if (d.base !== item.price) return true;
        for (const a of item.addOns ?? []) {
            if (d.addOns[a.id] !== a.price) return true;
        }
        for (const e of item.extras ?? []) {
            if (d.extras[e.id] !== e.price) return true;
        }
        return false;
    };

    const saveSingle = async (itemId: string) => {
        const item = menuItems.find(i => i.id === itemId)!;
        const d = getDraft(itemId);
        const updatedAddOns: AddOn[] = (item.addOns ?? []).map(a => ({ ...a, price: d.addOns[a.id] ?? a.price }));
        const updatedExtras: Extra[] = (item.extras ?? []).map(e => ({ ...e, price: d.extras[e.id] ?? e.price }));

        await updateMenuItem(itemId, { price: d.base, addOns: updatedAddOns, extras: updatedExtras });

        setSavedIds(prev => { const s = new Set(prev); s.add(itemId); return s; });
        setTimeout(() => setSavedIds(prev => { const s = new Set(prev); s.delete(itemId); return s; }), 2000);
        setDraft(prev => { const next = { ...prev }; delete next[itemId]; return next; });
    };

    const saveAll = async () => {
        const dirtyIds = filtered.map(i => i.id).filter(isDirty);
        if (!dirtyIds.length) return;
        setSaving(true);
        await Promise.all(dirtyIds.map(saveSingle));
        setSaving(false);
    };

    const applyBulkAdjust = () => {
        const pct = parseFloat(bulkPercent);
        if (isNaN(pct) || pct <= 0) return;
        const multiplier = bulkDirection === 'increase' ? (1 + pct / 100) : (1 - pct / 100);
        setDraft(prev => {
            const next = { ...prev };
            for (const item of filtered) {
                const d = getDraft(item.id);
                next[item.id] = {
                    base: Math.round(d.base * multiplier),
                    addOns: Object.fromEntries(Object.entries(d.addOns).map(([id, p]) => [id, Math.round(p * multiplier)])),
                    extras: Object.fromEntries(Object.entries(d.extras).map(([id, p]) => [id, Math.round(p * multiplier)])),
                };
            }
            return next;
        });
    };

    const resetAll = () => setDraft({});

    const dirtyCount = filtered.filter(i => isDirty(i.id)).length;

    return (
        <div className={styles.page}>
            {/* Header */}
            <header className={styles.header}>
                <div className={styles.headerLeft}>
                    <Link href="/admin" className={styles.backBtn}>
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                            <path d="M19 12H5M12 5l-7 7 7 7" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                    </Link>
                    <div>
                        <h1 className={styles.title}>Pricing</h1>
                        <p className={styles.subtitle}>Edit base prices, add-ons & extras</p>
                    </div>
                </div>
                <div className={styles.headerActions}>
                    {dirtyCount > 0 && (
                        <>
                            <button className={styles.resetBtn} onClick={resetAll}>Reset</button>
                            <button className={styles.saveAllBtn} onClick={saveAll} disabled={saving}>
                                {saving ? 'Saving…' : `Save ${dirtyCount} change${dirtyCount > 1 ? 's' : ''}`}
                            </button>
                        </>
                    )}
                </div>
            </header>

            {/* Controls */}
            <div className={styles.controls}>
                <input
                    className={styles.searchInput}
                    placeholder="Search items…"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                />
                <select
                    className={styles.categorySelect}
                    value={selectedCategory}
                    onChange={e => setSelectedCategory(e.target.value)}
                >
                    <option value="all">All Categories</option>
                    {categories.map(cat => (
                        <option key={cat.id} value={cat.id}>{cat.name}</option>
                    ))}
                </select>
            </div>

            {/* Bulk Adjust */}
            <div className={styles.bulkBar}>
                <span className={styles.bulkLabel}>Bulk adjust visible items:</span>
                <select
                    className={styles.bulkSelect}
                    value={bulkDirection}
                    onChange={e => setBulkDirection(e.target.value as 'increase' | 'decrease')}
                >
                    <option value="increase">Increase</option>
                    <option value="decrease">Decrease</option>
                </select>
                <input
                    className={styles.bulkInput}
                    type="number"
                    min="1"
                    max="100"
                    placeholder="%"
                    value={bulkPercent}
                    onChange={e => setBulkPercent(e.target.value)}
                />
                <span className={styles.bulkLabel}>%</span>
                <button className={styles.bulkApplyBtn} onClick={applyBulkAdjust}>Apply</button>
            </div>

            {/* Table */}
            <div className={styles.tableWrap}>
                <table className={styles.table}>
                    <thead>
                        <tr>
                            <th className={styles.thName}>Item</th>
                            <th className={styles.thPrice}>Base Price (₹)</th>
                            <th className={styles.thAddOns}>Add-ons / Extras</th>
                            <th className={styles.thAction}></th>
                        </tr>
                    </thead>
                    <tbody>
                        {filtered.map(item => {
                            const d = getDraft(item.id);
                            const dirty = isDirty(item.id);
                            const saved = savedIds.has(item.id);
                            const hasAddOnExtras = (item.addOns?.length ?? 0) + (item.extras?.length ?? 0) > 0;
                            const expanded = expandedAddOns.has(item.id);

                            return (
                                <React.Fragment key={item.id}>
                                    <tr className={`${styles.row} ${dirty ? styles.rowDirty : ''}`}>
                                        <td className={styles.tdName}>
                                            <div className={styles.itemName}>{item.name}</div>
                                            <div className={styles.itemCategory}>
                                                {categories.find(c => c.id === item.categoryId)?.name ?? ''}
                                            </div>
                                        </td>
                                        <td className={styles.tdPrice}>
                                            <div className={styles.priceWrap}>
                                                <span className={styles.rupee}>₹</span>
                                                <input
                                                    className={styles.priceInput}
                                                    type="number"
                                                    min="0"
                                                    value={d.base}
                                                    onChange={e => setBase(item.id, e.target.value)}
                                                />
                                            </div>
                                            {dirty && item.price !== d.base && (
                                                <span className={styles.oldPrice}>was ₹{item.price}</span>
                                            )}
                                        </td>
                                        <td className={styles.tdAddOns}>
                                            {hasAddOnExtras ? (
                                                <button
                                                    className={styles.expandBtn}
                                                    onClick={() => setExpandedAddOns(prev => {
                                                        const next = new Set(prev);
                                                        next.has(item.id) ? next.delete(item.id) : next.add(item.id);
                                                        return next;
                                                    })}
                                                >
                                                    {(item.addOns?.length ?? 0) + (item.extras?.length ?? 0)} modifier{((item.addOns?.length ?? 0) + (item.extras?.length ?? 0)) !== 1 ? 's' : ''}
                                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ transform: expanded ? 'rotate(180deg)' : undefined, transition: 'transform 0.15s' }}>
                                                        <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
                                                    </svg>
                                                </button>
                                            ) : (
                                                <span className={styles.noModifiers}>—</span>
                                            )}
                                        </td>
                                        <td className={styles.tdAction}>
                                            {saved ? (
                                                <span className={styles.savedBadge}>Saved ✓</span>
                                            ) : dirty ? (
                                                <button className={styles.saveBtn} onClick={() => saveSingle(item.id)}>Save</button>
                                            ) : null}
                                        </td>
                                    </tr>

                                    {/* Add-ons & extras inline row */}
                                    {expanded && hasAddOnExtras && (
                                        <tr className={styles.modifierRow}>
                                            <td colSpan={4} className={styles.modifierCell}>
                                                <div className={styles.modifierGrid}>
                                                    {(item.addOns ?? []).map(addOn => (
                                                        <div key={addOn.id} className={styles.modifierItem}>
                                                            <span className={styles.modifierTag}>Add-on</span>
                                                            <span className={styles.modifierName}>{addOn.name}</span>
                                                            <div className={styles.priceWrap}>
                                                                <span className={styles.rupee}>₹</span>
                                                                <input
                                                                    className={styles.priceInputSm}
                                                                    type="number"
                                                                    min="0"
                                                                    value={d.addOns[addOn.id] ?? addOn.price}
                                                                    onChange={e => setAddOnPrice(item.id, addOn.id, e.target.value)}
                                                                />
                                                            </div>
                                                        </div>
                                                    ))}
                                                    {(item.extras ?? []).map(extra => (
                                                        <div key={extra.id} className={styles.modifierItem}>
                                                            <span className={`${styles.modifierTag} ${styles.extraTag}`}>Extra</span>
                                                            <span className={styles.modifierName}>{extra.name}</span>
                                                            <div className={styles.priceWrap}>
                                                                <span className={styles.rupee}>₹</span>
                                                                <input
                                                                    className={styles.priceInputSm}
                                                                    type="number"
                                                                    min="0"
                                                                    value={d.extras[extra.id] ?? extra.price}
                                                                    onChange={e => setExtraPrice(item.id, extra.id, e.target.value)}
                                                                />
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            </td>
                                        </tr>
                                    )}
                                </React.Fragment>
                            );
                        })}

                        {filtered.length === 0 && (
                            <tr>
                                <td colSpan={4} className={styles.empty}>No items match your filter.</td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
