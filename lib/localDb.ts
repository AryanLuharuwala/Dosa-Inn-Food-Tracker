/**
 * Local file-based database.
 * All data lives in /data/*.json — server-side only.
 * Clients talk to /api/db/* routes.
 */

import fs from 'fs';
import path from 'path';
import { menuItems as seedMenuItems, categories as seedCategories } from './menuData';

const DATA_DIR = path.join(process.cwd(), 'data');

function dbPath(name: string) {
    return path.join(DATA_DIR, `${name}.json`);
}

function read<T>(name: string, fallback: T): T {
    try {
        const raw = fs.readFileSync(dbPath(name), 'utf8');
        return JSON.parse(raw) as T;
    } catch {
        return fallback;
    }
}

function write(name: string, data: unknown) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(dbPath(name), JSON.stringify(data, null, 2), 'utf8');
}

// ── Append-only analytics log ──────────────────────────────────────────────

function appendLog(name: string, entry: unknown) {
    const logPath = path.join(DATA_DIR, `${name}.jsonl`);
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.appendFileSync(logPath, JSON.stringify({ ...( entry as object), ts: new Date().toISOString() }) + '\n', 'utf8');
}

export function logPayment(entry: Record<string, unknown>) { appendLog('log_payments', entry); }
export function logOrder(entry: Record<string, unknown>) { appendLog('log_orders', entry); }
export function logCancellation(entry: Record<string, unknown>) { appendLog('log_cancellations', entry); }
export function logCartAbandonment(entry: Record<string, unknown>) { appendLog('log_cart_abandonments', entry); }

// ── Menu items ─────────────────────────────────────────────────────────────

export function getMenuItems() {
    return read('menu_items', seedMenuItems);
}

export function saveMenuItems(items: unknown[]) {
    write('menu_items', items);
}

// ── Categories ─────────────────────────────────────────────────────────────

export function getCategories() {
    return read('categories', seedCategories);
}

export function saveCategories(cats: unknown[]) {
    write('categories', cats);
}

// ── Orders ─────────────────────────────────────────────────────────────────

export function getOrders(): Order[] {
    return read<Order[]>('orders', []);
}

export function saveOrders(orders: Order[]) {
    write('orders', orders);
}

export function appendOrder(order: Order) {
    const orders = getOrders();
    orders.unshift(order);
    saveOrders(orders);
    logOrder({ event: 'order_placed', orderId: order.orderId, amount: order.totalAmount, items: order.items.length });
}

export function updateOrderStatus(orderId: string, status: Order['status'], itemsPayload?: Order['items']) {
    const orders = getOrders();
    const idx = orders.findIndex(o => o.orderId === orderId);
    if (idx === -1) return false;
    orders[idx].status = status;
    if (itemsPayload) orders[idx].items = itemsPayload;
    saveOrders(orders);
    return true;
}

// ── Settings ───────────────────────────────────────────────────────────────

interface Settings {
    rushHourMode: boolean;
    rushHourItems: string[];
}

export function getSettings(): Settings {
    return read<Settings>('settings', { rushHourMode: false, rushHourItems: [] });
}

export function saveSettings(s: Settings) {
    write('settings', s);
}

// ── Chefs ──────────────────────────────────────────────────────────────────

export interface Chef {
    id: string;
    name: string;
    is_active: boolean;
    color: string;
}

export interface ChefCategory {
    chef_id: string;
    category_id: string;
}

export function getChefs(): Chef[] {
    return read<Chef[]>('chefs', []);
}

export function saveChefs(chefs: Chef[]) {
    write('chefs', chefs);
}

export function getChefCategories(): ChefCategory[] {
    return read<ChefCategory[]>('chef_categories', []);
}

export function saveChefCategories(cc: ChefCategory[]) {
    write('chef_categories', cc);
}

// ── Order type (shared) ───────────────────────────────────────────────────

export interface Order {
    orderId: string;
    orderType: 'dine-in' | 'preorder';
    tableNumber: string | null;
    preorderDetails: { pickupTime: string; customerName: string; customerPhone: string } | null;
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
