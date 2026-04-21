'use client';

import React, { useState } from 'react';
import { MenuItem, AddOn, Extra } from '@/lib/menuData';
import { useCart } from '@/lib/cartContext';
import { useSound } from '@/lib/useSound';
import styles from './ItemSheet.module.css';

interface ItemSheetProps {
    item: MenuItem | null;
    isOpen: boolean;
    onClose: () => void;
}

export default function ItemSheet({ item, isOpen, onClose }: ItemSheetProps) {
    const { addItem, addExtra } = useCart();
    const playAddToCart = useSound('/sounds/add-to-cart.mp3', 0.5);
    const [quantity, setQuantity] = useState(1);
    const [selectedAddOns, setSelectedAddOns] = useState<AddOn[]>([]);
    const [selectedExtras, setSelectedExtras] = useState<Extra[]>([]);

    if (!item) return null;

    const handleAddOnToggle = (addOn: AddOn) => {
        setSelectedAddOns(prev => {
            const exists = prev.find(a => a.id === addOn.id);
            if (exists) {
                return prev.filter(a => a.id !== addOn.id);
            }
            return [...prev, addOn];
        });
    };

    const handleExtraToggle = (extra: Extra) => {
        setSelectedExtras(prev => {
            const exists = prev.find(e => e.id === extra.id);
            if (exists) {
                return prev.filter(e => e.id !== extra.id);
            }
            return [...prev, extra];
        });
    };

    const addOnsTotal = selectedAddOns.reduce((sum, a) => sum + a.price, 0);
    const itemTotal = (item.price + addOnsTotal) * quantity;
    const extrasTotal = selectedExtras.reduce((sum, e) => sum + e.price, 0);
    const grandTotal = itemTotal + extrasTotal;

    const handleAddToCart = () => {
        addItem(item, quantity, selectedAddOns);
        selectedExtras.forEach(extra => addExtra(extra));
        playAddToCart();

        setQuantity(1);
        setSelectedAddOns([]);
        setSelectedExtras([]);
        onClose();
    };

    const handleClose = () => {
        setQuantity(1);
        setSelectedAddOns([]);
        setSelectedExtras([]);
        onClose();
    };

    return (
        <>
            <div
                className={`${styles.overlay} ${isOpen ? styles.open : ''}`}
                onClick={handleClose}
            />
            <div className={`${styles.sheet} ${isOpen ? styles.open : ''}`}>
                <div className={styles.handle} />

                <div className={styles.content}>
                    {/* Item Header */}
                    <div className={styles.itemHeader}>
                        <div className={styles.vegBadge} />
                        <div className={styles.itemInfo}>
                            <h2 className={styles.itemName}>{item.name}</h2>
                            <p className={styles.itemDesc}>{item.description}</p>
                            <p className={styles.itemPrice}>₹{item.price}</p>
                        </div>
                    </div>

                    {/* Quantity Selector */}
                    <div className={styles.section}>
                        <h3 className={styles.sectionTitle}>Quantity</h3>
                        <div className={styles.quantitySelector}>
                            <button
                                className={styles.quantityBtn}
                                onClick={() => setQuantity(Math.max(1, quantity - 1))}
                                disabled={quantity <= 1}
                            >
                                −
                            </button>
                            <span className={styles.quantityValue}>{quantity}</span>
                            <button
                                className={styles.quantityBtn}
                                onClick={() => setQuantity(quantity + 1)}
                            >
                                +
                            </button>
                        </div>
                    </div>

                    {/* Add-ons */}
                    {item.addOns && item.addOns.length > 0 && (
                        <div className={styles.section}>
                            <h3 className={styles.sectionTitle}>Add-ons</h3>
                            <div className={styles.optionsList}>
                                {item.addOns.map(addOn => (
                                    <div
                                        key={addOn.id}
                                        className={styles.optionItem}
                                        onClick={() => handleAddOnToggle(addOn)}
                                    >
                                        <div
                                            className={`${styles.checkbox} ${selectedAddOns.find(a => a.id === addOn.id) ? styles.checked : ''}`}
                                        />
                                        <span className={styles.optionName}>{addOn.name}</span>
                                        <span className={styles.optionPrice}>+₹{addOn.price}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Extras */}
                    {item.extras && item.extras.length > 0 && (
                        <div className={styles.section}>
                            <h3 className={styles.sectionTitle}>Extras</h3>
                            <p className={styles.sectionSubtitle}>Added as separate items</p>
                            <div className={styles.optionsList}>
                                {item.extras.map(extra => (
                                    <div
                                        key={extra.id}
                                        className={styles.optionItem}
                                        onClick={() => handleExtraToggle(extra)}
                                    >
                                        <div
                                            className={`${styles.checkbox} ${selectedExtras.find(e => e.id === extra.id) ? styles.checked : ''}`}
                                        />
                                        <span className={styles.optionName}>{extra.name}</span>
                                        <span className={styles.optionPrice}>+₹{extra.price}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className={styles.footer}>
                    <div className={styles.totalInfo}>
                        <span className={styles.totalLabel}>Total</span>
                        <span className={styles.totalAmount}>₹{grandTotal}</span>
                    </div>
                    <button className={styles.addBtn} onClick={handleAddToCart}>
                        Add to Cart
                    </button>
                </div>
            </div>
        </>
    );
}
