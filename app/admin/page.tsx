'use client';

import React, { useState, useMemo, useRef } from 'react';
import Link from 'next/link';
import { useMenu, Order } from '@/lib/menuContext';
import { MenuItem } from '@/lib/menuData';
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
        orders,
        rushHourMode,
        rushHourItems,
        toggleItemAvailability,
        updateItemPrice,
        addMenuItem,
        updateMenuItem,
        deleteMenuItem,
        setRushHourMode,
        toggleRushHourItem,
        setRushHourItems,
        updateOrderStatus
    } = useMenu();

    const [activeTab, setActiveTab] = useState<'orders' | 'menu' | 'rush-hour'>('orders');
    const [selectedCategory, setSelectedCategory] = useState('all');
    const [editingPrice, setEditingPrice] = useState<string | null>(null);
    const [newPrice, setNewPrice] = useState('');
    const [menuSearch, setMenuSearch] = useState('');
    const [rushHourSearch, setRushHourSearch] = useState('');

    // Modal state
    const [showModal, setShowModal] = useState(false);
    const [editingItemId, setEditingItemId] = useState<string | null>(null);
    const [formData, setFormData] = useState<ItemFormData>(defaultFormData);

    // Delete confirmation state
    const [deletingItemId, setDeletingItemId] = useState<string | null>(null);

    // Image upload state
    const [isUploading, setIsUploading] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

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

    // Filter menu items based on category and search
    const filteredMenuItems = useMemo(() => {
        let items = menuItems;

        if (selectedCategory !== 'all') {
            items = items.filter(item => item.categoryId === selectedCategory);
        }

        if (menuSearch.trim()) {
            const query = menuSearch.toLowerCase();
            items = items.filter(item =>
                item.name.toLowerCase().includes(query) ||
                item.description.toLowerCase().includes(query)
            );
        }

        return items;
    }, [menuItems, selectedCategory, menuSearch]);

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

    const handlePriceEdit = (itemId: string, currentPrice: number) => {
        setEditingPrice(itemId);
        setNewPrice(currentPrice.toString());
    };

    const handlePriceSave = (itemId: string) => {
        const price = parseInt(newPrice);
        if (!isNaN(price) && price > 0) {
            updateItemPrice(itemId, price);
        }
        setEditingPrice(null);
        setNewPrice('');
    };

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
            <header className={styles.header}>
                <div className={styles.headerLeft}>
                    <Link href="/" className={styles.backLink}>← Home</Link>
                    <Link href="/" className={styles.logoLink}>
                        <img src="/logo.png" alt="Rocky Da Adda" className={styles.logo} />
                    </Link>
                    <span className={styles.adminBadge}>Admin</span>
                    <Link href="/kitchen" className={styles.adminBadge} style={{ backgroundColor: '#ff9800', cursor: 'pointer' }}>
                        🍳 Kitchen
                    </Link>
                </div>
                <div className={styles.rushHourToggle}>
                    <Link href="/admin/pricing" style={{
                        marginRight: '8px',
                        padding: '6px 12px',
                        backgroundColor: '#5F259F',
                        color: 'white',
                        borderRadius: '6px',
                        textDecoration: 'none',
                        fontSize: '14px',
                        fontWeight: 600,
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px'
                    }}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z" fill="currentColor" stroke="none" />
                        </svg>
                        Pricing
                    </Link>
                    <Link href="/admin/analytics" className={styles.analyticsBtn} style={{
                        marginRight: '15px',
                        padding: '6px 12px',
                        backgroundColor: 'var(--color-primary)',
                        color: 'white',
                        borderRadius: '6px',
                        textDecoration: 'none',
                        fontSize: '14px',
                        fontWeight: 600,
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px'
                    }}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M18 20V10M12 20V4M6 20v-6" />
                        </svg>
                        Analytics
                    </Link>

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
                {
                    activeTab === 'menu' && (
                        <div className={styles.menuTab}>
                            <div className={styles.menuHeader}>
                                <div className={styles.menuHeaderTop}>
                                    <div>
                                        <h2 className={styles.sectionTitle}>Menu Management</h2>
                                        <p className={styles.menuSubtitle}>
                                            {activeItems} active • {disabledItems} hidden
                                        </p>
                                    </div>
                                    <button className={styles.addItemBtn} onClick={openAddModal}>
                                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                            <path d="M12 5v14M5 12h14" />
                                        </svg>
                                        Add Item
                                    </button>
                                </div>
                            </div>

                            {/* Search Bar */}
                            <div className={styles.searchBar}>
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <circle cx="11" cy="11" r="8" />
                                    <path d="M21 21l-4.35-4.35" />
                                </svg>
                                <input
                                    type="text"
                                    placeholder="Search menu items..."
                                    value={menuSearch}
                                    onChange={(e) => setMenuSearch(e.target.value)}
                                    className={styles.searchInput}
                                />
                                {menuSearch && (
                                    <button
                                        className={styles.clearBtn}
                                        onClick={() => setMenuSearch('')}
                                    >
                                        ✕
                                    </button>
                                )}
                            </div>

                            <div className={styles.categorySelect}>
                                <select
                                    value={selectedCategory}
                                    onChange={(e) => setSelectedCategory(e.target.value)}
                                    className={styles.select}
                                >
                                    <option value="all">All Categories</option>
                                    {categories.map(cat => (
                                        <option key={cat.id} value={cat.id}>{cat.icon} {cat.name}</option>
                                    ))}
                                </select>
                            </div>

                            <div className={styles.menuList}>
                                {filteredMenuItems.length === 0 ? (
                                    <div className={styles.noResults}>No items found</div>
                                ) : (
                                    filteredMenuItems.map(item => (
                                        <div key={item.id} className={`${styles.menuItem} ${!item.isAvailable ? styles.menuItemDisabled : ''}`}>
                                            <div className={styles.menuItemLeft}>
                                                <button
                                                    className={`${styles.toggle} ${item.isAvailable ? styles.toggleActive : ''}`}
                                                    onClick={() => toggleItemAvailability(item.id)}
                                                    aria-label={item.isAvailable ? 'Disable item' : 'Enable item'}
                                                >
                                                    <div className={styles.toggleThumb} />
                                                </button>
                                            </div>
                                            {item.image && (
                                                <img
                                                    src={item.image}
                                                    alt={item.name}
                                                    className={styles.menuItemImage}
                                                />
                                            )}
                                            <div className={styles.menuItemInfo}>
                                                <div className={styles.menuItemHeader}>
                                                    <span className={styles.menuItemName}>{item.name}</span>
                                                    {item.tags?.includes('bestSeller') && (
                                                        <span className={styles.tagBestseller}>Best</span>
                                                    )}
                                                    {item.tags?.includes('readyFast') && (
                                                        <span className={styles.tagFast}>Fast</span>
                                                    )}
                                                </div>
                                                <span className={styles.menuItemCategory}>
                                                    {categories.find(c => c.id === item.categoryId)?.icon}{' '}
                                                    {categories.find(c => c.id === item.categoryId)?.name}
                                                </span>
                                            </div>
                                            <div className={styles.menuItemActions}>
                                                <div className={styles.menuItemPrice}>
                                                    {editingPrice === item.id ? (
                                                        <div className={styles.priceEdit}>
                                                            <input
                                                                type="number"
                                                                value={newPrice}
                                                                onChange={(e) => setNewPrice(e.target.value)}
                                                                className={styles.priceInput}
                                                                autoFocus
                                                                onKeyDown={(e) => e.key === 'Enter' && handlePriceSave(item.id)}
                                                            />
                                                            <button
                                                                className={styles.priceSaveBtn}
                                                                onClick={() => handlePriceSave(item.id)}
                                                            >
                                                                ✓
                                                            </button>
                                                        </div>
                                                    ) : (
                                                        <button
                                                            className={styles.priceBtn}
                                                            onClick={() => handlePriceEdit(item.id, item.price)}
                                                        >
                                                            ₹{item.price}
                                                        </button>
                                                    )}
                                                </div>
                                                <div className={styles.itemActionBtns}>
                                                    <button
                                                        className={styles.editBtn}
                                                        onClick={() => openEditModal(item)}
                                                        aria-label="Edit item"
                                                    >
                                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                                            <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                                                            <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
                                                        </svg>
                                                    </button>
                                                    <button
                                                        className={styles.deleteBtn}
                                                        onClick={() => handleDeleteConfirm(item.id)}
                                                        aria-label="Delete item"
                                                    >
                                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                                            <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                                                        </svg>
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                    ))
                                )}
                            </div>
                        </div>
                    )
                }

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
