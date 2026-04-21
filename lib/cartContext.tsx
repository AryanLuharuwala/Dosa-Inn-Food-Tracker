/**
 * Cart Context Provider
 * 
 * Manages the customer's shopping cart state including:
 * - Cart items with quantities and add-ons
 * - Extra items (RDA Specials)
 * - Table number for dine-in orders
 * - Preorder details (pickup time, customer info)
 * - Cart totals (items count and amount)
 * 
 * The cart state is stored in memory and cleared after checkout.
 * Order type determines flow: 'dine-in' or 'preorder'
 */

'use client';

import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import { MenuItem, AddOn, Extra } from './menuData';
import { getStoredSharedCode, setStoredSharedCode, useSharedCartSync, SharedCart } from './useSharedCart';
import { ensureSession } from './auth';

export type OrderType = 'dine-in' | 'preorder';

export interface CartItem {
    id: string; // unique cart item id
    menuItem: MenuItem;
    quantity: number;
    selectedAddOns: AddOn[];
    totalPrice: number;
}

export interface CartExtra {
    id: string;
    extra: Extra;
    quantity: number;
}

export interface PreorderDetails {
    pickupTime: string;
    customerName: string;
    customerPhone: string;
}

interface CartContextType {
    items: CartItem[];
    extras: CartExtra[];
    tableNumber: string | null;
    orderType: OrderType;
    preorderDetails: PreorderDetails | null;
    setTableNumber: (table: string | null) => void;
    setOrderType: (type: OrderType) => void;
    setPreorderDetails: (details: PreorderDetails) => void;
    addItem: (menuItem: MenuItem, quantity: number, addOns: AddOn[]) => void;
    updateItemQuantity: (cartItemId: string, quantity: number) => void;
    removeItem: (cartItemId: string) => void;
    addExtra: (extra: Extra) => void;
    updateExtraQuantity: (extraId: string, quantity: number) => void;
    removeExtra: (extraId: string) => void;
    clearCart: () => void;
    totalItems: number;
    totalAmount: number;
    // Shared cart
    sharedCartCode: string | null;
    sharedCart: SharedCart | null;
    visitorId: string | null;
    startSharedCart: () => Promise<void>;
    joinSharedCart: (code: string) => Promise<boolean>;
    leaveSharedCart: () => void;
    updateParticipantItem: (participantVisitorId: string, cartItemId: string, newQuantity: number) => Promise<void>;
    removeParticipantItem: (participantVisitorId: string, cartItemId: string) => Promise<void>;
}

const CartContext = createContext<CartContextType | undefined>(undefined);

export function CartProvider({ children }: { children: ReactNode }) {
    const [visitorId, setVisitorId] = useState<string | null>(null);
    const [sharedCartCode, setSharedCartCode] = useState<string | null>(() => getStoredSharedCode());
    const [sharedCart, setSharedCart] = useState<SharedCart | null>(null);

    React.useEffect(() => {
        ensureSession().then(id => setVisitorId(id));
    }, []);

    // Initialize state from localStorage if available
    const [items, setItems] = useState<CartItem[]>(() => {
        if (typeof window === 'undefined') return [];
        const saved = localStorage.getItem('cart_items');
        return saved ? JSON.parse(saved) : [];
    });

    const [extras, setExtras] = useState<CartExtra[]>(() => {
        if (typeof window === 'undefined') return [];
        const saved = localStorage.getItem('cart_extras');
        return saved ? JSON.parse(saved) : [];
    });

    const [tableNumber, setTableNumber] = useState<string | null>(() => {
        if (typeof window === 'undefined') return null;
        return localStorage.getItem('table_number');
    });

    const [orderType, setOrderType] = useState<OrderType>(() => {
        if (typeof window === 'undefined') return 'dine-in';
        const saved = localStorage.getItem('order_type');
        return (saved as OrderType) || 'dine-in';
    });

    const [preorderDetails, setPreorderDetails] = useState<PreorderDetails | null>(() => {
        if (typeof window === 'undefined') return null;
        const saved = localStorage.getItem('preorder_details');
        return saved ? JSON.parse(saved) : null;
    });

    // Persistence effects
    React.useEffect(() => {
        localStorage.setItem('cart_items', JSON.stringify(items));
    }, [items]);

    React.useEffect(() => {
        localStorage.setItem('cart_extras', JSON.stringify(extras));
    }, [extras]);

    React.useEffect(() => {
        if (tableNumber) localStorage.setItem('table_number', tableNumber);
        else localStorage.removeItem('table_number');
    }, [tableNumber]);

    React.useEffect(() => {
        localStorage.setItem('order_type', orderType);
    }, [orderType]);

    React.useEffect(() => {
        if (preorderDetails) localStorage.setItem('preorder_details', JSON.stringify(preorderDetails));
        else localStorage.removeItem('preorder_details');
    }, [preorderDetails]);

    const addItem = useCallback((menuItem: MenuItem, quantity: number, addOns: AddOn[]) => {
        const addOnsPrice = addOns.reduce((sum, a) => sum + a.price, 0);
        const totalPrice = (menuItem.price + addOnsPrice) * quantity;

        const newItem: CartItem = {
            id: `${menuItem.id}-${Date.now()}`,
            menuItem,
            quantity,
            selectedAddOns: addOns,
            totalPrice,
        };

        setItems(prev => [...prev, newItem]);
    }, []);

    const updateItemQuantity = useCallback((cartItemId: string, quantity: number) => {
        setItems(prev => prev.map(item => {
            if (item.id === cartItemId) {
                const addOnsPrice = item.selectedAddOns.reduce((sum, a) => sum + a.price, 0);
                return {
                    ...item,
                    quantity,
                    totalPrice: (item.menuItem.price + addOnsPrice) * quantity,
                };
            }
            return item;
        }));
    }, []);

    const removeItem = useCallback((cartItemId: string) => {
        setItems(prev => prev.filter(item => item.id !== cartItemId));
    }, []);

    const addExtra = useCallback((extra: Extra) => {
        setExtras(prev => {
            const existing = prev.find(e => e.extra.id === extra.id);
            if (existing) {
                return prev.map(e =>
                    e.extra.id === extra.id
                        ? { ...e, quantity: e.quantity + 1 }
                        : e
                );
            }
            return [...prev, { id: extra.id, extra, quantity: 1 }];
        });
    }, []);

    const updateExtraQuantity = useCallback((extraId: string, quantity: number) => {
        setExtras(prev => prev.map(e =>
            e.id === extraId ? { ...e, quantity } : e
        ));
    }, []);

    const removeExtra = useCallback((extraId: string) => {
        setExtras(prev => prev.filter(e => e.id !== extraId));
    }, []);

    const clearCart = useCallback(() => {
        setItems([]);
        setExtras([]);
        // Preserve orderType and preorderDetails so the user stays in their flow
    }, []);

    // ── Shared cart ──────────────────────────────────────────────────────────

    const handleRemoteUpdate = useCallback((cart: SharedCart) => {
        setSharedCart(cart);
        // If someone else joined and we don't have tableNumber yet, adopt theirs
        if (cart.tableNumber) {
            setTableNumber(cart.tableNumber);
        }
    }, [setTableNumber]);

    useSharedCartSync(sharedCartCode, visitorId, items, extras, handleRemoteUpdate);

    const startSharedCart = useCallback(async () => {
        if (!tableNumber || !visitorId) return;
        const tokenNum = parseInt(tableNumber) || 0;
        const res = await fetch('/api/shared-cart', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'create', visitorId, tableNumber, tokenNumber: tokenNum }),
        });
        if (res.ok) {
            const cart: SharedCart = await res.json();
            setSharedCartCode(cart.code);
            setStoredSharedCode(cart.code);
            setSharedCart(cart);
        }
    }, [tableNumber, visitorId]);

    const joinSharedCart = useCallback(async (code: string): Promise<boolean> => {
        if (!visitorId) return false;
        // Pass current shared cart participants so they get merged into the target cart
        const mergeParticipants = sharedCart?.participants ?? [];
        const res = await fetch('/api/shared-cart', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'join', visitorId, code, mergeParticipants }),
        });
        if (!res.ok) return false;
        const cart: SharedCart = await res.json();
        // Discard old shared cart code and adopt the new one
        setSharedCartCode(cart.code);
        setStoredSharedCode(cart.code);
        setSharedCart(cart);
        setTableNumber(cart.tableNumber);
        setOrderType('dine-in');
        return true;
    }, [visitorId, sharedCart, setTableNumber, setOrderType]);

    const leaveSharedCart = useCallback(() => {
        setSharedCartCode(null);
        setStoredSharedCode(null);
        setSharedCart(null);
    }, []);

    const updateParticipantItem = useCallback(async (participantVisitorId: string, cartItemId: string, newQuantity: number) => {
        if (!sharedCartCode || !sharedCart) return;
        const participant = sharedCart.participants.find(p => p.visitorId === participantVisitorId);
        if (!participant) return;
        const updatedItems = participant.items.map(i =>
            i.id === cartItemId
                ? { ...i, quantity: newQuantity, totalPrice: (i.menuItem.price + i.selectedAddOns.reduce((s, a) => s + a.price, 0)) * newQuantity }
                : i
        ).filter(i => i.quantity > 0);
        const res = await fetch('/api/shared-cart', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'update', visitorId: participantVisitorId, code: sharedCartCode, items: updatedItems, extras: participant.extras }),
        });
        if (res.ok) setSharedCart(await res.json());
    }, [sharedCartCode, sharedCart]);

    const removeParticipantItem = useCallback(async (participantVisitorId: string, cartItemId: string) => {
        if (!sharedCartCode || !sharedCart) return;
        const participant = sharedCart.participants.find(p => p.visitorId === participantVisitorId);
        if (!participant) return;
        const updatedItems = participant.items.filter(i => i.id !== cartItemId);
        const res = await fetch('/api/shared-cart', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'update', visitorId: participantVisitorId, code: sharedCartCode, items: updatedItems, extras: participant.extras }),
        });
        if (res.ok) setSharedCart(await res.json());
    }, [sharedCartCode, sharedCart]);

    const totalItems = items.reduce((sum, item) => sum + item.quantity, 0) +
        extras.reduce((sum, e) => sum + e.quantity, 0);

    const totalAmount = items.reduce((sum, item) => sum + item.totalPrice, 0) +
        extras.reduce((sum, e) => sum + (e.extra.price * e.quantity), 0);

    return (
        <CartContext.Provider value={{
            items,
            extras,
            tableNumber,
            orderType,
            preorderDetails,
            setTableNumber,
            setOrderType,
            setPreorderDetails,
            addItem,
            updateItemQuantity,
            removeItem,
            addExtra,
            updateExtraQuantity,
            removeExtra,
            clearCart,
            totalItems,
            totalAmount,
            sharedCartCode,
            sharedCart,
            visitorId,
            startSharedCart,
            joinSharedCart,
            leaveSharedCart,
            updateParticipantItem,
            removeParticipantItem,
        }}>
            {children}
        </CartContext.Provider>
    );
}

export function useCart() {
    const context = useContext(CartContext);
    if (context === undefined) {
        throw new Error('useCart must be used within a CartProvider');
    }
    return context;
}

