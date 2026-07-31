'use client';

import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useMenu, Order } from '@/lib/menuContext';
import { MenuItem } from '@/lib/menuData';
import PricingTable from '@/components/pricing/PricingTable';
import PrinterPanel from '@/components/printer/PrinterPanel';
import PrinterHeaderButton from '@/components/printer/PrinterHeaderButton';
import { usePrinter } from '@/components/printer/usePrinter';
import { useEspPrinterStatus } from '@/components/printer/useEspPrinterStatus';
import styles from './page.module.css';

// List of available menu images (from /public/menu-images/)
const AVAILABLE_IMAGES = [
    'aloo-cheese-sandwich.png', 'aloo-paratha.png', 'aloo-sandwich.png', 'baby-corn-65.png',
    'bombay-sandwich.png', 'bread-butter.png', 'bread-pakora.png', 'cheese-maggi.png',
    'cheese-paratha.png', 'cheese-pasta.png', 'cheese-sandwich.png', 'chilli-baby-corn.png',
    'chilli-mushroom.png', 'chilli-paneer.png', 'chole-chawal.png', 'chole-kulche.png',
    'cutting-chai.png', 'dal-chawal.png', 'dal-tadka.png', 'desi-pasta.png',
    'fried-momos.png', 'ghar-ki-dal.png', 'gobi-paratha.png', 'gravy-noodles.png',
    'hakka-noodles.png', 'indori-poha.png', 'jeera-aloo.png', 'kadai-mushroom.png',
    'kadai-paneer.png', 'kadi-chawal.png', 'litti-chokha.png', 'maggi.png',
    'manchurian-momos.png', 'marwadi-sandwich.png', 'masala-chaas.png', 'masala-chai.png',
    'masala-cold-drink.png', 'matar-mushroom.png', 'matar-paneer.png', 'methi-paratha.png',
    'mix-veg-curry.png', 'mix-veg-paratha.png', 'mumbai-pav-bhaji.png', 'mushroom-65.png',
    'mushroom-manchurian.png', 'mushroom-masala.png', 'nimbu-paani.png', 'onion-paratha.png',
    'paneer-65.png', 'paneer-bhurji.png', 'paneer-butter-masala.png', 'paneer-paratha.png',
    'pav-bhaji.png', 'pizza-paratha.png', 'plain-paratha.png', 'punjabi-chole.png',
    'punjabi-kadi.png', 'rajma-chawal.png', 'rajma-curry.png', 'ratlami-sandwich.png',
    'ratlami-sev-paratha.png', 'ratlami-sev-pav-bhaji.png', 'samosa.png', 'sattu-paratha.png',
    'schezwan-maggi.png', 'schezwan-momos.png', 'schezwan-noodles.png', 'schezwan-pasta.png',
    'schezwan-rice.png', 'spring-roll.png', 'tomato-fried-rice.png', 'tomato-garlic-maggi.png',
    'tomato-garlic-momos.png', 'tomato-garlic-pasta.png', 'veg-fried-rice.png',
    'veg-manchurian.png', 'veg-masala-pasta.png', 'veg-momos.png', 'veg-pasta.png',
    'veg-stir-fried-maggi.png',
];

interface ItemFormData {
    name: string;
    description: string;
    price: string;
    categoryId: string;
    image: string;
    tags: ('bestSeller' | 'readyFast')[];
    isAvailable: boolean;
}

const defaultFormData: ItemFormData = {
    name: '',
    description: '',
    price: '',
    categoryId: '',
    image: '',
    tags: [],
    isAvailable: true,
};

export default function AdminPage() {

    const {
        menuItems,
        categories,
        modifierGroups,
        orders,
        rushHourMode,
        rushHourItems,
        toggleItemAvailability,
        addMenuItem,
        updateMenuItem,
        deleteMenuItem,
        addCategory,
        updateCategory,
        deleteCategory,
        upsertModifierGroup,
        deleteModifierGroup,
        setRushHourMode,
        toggleRushHourItem,
        setRushHourItems,
        updateOrderStatus,
        deleteOrder,
        restaurantName,
        tagline: contextTagline,
        legalName: contextLegalName,
        updateBranding,
        paymentsEnabled,
        setPaymentsEnabled,
        kotCopies,
        billCopies,
        setPrintCopies,
        autoPrintOrders,
        setAutoPrintOrders,
        billTemplate,
    } = useMenu();

    // Bluetooth printer — connection state lives in the singleton client, this
    // hook just subscribes to changes and exposes printKOT/printBill.
    const printer = usePrinter();
    // ESP32 bridge online status — any registered device with last_seen < 60s.
    const esp = useEspPrinterStatus();
    // "Print is possible" if EITHER path is up. Print buttons show whenever
    // this is true; routing inside handlePrint* decides which path to use.
    const printAvailable = printer.isConnected || esp.online;
    const [printingId, setPrintingId] = useState<string | null>(null);
    /** Loops over the configured copy count; each call awaits the previous so
     *  the queue inside the printer client serializes BLE writes. */
    const printNCopies = async (n: number, send: () => Promise<void>) => {
        for (let i = 0; i < Math.max(1, n); i++) await send();
    };
    // Fire-and-forget enqueue to the ESP32 bridge. We pass copies explicitly
    // so the device prints N times from a single fetch — the server stamps
    // `copies` onto the job and the ESP reads it back. This keeps the
    // browser-BLE path and the server-queue path consistent.
    const enqueueJob = (kind: 'bill' | 'kot', orderId: string, copies: number) => {
        fetch('/api/print/jobs', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ orderId, kind, copies }),
        }).catch(() => {});
    };
    const handlePrintKOT = async (order: Order) => {
        setPrintingId(order.orderId);
        try {
            enqueueJob('kot', order.orderId, kotCopies);
            if (printer.isConnected) {
                await printNCopies(kotCopies, () => printer.printKOT(order, restaurantName));
            }
        }
        catch (e) { alert((e as Error).message); }
        finally { setPrintingId(null); }
    };
    const handlePrintBill = async (order: Order) => {
        setPrintingId(order.orderId);
        try {
            enqueueJob('bill', order.orderId, billCopies);
            if (printer.isConnected) {
                await printNCopies(billCopies, () => printer.printBill(order, restaurantName, { template: billTemplate, tagline: contextTagline }));
            }
        }
        catch (e) { alert((e as Error).message); }
        finally { setPrintingId(null); }
    };

    const [activeTab, setActiveTab] = useState<'orders' | 'menu' | 'rush-hour' | 'whatsapp'>('orders');
    const [menuSubTab, setMenuSubTab] = useState<'items' | 'categories' | 'modifiers'>('items');
    const [rushHourSearch, setRushHourSearch] = useState('');
    const [headerScrolled, setHeaderScrolled] = useState(false);
    useEffect(() => {
        const onScroll = () => setHeaderScrolled(window.scrollY > 10);
        window.addEventListener('scroll', onScroll, { passive: true });
        return () => window.removeEventListener('scroll', onScroll);
    }, []);

    // Screen wake lock: keep the display on so Chrome never suspends this tab.
    // Without this, the screen sleeping on Android/tablet kills SSE and stops
    // new orders from appearing and auto-print from firing.
    useEffect(() => {
        if (typeof navigator === 'undefined' || !('wakeLock' in navigator)) return;
        let lock: WakeLockSentinel | null = null;
        let active = true;
        const acquire = async () => {
            if (!active) return;
            try { lock = await navigator.wakeLock.request('screen'); } catch {}
        };
        const onVisibility = () => {
            if (document.visibilityState === 'visible') acquire();
        };
        acquire();
        document.addEventListener('visibilitychange', onVisibility);
        return () => {
            active = false;
            document.removeEventListener('visibilitychange', onVisibility);
            lock?.release().catch(() => {});
        };
    }, []);

    // Category CRUD state
    const [showCatModal, setShowCatModal] = useState(false);
    const [editingCatId, setEditingCatId] = useState<string | null>(null);
    const [catForm, setCatForm] = useState({ name: '', icon: '', tagline: '' });
    const [deletingCatId, setDeletingCatId] = useState<string | null>(null);

    // Modifier group CRUD state
    type ModifierGroupForm = {
        id: string | null;
        name: string;
        type: 'addOn' | 'extra';
        modifiers: Array<{ id: string; name: string; price: string }>;
    };
    const [showMgModal, setShowMgModal] = useState(false);
    const [mgForm, setMgForm] = useState<ModifierGroupForm>({ id: null, name: '', type: 'addOn', modifiers: [] });
    const [deletingMgId, setDeletingMgId] = useState<string | null>(null);

    // Modal state
    const [showModal, setShowModal] = useState(false);
    const [editingItemId, setEditingItemId] = useState<string | null>(null);
    const [formData, setFormData] = useState<ItemFormData>(defaultFormData);

    // Delete confirmation state
    const [deletingItemId, setDeletingItemId] = useState<string | null>(null);

    // Image upload state
    const [isUploading, setIsUploading] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // WhatsApp state
    const [waStatus, setWaStatus] = useState<'disconnected' | 'qr' | 'connecting' | 'ready'>('disconnected');
    const [waQr, setWaQr] = useState<string | null>(null);
    const [waInfo, setWaInfo] = useState<{ phone?: string; name?: string } | null>(null);
    const [waPolling, setWaPolling] = useState(false);

    const fetchWaStatus = useCallback(async () => {
        try {
            const res = await fetch('/api/whatsapp?action=status');
            if (!res.ok) return;
            const data = await res.json();
            setWaStatus(data.status ?? 'disconnected');
            if (data.phone) setWaInfo({ phone: data.phone, name: data.name });
            else setWaInfo(null);
        } catch { /* service not running */ }
    }, []);

    const fetchWaQr = useCallback(async () => {
        try {
            const res = await fetch('/api/whatsapp?action=qr');
            if (!res.ok) return;
            const data = await res.json();
            setWaQr(data.qr ?? null);
        } catch { /* ignore */ }
    }, []);

    // Poll status while on the WhatsApp tab or when connecting
    useEffect(() => {
        if (activeTab !== 'whatsapp' && waStatus === 'ready') return;
        if (activeTab !== 'whatsapp' && waStatus === 'disconnected') return;
        let handle: ReturnType<typeof setInterval>;
        const poll = async () => {
            await fetchWaStatus();
            if (waStatus === 'qr') await fetchWaQr();
        };
        poll();
        handle = setInterval(poll, waStatus === 'qr' ? 3000 : 8000);
        return () => clearInterval(handle);
    }, [activeTab, waStatus, fetchWaStatus, fetchWaQr]);

    // Fetch QR whenever tab is opened and status is qr
    useEffect(() => {
        if (activeTab === 'whatsapp') {
            fetchWaStatus().then(() => {
                if (waStatus === 'qr') fetchWaQr();
            });
        }
    }, [activeTab]); // eslint-disable-line react-hooks/exhaustive-deps

    const handleWaConnect = async () => {
        setWaStatus('connecting');
        setWaQr(null);
        await fetchWaStatus();
        await fetchWaQr();
    };

    const handleWaLogout = async () => {
        await fetch('/api/whatsapp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'logout' }) });
        setWaStatus('disconnected');
        setWaQr(null);
        setWaInfo(null);
    };

    // Branding — sync initial values from context once loaded
    const [brandingName, setBrandingName] = useState('');
    const [brandingTagline, setBrandingTagline] = useState('');
    const [brandingLegalName, setBrandingLegalName] = useState('');
    const [brandingSaving, setBrandingSaving] = useState(false);
    const [brandingSaved, setBrandingSaved] = useState(false);

    // Env settings (Cashfree, base URL, admin password)
    type EnvFields = {
        ADMIN_PASSWORD: string;
        CASHFREE_APP_ID: string;
        CASHFREE_SECRET_KEY: string;
        CASHFREE_ENV: string;
        NEXT_PUBLIC_BASE_URL: string;
    };
    const [envFields, setEnvFields] = useState<EnvFields>({
        ADMIN_PASSWORD: '', CASHFREE_APP_ID: '', CASHFREE_SECRET_KEY: '',
        CASHFREE_ENV: '', NEXT_PUBLIC_BASE_URL: '',
    });
    const [envSaving, setEnvSaving] = useState(false);
    const [envSaved, setEnvSaved] = useState(false);
    const [envLoaded, setEnvLoaded] = useState(false);
    const [envOpen, setEnvOpen] = useState(false);
    const brandingInitialized = React.useRef(false);
    React.useEffect(() => {
        if (!brandingInitialized.current && restaurantName) {
            setBrandingName(restaurantName);
            setBrandingTagline(contextTagline);
            setBrandingLegalName(contextLegalName);
            brandingInitialized.current = true;
        }
    }, [restaurantName, contextTagline, contextLegalName]);

    // WA logs
    const [waLogs, setWaLogs] = useState<string>('');
    const [waLogsOpen, setWaLogsOpen] = useState(false);
    const fetchWaLogs = useCallback(async () => {
        try {
            const res = await fetch('/api/whatsapp?action=logs');
            if (!res.ok) return;
            const data = await res.json();
            const combined = [data.out, data.err].filter(Boolean).join('\n--- stderr ---\n');
            setWaLogs(combined || '(no logs yet)');
        } catch { setWaLogs('Service unavailable'); }
    }, []);

    const fetchEnvSettings = useCallback(async () => {
        try {
            const res = await fetch('/api/settings');
            if (!res.ok) return;
            const data = await res.json();
            setEnvFields(prev => ({ ...prev, ...data }));
            setEnvLoaded(true);
        } catch { /* ignore */ }
    }, []);

    const handleEnvSave = useCallback(async () => {
        setEnvSaving(true);
        const res = await fetch('/api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(envFields),
        });
        setEnvSaving(false);
        if (res.ok) {
            setEnvSaved(true);
            setTimeout(() => setEnvSaved(false), 2000);
        }
    }, [envFields]);

    const handleBrandingSave = useCallback(async () => {
        if (!brandingName.trim()) return;
        setBrandingSaving(true);
        await updateBranding(brandingName.trim(), brandingTagline.trim(), brandingLegalName.trim());
        setBrandingSaving(false);
        setBrandingSaved(true);
        setTimeout(() => setBrandingSaved(false), 2000);
    }, [brandingName, brandingTagline, brandingLegalName, updateBranding]);

    // Data export
    const handleExport = useCallback(async (format: 'json' | 'csv') => {
        const res = await fetch(`/api/db?resource=export&format=${format}`);
        if (!res.ok) { alert('Export failed'); return; }
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `dosa-inn-export-${new Date().toISOString().slice(0, 10)}.${format}`;
        a.click();
        URL.revokeObjectURL(url);
    }, []);

    // Bell sound + auto-print on new orders. We track the previous set of
    // order IDs so we can identify *which* orders are new (count-only
    // detection misses cases where orders both arrive and get cleared between
    // ticks). On the first SSE load we just seed the set without ringing
    // the bell — otherwise every page refresh would auto-print the entire
    // backlog.
    const bellRef = useRef<HTMLAudioElement | null>(null);
    const prevOrderIdsRef = useRef<Set<string> | null>(null);
    // Captured once on mount. Orders created before this moment are backlog
    // and must never auto-print, even if they arrive late from loadAll().
    const mountedAtRef = useRef<number>(Date.now());
    useEffect(() => {
        bellRef.current = new Audio('/sounds/bell.mp3');
        bellRef.current.volume = 0.7;
    }, []);
    useEffect(() => {
        const currentIds = new Set(orders.map(o => o.orderId));
        const prevIds = prevOrderIdsRef.current;

        // First load — seed silently
        if (prevIds === null) {
            prevOrderIdsRef.current = currentIds;
            return;
        }

        // Only treat an order as "new" if it (a) wasn't in the previous snapshot
        // AND (b) was created after the admin page was opened. (b) protects
        // against the case where loadAll() returns orders late — those would
        // otherwise look new on the first non-null tick and auto-print the
        // entire backlog.
        const newOrders = orders.filter(o => {
            if (prevIds.has(o.orderId)) return false;
            const ts = o.timestamp ? new Date(o.timestamp).getTime() : 0;
            return ts >= mountedAtRef.current;
        });
        if (newOrders.length > 0) {
            bellRef.current?.play().catch(() => {});
            if (autoPrintOrders) {
                for (const order of newOrders) {
                    // Always enqueue once on the server — the ESP bridge will
                    // pick it up via long-poll regardless of whether this tab
                    // is paired over BLE. order_add already does this same
                    // enqueue unconditionally server-side; `auto: true` shares
                    // its dedup key so whichever of the two reaches the server
                    // first wins and the other is a no-op, not a duplicate KOT.
                    fetch('/api/print/jobs', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ orderId: order.orderId, kind: 'kot', copies: kotCopies, auto: true }),
                    }).catch(() => {});
                    // Also fire over BLE if this tab is paired — gives same-room
                    // printer the fastest path. The BLE client serializes writes
                    // internally so kotCopies don't race.
                    if (printer.isConnected) {
                        for (let i = 0; i < kotCopies; i++) {
                            printer.printKOT(order, restaurantName).catch(err => {
                                console.warn('[admin] auto-print KOT failed', err);
                            });
                        }
                    }
                }
            }
        }
        prevOrderIdsRef.current = currentIds;
    }, [orders, autoPrintOrders, printer, kotCopies, restaurantName]);

    const handleImageUpload = async (file: File) => {
        setIsUploading(true);
        try {
            const form = new FormData();
            form.append('file', file);
            const res = await fetch('/api/upload', { method: 'POST', body: form });
            if (!res.ok) throw new Error('Upload failed');
            const { url } = await res.json();
            handleFormChange('image', url);
        } catch (err) {
            console.error('Upload error:', err);
            alert('Failed to upload image. Please try again.');
        } finally {
            setIsUploading(false);
        }
    };

    const getStatusColor = (status: Order['status']) => {
        switch (status) {
            case 'pending': return '#ff9800';
            case 'preparing': return '#2196f3';
            case 'ready': return '#4caf50';
            case 'delivered': return '#9e9e9e';
        }
    };

    // Filter rush hour items
    const filteredRushHourItems = useMemo(() => {
        let items = menuItems;

        if (rushHourSearch.trim()) {
            const query = rushHourSearch.toLowerCase();
            items = items.filter(item =>
                item.name.toLowerCase().includes(query)
            );
        }

        return items;
    }, [menuItems, rushHourSearch]);

    const handleSelectSlowItems = () => {
        const slowItems = menuItems
            .filter(i => !i.tags?.includes('readyFast'))
            .map(i => i.id);
        setRushHourItems(slowItems);
    };

    const handleClearAllRushItems = () => {
        setRushHourItems([]);
    };

    const handleToggleRushHour = () => {
        if (!rushHourMode && rushHourItems.length === 0) {
            alert('Please select items to pause during Rush Hour first!');
            setActiveTab('rush-hour');
            return;
        }
        setRushHourMode(!rushHourMode);
    };

    // --- CRUD Handlers ---
    const openAddModal = () => {
        setEditingItemId(null);
        setFormData({ ...defaultFormData, categoryId: categories[0]?.id || '' });
        setShowModal(true);
    };

    const openEditModal = (item: MenuItem) => {
        setEditingItemId(item.id);
        setFormData({
            name: item.name,
            description: item.description,
            price: item.price.toString(),
            categoryId: item.categoryId,
            image: item.image || '',
            tags: item.tags ? [...item.tags] : [],
            isAvailable: item.isAvailable,
        });
        setShowModal(true);
    };

    const closeModal = () => {
        setShowModal(false);
        setEditingItemId(null);
        setFormData(defaultFormData);
    };

    const handleFormChange = (field: keyof ItemFormData, value: string | boolean | ('bestSeller' | 'readyFast')[]) => {
        setFormData(prev => ({ ...prev, [field]: value }));
    };

    const handleTagToggle = (tag: 'bestSeller' | 'readyFast') => {
        setFormData(prev => ({
            ...prev,
            tags: prev.tags.includes(tag)
                ? prev.tags.filter(t => t !== tag)
                : [...prev.tags, tag],
        }));
    };

    const handleFormSubmit = () => {
        if (!formData.name.trim() || !formData.price || !formData.categoryId) return;

        const price = parseInt(formData.price);
        if (isNaN(price) || price <= 0) return;

        if (editingItemId) {
            // Editing existing item
            updateMenuItem(editingItemId, {
                name: formData.name.trim(),
                description: formData.description.trim(),
                price,
                categoryId: formData.categoryId,
                image: formData.image || undefined,
                tags: formData.tags.length > 0 ? formData.tags : undefined,
                isAvailable: formData.isAvailable,
            });
        } else {
            // Adding new item
            const id = formData.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
            const uniqueId = menuItems.find(i => i.id === id) ? `${id}-${Date.now()}` : id;
            const newItem: MenuItem = {
                id: uniqueId,
                name: formData.name.trim(),
                description: formData.description.trim(),
                price,
                categoryId: formData.categoryId,
                image: formData.image || undefined,
                tags: formData.tags.length > 0 ? formData.tags : undefined,
                isAvailable: formData.isAvailable,
            };
            addMenuItem(newItem);
        }
        closeModal();
    };

    const handleDeleteConfirm = (itemId: string) => {
        setDeletingItemId(itemId);
    };

    const handleDeleteExecute = () => {
        if (deletingItemId) {
            deleteMenuItem(deletingItemId);
            setDeletingItemId(null);
        }
    };

    const handleDeleteCancel = () => {
        setDeletingItemId(null);
    };

    const openAddCatModal = () => {
        setEditingCatId(null);
        setCatForm({ name: '', icon: '🍽️', tagline: '' });
        setShowCatModal(true);
    };

    const openEditCatModal = (cat: import('@/lib/menuData').Category) => {
        setEditingCatId(cat.id);
        setCatForm({ name: cat.name, icon: cat.icon, tagline: cat.tagline || '' });
        setShowCatModal(true);
    };

    const handleCatFormSubmit = () => {
        if (!catForm.name.trim() || !catForm.icon.trim()) return;
        if (editingCatId) {
            updateCategory(editingCatId, { name: catForm.name.trim(), icon: catForm.icon.trim(), tagline: catForm.tagline.trim() || undefined });
        } else {
            const id = catForm.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
            const uniqueId = categories.find(c => c.id === id) ? `${id}-${Date.now()}` : id;
            addCategory({ id: uniqueId, name: catForm.name.trim(), icon: catForm.icon.trim(), tagline: catForm.tagline.trim() || undefined });
        }
        setShowCatModal(false);
        setEditingCatId(null);
    };

    // ── Modifier group handlers ───────────────────────────────────────────────

    const openAddModifierGroupModal = () => {
        setMgForm({ id: null, name: '', type: 'addOn', modifiers: [] });
        setShowMgModal(true);
    };

    const openEditModifierGroupModal = (group: import('@/lib/menuContext').ModifierGroup) => {
        setMgForm({
            id: group.id,
            name: group.name,
            type: group.type,
            modifiers: group.modifiers.map(m => ({ id: m.id, name: m.name, price: String(m.price) })),
        });
        setShowMgModal(true);
    };

    const handleMgFormSubmit = async () => {
        if (!mgForm.name.trim()) return;
        const id = mgForm.id ?? `mg_${mgForm.type}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        const modifiers = mgForm.modifiers
            .map(m => ({
                id: m.id || `m_${Math.random().toString(36).slice(2, 8)}`,
                name: m.name.trim(),
                price: parseInt(m.price, 10),
            }))
            .filter(m => m.name && !isNaN(m.price) && m.price >= 0);
        await upsertModifierGroup({ id, name: mgForm.name.trim(), type: mgForm.type, modifiers });
        setShowMgModal(false);
    };

    const mgFormAddRow = () => {
        setMgForm(prev => ({
            ...prev,
            modifiers: [...prev.modifiers, { id: '', name: '', price: '' }],
        }));
    };

    const mgFormUpdateRow = (idx: number, field: 'name' | 'price', val: string) => {
        setMgForm(prev => ({
            ...prev,
            modifiers: prev.modifiers.map((m, i) => i === idx ? { ...m, [field]: val } : m),
        }));
    };

    const mgFormRemoveRow = (idx: number) => {
        setMgForm(prev => ({
            ...prev,
            modifiers: prev.modifiers.filter((_, i) => i !== idx),
        }));
    };

    /** Items that reference a given group — used in the Modifiers list and as a delete safety check. */
    const itemsUsingGroup = useCallback((groupId: string) => {
        return menuItems.filter(i => i.modifierGroupIds?.includes(groupId));
    }, [menuItems]);

    // Calculate analytics
    const todayOrders = orders.filter(o => {
        const orderDate = new Date(o.timestamp).toDateString();
        const today = new Date().toDateString();
        return orderDate === today;
    });

    const todayRevenue = todayOrders.reduce((sum, o) => sum + o.totalAmount, 0);
    const totalOrders = todayOrders.length;
    const activeItems = menuItems.filter(i => i.isAvailable).length;
    const disabledItems = menuItems.length - activeItems;

    // Order status counts
    const pendingCount = orders.filter(o => o.status === 'pending').length;
    const preparingCount = orders.filter(o => o.status === 'preparing').length;
    const readyCount = orders.filter(o => o.status === 'ready').length;
    const deliveredCount = orders.filter(o => o.status === 'delivered').length;

    // Calculate top sellers
    const itemSales: { [key: string]: { name: string; count: number } } = {};
    orders.forEach(order => {
        order.items.forEach(item => {
            const key = item.menuItem.name;
            if (!itemSales[key]) {
                itemSales[key] = { name: key, count: 0 };
            }
            itemSales[key].count += item.quantity;
        });
    });
    const topSellers = Object.values(itemSales)
        .sort((a, b) => b.count - a.count)
        .slice(0, 5);

    return (
        <div className={styles.container}>
            {/* Header */}
            <header className={`${styles.header}${headerScrolled ? ` ${styles.headerScrolled}` : ''}`}>
                <div className={styles.headerLeft}>
                    <Link href="/" className={styles.backLink}>← Home</Link>
                    <Link href="/" className={styles.logoLink}>
                        <img src="/logo.png" alt={restaurantName} className={styles.logo} />
                    </Link>
                    <span className={styles.adminBadge}>Admin</span>
                </div>
                <div className={styles.rushHourToggle}>
                    {/* Subpage links (Kitchen/Cook/Pricing/Analytics/Bill Editor/
                        Sessions/Debug/Printers) moved to the site-wide sidebar —
                        open it via the hamburger button instead of this strip. */}
                    <PrinterHeaderButton />

                    <span className={rushHourMode ? styles.rushActive : ''}>
                        {rushHourMode ? '🔥 Rush Hour ON' : 'Rush Hour'}
                    </span>
                    <button
                        className={`${styles.toggle} ${rushHourMode ? styles.toggleActive : ''}`}
                        onClick={handleToggleRushHour}
                        style={{ marginRight: '15px' }}
                    >
                        <div className={styles.toggleThumb} />
                    </button>

                    <button
                        onClick={async () => {
                            await fetch('/api/auth/logout', { method: 'POST' });
                            window.location.href = '/login';
                        }}
                        className={styles.logoutBtn}
                        style={{
                            padding: '6px 12px',
                            borderRadius: '6px',
                            border: '1px solid #ddd',
                            backgroundColor: 'white',
                            cursor: 'pointer',
                            color: '#666',
                            fontSize: '14px',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '5px'
                        }}
                    >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9" />
                        </svg>
                        Logout
                    </button>
                </div>
            </header>

            {/* Tab Navigation */}
            < div className={styles.tabs} >
                <button
                    className={`${styles.tab} ${activeTab === 'orders' ? styles.tabActive : ''}`}
                    onClick={() => setActiveTab('orders')}
                >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                    </svg>
                    Orders
                    {orders.filter(o => o.status === 'pending').length > 0 && (
                        <span className={styles.badge}>{orders.filter(o => o.status === 'pending').length}</span>
                    )}
                </button>
                <button
                    className={`${styles.tab} ${activeTab === 'menu' ? styles.tabActive : ''}`}
                    onClick={() => setActiveTab('menu')}
                >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M4 6h16M4 12h16M4 18h16" />
                    </svg>
                    Menu
                </button>
                <button
                    className={`${styles.tab} ${activeTab === 'rush-hour' ? styles.tabActive : ''}`}
                    onClick={() => setActiveTab('rush-hour')}
                >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
                    </svg>
                    Rush
                    {rushHourItems.length > 0 && (
                        <span className={styles.badgeOrange}>{rushHourItems.length}</span>
                    )}
                </button>
                <button
                    className={`${styles.tab} ${activeTab === 'whatsapp' ? styles.tabActive : ''}`}
                    onClick={() => setActiveTab('whatsapp')}
                >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                    </svg>
                    WA
                    {waStatus === 'ready' && <span className={styles.badgeGreen}>●</span>}
                </button>
            </div >

            {/* Content */}
            < div className={styles.content} >
                {/* Orders Tab */}
                {
                    activeTab === 'orders' && (
                        <div className={styles.ordersTab}>
                            <h2 className={styles.sectionTitle}>Live Orders</h2>
                            {orders.length === 0 ? (
                                <div className={styles.emptyState}>
                                    <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                                        <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                                    </svg>
                                    <p>No orders yet</p>
                                    <span>Orders will appear here when customers place them</span>
                                </div>
                            ) : (
                                <div className={styles.ordersList}>
                                    {orders.map(order => (
                                        <div key={order.orderId} className={styles.orderCard}>
                                            <div className={styles.orderHeader}>
                                                <div className={styles.orderInfo}>
                                                    <span className={styles.orderId}>Token #{order.tokenNumber}</span>
                                                    {order.orderType === 'preorder' ? (
                                                        <>
                                                            <span className={styles.orderPreorder}>🕐 Arrive {order.preorderDetails?.pickupTime}</span>
                                                            <span className={styles.orderCustomer}>{order.preorderDetails?.customerName} • {order.preorderDetails?.customerPhone}</span>
                                                        </>
                                                    ) : (
                                                        <span className={styles.orderTable}>Token No {order.tableNumber}</span>
                                                    )}
                                                    <span className={styles.orderTime}>
                                                        {new Date(order.timestamp).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                                                    </span>
                                                </div>
                                                {order.orderType === 'preorder' && (
                                                    <span className={styles.preorderBadge}>PICKUP</span>
                                                )}
                                                <div
                                                    className={styles.statusBadge}
                                                    style={{ backgroundColor: getStatusColor(order.status) }}
                                                >
                                                    {order.status}
                                                </div>
                                            </div>

                                            <div className={styles.orderItems}>
                                                {order.items.map((item, i) => (
                                                    <div key={i} className={styles.orderItem}>
                                                        <span className={styles.qty}>{item.quantity}x</span>
                                                        <span className={styles.name}>{item.menuItem.name}</span>
                                                        {item.selectedAddOns.length > 0 && (
                                                            <span className={styles.addons}>
                                                                +{item.selectedAddOns.map(a => a.name).join(', ')}
                                                            </span>
                                                        )}
                                                    </div>
                                                ))}
                                            </div>

                                            <div className={styles.orderFooter}>
                                                <span className={styles.orderTotal}>₹{order.totalAmount}</span>
                                                <div className={styles.statusButtons}>
                                                    {printAvailable && (
                                                        <>
                                                            <button
                                                                className={styles.statusBtn}
                                                                style={{ background: '#374151' }}
                                                                onClick={() => handlePrintKOT(order)}
                                                                disabled={printingId === order.orderId}
                                                                title={printer.isConnected ? 'Print Kitchen Order Ticket (BLE + ESP)' : 'Print Kitchen Order Ticket (via ESP)'}
                                                            >
                                                                {printingId === order.orderId ? '…' : '🖨 KOT'}
                                                            </button>
                                                            <button
                                                                className={styles.statusBtn}
                                                                style={{ background: '#6b7280' }}
                                                                onClick={() => handlePrintBill(order)}
                                                                disabled={printingId === order.orderId}
                                                                title={printer.isConnected ? 'Print Bill (BLE + ESP)' : 'Print Bill (via ESP)'}
                                                            >
                                                                {printingId === order.orderId ? '…' : '🖨 Bill'}
                                                            </button>
                                                        </>
                                                    )}
                                                    {order.status === 'pending' && (
                                                        <button
                                                            className={styles.statusBtn}
                                                            onClick={() => updateOrderStatus(order.orderId, 'preparing')}
                                                        >
                                                            Start
                                                        </button>
                                                    )}
                                                    {order.status === 'preparing' && (
                                                        <button
                                                            className={styles.statusBtn}
                                                            onClick={() => updateOrderStatus(order.orderId, 'ready')}
                                                        >
                                                            Ready
                                                        </button>
                                                    )}
                                                    {order.status === 'ready' && (
                                                        <button
                                                            className={styles.statusBtn}
                                                            onClick={() => updateOrderStatus(order.orderId, 'delivered')}
                                                        >
                                                            Done
                                                        </button>
                                                    )}
                                                    {order.status === 'delivered' && (
                                                        <button
                                                            className={styles.removeOrderBtn}
                                                            onClick={() => deleteOrder(order.orderId)}
                                                            title="Remove completed order"
                                                            aria-label="Remove completed order"
                                                        >
                                                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 6L6 18M6 6l12 12" /></svg>
                                                        </button>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )
                }

                {/* Menu Tab */}
                {activeTab === 'menu' && (
                    <div className={styles.menuTab}>
                        <div className={styles.menuHeader}>
                            <div className={styles.menuHeaderTop}>
                                <div>
                                    <h2 className={styles.sectionTitle}>Menu Management</h2>
                                    <p className={styles.menuSubtitle}>{activeItems} active • {disabledItems} hidden</p>
                                </div>
                                {menuSubTab === 'items' && (
                                    <button className={styles.addItemBtn} onClick={openAddModal}>
                                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 5v14M5 12h14" /></svg>
                                        Add Item
                                    </button>
                                )}
                                {menuSubTab === 'categories' && (
                                    <button className={styles.addItemBtn} onClick={openAddCatModal}>
                                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 5v14M5 12h14" /></svg>
                                        Add Category
                                    </button>
                                )}
                                {menuSubTab === 'modifiers' && (
                                    <button className={styles.addItemBtn} onClick={openAddModifierGroupModal}>
                                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 5v14M5 12h14" /></svg>
                                        Add Group
                                    </button>
                                )}
                            </div>
                            {/* Sub-tab switcher */}
                            <div className={styles.menuSubTabs}>
                                <button
                                    className={`${styles.menuSubTab} ${menuSubTab === 'items' ? styles.menuSubTabActive : ''}`}
                                    onClick={() => setMenuSubTab('items')}
                                >Items</button>
                                <button
                                    className={`${styles.menuSubTab} ${menuSubTab === 'categories' ? styles.menuSubTabActive : ''}`}
                                    onClick={() => setMenuSubTab('categories')}
                                >Categories</button>
                                <button
                                    className={`${styles.menuSubTab} ${menuSubTab === 'modifiers' ? styles.menuSubTabActive : ''}`}
                                    onClick={() => setMenuSubTab('modifiers')}
                                >Modifiers</button>
                            </div>
                        </div>

                        {menuSubTab === 'items' && (
                            <PricingTable
                                showHeader={false}
                                onToggle={toggleItemAvailability}
                                onEdit={openEditModal}
                                onDelete={handleDeleteConfirm}
                            />
                        )}

                        {menuSubTab === 'categories' && (
                            <div className={styles.menuList}>
                                {categories.map(cat => {
                                    const itemCount = menuItems.filter(i => i.categoryId === cat.id).length;
                                    return (
                                        <div key={cat.id} className={styles.catManageRow}>
                                            <span className={styles.catManageIcon}>{cat.icon}</span>
                                            <div className={styles.catManageInfo}>
                                                <span className={styles.catManageName}>{cat.name}</span>
                                                {cat.tagline && <span className={styles.catManageTagline}>{cat.tagline}</span>}
                                                <span className={styles.catManageCount}>{itemCount} item{itemCount !== 1 ? 's' : ''}</span>
                                            </div>
                                            <div className={styles.itemActionBtns}>
                                                <button className={styles.editBtn} onClick={() => openEditCatModal(cat)} aria-label="Edit category">
                                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
                                                </button>
                                                <button className={styles.deleteBtn} onClick={() => setDeletingCatId(cat.id)} aria-label="Delete category" disabled={itemCount > 0} title={itemCount > 0 ? 'Move items out first' : 'Delete'}>
                                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" /></svg>
                                                </button>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}

                        {menuSubTab === 'modifiers' && (
                            <div className={styles.menuList}>
                                {modifierGroups.length === 0 && (
                                    <p style={{ padding: 24, color: 'var(--color-text-muted)', textAlign: 'center' }}>
                                        No modifier groups yet. Click <strong>Add Group</strong> to create one (e.g. &quot;Paratha add-ons&quot;), then assign it to items in the Items tab.
                                    </p>
                                )}
                                {modifierGroups.map(group => {
                                    const usedBy = itemsUsingGroup(group.id);
                                    return (
                                        <div key={group.id} className={styles.catManageRow}>
                                            <span className={styles.catManageIcon}>{group.type === 'addOn' ? '➕' : '🍽️'}</span>
                                            <div className={styles.catManageInfo}>
                                                <span className={styles.catManageName}>
                                                    {group.name}
                                                    <span style={{ marginLeft: 8, fontSize: '0.75rem', color: 'var(--color-text-muted)', fontWeight: 400 }}>
                                                        {group.type === 'addOn' ? 'Add-on group' : 'Extra group'}
                                                    </span>
                                                </span>
                                                <span className={styles.catManageTagline}>
                                                    {group.modifiers.length === 0 ? 'No modifiers' :
                                                        group.modifiers.map(m => `${m.name} ₹${m.price}`).join(' · ')}
                                                </span>
                                                <span className={styles.catManageCount}>
                                                    Used by {usedBy.length} item{usedBy.length !== 1 ? 's' : ''}
                                                </span>
                                            </div>
                                            <div className={styles.itemActionBtns}>
                                                <button className={styles.editBtn} onClick={() => openEditModifierGroupModal(group)} aria-label="Edit modifier group">
                                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
                                                </button>
                                                <button
                                                    className={styles.deleteBtn}
                                                    onClick={() => setDeletingMgId(group.id)}
                                                    aria-label="Delete modifier group"
                                                >
                                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" /></svg>
                                                </button>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                )}

                {/* Rush Hour Tab */}
                {
                    activeTab === 'rush-hour' && (
                        <div className={styles.rushHourTab}>
                            <div className={styles.rushHourHeader}>
                                <h2 className={styles.sectionTitle}>Rush Hour Settings</h2>
                                <p className={styles.menuSubtitle}>
                                    Select items to pause during rush hours
                                </p>
                            </div>

                            {rushHourMode && (
                                <div className={styles.rushActiveAlert}>
                                    <span>🔥</span>
                                    <div>
                                        <strong>Rush Hour is ACTIVE</strong>
                                        <p>{rushHourItems.length} items are currently hidden</p>
                                    </div>
                                </div>
                            )}

                            {/* Quick Actions */}
                            <div className={styles.quickActions}>
                                <button
                                    className={styles.quickActionBtn}
                                    onClick={handleSelectSlowItems}
                                >
                                    Select Slow Items
                                </button>
                                <button
                                    className={styles.quickActionBtn}
                                    onClick={handleClearAllRushItems}
                                >
                                    Clear All
                                </button>
                            </div>

                            {/* Search */}
                            <div className={styles.searchBar}>
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <circle cx="11" cy="11" r="8" />
                                    <path d="M21 21l-4.35-4.35" />
                                </svg>
                                <input
                                    type="text"
                                    placeholder="Search items..."
                                    value={rushHourSearch}
                                    onChange={(e) => setRushHourSearch(e.target.value)}
                                    className={styles.searchInput}
                                />
                            </div>

                            <div className={styles.rushItemsList}>
                                {filteredRushHourItems.map(item => (
                                    <div
                                        key={item.id}
                                        className={`${styles.rushItem} ${rushHourItems.includes(item.id) ? styles.rushItemSelected : ''}`}
                                        onClick={() => toggleRushHourItem(item.id)}
                                    >
                                        <div className={styles.checkbox}>
                                            {rushHourItems.includes(item.id) && (
                                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                                                    <path d="M20 6L9 17l-5-5" />
                                                </svg>
                                            )}
                                        </div>
                                        <span className={styles.rushItemName}>{item.name}</span>
                                        {item.tags?.includes('readyFast') && (
                                            <span className={styles.tagFast}>Fast</span>
                                        )}
                                    </div>
                                ))}
                            </div>

                            <div className={styles.rushFooter}>
                                <span>{rushHourItems.length} items selected</span>
                                <button
                                    className={`${styles.rushActivateBtn} ${rushHourMode ? styles.rushDeactivateBtn : ''}`}
                                    onClick={handleToggleRushHour}
                                >
                                    {rushHourMode ? 'End Rush Hour' : 'Start Rush Hour'}
                                </button>
                            </div>
                        </div>
                    )
                }

                {/* WhatsApp Tab */}
                {activeTab === 'whatsapp' && (
                    <div className={styles.waTab}>
                        <div className={styles.waHeader}>
                            <h2 className={styles.sectionTitle}>WhatsApp Notifications</h2>
                            <p className={styles.menuSubtitle}>Connect WhatsApp Web to send order updates to customers automatically.</p>
                        </div>

                        {/* Status card */}
                        <div className={styles.waStatusCard}>
                            <div className={styles.waStatusRow}>
                                <span className={`${styles.waStatusDot} ${styles[`waDot_${waStatus}`]}`} />
                                <span className={styles.waStatusLabel}>
                                    {waStatus === 'ready' && `Connected${waInfo?.name ? ` as ${waInfo.name}` : ''}${waInfo?.phone ? ` (+${waInfo.phone})` : ''}`}
                                    {waStatus === 'qr' && 'Scan QR code with WhatsApp'}
                                    {waStatus === 'connecting' && 'Connecting…'}
                                    {waStatus === 'disconnected' && 'Not connected'}
                                </span>
                            </div>

                            {waStatus === 'ready' && (
                                <button className={styles.waLogoutBtn} onClick={handleWaLogout}>Disconnect</button>
                            )}
                            {waStatus === 'disconnected' && (
                                <button className={styles.waConnectBtn} onClick={handleWaConnect}>Connect</button>
                            )}
                            {waStatus === 'connecting' && (
                                <button className={styles.waConnectBtn} onClick={fetchWaQr}>Refresh QR</button>
                            )}
                        </div>

                        {/* QR code */}
                        {(waStatus === 'qr' || waStatus === 'connecting') && waQr && (
                            <div className={styles.waQrCard}>
                                <p className={styles.waQrInstructions}>
                                    Open WhatsApp → Linked Devices → Link a device → scan this code
                                </p>
                                <img src={waQr} alt="WhatsApp QR Code" className={styles.waQrImage} />
                                <p className={styles.waQrHint}>QR refreshes automatically every 3 seconds</p>
                            </div>
                        )}

                        {waStatus === 'ready' && (
                            <div className={styles.waReadyInfo}>
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" style={{ color: '#25D366', flexShrink: 0 }}>
                                    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                                </svg>
                                <div>
                                    <p style={{ fontWeight: 600, marginBottom: 4 }}>Notifications active</p>
                                    <p style={{ fontSize: '0.875rem', color: '#666' }}>
                                        Customers who provide their number will receive order confirmations and status updates automatically.
                                    </p>
                                </div>
                            </div>
                        )}

                        {/* Payments toggle — when off, customers pay at the counter */}
                        <div className={styles.waInstructions}>
                            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
                                <div style={{ flex: 1 }}>
                                    <h3 style={{ marginBottom: 4 }}>Online Payments</h3>
                                    <p style={{ fontSize: '0.875rem', color: '#666', margin: 0 }}>
                                        {paymentsEnabled
                                            ? 'Customers pay via Cashfree before order is placed.'
                                            : 'Counter mode — customers place orders directly and pay at the counter. Turn this on after Cashfree registration is complete.'}
                                    </p>
                                </div>
                                <button
                                    type="button"
                                    role="switch"
                                    aria-checked={paymentsEnabled}
                                    onClick={() => setPaymentsEnabled(!paymentsEnabled)}
                                    style={{
                                        position: 'relative',
                                        width: 52,
                                        height: 28,
                                        flexShrink: 0,
                                        borderRadius: 999,
                                        border: 'none',
                                        cursor: 'pointer',
                                        background: paymentsEnabled ? 'var(--color-primary, #1a4d2e)' : '#ccc',
                                        transition: 'background 0.15s',
                                    }}
                                >
                                    <span style={{
                                        position: 'absolute',
                                        top: 2,
                                        left: paymentsEnabled ? 26 : 2,
                                        width: 24,
                                        height: 24,
                                        borderRadius: '50%',
                                        background: '#fff',
                                        transition: 'left 0.15s',
                                        boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                                    }} />
                                </button>
                            </div>
                        </div>

                        {/* Bluetooth printer */}
                        <PrinterPanel
                            restaurantName={restaurantName}
                            className={styles.waInstructions}
                            kotCopies={kotCopies}
                            billCopies={billCopies}
                            onCopiesChange={setPrintCopies}
                            autoPrintOrders={autoPrintOrders}
                            onAutoPrintChange={setAutoPrintOrders}
                            onPrintStats={() => printer.printStats(orders, restaurantName)}
                        />

                        {/* Branding */}
                        <div className={styles.waInstructions}>
                            <h3>Restaurant Name &amp; Tagline</h3>
                            <p style={{ fontSize: '0.875rem', color: '#666', marginBottom: 12 }}>
                                Shown across all pages — menu, tracking, table screen, etc.
                            </p>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                                <input
                                    type="text"
                                    value={brandingName}
                                    onChange={e => setBrandingName(e.target.value)}
                                    placeholder="Restaurant name"
                                    style={{ padding: '10px 14px', borderRadius: 8, border: '1px solid #ddd', fontSize: '1rem', width: '100%' }}
                                />
                                <input
                                    type="text"
                                    value={brandingTagline}
                                    onChange={e => setBrandingTagline(e.target.value)}
                                    placeholder="Tagline (e.g. 100% Pure Veg)"
                                    style={{ padding: '10px 14px', borderRadius: 8, border: '1px solid #ddd', fontSize: '1rem', width: '100%' }}
                                />
                                <div>
                                    <label style={{ fontSize: '0.8rem', color: '#555', display: 'block', marginBottom: 4 }}>
                                        Legal / Registered Business Name
                                    </label>
                                    <input
                                        type="text"
                                        value={brandingLegalName}
                                        onChange={e => setBrandingLegalName(e.target.value)}
                                        placeholder="Exact name on GST / business registration"
                                        style={{ padding: '10px 14px', borderRadius: 8, border: '1px solid #ddd', fontSize: '1rem', width: '100%' }}
                                    />
                                    <p style={{ fontSize: '0.75rem', color: '#999', margin: '4px 0 0' }}>
                                        Required by Cashfree for compliance. Not shown to customers.
                                    </p>
                                </div>
                                <button
                                    className={styles.waConnectBtn}
                                    onClick={handleBrandingSave}
                                    disabled={brandingSaving || !brandingName.trim()}
                                    style={{ alignSelf: 'flex-start' }}
                                >
                                    {brandingSaving ? 'Saving…' : brandingSaved ? 'Saved!' : 'Save'}
                                </button>
                            </div>
                        </div>

                        {/* Environment / Payment Settings */}
                        <div className={styles.waInstructions}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                                <h3 style={{ margin: 0 }}>Payment &amp; App Settings</h3>
                                <button
                                    className={styles.waConnectBtn}
                                    style={{ fontSize: '0.8rem', padding: '6px 14px' }}
                                    onClick={async () => {
                                        if (!envLoaded) await fetchEnvSettings();
                                        setEnvOpen(v => !v);
                                    }}
                                >
                                    {envOpen ? 'Hide' : 'Edit'}
                                </button>
                            </div>
                            <p style={{ fontSize: '0.875rem', color: '#666', marginBottom: 8 }}>
                                Cashfree credentials, admin password, and base URL. Saved to <code>.env.local</code> on disk.
                            </p>
                            {envOpen && (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 12 }}>
                                    {([
                                        { key: 'ADMIN_PASSWORD', label: 'Admin Password', type: 'password' },
                                        { key: 'NEXT_PUBLIC_BASE_URL', label: 'App Base URL', type: 'text' },
                                        { key: 'CASHFREE_APP_ID', label: 'Cashfree App ID', type: 'text' },
                                        { key: 'CASHFREE_SECRET_KEY', label: 'Cashfree Secret Key', type: 'password' },
                                        { key: 'CASHFREE_ENV', label: 'Cashfree Env (sandbox / production)', type: 'text' },
                                    ] as { key: keyof EnvFields; label: string; type: string }[]).map(({ key, label, type }) => (
                                        <div key={key}>
                                            <label style={{ fontSize: '0.8rem', color: '#555', display: 'block', marginBottom: 4 }}>{label}</label>
                                            <input
                                                type={type}
                                                value={envFields[key]}
                                                onChange={e => setEnvFields(prev => ({ ...prev, [key]: e.target.value }))}
                                                placeholder={label}
                                                style={{ padding: '10px 14px', borderRadius: 8, border: '1px solid #ddd', fontSize: '0.9rem', width: '100%' }}
                                            />
                                        </div>
                                    ))}
                                    <button
                                        className={styles.waConnectBtn}
                                        onClick={handleEnvSave}
                                        disabled={envSaving}
                                        style={{ alignSelf: 'flex-start' }}
                                    >
                                        {envSaving ? 'Saving…' : envSaved ? 'Saved! (restart app to apply)' : 'Save Settings'}
                                    </button>
                                </div>
                            )}
                        </div>

                        {/* Data Export */}
                        <div className={styles.waInstructions}>
                            <h3>Export Data</h3>
                            <p style={{ fontSize: '0.875rem', color: '#666', marginBottom: 12 }}>
                                Download all orders, menu, and settings as a single file.
                            </p>
                            <div style={{ display: 'flex', gap: 8 }}>
                                <button className={styles.waConnectBtn} onClick={() => handleExport('json')}>
                                    Download JSON
                                </button>
                                <button className={styles.waConnectBtn} onClick={() => handleExport('csv')}>
                                    Download CSV (orders)
                                </button>
                            </div>
                        </div>

                        {/* WA Logs */}
                        <div className={styles.waInstructions}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                                <h3 style={{ margin: 0 }}>Service Logs</h3>
                                <button
                                    className={styles.waConnectBtn}
                                    style={{ fontSize: '0.8rem', padding: '6px 14px' }}
                                    onClick={async () => {
                                        await fetchWaLogs();
                                        setWaLogsOpen(v => !v);
                                    }}
                                >
                                    {waLogsOpen ? 'Hide Logs' : 'View Logs'}
                                </button>
                            </div>
                            {waLogsOpen && (
                                <pre style={{
                                    background: '#111', color: '#d4f4d4', borderRadius: 8,
                                    padding: '12px 16px', fontSize: '0.75rem', overflowX: 'auto',
                                    maxHeight: 320, overflowY: 'auto', whiteSpace: 'pre-wrap',
                                    wordBreak: 'break-all', marginTop: 8,
                                }}>
                                    {waLogs}
                                </pre>
                            )}
                        </div>

                        <div className={styles.waInstructions}>
                            <h3>How it works</h3>
                            <ol>
                                <li>Run <code>./install.sh</code> on the server — it sets up everything automatically</li>
                                <li>Or manually: <code>pm2 start ecosystem.config.js</code> from the project root</li>
                                <li>Click <strong>Connect</strong> above and scan the QR with your WhatsApp</li>
                                <li>Customers enter their phone number at checkout (optional)</li>
                                <li>They automatically receive order confirmation and status updates</li>
                            </ol>
                        </div>
                    </div>
                )}

                {/* Analytics Tab */}
            </div >

            {/* Add/Edit Item Modal */}
            {
                showModal && (
                    <div className={styles.modalOverlay} onClick={closeModal}>
                        <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
                            <div className={styles.modalHeader}>
                                <h2 className={styles.modalTitle}>
                                    {editingItemId ? 'Edit Menu Item' : 'Add New Menu Item'}
                                </h2>
                                <button className={styles.modalClose} onClick={closeModal}>✕</button>
                            </div>

                            <div className={styles.modalBody}>
                                {/* Image Preview */}
                                {formData.image && (
                                    <div className={styles.imagePreview}>
                                        <img src={formData.image} alt="Preview" />
                                    </div>
                                )}

                                <div className={styles.formGroup}>
                                    <label className={styles.formLabel}>Name *</label>
                                    <input
                                        type="text"
                                        className={styles.formInput}
                                        value={formData.name}
                                        onChange={(e) => handleFormChange('name', e.target.value)}
                                        placeholder="e.g. Cheese Paratha"
                                    />
                                </div>

                                <div className={styles.formGroup}>
                                    <label className={styles.formLabel}>Description</label>
                                    <textarea
                                        className={styles.formTextarea}
                                        value={formData.description}
                                        onChange={(e) => handleFormChange('description', e.target.value)}
                                        placeholder="A short description of the dish..."
                                        rows={3}
                                    />
                                </div>

                                <div className={styles.formRow}>
                                    <div className={styles.formGroup}>
                                        <label className={styles.formLabel}>Price (₹) *</label>
                                        <input
                                            type="number"
                                            className={styles.formInput}
                                            value={formData.price}
                                            onChange={(e) => handleFormChange('price', e.target.value)}
                                            placeholder="e.g. 80"
                                            min="1"
                                        />
                                    </div>
                                    <div className={styles.formGroup}>
                                        <label className={styles.formLabel}>Category *</label>
                                        <select
                                            className={styles.formSelect}
                                            value={formData.categoryId}
                                            onChange={(e) => handleFormChange('categoryId', e.target.value)}
                                        >
                                            <option value="">Select category</option>
                                            {categories.map(cat => (
                                                <option key={cat.id} value={cat.id}>{cat.icon} {cat.name}</option>
                                            ))}
                                        </select>
                                    </div>
                                </div>

                                <div className={styles.formGroup}>
                                    <label className={styles.formLabel}>Image</label>

                                    {/* Upload Button */}
                                    <div className={styles.imageUploadArea}>
                                        <input
                                            type="file"
                                            ref={fileInputRef}
                                            accept="image/png,image/jpeg,image/webp,image/gif"
                                            style={{ display: 'none' }}
                                            onChange={(e) => {
                                                const file = e.target.files?.[0];
                                                if (file) handleImageUpload(file);
                                                e.target.value = ''; // Reset so same file can be re-selected
                                            }}
                                        />
                                        <button
                                            type="button"
                                            className={styles.uploadBtn}
                                            onClick={() => fileInputRef.current?.click()}
                                            disabled={isUploading}
                                        >
                                            {isUploading ? (
                                                <>
                                                    <span className={styles.uploadSpinner} />
                                                    Uploading...
                                                </>
                                            ) : (
                                                <>
                                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                                                        <polyline points="17 8 12 3 7 8" />
                                                        <line x1="12" y1="3" x2="12" y2="15" />
                                                    </svg>
                                                    Upload from Device
                                                </>
                                            )}
                                        </button>
                                        <span className={styles.uploadDivider}>or choose existing</span>
                                    </div>

                                    {/* Existing Dropdown */}
                                    <select
                                        className={styles.formSelect}
                                        value={formData.image && !formData.image.startsWith('http') ? formData.image.replace('/menu-images/', '') : ''}
                                        onChange={(e) => handleFormChange('image', e.target.value ? `/menu-images/${e.target.value}` : '')}
                                    >
                                        <option value="">Select from library</option>
                                        {AVAILABLE_IMAGES.map(img => (
                                            <option key={img} value={img}>
                                                {img.replace('.png', '').replace(/-/g, ' ')}
                                            </option>
                                        ))}
                                    </select>

                                    {/* URL input for pasted links */}
                                    <input
                                        type="text"
                                        className={styles.formInput}
                                        value={formData.image.startsWith('http') ? formData.image : ''}
                                        onChange={(e) => handleFormChange('image', e.target.value)}
                                        placeholder="Or paste image URL here..."
                                        style={{ marginTop: '8px', fontSize: '13px' }}
                                    />
                                </div>

                                <div className={styles.formGroup}>
                                    <label className={styles.formLabel}>Tags</label>
                                    <div className={styles.tagCheckboxes}>
                                        <label className={styles.tagCheckbox}>
                                            <input
                                                type="checkbox"
                                                checked={formData.tags.includes('bestSeller')}
                                                onChange={() => handleTagToggle('bestSeller')}
                                            />
                                            <span className={styles.tagBestseller}>⭐ Best Seller</span>
                                        </label>
                                        <label className={styles.tagCheckbox}>
                                            <input
                                                type="checkbox"
                                                checked={formData.tags.includes('readyFast')}
                                                onChange={() => handleTagToggle('readyFast')}
                                            />
                                            <span className={styles.tagFast}>⚡ Ready Fast</span>
                                        </label>
                                    </div>
                                </div>

                                <div className={styles.formGroup}>
                                    <label className={styles.formLabel}>Availability</label>
                                    <div className={styles.availabilityToggle}>
                                        <button
                                            className={`${styles.toggle} ${formData.isAvailable ? styles.toggleActive : ''}`}
                                            onClick={() => handleFormChange('isAvailable', !formData.isAvailable)}
                                            type="button"
                                        >
                                            <div className={styles.toggleThumb} />
                                        </button>
                                        <span>{formData.isAvailable ? 'Available' : 'Hidden'}</span>
                                    </div>
                                </div>
                            </div>

                            <div className={styles.modalFooter}>
                                <button className={styles.modalCancelBtn} onClick={closeModal}>
                                    Cancel
                                </button>
                                <button
                                    className={styles.modalSaveBtn}
                                    onClick={handleFormSubmit}
                                    disabled={!formData.name.trim() || !formData.price || !formData.categoryId}
                                >
                                    {editingItemId ? 'Save Changes' : 'Add Item'}
                                </button>
                            </div>
                        </div>
                    </div>
                )
            }

            {/* Category Add/Edit Modal */}
            {showCatModal && (
                <div className={styles.modalOverlay} onClick={() => setShowCatModal(false)}>
                    <div className={styles.modal} onClick={e => e.stopPropagation()}>
                        <div className={styles.modalHeader}>
                            <h2 className={styles.modalTitle}>{editingCatId ? 'Edit Category' : 'Add Category'}</h2>
                            <button className={styles.modalClose} onClick={() => setShowCatModal(false)}>✕</button>
                        </div>
                        <div className={styles.modalBody}>
                            <div className={styles.formRow}>
                                <div className={styles.formGroup} style={{ flex: '0 0 80px' }}>
                                    <label className={styles.formLabel}>Icon</label>
                                    <input type="text" className={styles.formInput} value={catForm.icon} onChange={e => setCatForm(p => ({ ...p, icon: e.target.value }))} placeholder="🍽️" style={{ fontSize: '1.4rem', textAlign: 'center' }} />
                                </div>
                                <div className={styles.formGroup}>
                                    <label className={styles.formLabel}>Name *</label>
                                    <input type="text" className={styles.formInput} value={catForm.name} onChange={e => setCatForm(p => ({ ...p, name: e.target.value }))} placeholder="e.g. Parathas" />
                                </div>
                            </div>
                            <div className={styles.formGroup}>
                                <label className={styles.formLabel}>Tagline</label>
                                <input type="text" className={styles.formInput} value={catForm.tagline} onChange={e => setCatForm(p => ({ ...p, tagline: e.target.value }))} placeholder="Optional subtitle" />
                            </div>
                        </div>
                        <div className={styles.modalFooter}>
                            <button className={styles.modalCancelBtn} onClick={() => setShowCatModal(false)}>Cancel</button>
                            <button className={styles.modalSaveBtn} onClick={handleCatFormSubmit} disabled={!catForm.name.trim() || !catForm.icon.trim()}>
                                {editingCatId ? 'Save Changes' : 'Add Category'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Category Delete Confirmation */}
            {deletingCatId && (
                <div className={styles.modalOverlay} onClick={() => setDeletingCatId(null)}>
                    <div className={styles.deleteModal} onClick={e => e.stopPropagation()}>
                        <div className={styles.deleteModalIcon}>
                            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#e53935" strokeWidth="2"><path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" /></svg>
                        </div>
                        <h3 className={styles.deleteModalTitle}>Delete Category?</h3>
                        <p className={styles.deleteModalText}>Delete <strong>{categories.find(c => c.id === deletingCatId)?.name}</strong>? This cannot be undone.</p>
                        <div className={styles.deleteModalActions}>
                            <button className={styles.modalCancelBtn} onClick={() => setDeletingCatId(null)}>Keep It</button>
                            <button className={styles.deleteConfirmBtn} onClick={() => { deleteCategory(deletingCatId!); setDeletingCatId(null); }}>Delete</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Modifier Group Edit Modal */}
            {showMgModal && (
                <div className={styles.modalOverlay} onClick={() => setShowMgModal(false)}>
                    <div className={styles.modal} onClick={e => e.stopPropagation()}>
                        <div className={styles.modalHeader}>
                            <h2 className={styles.modalTitle}>{mgForm.id ? 'Edit Modifier Group' : 'New Modifier Group'}</h2>
                            <button className={styles.modalCloseBtn} onClick={() => setShowMgModal(false)} aria-label="Close">
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" /></svg>
                            </button>
                        </div>
                        <div className={styles.modalBody}>
                            <div className={styles.formGroup}>
                                <label className={styles.formLabel}>Group name</label>
                                <input
                                    type="text"
                                    className={styles.formInput}
                                    value={mgForm.name}
                                    onChange={e => setMgForm(prev => ({ ...prev, name: e.target.value }))}
                                    placeholder="e.g. Paratha add-ons"
                                />
                            </div>
                            <div className={styles.formGroup}>
                                <label className={styles.formLabel}>Type</label>
                                <select
                                    className={styles.formInput}
                                    value={mgForm.type}
                                    onChange={e => setMgForm(prev => ({ ...prev, type: e.target.value as 'addOn' | 'extra' }))}
                                    disabled={!!mgForm.id}
                                >
                                    <option value="addOn">Add-on (modifies the item)</option>
                                    <option value="extra">Extra (sold alongside)</option>
                                </select>
                                {mgForm.id && (
                                    <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                                        Type can&apos;t be changed after creation. Delete and recreate if needed.
                                    </span>
                                )}
                            </div>
                            <div className={styles.formGroup}>
                                <label className={styles.formLabel}>Modifiers</label>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                    {mgForm.modifiers.length === 0 && (
                                        <p style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>
                                            No modifiers yet. Click <strong>+ Add modifier</strong> below.
                                        </p>
                                    )}
                                    {mgForm.modifiers.map((m, idx) => (
                                        <div key={idx} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                                            <input
                                                type="text"
                                                className={styles.formInput}
                                                style={{ flex: 1 }}
                                                value={m.name}
                                                onChange={e => mgFormUpdateRow(idx, 'name', e.target.value)}
                                                placeholder="Name (e.g. Butter)"
                                            />
                                            <span style={{ color: 'var(--color-text-muted)' }}>₹</span>
                                            <input
                                                type="number"
                                                min="0"
                                                className={styles.formInput}
                                                style={{ width: 80 }}
                                                value={m.price}
                                                onChange={e => mgFormUpdateRow(idx, 'price', e.target.value)}
                                                placeholder="0"
                                            />
                                            <button
                                                type="button"
                                                className={styles.deleteBtn}
                                                onClick={() => mgFormRemoveRow(idx)}
                                                aria-label="Remove modifier"
                                                style={{ flexShrink: 0 }}
                                            >
                                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" /></svg>
                                            </button>
                                        </div>
                                    ))}
                                    <button
                                        type="button"
                                        className={styles.modalCancelBtn}
                                        onClick={mgFormAddRow}
                                        style={{ alignSelf: 'flex-start', marginTop: 4 }}
                                    >
                                        + Add modifier
                                    </button>
                                </div>
                            </div>
                        </div>
                        <div className={styles.modalActions}>
                            <button className={styles.modalCancelBtn} onClick={() => setShowMgModal(false)}>Cancel</button>
                            <button className={styles.modalSaveBtn} onClick={handleMgFormSubmit} disabled={!mgForm.name.trim()}>
                                {mgForm.id ? 'Save Changes' : 'Create Group'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Modifier Group Delete Confirmation */}
            {deletingMgId && (() => {
                const group = modifierGroups.find(g => g.id === deletingMgId);
                const usedBy = itemsUsingGroup(deletingMgId);
                return (
                    <div className={styles.modalOverlay} onClick={() => setDeletingMgId(null)}>
                        <div className={styles.deleteModal} onClick={e => e.stopPropagation()}>
                            <div className={styles.deleteModalIcon}>
                                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#e53935" strokeWidth="2"><path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" /></svg>
                            </div>
                            <h3 className={styles.deleteModalTitle}>Delete Modifier Group?</h3>
                            <p className={styles.deleteModalText}>
                                Delete <strong>{group?.name}</strong>?
                                {usedBy.length > 0 && (
                                    <> It&apos;s currently assigned to <strong>{usedBy.length} item{usedBy.length !== 1 ? 's' : ''}</strong>; they&apos;ll lose these modifiers.</>
                                )}
                            </p>
                            <div className={styles.deleteModalActions}>
                                <button className={styles.modalCancelBtn} onClick={() => setDeletingMgId(null)}>Keep It</button>
                                <button className={styles.deleteConfirmBtn} onClick={() => { deleteModifierGroup(deletingMgId); setDeletingMgId(null); }}>Delete</button>
                            </div>
                        </div>
                    </div>
                );
            })()}

            {/* Delete Confirmation Modal */}
            {
                deletingItemId && (
                    <div className={styles.modalOverlay} onClick={handleDeleteCancel}>
                        <div className={styles.deleteModal} onClick={(e) => e.stopPropagation()}>
                            <div className={styles.deleteModalIcon}>
                                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#e53935" strokeWidth="2">
                                    <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                                    <line x1="10" y1="11" x2="10" y2="17" />
                                    <line x1="14" y1="11" x2="14" y2="17" />
                                </svg>
                            </div>
                            <h3 className={styles.deleteModalTitle}>Delete Item?</h3>
                            <p className={styles.deleteModalText}>
                                Are you sure you want to delete <strong>{menuItems.find(i => i.id === deletingItemId)?.name}</strong>? This action cannot be undone.
                            </p>
                            <div className={styles.deleteModalActions}>
                                <button className={styles.modalCancelBtn} onClick={handleDeleteCancel}>
                                    Keep It
                                </button>
                                <button className={styles.deleteConfirmBtn} onClick={handleDeleteExecute}>
                                    Delete
                                </button>
                            </div>
                        </div>
                    </div>
                )
            }
        </div >
    );
}
