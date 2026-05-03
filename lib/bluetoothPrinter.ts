'use client';

/**
 * Bluetooth thermal printer driver (BLE only — Web Bluetooth doesn't
 * support Bluetooth Classic / SPP).
 *
 * Wire protocol: ESC/POS — virtually every cheap thermal printer speaks it.
 * Transport: BLE GATT writes to the first writable characteristic we find.
 * We don't filter by service UUID because BLE thermal printer vendors are
 * inconsistent; instead we list every common thermal-printer service in
 * `optionalServices` so the OS picker can show the device, then we walk the
 * services post-connect and pick a writable characteristic.
 *
 * Browser support: Chrome / Edge desktop, Chrome on Android. NOT iOS Safari.
 */

import type { Order } from './localDb';

// ── ESC/POS byte builders ────────────────────────────────────────────────────

const ESC = 0x1B;
const GS = 0x1D;
const NL_BYTES = new Uint8Array([0x0A]);

function b(...arr: number[]): Uint8Array {
    return new Uint8Array(arr);
}

/** Encode plain text. ESC/POS printers default to CP437/ASCII; non-ASCII
 *  symbols (₹, ✓, em dash) print as garbage on most devices, so we
 *  transliterate them. */
function txt(s: string): Uint8Array {
    const safe = s
        .replace(/₹/g, 'Rs.')
        .replace(/[—–]/g, '-')
        .replace(/[“”]/g, '"')
        .replace(/[‘’]/g, "'")
        .replace(/✓/g, '*');
    return new TextEncoder().encode(safe);
}

function concat(...arrs: Uint8Array[]): Uint8Array {
    const total = arrs.reduce((sum, a) => sum + a.length, 0);
    const out = new Uint8Array(total);
    let off = 0;
    for (const a of arrs) { out.set(a, off); off += a.length; }
    return out;
}

const CMD = {
    init:        b(ESC, 0x40),                          // ESC @ — reset
    alignLeft:   b(ESC, 0x61, 0x00),
    alignCenter: b(ESC, 0x61, 0x01),
    alignRight:  b(ESC, 0x61, 0x02),
    boldOn:      b(ESC, 0x45, 0x01),
    boldOff:     b(ESC, 0x45, 0x00),
    sizeNormal:  b(GS, 0x21, 0x00),
    sizeWide:    b(GS, 0x21, 0x10),                     // 2x width
    sizeTall:    b(GS, 0x21, 0x01),                     // 2x height
    sizeLarge:   b(GS, 0x21, 0x11),                     // 2x both
    feed3:       b(0x0A, 0x0A, 0x0A),
    feedAndCut:  b(GS, 0x56, 0x42, 0x00),               // feed + full cut
    cutFull:     b(GS, 0x56, 0x00),
};

// ── Receipt builders ─────────────────────────────────────────────────────────

const PAPER_WIDTH = 32; // chars at normal font on a 58mm printer

function pad(left: string, right: string, width = PAPER_WIDTH): string {
    const space = Math.max(1, width - left.length - right.length);
    return left + ' '.repeat(space) + right;
}

function divider(): Uint8Array {
    return concat(txt('-'.repeat(PAPER_WIDTH)), NL_BYTES);
}

function header(restaurantName: string, subtitle?: string): Uint8Array {
    return concat(
        CMD.init,
        CMD.alignCenter, CMD.boldOn, CMD.sizeWide,
        txt(restaurantName), NL_BYTES,
        CMD.sizeNormal, CMD.boldOff,
        ...(subtitle ? [txt(subtitle), NL_BYTES] : []),
        CMD.alignLeft,
        divider(),
    );
}

/** KOT (Kitchen Order Ticket): big token number, items + qty + add-ons.
 *  No prices — kitchen doesn't need them. */
export function buildKOT(order: Order, restaurantName: string): Uint8Array {
    const labelText =
        order.orderType === 'preorder' ? 'PARCEL' :
        order.tableNumber && order.tableNumber !== '0' ? `TABLE ${order.tableNumber}` :
        `TOKEN ${order.tokenNumber}`;

    const itemBlocks: Uint8Array[] = [];
    for (const it of order.items) {
        itemBlocks.push(
            CMD.boldOn,
            txt(`${it.quantity} x ${it.menuItem.name}`), NL_BYTES,
            CMD.boldOff,
        );
        for (const a of it.selectedAddOns ?? []) {
            itemBlocks.push(txt(`   + ${a.name}`), NL_BYTES);
        }
    }
    for (const e of order.extras ?? []) {
        itemBlocks.push(
            CMD.boldOn,
            txt(`${e.quantity} x ${e.extra.name}`), NL_BYTES,
            CMD.boldOff,
        );
    }

    const time = new Date(order.timestamp).toLocaleTimeString('en-IN', {
        hour: '2-digit', minute: '2-digit', hour12: true,
    });

    return concat(
        header(restaurantName, 'KITCHEN ORDER'),
        CMD.alignCenter, CMD.sizeLarge, CMD.boldOn,
        txt(labelText), NL_BYTES,
        CMD.sizeNormal, CMD.boldOff,
        CMD.alignLeft,
        txt(`Order: ${order.orderId}`), NL_BYTES,
        txt(`Time:  ${time}`), NL_BYTES,
        ...(order.preorderDetails?.pickupTime
            ? [txt(`Pickup: ${order.preorderDetails.pickupTime}`), NL_BYTES]
            : []),
        ...(order.customerName
            ? [txt(`Name:  ${order.customerName}`), NL_BYTES]
            : []),
        divider(),
        ...itemBlocks,
        divider(),
        CMD.feedAndCut,
    );
}

/** Bill / receipt: items + prices + total. Works for both paid and counter modes. */
export function buildBill(order: Order, restaurantName: string): Uint8Array {
    const lines: Uint8Array[] = [];
    let totalUnits = 0;
    for (const it of order.items) {
        const name = it.menuItem.name.length > 20
            ? it.menuItem.name.slice(0, 20)
            : it.menuItem.name;
        lines.push(txt(pad(`${it.quantity} x ${name}`, `Rs.${it.totalPrice}`)), NL_BYTES);
        totalUnits += it.quantity;
        for (const a of it.selectedAddOns ?? []) {
            lines.push(txt(pad(`   + ${a.name}`, `Rs.${a.price}`)), NL_BYTES);
        }
    }
    for (const e of order.extras ?? []) {
        lines.push(txt(pad(`${e.quantity} x ${e.extra.name}`, `Rs.${e.extra.price * e.quantity}`)), NL_BYTES);
        totalUnits += e.quantity;
    }

    const time = new Date(order.timestamp).toLocaleString('en-IN', {
        day: '2-digit', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit', hour12: true,
    });

    const payLine = order.paymentMethod === 'counter'
        ? '** PAY AT COUNTER **'
        : order.paymentMethod === 'online'
            ? '** PAID ONLINE **'
            : '';

    return concat(
        header(restaurantName),
        txt(`Order: ${order.orderId}`), NL_BYTES,
        txt(`Token: ${order.tokenNumber}`), NL_BYTES,
        ...(order.tableNumber && order.tableNumber !== '0'
            ? [txt(`Table: ${order.tableNumber}`), NL_BYTES]
            : []),
        txt(`Time:  ${time}`), NL_BYTES,
        divider(),
        ...lines,
        divider(),
        CMD.boldOn, CMD.sizeTall,
        txt(pad('TOTAL', `Rs.${order.totalAmount}`)), NL_BYTES,
        CMD.sizeNormal, CMD.boldOff,
        txt(`Items: ${totalUnits}`), NL_BYTES,
        ...(payLine ? [NL_BYTES, CMD.alignCenter, CMD.boldOn, txt(payLine), NL_BYTES, CMD.boldOff, CMD.alignLeft] : []),
        NL_BYTES,
        CMD.alignCenter, txt('Thank you!'), NL_BYTES,
        CMD.alignLeft,
        CMD.feedAndCut,
    );
}

/** Today's summary: revenue, order count, top sellers, status breakdown.
 *  Caller passes the orders array — we filter to today's date here. */
export function buildDailyStats(orders: Order[], restaurantName: string): Uint8Array {
    const today = new Date();
    const todayStr = today.toDateString();
    const todayOrders = orders.filter(o => new Date(o.timestamp).toDateString() === todayStr);

    const revenue = todayOrders.reduce((sum, o) => sum + o.totalAmount, 0);
    const count = todayOrders.length;
    const aov = count > 0 ? Math.round(revenue / count) : 0;

    const statusCounts = {
        pending: todayOrders.filter(o => o.status === 'pending').length,
        preparing: todayOrders.filter(o => o.status === 'preparing').length,
        ready: todayOrders.filter(o => o.status === 'ready').length,
        delivered: todayOrders.filter(o => o.status === 'delivered').length,
    };

    const dineIn = todayOrders.filter(o => o.orderType === 'dine-in').length;
    const preorder = todayOrders.filter(o => o.orderType === 'preorder').length;

    // Top 5 items by quantity sold
    const itemCounts: Record<string, number> = {};
    for (const o of todayOrders) {
        for (const item of o.items) {
            itemCounts[item.menuItem.name] = (itemCounts[item.menuItem.name] ?? 0) + item.quantity;
        }
    }
    const topItems = Object.entries(itemCounts)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 5);

    const dateStr = today.toLocaleDateString('en-IN', {
        weekday: 'short', day: '2-digit', month: 'short', year: 'numeric',
    });
    const timeStr = today.toLocaleTimeString('en-IN', {
        hour: '2-digit', minute: '2-digit', hour12: true,
    });

    return concat(
        header(restaurantName, 'DAILY SUMMARY'),
        CMD.alignCenter, txt(dateStr), NL_BYTES,
        txt(`Printed at ${timeStr}`), NL_BYTES,
        CMD.alignLeft,
        divider(),
        CMD.boldOn, txt('REVENUE'), NL_BYTES, CMD.boldOff,
        CMD.sizeTall, txt(pad('Total', `Rs.${revenue}`)), NL_BYTES, CMD.sizeNormal,
        txt(pad('Orders', String(count))), NL_BYTES,
        txt(pad('Avg order', `Rs.${aov}`)), NL_BYTES,
        divider(),
        CMD.boldOn, txt('STATUS'), NL_BYTES, CMD.boldOff,
        txt(pad('Pending', String(statusCounts.pending))), NL_BYTES,
        txt(pad('Preparing', String(statusCounts.preparing))), NL_BYTES,
        txt(pad('Ready', String(statusCounts.ready))), NL_BYTES,
        txt(pad('Delivered', String(statusCounts.delivered))), NL_BYTES,
        divider(),
        CMD.boldOn, txt('ORDER TYPE'), NL_BYTES, CMD.boldOff,
        txt(pad('Dine-in', String(dineIn))), NL_BYTES,
        txt(pad('Preorder/Parcel', String(preorder))), NL_BYTES,
        ...(topItems.length > 0
            ? [
                divider(),
                CMD.boldOn, txt('TOP SELLERS'), NL_BYTES, CMD.boldOff,
                ...topItems.flatMap(([name, qty]) => {
                    const truncated = name.length > 22 ? name.slice(0, 22) : name;
                    return [txt(pad(truncated, `x${qty}`)), NL_BYTES];
                }),
            ]
            : []),
        divider(),
        CMD.feedAndCut,
    );
}

export function buildTestPrint(restaurantName: string): Uint8Array {
    return concat(
        header(restaurantName, 'PRINTER TEST'),
        txt('If you can read this, the'), NL_BYTES,
        txt('printer is connected and'), NL_BYTES,
        txt('working correctly.'), NL_BYTES,
        NL_BYTES,
        CMD.boldOn, txt('Bold text test'), NL_BYTES, CMD.boldOff,
        CMD.sizeLarge, txt('LARGE'), NL_BYTES, CMD.sizeNormal,
        NL_BYTES,
        txt(`Time: ${new Date().toLocaleTimeString('en-IN')}`), NL_BYTES,
        CMD.feedAndCut,
    );
}

// ── Web Bluetooth driver ─────────────────────────────────────────────────────

/** Service UUIDs of common BLE thermal printers. We don't filter on these
 *  (we use acceptAllDevices) but we DO need them in optionalServices so the
 *  GATT server lets us discover them. New ones can be added freely. */
const KNOWN_PRINTER_SERVICES: BluetoothServiceUUID[] = [
    '000018f0-0000-1000-8000-00805f9b34fb', // Goojprt / Mocodo
    '0000ff00-0000-1000-8000-00805f9b34fb', // generic vendor service
    '0000ff10-0000-1000-8000-00805f9b34fb', // Xprinter
    '0000ffe0-0000-1000-8000-00805f9b34fb', // generic
    '0000fee7-0000-1000-8000-00805f9b34fb', // iPrint / cat printer family variant
    '0000ae30-0000-1000-8000-00805f9b34fb', // iPrint primary service (incl. SC03h)
    '0000af30-0000-1000-8000-00805f9b34fb', // iPrint variant
    '49535343-fe7d-4ae5-8fa9-9fafd205e455', // ISSC / Microchip
    'e7810a71-73ae-499d-8c15-faa9aef0c3f2', // common
    '6e400001-b5a3-f393-e0a9-e50e24dcca9e', // Nordic UART (NUS)
    '0000180a-0000-1000-8000-00805f9b34fb', // Device Information
    '00001800-0000-1000-8000-00805f9b34fb', // Generic Access
];

const STORAGE_KEY = 'btPrinter:lastDeviceId';

class BluetoothPrinterClient {
    private device: BluetoothDevice | null = null;
    private server: BluetoothRemoteGATTServer | null = null;
    private char: BluetoothRemoteGATTCharacteristic | null = null;
    private listeners = new Set<() => void>();
    /** Serializes every write() call. Two prints fired back-to-back used to
     *  interleave their byte streams over the BLE link, producing garbled
     *  output and partial cuts. The queue ensures one print finishes (every
     *  chunk + the cut) before the next one starts. */
    private writeQueue: Promise<void> = Promise.resolve();

    /** Last successful service+characteristic discovery, kept for diagnostics. */
    private lastDiscovery: { service: string; characteristic: string; properties: string[] } | null = null;

    isSupported(): boolean {
        return typeof navigator !== 'undefined' && !!navigator.bluetooth;
    }

    isConnected(): boolean {
        return !!this.server?.connected && !!this.char;
    }

    name(): string | null {
        return this.device?.name ?? null;
    }

    /** What service/characteristic we're actually writing to. Useful when a
     *  printer connects but won't print — confirms which channel is in use. */
    getDiagnostics(): { service: string; characteristic: string; properties: string[] } | null {
        return this.lastDiscovery;
    }

    onChange(listener: () => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    private notify() {
        this.listeners.forEach(l => l());
    }

    async connect(): Promise<void> {
        if (!this.isSupported()) {
            throw new Error('Web Bluetooth is not supported in this browser. Use Chrome/Edge on desktop or Chrome on Android.');
        }
        // Web Bluetooth requires a secure context. Catching this here gives a
        // clearer message than Chrome's "Web Bluetooth API globally disabled".
        if (typeof window !== 'undefined' && !window.isSecureContext) {
            throw new Error('Web Bluetooth requires HTTPS. Open the site over https:// or localhost.');
        }

        const device = await navigator.bluetooth.requestDevice({
            acceptAllDevices: true,
            optionalServices: KNOWN_PRINTER_SERVICES,
        });

        device.addEventListener('gattserverdisconnected', () => {
            this.server = null;
            this.char = null;
            this.notify();
        });

        // Chromium has a known quirk where the first GATT connect attempt
        // can fail on a freshly-picked device, particularly if it was just
        // released by another app. Retry up to 3 times with backoff before
        // giving up. Throws a more specific error if all retries exhaust.
        const server = await this.connectGattWithRetry(device);

        // Walk every primary service. iPrint-family printers (SC03h etc.) put
        // their write channel on a custom service like 0xAE30, so we can't
        // shortcut to a known UUID; we log everything found and pick the
        // best writable characteristic. Preference order:
        //   1. writeWithoutResponse (most thermal printers want this)
        //   2. write (with response)
        // We log all candidates to the console so a printer that connects but
        // refuses to print can still be debugged remotely.
        const services = await server.getPrimaryServices();
        let writable: BluetoothRemoteGATTCharacteristic | null = null;
        let writableSvcUuid = '';
        const allCandidates: Array<{ svc: string; chr: string; props: string[] }> = [];
        for (const svc of services) {
            const chars = await svc.getCharacteristics().catch(() => []);
            for (const c of chars) {
                const props: string[] = [];
                if (c.properties.write) props.push('write');
                if (c.properties.writeWithoutResponse) props.push('writeWithoutResponse');
                if (c.properties.read) props.push('read');
                if (c.properties.notify) props.push('notify');
                if (props.length > 0) allCandidates.push({ svc: svc.uuid, chr: c.uuid, props });
                // Prefer writeWithoutResponse — that's what iPrint and most
                // ESC/POS BLE printers actually use under the hood.
                if (!writable && c.properties.writeWithoutResponse) {
                    writable = c;
                    writableSvcUuid = svc.uuid;
                }
            }
        }
        // Fallback: any plain writable characteristic
        if (!writable) {
            for (const svc of services) {
                const chars = await svc.getCharacteristics().catch(() => []);
                for (const c of chars) {
                    if (c.properties.write) {
                        writable = c;
                        writableSvcUuid = svc.uuid;
                        break;
                    }
                }
                if (writable) break;
            }
        }

        // Always log the GATT layout — invaluable for diagnosing iPrint /
        // proprietary protocol printers that pair but won't print.
        console.log('[BluetoothPrinter] Discovered GATT structure:', allCandidates);

        if (!writable) {
            await server.disconnect();
            throw new Error(`Connected to "${device.name ?? 'device'}" but no writable characteristic was found. Open DevTools console to see the GATT structure.`);
        }

        this.device = device;
        this.server = server;
        this.char = writable;
        this.lastDiscovery = {
            service: writableSvcUuid,
            characteristic: writable.uuid,
            properties: [
                writable.properties.write ? 'write' : '',
                writable.properties.writeWithoutResponse ? 'writeWithoutResponse' : '',
            ].filter(Boolean),
        };
        console.log('[BluetoothPrinter] Selected channel:', this.lastDiscovery);

        if (device.id) {
            try { localStorage.setItem(STORAGE_KEY, device.id); } catch {}
        }
        this.notify();
    }

    async disconnect(): Promise<void> {
        try { this.server?.disconnect(); } catch {}
        this.device = null;
        this.server = null;
        this.char = null;
        this.lastDiscovery = null;
        this.writeQueue = Promise.resolve();
        try { localStorage.removeItem(STORAGE_KEY); } catch {}
        this.notify();
    }

    private async connectGattWithRetry(device: BluetoothDevice): Promise<BluetoothRemoteGATTServer> {
        const MAX_ATTEMPTS = 3;
        let lastErr: unknown;
        for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
            try {
                return await device.gatt!.connect();
            } catch (err) {
                lastErr = err;
                console.warn(`[BluetoothPrinter] GATT connect attempt ${attempt}/${MAX_ATTEMPTS} failed:`, err);
                if (attempt < MAX_ATTEMPTS) {
                    await new Promise(r => setTimeout(r, 400 * attempt));
                }
            }
        }
        const msg = (lastErr as Error)?.message ?? 'Connection attempt failed';
        // Wrap with a clearer, action-oriented message
        throw new Error(
            `Could not connect to "${device.name ?? 'printer'}". ` +
            `Most common causes: (1) the printer's iPrint app or another phone is still connected — close it first, ` +
            `(2) the printer is asleep — press its power button to wake it, ` +
            `(3) the printer is paired in OS Bluetooth settings — unpair it there and try again. ` +
            `[${msg}]`
        );
    }

    /** Public entry point — appends to the serial queue so concurrent calls
     *  don't interleave their byte streams. Errors propagate to the caller
     *  but DO NOT poison the queue (next caller still gets to run). */
    write(data: Uint8Array): Promise<void> {
        const next = this.writeQueue.then(() => this.doWrite(data));
        this.writeQueue = next.catch(() => { /* swallow so chain continues */ });
        return next;
    }

    /** BLE has a small MTU (often 20-185 bytes). Chunking is mandatory. */
    private async doWrite(data: Uint8Array): Promise<void> {
        if (!this.char) throw new Error('Printer is not connected');
        const CHUNK_SIZE = 100;
        const useNoResponse = this.char.properties.writeWithoutResponse;
        for (let i = 0; i < data.length; i += CHUNK_SIZE) {
            const slice = data.slice(i, i + CHUNK_SIZE);
            if (useNoResponse) {
                await this.char.writeValueWithoutResponse(slice);
            } else {
                await this.char.writeValueWithResponse(slice);
            }
        }
    }
}

let _client: BluetoothPrinterClient | null = null;
export function getPrinterClient(): BluetoothPrinterClient {
    if (!_client) _client = new BluetoothPrinterClient();
    return _client;
}
