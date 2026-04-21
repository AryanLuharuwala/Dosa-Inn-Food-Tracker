'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { useMenu } from '@/lib/menuContext';
import KitchenAnnouncer from '@/components/KitchenAnnouncer';
import VoiceAssistant from '@/components/VoiceAssistant';
import styles from './page.module.css';

// ============ Types ============

interface Chef {
    id: string;
    name: string;
    is_active: boolean;
    color: string;
}

interface ChefCategory {
    chef_id: string;
    category_id: string;
}

interface CategoryInfo {
    id: string;
    name: string;
    icon: string;
}

interface OrderItem {
    menuItem: { id: string; name: string; price: number };
    quantity: number;
    selectedAddOns: Array<{ id: string; name: string; price: number }>;
    totalPrice: number;
}

interface KitchenOrder {
    order_id: string;
    order_type: string;
    table_number: string | null;
    token_number: number;
    items: OrderItem[];
    status: 'pending' | 'preparing' | 'ready' | 'delivered';
    created_at: string;
}

// Items grouped per chef for display
interface ChefOrderGroup {
    orderId: string;
    orderType: string;
    tableNumber: string | null;
    tokenNumber: number;
    createdAt: string;
    items: Array<OrderItem & { itemIndex: number }>;
}

// ============ Chef Form Modal ============

function ChefModal({
    chef,
    onSave,
    onClose
}: {
    chef: Chef | null;
    onSave: (name: string, color: string) => void;
    onClose: () => void;
}) {
    const [name, setName] = useState(chef?.name || '');
    const [color, setColor] = useState(chef?.color || '#4CAF50');

    const colors = [
        '#4CAF50', '#2196F3', '#FF9800', '#E91E63',
        '#9C27B0', '#00BCD4', '#FF5722', '#607D8B',
        '#795548', '#3F51B5'
    ];

    return (
        <div className={styles.modalOverlay} onClick={onClose}>
            <div className={styles.modal} onClick={e => e.stopPropagation()}>
                <div className={styles.modalHeader}>
                    <h2>{chef ? 'Edit Chef' : 'Add New Chef'}</h2>
                    <button className={styles.closeBtn} onClick={onClose}>✕</button>
                </div>
                <div className={styles.modalBody}>
                    <div className={styles.formGroup}>
                        <label>Chef Name *</label>
                        <input
                            type="text"
                            value={name}
                            onChange={e => setName(e.target.value)}
                            placeholder="e.g. Ram, Rocky"
                            className={styles.input}
                            autoFocus
                        />
                    </div>
                    <div className={styles.formGroup}>
                        <label>Color</label>
                        <div className={styles.colorPicker}>
                            {colors.map(c => (
                                <button
                                    key={c}
                                    className={`${styles.colorDot} ${color === c ? styles.colorDotActive : ''}`}
                                    style={{ backgroundColor: c }}
                                    onClick={() => setColor(c)}
                                    type="button"
                                />
                            ))}
                        </div>
                    </div>
                </div>
                <div className={styles.modalFooter}>
                    <button className={styles.cancelBtn} onClick={onClose}>Cancel</button>
                    <button
                        className={styles.saveBtn}
                        onClick={() => name.trim() && onSave(name.trim(), color)}
                        disabled={!name.trim()}
                    >
                        {chef ? 'Update Chef' : 'Add Chef'}
                    </button>
                </div>
            </div>
        </div>
    );
}

// ============ Category Assignment Modal ============

function AssignModal({
    chef,
    allCategories,
    assignedCategoryIds,
    allAssignments,
    onSave,
    onClose
}: {
    chef: Chef;
    allCategories: CategoryInfo[];
    assignedCategoryIds: string[];
    allAssignments: ChefCategory[];
    onSave: (categoryIds: string[]) => void;
    onClose: () => void;
}) {
    const [selected, setSelected] = useState<string[]>(assignedCategoryIds);

    const toggle = (catId: string) => {
        setSelected(prev =>
            prev.includes(catId)
                ? prev.filter(id => id !== catId)
                : [...prev, catId]
        );
    };

    // Find which chef currently owns each category (for showing conflicts)
    const categoryOwners = useMemo(() => {
        const map: Record<string, string> = {};
        allAssignments.forEach(a => {
            if (a.chef_id !== chef.id) {
                map[a.category_id] = a.chef_id;
            }
        });
        return map;
    }, [allAssignments, chef.id]);

    return (
        <div className={styles.modalOverlay} onClick={onClose}>
            <div className={styles.modal} onClick={e => e.stopPropagation()}>
                <div className={styles.modalHeader}>
                    <h2>Assign Categories to {chef.name}</h2>
                    <button className={styles.closeBtn} onClick={onClose}>✕</button>
                </div>
                <div className={styles.modalBody}>
                    <p className={styles.assignHint}>
                        Select which food categories this chef handles. Each category can only be assigned to one chef.
                    </p>
                    <div className={styles.categoryList}>
                        {allCategories.map(cat => {
                            const ownedByOther = categoryOwners[cat.id];
                            const isSelected = selected.includes(cat.id);
                            return (
                                <button
                                    key={cat.id}
                                    className={`${styles.categoryChip} ${isSelected ? styles.categoryChipActive : ''} ${ownedByOther ? styles.categoryChipTaken : ''}`}
                                    onClick={() => toggle(cat.id)}
                                    type="button"
                                >
                                    <span className={styles.categoryIcon}>{cat.icon}</span>
                                    <span>{cat.name}</span>
                                    {ownedByOther && !isSelected && (
                                        <span className={styles.takenLabel}>(assigned)</span>
                                    )}
                                </button>
                            );
                        })}
                    </div>
                </div>
                <div className={styles.modalFooter}>
                    <button className={styles.cancelBtn} onClick={onClose}>Cancel</button>
                    <button className={styles.saveBtn} onClick={() => onSave(selected)}>
                        Save Assignments
                    </button>
                </div>
            </div>
        </div>
    );
}

// ============ Main Kitchen Page ============

export default function KitchenPage() {
    // Use global menu context for orders to ensure sync with Admin
    const { orders: allOrders } = useMenu();

    // Local state only for kitchen-specific UI
    const [chefs, setChefs] = useState<Chef[]>([]);
    const [categories, setCategories] = useState<CategoryInfo[]>([]);
    const [assignments, setAssignments] = useState<ChefCategory[]>([]);
    const [menuItemCategories, setMenuItemCategories] = useState<Record<string, string>>({});

    // UI state
    const [showChefModal, setShowChefModal] = useState(false);
    const [editingChef, setEditingChef] = useState<Chef | null>(null);
    const [assigningChef, setAssigningChef] = useState<Chef | null>(null);
    const [showSettings, setShowSettings] = useState(false);
    const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

    // Filter orders for display (Pending & Preparing only)
    const orders = useMemo(() => {
        return allOrders
            .filter(o => o.status === 'pending' || o.status === 'preparing')
            .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
            .map(o => ({
                order_id: o.orderId,
                order_type: o.orderType,
                table_number: o.tableNumber,
                token_number: o.tokenNumber,
                items: o.items as OrderItem[],
                status: o.status,
                created_at: o.timestamp
            }));
    }, [allOrders]);

    // ===== Data Loading (Kitchen specific settings) =====

    const loadData = useCallback(async () => {
        const [chefsData, catsData, assignData, menuData] = await Promise.all([
            fetch('/api/db?resource=chefs').then(r => r.json()).catch(() => []),
            fetch('/api/db?resource=categories').then(r => r.json()).catch(() => []),
            fetch('/api/db?resource=chef_categories').then(r => r.json()).catch(() => []),
            fetch('/api/db?resource=menu_items').then(r => r.json()).catch(() => []),
        ]);

        if (chefsData?.length) setChefs(chefsData);
        if (catsData?.length) setCategories(catsData);
        if (assignData) setAssignments(assignData);
        if (menuData?.length) {
            const map: Record<string, string> = {};
            menuData.forEach((item: { id: string; categoryId: string }) => {
                map[item.id] = item.categoryId;
            });
            setMenuItemCategories(map);
        }
    }, []);

    useEffect(() => {
        loadData();
        const interval = setInterval(loadData, 3000);
        return () => clearInterval(interval);
    }, [loadData]);

    // ===== Computed: Orders grouped by chef =====

    const chefOrders = useMemo(() => {
        // Build category→chef map
        const catToChef: Record<string, string> = {};
        assignments.forEach(a => { catToChef[a.category_id] = a.chef_id; });

        // Group order items by chef
        const grouped: Record<string, ChefOrderGroup[]> = {};
        chefs.forEach(c => { grouped[c.id] = []; });

        orders.forEach(order => {
            // Bucket items by chef
            const chefItems: Record<string, Array<OrderItem & { itemIndex: number }>> = {};

            order.items.forEach((item, idx) => {
                const categoryId = menuItemCategories[item.menuItem.id];
                const chefId = categoryId ? catToChef[categoryId] : undefined;
                if (chefId) {
                    if (!chefItems[chefId]) chefItems[chefId] = [];
                    chefItems[chefId].push({ ...item, itemIndex: idx });
                }
            });

            // Create order groups per chef
            Object.entries(chefItems).forEach(([chefId, items]) => {
                if (!grouped[chefId]) grouped[chefId] = [];
                grouped[chefId].push({
                    orderId: order.order_id,
                    orderType: order.order_type,
                    tableNumber: order.table_number,
                    tokenNumber: order.token_number || 0,
                    createdAt: order.created_at,
                    items
                });
            });
        });

        return grouped;
    }, [orders, assignments, chefs, menuItemCategories]);

    // ===== Chef CRUD =====

    const handleSaveChef = async (name: string, color: string) => {
        const chef = editingChef
            ? { ...editingChef, name, color }
            : { id: `chef-${Date.now()}`, name, color, is_active: true };

        await fetch('/api/db', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'chef_upsert', chef }),
        });
        setShowChefModal(false);
        setEditingChef(null);
        loadData();
    };

    const handleDeleteChef = async (chefId: string) => {
        await fetch('/api/db', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'chef_delete', id: chefId }),
        });
        setDeleteConfirm(null);
        loadData();
    };

    // ===== Category Assignment =====

    const handleSaveAssignments = async (categoryIds: string[]) => {
        if (!assigningChef) return;
        await fetch('/api/db', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'chef_categories_set', chef_id: assigningChef.id, category_ids: categoryIds }),
        });
        setAssigningChef(null);
        loadData();
    };

    // ===== Item Tick-off =====

    const handleTickItem = async (orderId: string, itemIndex: number) => {
        const order = orders.find(o => o.order_id === orderId);
        if (!order) return;

        const updatedItems = [...order.items];
        (updatedItems[itemIndex] as OrderItem & { ready?: boolean }).ready = true;
        const allReady = updatedItems.every((i) => (i as OrderItem & { ready?: boolean }).ready === true);

        await fetch('/api/db', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                action: 'order_status',
                orderId,
                status: allReady ? 'delivered' : 'preparing',
                items: updatedItems,
            }),
        });
        loadData();
    };

    // ===== Time helper =====

    const getTimeAgo = (timestamp: string) => {
        const diff = Date.now() - new Date(timestamp).getTime();
        const mins = Math.floor(diff / 60000);
        if (mins < 1) return 'just now';
        if (mins < 60) return `${mins}m ago`;
        return `${Math.floor(mins / 60)}h ${mins % 60}m ago`;
    };

    // Count total pending items per chef
    const chefPendingCounts = useMemo(() => {
        const counts: Record<string, number> = {};
        chefs.forEach(c => {
            const orderGroups = chefOrders[c.id] || [];
            counts[c.id] = orderGroups.reduce((sum, og) =>
                sum + og.items.filter(i => !(i as OrderItem & { ready?: boolean }).ready).length
                , 0);
        });
        return counts;
    }, [chefs, chefOrders]);

    // Unassigned categories warning
    const unassignedCategories = useMemo(() => {
        const assignedCatIds = new Set(assignments.map(a => a.category_id));
        return categories.filter(c => !assignedCatIds.has(c.id));
    }, [categories, assignments]);

    return (
        <div className={styles.container}>
            {/* Header */}
            <header className={styles.header}>
                <div className={styles.headerLeft}>
                    <Link href="/admin" className={styles.backLink}>← Admin</Link>
                    <h1 className={styles.title}>🍳 Kitchen Dashboard</h1>
                </div>
                <div className={styles.headerRight}>
                    <span className={styles.orderCount}>
                        {orders.length} active order{orders.length !== 1 ? 's' : ''}
                    </span>
                    <Link href="/cook" className={styles.settingsBtn} style={{ textDecoration: 'none', background: '#111827', color: '#f59e0b', border: '1.5px solid #f59e0b' }}>
                        🔥 Cook View
                    </Link>
                    <button
                        className={styles.settingsBtn}
                        onClick={() => setShowSettings(!showSettings)}
                    >
                        ⚙️ Manage Chefs
                    </button>
                </div>
            </header>

            {/* Unassigned categories warning */}
            {unassignedCategories.length > 0 && (
                <div className={styles.warningBanner}>
                    ⚠️ <strong>{unassignedCategories.length} categories</strong> not assigned to any chef:{' '}
                    {unassignedCategories.map(c => `${c.icon} ${c.name}`).join(', ')}
                    <button className={styles.fixBtn} onClick={() => setShowSettings(true)}>
                        Assign Now →
                    </button>
                </div>
            )}

            {/* Chef Management Panel */}
            {showSettings && (
                <div className={styles.settingsPanel}>
                    <div className={styles.settingsHeader}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                            <button
                                className={styles.backLink}
                                onClick={() => setShowSettings(false)}
                                style={{ cursor: 'pointer' }}
                            >← Back</button>
                            <h2>👨‍🍳 Chef Management</h2>
                        </div>
                        <button
                            className={styles.addChefBtn}
                            onClick={() => { setEditingChef(null); setShowChefModal(true); }}
                        >
                            + Add Chef
                        </button>
                    </div>

                    {chefs.length === 0 ? (
                        <p className={styles.emptyText}>No chefs added yet. Add your first chef to start!</p>
                    ) : (
                        <div className={styles.chefList}>
                            {chefs.map(chef => {
                                const assignedCats = assignments
                                    .filter(a => a.chef_id === chef.id)
                                    .map(a => categories.find(c => c.id === a.category_id))
                                    .filter(Boolean) as CategoryInfo[];

                                return (
                                    <div key={chef.id} className={styles.chefCard}>
                                        <div className={styles.chefBadge} style={{ backgroundColor: chef.color }}>
                                            {chef.name.charAt(0).toUpperCase()}
                                        </div>
                                        <div className={styles.chefInfo}>
                                            <strong>{chef.name}</strong>
                                            <div className={styles.assignedCats}>
                                                {assignedCats.length > 0
                                                    ? assignedCats.map(c => `${c.icon} ${c.name}`).join(', ')
                                                    : '— No categories assigned —'
                                                }
                                            </div>
                                        </div>
                                        <div className={styles.chefActions}>
                                            <button
                                                className={styles.actionBtn}
                                                onClick={() => setAssigningChef(chef)}
                                                title="Assign categories"
                                            >
                                                📋
                                            </button>
                                            <button
                                                className={styles.actionBtn}
                                                onClick={() => { setEditingChef(chef); setShowChefModal(true); }}
                                                title="Edit chef"
                                            >
                                                ✏️
                                            </button>
                                            <button
                                                className={`${styles.actionBtn} ${styles.deleteBtn}`}
                                                onClick={() => setDeleteConfirm(chef.id)}
                                                title="Delete chef"
                                            >
                                                🗑️
                                            </button>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            )}

            {/* Chef Order Columns */}
            {chefs.length === 0 ? (
                <div className={styles.emptyState}>
                    <div className={styles.emptyIcon}>👨‍🍳</div>
                    <h2>No Chefs Set Up</h2>
                    <p>Add your kitchen chefs and assign food categories to them.</p>
                    <button
                        className={styles.addChefBtn}
                        onClick={() => { setShowSettings(true); setShowChefModal(true); }}
                    >
                        + Add First Chef
                    </button>
                </div>
            ) : (
                <div className={styles.chefColumns}>
                    {chefs.filter(c => c.is_active).map(chef => {
                        const orderGroups = chefOrders[chef.id] || [];
                        const pendingCount = chefPendingCounts[chef.id] || 0;

                        return (
                            <div key={chef.id} className={styles.chefColumn}>
                                <div className={styles.columnHeader} style={{ borderColor: chef.color }}>
                                    <div className={styles.columnBadge} style={{ backgroundColor: chef.color }}>
                                        {chef.name.charAt(0).toUpperCase()}
                                    </div>
                                    <div>
                                        <h3 className={styles.columnTitle}>{chef.name}</h3>
                                        <span className={styles.columnCount}>
                                            {pendingCount} item{pendingCount !== 1 ? 's' : ''} pending
                                        </span>
                                    </div>
                                </div>

                                <div className={styles.orderList}>
                                    {orderGroups.length === 0 ? (
                                        <div className={styles.noOrders}>
                                            <span>✅</span>
                                            <p>All clear!</p>
                                        </div>
                                    ) : (
                                        orderGroups.map(group => (
                                            <div key={group.orderId} className={styles.orderCard}>
                                                <div className={styles.orderHeader}>
                                                    <span className={styles.orderId}>
                                                        Token #{group.tokenNumber}
                                                    </span>
                                                    <span className={styles.orderMeta}>
                                                        {group.orderType === 'dine-in' && group.tableNumber
                                                            ? `Token No ${group.tableNumber}`
                                                            : `Parcel #${group.orderId.slice(-4).toUpperCase()}`}
                                                    </span>
                                                    <span className={styles.orderTime}>
                                                        {getTimeAgo(group.createdAt)}
                                                    </span>
                                                </div>
                                                <div className={styles.orderItems}>
                                                    {group.items.map((item, i) => {
                                                        const isReady = (item as OrderItem & { ready?: boolean }).ready;
                                                        return (
                                                            <button
                                                                key={i}
                                                                className={`${styles.itemRow} ${isReady ? styles.itemReady : ''}`}
                                                                onClick={() => !isReady && handleTickItem(group.orderId, item.itemIndex)}
                                                                disabled={isReady}
                                                            >
                                                                <span className={styles.itemCheck}>
                                                                    {isReady ? '✅' : '☐'}
                                                                </span>
                                                                <span className={styles.itemQty}>{item.quantity}×</span>
                                                                <span className={styles.itemName}>
                                                                    {item.menuItem.name}
                                                                </span>
                                                                {item.selectedAddOns.length > 0 && (
                                                                    <span className={styles.itemAddons}>
                                                                        + {item.selectedAddOns.map(a => a.name).join(', ')}
                                                                    </span>
                                                                )}
                                                            </button>
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                        ))
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Chef Add/Edit Modal */}
            {showChefModal && (
                <ChefModal
                    chef={editingChef}
                    onSave={handleSaveChef}
                    onClose={() => { setShowChefModal(false); setEditingChef(null); }}
                />
            )}

            {/* Category Assignment Modal */}
            {assigningChef && (
                <AssignModal
                    chef={assigningChef}
                    allCategories={categories}
                    assignedCategoryIds={assignments.filter(a => a.chef_id === assigningChef.id).map(a => a.category_id)}
                    allAssignments={assignments}
                    onSave={handleSaveAssignments}
                    onClose={() => setAssigningChef(null)}
                />
            )}

            {/* Delete Confirmation */}
            {deleteConfirm && (
                <div className={styles.modalOverlay} onClick={() => setDeleteConfirm(null)}>
                    <div className={styles.deleteDialog} onClick={e => e.stopPropagation()}>
                        <h3>Delete Chef?</h3>
                        <p>This will remove the chef and all their category assignments.</p>
                        <div className={styles.deleteActions}>
                            <button className={styles.cancelBtn} onClick={() => setDeleteConfirm(null)}>Cancel</button>
                            <button className={styles.deleteBtnConfirm} onClick={() => handleDeleteChef(deleteConfirm)}>Delete</button>
                        </div>
                    </div>
                </div>
            )}
            <KitchenAnnouncer />
        </div>
    );
}
