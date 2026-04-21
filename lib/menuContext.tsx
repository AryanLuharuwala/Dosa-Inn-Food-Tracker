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
}

interface MenuContextType {
    menuItems: MenuItem[];
    categories: Category[];
    orders: Order[];
    rushHourMode: boolean;
    rushHourItems: string[];
    toggleItemAvailability: (itemId: string) => void;
    updateItemPrice: (itemId: string, newPrice: number) => void;
    addMenuItem: (item: MenuItem) => void;
    updateMenuItem: (itemId: string, updates: Partial<MenuItem>) => void;
    deleteMenuItem: (itemId: string) => void;
    setRushHourMode: (mode: boolean) => void;
    toggleRushHourItem: (itemId: string) => void;
    setRushHourItems: (itemIds: string[]) => void;
    addOrder: (order: Omit<Order, 'status'>) => void;
    updateOrderStatus: (orderId: string, status: Order['status']) => void;
    getAvailableItems: () => MenuItem[];
    refreshMenuState: () => void;
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
    const [orders, setOrders] = useState<Order[]>([]);
    const [rushHourMode, setRushHourModeState] = useState(false);
    const [rushHourItems, setRushHourItemsState] = useState<string[]>([]);

    const loadAll = useCallback(async () => {
        const [items, cats, ords, settings] = await Promise.all([
            dbGet<MenuItem[]>('menu_items'),
            dbGet<Category[]>('categories'),
            dbGet<Order[]>('orders'),
            dbGet<{ rushHourMode: boolean; rushHourItems: string[] }>('settings'),
        ]);
        if (items && items.length > 0) setMenuItems(items);
        if (cats && cats.length > 0) setCategories(cats);
        if (ords) setOrders(ords);
        if (settings) {
            setRushHourModeState(settings.rushHourMode);
            setRushHourItemsState(settings.rushHourItems);
        }
    }, []);

    useEffect(() => {
        loadAll();
        const interval = setInterval(loadAll, 3000);
        return () => clearInterval(interval);
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

    // ── Orders ────────────────────────────────────────────────────────────

    const addOrder = useCallback(async (orderData: Omit<Order, 'status'>) => {
        const newOrder: Order = { ...orderData, status: 'pending' };
        setOrders(prev => [newOrder, ...prev]);
        await dbPost('order_add', { order: newOrder });
    }, []);

    const updateOrderStatus = useCallback(async (orderId: string, status: Order['status']) => {
        setOrders(prev => prev.map(o => o.orderId === orderId ? { ...o, status } : o));
        await dbPost('order_status', { orderId, status });
    }, []);

    // ── Utilities ─────────────────────────────────────────────────────────

    const getAvailableItems = useCallback(() => menuItems.filter(i => i.isAvailable), [menuItems]);
    const refreshMenuState = useCallback(() => { loadAll(); }, [loadAll]);

    return (
        <MenuContext.Provider value={{
            menuItems, categories, orders,
            rushHourMode, rushHourItems,
            toggleItemAvailability, updateItemPrice,
            addMenuItem, updateMenuItem, deleteMenuItem,
            setRushHourMode, toggleRushHourItem, setRushHourItems,
            addOrder, updateOrderStatus,
            getAvailableItems, refreshMenuState,
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
