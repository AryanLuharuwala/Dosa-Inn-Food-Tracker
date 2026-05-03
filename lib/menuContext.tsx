'use client';

import React, { createContext, useContext, useState, useCallback, useEffect, ReactNode } from 'react';
import { menuItems as initialMenuItems, MenuItem, categories as initialCategories, Category } from './menuData';
import { OrderType, PreorderDetails } from './cartContext';

export interface Order {
    orderId: string;
    orderType: OrderType;
    tableNumber: string | null;
    preorderDetails: PreorderDetails | null;
    tokenNumber: number;
    items: Array<{
        menuItem: { id: string; name: string; price: number };
        quantity: number;
        selectedAddOns: Array<{ id: string; name: string; price: number }>;
        totalPrice: number;
    }>;
    extras: Array<{
        extra: { id: string; name: string; price: number };
        quantity: number;
    }>;
    totalAmount: number;
    timestamp: string;
    status: 'pending' | 'preparing' | 'ready' | 'delivered';
    tokenId?: string;
    phonePeOrderId?: string;
    customerPhone?: string;
    customerName?: string;
}

export interface Modifier {
    id: string;
    name: string;
    price: number;
}

export interface ModifierGroup {
    id: string;
    name: string;
    type: 'addOn' | 'extra';
    modifiers: Modifier[];
}

interface MenuContextType {
    menuItems: MenuItem[];
    categories: Category[];
    modifierGroups: ModifierGroup[];
    orders: Order[];
    rushHourMode: boolean;
    rushHourItems: string[];
    restaurantName: string;
    tagline: string;
    paymentsEnabled: boolean;
    kotCopies: number;
    billCopies: number;
    autoPrintOrders: boolean;
    toggleItemAvailability: (itemId: string) => void;
    updateItemPrice: (itemId: string, newPrice: number) => void;
    addMenuItem: (item: MenuItem) => void;
    updateMenuItem: (itemId: string, updates: Partial<MenuItem>) => void;
    deleteMenuItem: (itemId: string) => void;
    addCategory: (cat: Category) => void;
    updateCategory: (catId: string, updates: Partial<Category>) => void;
    deleteCategory: (catId: string) => void;
    upsertModifierGroup: (group: ModifierGroup) => Promise<void>;
    deleteModifierGroup: (id: string) => Promise<void>;
    setRushHourMode: (mode: boolean) => void;
    toggleRushHourItem: (itemId: string) => void;
    setRushHourItems: (itemIds: string[]) => void;
    addOrder: (order: Omit<Order, 'status'>) => void;
    updateOrderStatus: (orderId: string, status: Order['status'], items?: Order['items']) => void;
    getAvailableItems: () => MenuItem[];
    refreshMenuState: () => void;
    updateBranding: (name: string, tagline: string) => Promise<void>;
    setPaymentsEnabled: (enabled: boolean) => Promise<void>;
    setPrintCopies: (kot: number, bill: number) => Promise<void>;
    setAutoPrintOrders: (enabled: boolean) => Promise<void>;
}

const MenuContext = createContext<MenuContextType | undefined>(undefined);

async function dbGet<T>(resource: string, params: Record<string, string> = {}): Promise<T | null> {
    try {
        const q = new URLSearchParams({ resource, ...params }).toString();
        const res = await fetch(`/api/db?${q}`);
        if (!res.ok) return null;
        return res.json();
    } catch { return null; }
}

async function dbPost(action: string, payload: Record<string, unknown> = {}) {
    try {
        await fetch('/api/db', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action, ...payload }),
        });
    } catch (e) { console.error('db post error', e); }
}

export function MenuProvider({ children }: { children: ReactNode }) {
    const [menuItems, setMenuItems] = useState<MenuItem[]>(initialMenuItems);
    const [categories, setCategories] = useState<Category[]>(initialCategories);
    const [modifierGroups, setModifierGroups] = useState<ModifierGroup[]>([]);
    const [orders, setOrders] = useState<Order[]>([]);
    const [rushHourMode, setRushHourModeState] = useState(false);
    const [rushHourItems, setRushHourItemsState] = useState<string[]>([]);
    const [restaurantName, setRestaurantName] = useState('Rocky Da Adda');
    const [tagline, setTagline] = useState('100% Pure Veg');
    // Default false — server returns the persisted value on first settings load.
    const [paymentsEnabled, setPaymentsEnabledState] = useState(false);
    const [kotCopies, setKotCopiesState] = useState(1);
    const [billCopies, setBillCopiesState] = useState(1);
    const [autoPrintOrders, setAutoPrintOrdersState] = useState(false);

    const loadResource = useCallback(async (resource: string) => {
        switch (resource) {
            case 'menu_items': {
                const items = await dbGet<MenuItem[]>('menu_items');
                if (items && items.length > 0) setMenuItems(items);
                break;
            }
            case 'categories': {
                const cats = await dbGet<Category[]>('categories');
                if (cats && cats.length > 0) setCategories(cats);
                break;
            }
            case 'modifier_groups': {
                const groups = await dbGet<ModifierGroup[]>('modifier_groups');
                if (groups) setModifierGroups(groups);
                break;
            }
            case 'orders': {
                const ords = await dbGet<Order[]>('orders');
                if (ords) setOrders(ords);
                break;
            }
            case 'settings': {
                const settings = await dbGet<{
                    rushHourMode: boolean;
                    rushHourItems: string[];
                    restaurantName?: string;
                    tagline?: string;
                    paymentsEnabled?: boolean;
                    kotCopies?: number;
                    billCopies?: number;
                    autoPrintOrders?: boolean;
                }>('settings');
                if (settings) {
                    setRushHourModeState(settings.rushHourMode);
                    setRushHourItemsState(settings.rushHourItems);
                    if (settings.restaurantName) setRestaurantName(settings.restaurantName);
                    if (settings.tagline !== undefined) setTagline(settings.tagline);
                    if (settings.paymentsEnabled !== undefined) setPaymentsEnabledState(settings.paymentsEnabled);
                    if (typeof settings.kotCopies === 'number') setKotCopiesState(settings.kotCopies);
                    if (typeof settings.billCopies === 'number') setBillCopiesState(settings.billCopies);
                    if (typeof settings.autoPrintOrders === 'boolean') setAutoPrintOrdersState(settings.autoPrintOrders);
                }
                break;
            }
        }
    }, []);

    const loadAll = useCallback(async () => {
        await Promise.all([
            loadResource('menu_items'),
            loadResource('categories'),
            loadResource('modifier_groups'),
            loadResource('orders'),
            loadResource('settings'),
        ]);
    }, [loadResource]);

    useEffect(() => {
        loadAll();

        // SSE-driven refresh — fetches only the changed resource
        let es: EventSource;
        let retryTimeout: ReturnType<typeof setTimeout>;

        const connect = () => {
            es = new EventSource('/api/events?channel=menu');
            es.addEventListener('change', (e: MessageEvent) => {
                try {
                    const { resource } = JSON.parse(e.data) as { resource: string };
                    loadResource(resource);
                } catch {
                    loadAll(); // fallback if payload is malformed
                }
            });
            es.addEventListener('error', () => {
                es.close();
                retryTimeout = setTimeout(connect, 3000);
            });
        };
        connect();

        return () => {
            es?.close();
            clearTimeout(retryTimeout);
        };
    }, [loadAll]);

    // ── Menu item operations ───────────────────────────────────────────────

    const toggleItemAvailability = useCallback(async (itemId: string) => {
        const item = menuItems.find(i => i.id === itemId);
        if (!item) return;
        const newAvail = !item.isAvailable;
        setMenuItems(prev => prev.map(i => i.id === itemId ? { ...i, isAvailable: newAvail } : i));
        await dbPost('menu_update_item', { id: itemId, updates: { isAvailable: newAvail } });
    }, [menuItems]);

    const updateItemPrice = useCallback(async (itemId: string, newPrice: number) => {
        setMenuItems(prev => prev.map(i => i.id === itemId ? { ...i, price: newPrice } : i));
        await dbPost('menu_update_item', { id: itemId, updates: { price: newPrice } });
    }, []);

    const addMenuItem = useCallback(async (item: MenuItem) => {
        setMenuItems(prev => [...prev, item]);
        await dbPost('menu_add_item', { item });
    }, []);

    const updateMenuItem = useCallback(async (itemId: string, updates: Partial<MenuItem>) => {
        setMenuItems(prev => prev.map(i => i.id === itemId ? { ...i, ...updates } : i));
        await dbPost('menu_update_item', { id: itemId, updates });
    }, []);

    const deleteMenuItem = useCallback(async (itemId: string) => {
        setMenuItems(prev => prev.filter(i => i.id !== itemId));
        await dbPost('menu_delete_item', { id: itemId });
    }, []);

    const addCategory = useCallback(async (cat: Category) => {
        setCategories(prev => [...prev, cat]);
        await dbPost('category_add', { cat });
    }, []);

    const updateCategory = useCallback(async (catId: string, updates: Partial<Category>) => {
        setCategories(prev => prev.map(c => c.id === catId ? { ...c, ...updates } : c));
        await dbPost('category_update', { id: catId, updates });
    }, []);

    const deleteCategory = useCallback(async (catId: string) => {
        setCategories(prev => prev.filter(c => c.id !== catId));
        await dbPost('category_delete', { id: catId });
    }, []);

    // ── Rush hour ─────────────────────────────────────────────────────────

    const setRushHourMode = useCallback(async (mode: boolean) => {
        setRushHourModeState(mode);
        setMenuItems(prev => prev.map(item =>
            rushHourItems.includes(item.id) ? { ...item, isAvailable: !mode } : item
        ));
        // Persist availability changes
        const currentItems = menuItems.map(item =>
            rushHourItems.includes(item.id) ? { ...item, isAvailable: !mode } : item
        );
        for (const item of currentItems.filter(i => rushHourItems.includes(i.id))) {
            await dbPost('menu_update_item', { id: item.id, updates: { isAvailable: !mode } });
        }
        await dbPost('settings_save', { settings: { rushHourMode: mode, rushHourItems } });
    }, [rushHourItems, menuItems]);

    const toggleRushHourItem = useCallback(async (itemId: string) => {
        const newItems = rushHourItems.includes(itemId)
            ? rushHourItems.filter(id => id !== itemId)
            : [...rushHourItems, itemId];
        setRushHourItemsState(newItems);
        await dbPost('settings_save', { settings: { rushHourMode, rushHourItems: newItems } });
    }, [rushHourItems, rushHourMode]);

    const setRushHourItems = useCallback(async (itemIds: string[]) => {
        setRushHourItemsState(itemIds);
        await dbPost('settings_save', { settings: { rushHourMode, rushHourItems: itemIds } });
    }, [rushHourMode]);

    const updateBranding = useCallback(async (name: string, tl: string) => {
        setRestaurantName(name);
        setTagline(tl);
        await dbPost('settings_save', { settings: { rushHourMode, rushHourItems, restaurantName: name, tagline: tl, paymentsEnabled } });
    }, [rushHourMode, rushHourItems, paymentsEnabled]);

    const setPaymentsEnabled = useCallback(async (enabled: boolean) => {
        setPaymentsEnabledState(enabled);
        await dbPost('settings_save', { settings: { rushHourMode, rushHourItems, restaurantName, tagline, paymentsEnabled: enabled } });
    }, [rushHourMode, rushHourItems, restaurantName, tagline]);

    const setPrintCopies = useCallback(async (kot: number, bill: number) => {
        const k = Math.max(1, Math.min(10, Math.round(kot)));
        const b = Math.max(1, Math.min(10, Math.round(bill)));
        setKotCopiesState(k);
        setBillCopiesState(b);
        // Server $set patches only these keys — other settings stay intact.
        await dbPost('settings_save', { settings: { kotCopies: k, billCopies: b } });
    }, []);

    const setAutoPrintOrders = useCallback(async (enabled: boolean) => {
        setAutoPrintOrdersState(enabled);
        await dbPost('settings_save', { settings: { autoPrintOrders: enabled } });
    }, []);

    // ── Modifier groups ───────────────────────────────────────────────────

    const upsertModifierGroup = useCallback(async (group: ModifierGroup) => {
        setModifierGroups(prev => {
            const idx = prev.findIndex(g => g.id === group.id);
            if (idx === -1) return [...prev, group];
            const next = [...prev];
            next[idx] = group;
            return next;
        });
        await dbPost('modifier_group_upsert', { group });
    }, []);

    const deleteModifierGroup = useCallback(async (id: string) => {
        setModifierGroups(prev => prev.filter(g => g.id !== id));
        // Strip from any items locally
        setMenuItems(prev => prev.map(i =>
            i.modifierGroupIds?.includes(id)
                ? { ...i, modifierGroupIds: i.modifierGroupIds.filter(g => g !== id) }
                : i
        ));
        await dbPost('modifier_group_delete', { id });
    }, []);

    // ── Orders ────────────────────────────────────────────────────────────

    const addOrder = useCallback(async (orderData: Omit<Order, 'status'>) => {
        const newOrder: Order = { ...orderData, status: 'pending' };
        setOrders(prev => [newOrder, ...prev]);
        await dbPost('order_add', { order: newOrder });
    }, []);

    const updateOrderStatus = useCallback(async (orderId: string, status: Order['status'], items?: Order['items']) => {
        setOrders(prev => prev.map(o => o.orderId === orderId ? { ...o, status, ...(items ? { items } : {}) } : o));
        await dbPost('order_status', { orderId, status, ...(items ? { items } : {}) });
    }, []);

    // ── Utilities ─────────────────────────────────────────────────────────

    const getAvailableItems = useCallback(() => menuItems.filter(i => i.isAvailable), [menuItems]);
    const refreshMenuState = useCallback(() => { loadAll(); }, [loadAll]);

    return (
        <MenuContext.Provider value={{
            menuItems, categories, modifierGroups, orders,
            rushHourMode, rushHourItems,
            restaurantName, tagline, paymentsEnabled,
            kotCopies, billCopies, autoPrintOrders,
            toggleItemAvailability, updateItemPrice,
            addMenuItem, updateMenuItem, deleteMenuItem,
            addCategory, updateCategory, deleteCategory,
            upsertModifierGroup, deleteModifierGroup,
            setRushHourMode, toggleRushHourItem, setRushHourItems,
            addOrder, updateOrderStatus,
            getAvailableItems, refreshMenuState, updateBranding,
            setPaymentsEnabled,
            setPrintCopies,
            setAutoPrintOrders,
        }}>
            {children}
        </MenuContext.Provider>
    );
}

export function useMenu() {
    const ctx = useContext(MenuContext);
    if (!ctx) throw new Error('useMenu must be used within MenuProvider');
    return ctx;
}
