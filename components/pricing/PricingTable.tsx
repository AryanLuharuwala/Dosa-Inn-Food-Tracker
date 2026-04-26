'use client';

import React, { useState, useMemo, useCallback } from 'react';
import { useMenu } from '@/lib/menuContext';
import { MenuItem } from '@/lib/menuData';
import styles from './PricingTable.module.css';

/**
 * Per-item draft state. Tracks two independently dirty things:
 *   - base price (the only price still editable here — modifier prices are managed in the Modifiers tab)
 *   - the set of modifierGroupIds the item subscribes to
 */
type DraftItem = {
    base: number;
    groupIds: string[];
};
type DraftItems = Record<string, DraftItem>;

function parsePosInt(val: string): number | null {
    const n = parseInt(val, 10);
    return !isNaN(n) && n >= 0 ? n : null;
}

function arraysEqUnordered(a: string[], b: string[]): boolean {
    if (a.length !== b.length) return false;
    const sa = new Set(a);
    for (const x of b) if (!sa.has(x)) return false;
    return true;
}

export interface PricingTableProps {
    /** Show the page-level header with title/back link. Off when embedded inside admin tab. */
    showHeader?: boolean;
    /** When provided, an "Edit" pencil button appears on each row. */
    onEdit?: (item: MenuItem) => void;
    /** When provided, a "Delete" button appears on each row. */
    onDelete?: (itemId: string) => void;
    /** When provided, a visibility toggle appears on each row. Pass useMenu().toggleItemAvailability. */
    onToggle?: (itemId: string) => void;
    /** Optional back-link href for the embedded header (defaults to /admin). */
    backHref?: string;
}

export default function PricingTable({
    showHeader = true,
    onEdit,
    onDelete,
    onToggle,
    backHref = '/admin',
}: PricingTableProps) {
    const { menuItems, categories, modifierGroups, updateMenuItem } = useMenu();

    const [selectedCategory, setSelectedCategory] = useState('all');
    const [search, setSearch] = useState('');
    const [draft, setDraft] = useState<DraftItems>({});
    const [expandedAddOns, setExpandedAddOns] = useState<Set<string>>(new Set());
    const [saving, setSaving] = useState(false);
    const [savedIds, setSavedIds] = useState<Set<string>>(new Set());

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

    const getDraft = useCallback((itemId: string): DraftItem => {
        const item = menuItems.find(i => i.id === itemId)!;
        return draft[itemId] ?? {
            base: item.price,
            groupIds: item.modifierGroupIds ?? [],
        };
    }, [draft, menuItems]);

    const setBase = (itemId: string, val: string) => {
        const n = parsePosInt(val);
        if (n === null) return;
        setDraft(prev => ({ ...prev, [itemId]: { ...getDraft(itemId), base: n } }));
    };

    const toggleGroup = (itemId: string, groupId: string) => {
        const d = getDraft(itemId);
        const next = d.groupIds.includes(groupId)
            ? d.groupIds.filter(g => g !== groupId)
            : [...d.groupIds, groupId];
        setDraft(prev => ({ ...prev, [itemId]: { ...d, groupIds: next } }));
    };

    const isDirty = (itemId: string) => {
        if (!draft[itemId]) return false;
        const item = menuItems.find(i => i.id === itemId)!;
        const d = draft[itemId];
        if (d.base !== item.price) return true;
        if (!arraysEqUnordered(d.groupIds, item.modifierGroupIds ?? [])) return true;
        return false;
    };

    const saveSingle = async (itemId: string) => {
        const item = menuItems.find(i => i.id === itemId)!;
        const d = getDraft(itemId);
        const updates: Partial<MenuItem> = {};
        if (d.base !== item.price) updates.price = d.base;
        if (!arraysEqUnordered(d.groupIds, item.modifierGroupIds ?? [])) updates.modifierGroupIds = d.groupIds;
        if (Object.keys(updates).length > 0) {
            await updateMenuItem(itemId, updates);
        }

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
                    ...d,
                    base: Math.round(d.base * multiplier),
                };
            }
            return next;
        });
    };

    const resetAll = () => setDraft({});

    const dirtyCount = filtered.filter(i => isDirty(i.id)).length;

    return (
        <div className={styles.page}>
            {showHeader && (
                <header className={styles.header}>
                    <div className={styles.headerLeft}>
                        <a href={backHref} className={styles.backBtn} aria-label="Back">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                <path d="M19 12H5M12 5l-7 7 7 7" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                        </a>
                        <div>
                            <h1 className={styles.title}>Pricing</h1>
                            <p className={styles.subtitle}>Edit base prices, add-ons &amp; extras</p>
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
            )}

            {/* Floating save bar shown when embedded — header is hidden but user still needs save controls */}
            {!showHeader && dirtyCount > 0 && (
                <div className={styles.embeddedSaveBar}>
                    <span>{dirtyCount} unsaved change{dirtyCount > 1 ? 's' : ''}</span>
                    <button className={styles.resetBtn} onClick={resetAll}>Reset</button>
                    <button className={styles.saveAllBtn} onClick={saveAll} disabled={saving}>
                        {saving ? 'Saving…' : `Save all`}
                    </button>
                </div>
            )}

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
                            const assignedGroups = d.groupIds
                                .map(gid => modifierGroups.find(g => g.id === gid))
                                .filter(Boolean) as typeof modifierGroups;
                            const totalAssignedModifiers = assignedGroups.reduce((sum, g) => sum + g.modifiers.length, 0);
                            const expanded = expandedAddOns.has(item.id);
                            const hasRowActions = !!(onEdit || onDelete || onToggle);

                            return (
                                <React.Fragment key={item.id}>
                                    <tr className={`${styles.row} ${dirty ? styles.rowDirty : ''} ${item.isAvailable === false ? styles.rowDisabled : ''}`}>
                                        <td className={styles.tdName}>
                                            <div className={styles.itemName}>{item.name}</div>
                                            <div className={styles.itemCategory}>
                                                {categories.find(c => c.id === item.categoryId)?.name ?? ''}
                                                {item.isAvailable === false && <span className={styles.hiddenBadge}>hidden</span>}
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
                                            <button
                                                className={styles.expandBtn}
                                                onClick={() => setExpandedAddOns(prev => {
                                                    const next = new Set(prev);
                                                    if (next.has(item.id)) next.delete(item.id);
                                                    else next.add(item.id);
                                                    return next;
                                                })}
                                            >
                                                {assignedGroups.length === 0
                                                    ? 'Assign modifiers'
                                                    : `${assignedGroups.length} group${assignedGroups.length !== 1 ? 's' : ''} · ${totalAssignedModifiers} modifier${totalAssignedModifiers !== 1 ? 's' : ''}`}
                                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ transform: expanded ? 'rotate(180deg)' : undefined, transition: 'transform 0.15s' }}>
                                                    <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
                                                </svg>
                                            </button>
                                        </td>
                                        <td className={styles.tdAction}>
                                            {saved ? (
                                                <span className={styles.savedBadge}>Saved ✓</span>
                                            ) : dirty ? (
                                                <button className={styles.saveBtn} onClick={() => saveSingle(item.id)}>Save</button>
                                            ) : hasRowActions ? (
                                                <div className={styles.rowActions}>
                                                    {onToggle && (
                                                        <button
                                                            className={styles.iconBtn}
                                                            onClick={() => onToggle(item.id)}
                                                            aria-label={item.isAvailable === false ? 'Show item' : 'Hide item'}
                                                            title={item.isAvailable === false ? 'Show item' : 'Hide item'}
                                                        >
                                                            {item.isAvailable === false ? (
                                                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24" /><line x1="1" y1="1" x2="23" y2="23" /></svg>
                                                            ) : (
                                                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>
                                                            )}
                                                        </button>
                                                    )}
                                                    {onEdit && (
                                                        <button className={styles.iconBtn} onClick={() => onEdit(item)} aria-label="Edit item" title="Edit item">
                                                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
                                                        </button>
                                                    )}
                                                    {onDelete && (
                                                        <button className={`${styles.iconBtn} ${styles.iconBtnDanger}`} onClick={() => onDelete(item.id)} aria-label="Delete item" title="Delete item">
                                                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-2 14a2 2 0 01-2 2H9a2 2 0 01-2-2L5 6M10 11v6M14 11v6M9 6V4a2 2 0 012-2h2a2 2 0 012 2v2" /></svg>
                                                        </button>
                                                    )}
                                                </div>
                                            ) : null}
                                        </td>
                                    </tr>

                                    {/* Group assignment + read-only resolved modifiers */}
                                    {expanded && (
                                        <tr className={styles.modifierRow}>
                                            <td colSpan={4} className={styles.modifierCell}>
                                                {modifierGroups.length === 0 ? (
                                                    <p style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', margin: 0 }}>
                                                        No modifier groups defined yet. Create one in the <strong>Modifiers</strong> tab to assign it here.
                                                    </p>
                                                ) : (
                                                    <>
                                                        <div style={{ marginBottom: 8, fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
                                                            Tap a group to assign or unassign it. Modifier prices are managed in the <strong>Modifiers</strong> tab.
                                                        </div>
                                                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
                                                            {modifierGroups.map(g => {
                                                                const assigned = d.groupIds.includes(g.id);
                                                                return (
                                                                    <button
                                                                        key={g.id}
                                                                        type="button"
                                                                        onClick={() => toggleGroup(item.id, g.id)}
                                                                        className={styles.groupChip}
                                                                        data-active={assigned ? 'true' : 'false'}
                                                                        title={`${g.modifiers.length} modifier${g.modifiers.length !== 1 ? 's' : ''}`}
                                                                    >
                                                                        <span>{g.type === 'addOn' ? '➕' : '🍽️'}</span>
                                                                        <span>{g.name}</span>
                                                                        <span style={{ opacity: 0.6, fontSize: '0.75rem' }}>· {g.modifiers.length}</span>
                                                                    </button>
                                                                );
                                                            })}
                                                        </div>
                                                        {assignedGroups.length > 0 && (
                                                            <div className={styles.modifierGrid}>
                                                                {assignedGroups.flatMap(g =>
                                                                    g.modifiers.map(m => (
                                                                        <div key={`${g.id}:${m.id}`} className={styles.modifierItem}>
                                                                            <span className={`${styles.modifierTag} ${g.type === 'extra' ? styles.extraTag : ''}`}>
                                                                                {g.type === 'addOn' ? 'Add-on' : 'Extra'}
                                                                            </span>
                                                                            <span className={styles.modifierName}>{m.name}</span>
                                                                            <span style={{ marginLeft: 'auto', color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>
                                                                                ₹{m.price}
                                                                            </span>
                                                                        </div>
                                                                    ))
                                                                )}
                                                            </div>
                                                        )}
                                                    </>
                                                )}
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
