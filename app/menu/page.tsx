'use client';

import React, { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import Header from '@/components/Header';
import ItemSheet from '@/components/ItemSheet';
import { MenuItem } from '@/lib/menuData';
import { useCart } from '@/lib/cartContext';
import { useMenu } from '@/lib/menuContext';
import styles from './page.module.css';

export default function MenuPage() {
    const router = useRouter();
    const { tableNumber, totalItems, totalAmount, orderType, preorderDetails } = useCart();
    const { menuItems, categories } = useMenu();
    const [activeCategory, setActiveCategory] = useState('all');
    const [selectedItem, setSelectedItem] = useState<MenuItem | null>(null);
    const [isSheetOpen, setIsSheetOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [mounted, setMounted] = useState(false);
    useEffect(() => { setMounted(true); }, []);

    // Redirect if no table number (only for dine-in and if NOT a preorder)
    useEffect(() => {
        // If we have preorder details, we are definitely in preorder mode, so don't redirect
        if (preorderDetails) return;

        if (!tableNumber && orderType === 'dine-in') {
            router.push('/table');
        }
    }, [tableNumber, orderType, preorderDetails, router]);

    const handleItemClick = (item: MenuItem) => {
        if (!item.isAvailable) return;
        setSelectedItem(item);
        setIsSheetOpen(true);
    };

    // Filter items based on category and search
    const getFilteredItems = () => {
        let filtered = menuItems.filter(item => item.isAvailable);

        if (activeCategory !== 'all') {
            filtered = filtered.filter(item => item.categoryId === activeCategory);
        }

        if (searchQuery.trim()) {
            const query = searchQuery.toLowerCase();
            filtered = filtered.filter(item =>
                item.name.toLowerCase().includes(query) ||
                item.description.toLowerCase().includes(query)
            );
        }

        return filtered;
    };

    const filteredItems = getFilteredItems();

    return (
        <div className={styles.container}>
            <Header />

            {/* Search Bar */}
            <div className={styles.searchSection}>
                <div className={styles.searchBar}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="11" cy="11" r="8" />
                        <path d="M21 21l-4.35-4.35" />
                    </svg>
                    <input
                        type="text"
                        placeholder="Search for dishes..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className={styles.searchInput}
                    />
                    {searchQuery && (
                        <button
                            className={styles.clearSearch}
                            onClick={() => setSearchQuery('')}
                        >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <line x1="18" y1="6" x2="6" y2="18" />
                                <line x1="6" y1="6" x2="18" y2="18" />
                            </svg>
                        </button>
                    )}
                </div>
            </div>

            {/* Category Pills */}
            <div className={styles.categoryNav}>
                <div className={styles.categoryScroll}>
                    <button
                        className={`${styles.categoryPill} ${activeCategory === 'all' ? styles.active : ''}`}
                        onClick={() => setActiveCategory('all')}
                    >
                        All
                    </button>
                    {categories.map(category => (
                        <button
                            key={category.id}
                            className={`${styles.categoryPill} ${activeCategory === category.id ? styles.active : ''}`}
                            onClick={() => setActiveCategory(category.id)}
                        >
                            {category.name.split(' ')[0]}
                        </button>
                    ))}
                </div>
            </div>

            {/* Menu Grid */}
            <div className={styles.menuContent}>
                {filteredItems.length === 0 ? (
                    <div className={styles.emptyState}>
                        <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                            <circle cx="11" cy="11" r="8" />
                            <path d="M21 21l-4.35-4.35" />
                        </svg>
                        <p>No items found</p>
                        <span>Try a different search or category</span>
                    </div>
                ) : (
                    <div className={styles.itemsGrid}>
                        {filteredItems.map((item, index) => (
                            <div
                                key={item.id}
                                className={styles.itemCard}
                                onClick={() => handleItemClick(item)}
                            >
                                {/* Item Image with Veg Badge */}
                                <div className={styles.itemImageWrapper}>
                                    {item.image ? (
                                        <Image
                                            src={item.image}
                                            alt={item.name}
                                            className={styles.itemImageReal}
                                            width={300}
                                            height={300}
                                            sizes="(max-width: 480px) 50vw, 240px"
                                            loading={index < 4 ? 'eager' : 'lazy'}
                                            priority={index < 2}
                                            quality={75}
                                            unoptimized={false}
                                        />
                                    ) : (
                                        <div className={styles.itemImage}>
                                            <span className={styles.itemEmoji}>
                                                {categories.find(c => c.id === item.categoryId)?.icon || '🍽️'}
                                            </span>
                                        </div>
                                    )}
                                    <div className={styles.vegBadgeFloat}>
                                        <div className={styles.vegDot} />
                                    </div>
                                    {item.tags?.includes('bestSeller') && (
                                        <span className={styles.bestsellerBadge}>★ Best</span>
                                    )}
                                </div>

                                {/* Item Info */}
                                <div className={styles.itemInfo}>
                                    <h3 className={styles.itemName}>{item.name}</h3>
                                    <p className={styles.itemDesc}>{item.description.slice(0, 60)}...</p>

                                    <div className={styles.itemFooter}>
                                        <span className={styles.itemPrice}>₹{item.price}</span>
                                        <button className={styles.addBtn}>
                                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                                                <line x1="12" y1="5" x2="12" y2="19" />
                                                <line x1="5" y1="12" x2="19" y2="12" />
                                            </svg>
                                        </button>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Floating Cart Button */}
            {mounted && totalItems > 0 && (
                <div className={styles.floatingCart} onClick={() => router.push('/cart')}>
                    <div className={styles.cartInfo}>
                        <span className={styles.cartItems}>{totalItems} item{totalItems !== 1 ? 's' : ''}</span>
                        <span className={styles.cartTotal}>₹{totalAmount}</span>
                    </div>
                    <button className={styles.viewCartBtn}>
                        View Cart
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                            <path d="M5 12h14M12 5l7 7-7 7" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                    </button>
                </div>
            )}

            {/* Item Customization Sheet */}
            <ItemSheet
                item={selectedItem}
                isOpen={isSheetOpen}
                onClose={() => setIsSheetOpen(false)}
            />
        </div>
    );
}
