'use client';

/**
 * Cat-Printer / iPrint family wire protocol (printers like SC03h-BA71,
 * GB02, MX02, etc). These printers do NOT speak ESC/POS — they accept
 * raster bitmap rows wrapped in framed command packets:
 *
 *   51 78 [cmd] [type] [len_lo] [len_hi] [payload...] [crc8] FF
 *
 * The host renders content to a 384-px-wide 1-bit bitmap, then ships
 * each non-empty row as a `Bitmap` (0xA2) packet. Surrounding the
 * bitmap stream are Speed/Energy/ApplyEnergy preamble and a Feed
 * postamble.
 *
 * Reference: https://github.com/opuu/cat-printer (AGPL — used as a
 * protocol reference, no code copied verbatim).
 */

import type { Order } from './localDb';

// ── BLE UUIDs ────────────────────────────────────────────────────────────────

export const CAT_PRINT_SRV = '0000ae30-0000-1000-8000-00805f9b34fb';
export const CAT_ADV_SRV   = '0000af30-0000-1000-8000-00805f9b34fb';
export const CAT_PRINT_TX  = '0000ae01-0000-1000-8000-00805f9b34fb';
export const CAT_PRINT_RX  = '0000ae02-0000-1000-8000-00805f9b34fb';
/** Auxiliary notify/indicate characteristics. iPrint enables these BEFORE
 *  any write — the SC03h-BA71 firmware silently drops writes if
 *  notifications aren't subscribed first. Reverse-engineered from a
 *  Wireshark capture of the iPrint app. */
export const CAT_PRINT_RX2 = '0000ae04-0000-1000-8000-00805f9b34fb';
export const CAT_PRINT_RX3 = '0000ae05-0000-1000-8000-00805f9b34fb';

// ── Frame builder ────────────────────────────────────────────────────────────

const enum Cmd {
    GetDeviceInfo  = 0xa8,
    GetDeviceState = 0xa3,
    SetDpi         = 0xa4,
    Lattice        = 0xa6,
    Retract        = 0xa0,
    Feed           = 0xa1,
    Speed          = 0xbd,
    Energy         = 0xaf,
    ApplyEnergy    = 0xbe,
    Bitmap         = 0xa2,
    /** Pre-warmup command — payload [0x01]. Captured from iPrint, exact
     *  semantics unknown but mandatory before printing on SC03h-style
     *  firmware. Without it, the first bitmap row is sometimes dropped. */
    Warmup         = 0xbb,
}

/** CRC-8 with polynomial 0x07, init 0x00 — what cat printers expect. */
function crc8(data: Uint8Array): number {
    let crc = 0;
    for (const byte of data) {
        crc ^= byte;
        for (let i = 0; i < 8; i++) {
            crc = (crc & 0x80) ? ((crc << 1) ^ 0x07) & 0xff : (crc << 1) & 0xff;
        }
    }
    return crc;
}

function frame(cmd: Cmd, payload: Uint8Array): Uint8Array {
    const out = new Uint8Array(8 + payload.length);
    out[0] = 0x51;
    out[1] = 0x78;
    out[2] = cmd;
    out[3] = 0x00; // type = transfer
    out[4] = payload.length & 0xff;
    out[5] = (payload.length >> 8) & 0xff;
    out.set(payload, 6);
    out[6 + payload.length] = crc8(payload);
    out[7 + payload.length] = 0xff;
    return out;
}

const u8  = (...b: number[]) => new Uint8Array(b);
const u16 = (n: number) => new Uint8Array([n & 0xff, (n >> 8) & 0xff]);

/** Concatenate frames into a single buffer so the BLE driver issues one write
 *  per group. The Wireshark capture shows iPrint sending preamble/postamble
 *  as one GATT op each; some firmware drops frames that arrive as separate
 *  writes with inter-packet gaps. */
function bundle(...frames: Uint8Array[]): Uint8Array {
    let total = 0;
    for (const f of frames) total += f.length;
    const out = new Uint8Array(total);
    let off = 0;
    for (const f of frames) { out.set(f, off); off += f.length; }
    return out;
}

// ── Print-job builders ───────────────────────────────────────────────────────

const PAPER_WIDTH = 384;          // pixels (58mm @ 8 dots/mm)
const BYTES_PER_ROW = PAPER_WIDTH / 8;  // 48
// Values calibrated from a Wireshark capture of the iPrint app printing
// to an SC03h-class printer. Cat-printer SDK uses different defaults
// (speed 32, energy 24000, applyEnergy 1) which resulted in blank output
// on this firmware. These captured values are what produces ink.
// Speed raised from 30→34 (faster motor). Energy raised from 12000→13500 to
// keep print darkness consistent at the higher speed (more heat per dot row).
const DEFAULT_SPEED = 34;         // 0x22 — ~13% faster motor vs captured 0x1E
const DEFAULT_ENERGY = 13500;     // 0x34BC — compensates for shorter dwell time
const FINISH_FEED_LINES = 48;     // dump fed 0x0030 = 48 lines twice

const LATTICE_START = new Uint8Array([0xaa, 0x55, 0x17, 0x38, 0x44, 0x5f, 0x5f, 0x5f, 0x44, 0x38, 0x2c]);
const LATTICE_END   = new Uint8Array([0xaa, 0x55, 0x17, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x17]);

/** One-shot session warmup — sent on the first print after connecting,
 *  *after* notifications on AE02/AE04/AE05 have been subscribed. The
 *  Wireshark capture sends GetDeviceInfo+GetDeviceState as one combined
 *  write, then 0xBB as a second write. */
export function warmupBundles(): { a: Uint8Array; b: Uint8Array } {
    return {
        a: bundle(
            frame(Cmd.GetDeviceInfo,  u8(0x00)),
            frame(Cmd.GetDeviceState, u8(0x00)),
        ),
        b: frame(Cmd.Warmup, u8(0x01)),
    };
}

/** Pre-bitmap header — single concatenated write to match the iPrint capture.
 *  Energy is u16 (2-byte payload) per Wireshark; cat-printer SDK uses u32 but
 *  iPrint firmware ignores or rejects the longer form. */
function preamble(): Uint8Array {
    return bundle(
        frame(Cmd.GetDeviceState, u8(0x00)),
        frame(Cmd.SetDpi,         u8(0x33)),
        frame(Cmd.Lattice,        LATTICE_START),
        frame(Cmd.Energy,         u16(DEFAULT_ENERGY)),
        frame(Cmd.ApplyEnergy,    u8(0x00)),
        frame(Cmd.Speed,          u8(DEFAULT_SPEED)),
    );
}

function postamble(): Uint8Array {
    return bundle(
        frame(Cmd.Speed,          u8(0x19)),
        frame(Cmd.Feed,           u16(FINISH_FEED_LINES)),
        frame(Cmd.Feed,           u16(FINISH_FEED_LINES)),
        frame(Cmd.Speed,          u8(0x19)),
        frame(Cmd.Lattice,        LATTICE_END),
        frame(Cmd.GetDeviceState, u8(0x00)),
    );
}

/** Convert canvas image data to a 1-bit-per-pixel bitmap. Each output byte is
 *  one horizontal run of 8 pixels, LSB = leftmost pixel (matches what the
 *  printer expects). Threshold-based; assumes the canvas is already
 *  rendered/dithered into pure black-on-white. */
function imageDataToBitmap(img: ImageData): Uint8Array {
    const { width, height, data } = img;
    const bytesPerRow = Math.ceil(width / 8);
    const out = new Uint8Array(bytesPerRow * height);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const i = (y * width + x) * 4;
            // Average RGB. Treat alpha=0 as white (background).
            const a = data[i + 3];
            if (a === 0) continue;
            const lum = (data[i] + data[i + 1] + data[i + 2]) / 3;
            if (lum < 128) {
                out[y * bytesPerRow + (x >> 3)] |= 1 << (x & 7);
            }
        }
    }
    return out;
}

function bitmapToRowPackets(bitmap: Uint8Array, height: number): Uint8Array[] {
    // Send every row as a Bitmap frame, including blank rows. The Wireshark
    // capture shows iPrint emitting an unbroken bitmap stream between
    // lattice-start and the footer; injecting Feed mid-stream caused the
    // following row to be dropped on SC03h-class firmware.
    const packets: Uint8Array[] = new Array(height);
    for (let y = 0; y < height; y++) {
        const start = y * BYTES_PER_ROW;
        packets[y] = frame(Cmd.Bitmap, bitmap.slice(start, start + BYTES_PER_ROW));
    }
    return packets;
}

// ── Receipt rendering ────────────────────────────────────────────────────────

type DocLine =
    | { kind: 'text'; text: string; bold?: boolean; align?: 'left' | 'center' | 'right'; size?: 'normal' | 'large' | 'huge' }
    | { kind: 'divider' }
    | { kind: 'space'; px?: number };

function renderDoc(doc: DocLine[]): { data: Uint8Array; height: number } {
    if (typeof document === 'undefined') {
        throw new Error('Cat-printer rendering requires a browser document — call from client only.');
    }

    // Two-pass: first measure, then render to exact-height canvas.
    const measure = document.createElement('canvas');
    const mctx = measure.getContext('2d')!;
    measure.width = PAPER_WIDTH;

    type TextSize = 'normal' | 'large' | 'huge' | undefined;
    const sizePx = (s: TextSize) => s === 'huge' ? 48 : s === 'large' ? 32 : 22;
    const lineHeight = (s: TextSize) => s === 'huge' ? 56 : s === 'large' ? 38 : 28;

    let h = 12; // top margin
    for (const line of doc) {
        if (line.kind === 'text') {
            mctx.font = `${line.bold ? 'bold ' : ''}${sizePx(line.size)}px sans-serif`;
            // Word-wrap to canvas width
            const words = line.text.split(' ');
            let cur = '';
            let wraps = 0;
            for (const w of words) {
                const test = cur ? `${cur} ${w}` : w;
                if (mctx.measureText(test).width > PAPER_WIDTH - 8 && cur) {
                    wraps++;
                    cur = w;
                } else cur = test;
            }
            h += lineHeight(line.size) * (wraps + 1);
        } else if (line.kind === 'divider') {
            h += 6;
        } else if (line.kind === 'space') {
            h += line.px ?? 8;
        }
    }
    h += 12; // bottom margin

    // Paint
    const canvas = document.createElement('canvas');
    canvas.width = PAPER_WIDTH;
    canvas.height = h;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, PAPER_WIDTH, h);
    ctx.fillStyle = '#000';
    ctx.textBaseline = 'top';

    let y = 12;
    for (const line of doc) {
        if (line.kind === 'text') {
            const fontSize = sizePx(line.size);
            const lh = lineHeight(line.size);
            ctx.font = `${line.bold ? 'bold ' : ''}${fontSize}px sans-serif`;
            const align = line.align ?? 'left';
            ctx.textAlign = align === 'center' ? 'center' : align === 'right' ? 'right' : 'left';
            const xAnchor = align === 'center' ? PAPER_WIDTH / 2 : align === 'right' ? PAPER_WIDTH - 4 : 4;
            // Manual word wrap (textAlign respects xAnchor)
            const words = line.text.split(' ');
            let cur = '';
            for (const w of words) {
                const test = cur ? `${cur} ${w}` : w;
                if (ctx.measureText(test).width > PAPER_WIDTH - 8 && cur) {
                    ctx.fillText(cur, xAnchor, y);
                    y += lh;
                    cur = w;
                } else cur = test;
            }
            if (cur) {
                ctx.fillText(cur, xAnchor, y);
                y += lh;
            }
        } else if (line.kind === 'divider') {
            ctx.fillRect(4, y + 2, PAPER_WIDTH - 8, 2);
            y += 6;
        } else if (line.kind === 'space') {
            y += line.px ?? 8;
        }
    }

    const img = ctx.getImageData(0, 0, PAPER_WIDTH, h);
    return { data: imageDataToBitmap(img), height: h };
}

/** Structured print job. The driver writes `preamble` as one BLE op, then
 *  each `rows` packet sequentially with inter-row pacing, then `postamble`
 *  as one BLE op. Matches the iPrint capture's GATT op boundaries. */
export interface CatJob {
    preamble: Uint8Array;
    rows: Uint8Array[];
    postamble: Uint8Array;
}

export function buildPrintJob(doc: DocLine[]): CatJob {
    const { data, height } = renderDoc(doc);
    return {
        preamble: preamble(),
        rows: bitmapToRowPackets(data, height),
        postamble: postamble(),
    };
}

// ── High-level receipt builders ──────────────────────────────────────────────

export function buildTestPacketsCat(restaurantName: string): CatJob {
    return buildPrintJob([
        { kind: 'text', text: restaurantName, bold: true, align: 'center', size: 'huge' },
        { kind: 'text', text: 'PRINTER TEST', align: 'center', bold: true },
        { kind: 'divider' },
        { kind: 'text', text: 'If you can read this, the printer is connected and working.' },
        { kind: 'space' },
        { kind: 'text', text: 'Bold text test', bold: true },
        { kind: 'text', text: 'LARGE TEXT', size: 'large', bold: true, align: 'center' },
        { kind: 'space' },
        { kind: 'text', text: `Time: ${new Date().toLocaleTimeString('en-IN')}`, align: 'center' },
    ]);
}

export function buildKOTPacketsCat(order: Order, restaurantName: string): CatJob {
    const label =
        order.orderType === 'preorder' ? 'PARCEL' :
        order.tableNumber && order.tableNumber !== '0' ? `TABLE ${order.tableNumber}` :
        `TOKEN ${order.tokenNumber}`;
    const time = new Date(order.timestamp).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });

    const doc: DocLine[] = [
        { kind: 'text', text: restaurantName, bold: true, align: 'center', size: 'large' },
        { kind: 'text', text: 'KITCHEN ORDER', align: 'center' },
        { kind: 'divider' },
        { kind: 'text', text: label, bold: true, align: 'center', size: 'huge' },
        { kind: 'divider' },
        { kind: 'text', text: `Order: ${order.orderId}` },
        { kind: 'text', text: `Time:  ${time}` },
    ];
    if (order.preorderDetails?.pickupTime) {
        doc.push({ kind: 'text', text: `Pickup: ${order.preorderDetails.pickupTime}` });
    }
    if (order.customerName) {
        doc.push({ kind: 'text', text: `Name:  ${order.customerName}` });
    }
    doc.push({ kind: 'divider' });
    for (const it of order.items) {
        doc.push({ kind: 'text', text: `${it.quantity} x ${it.menuItem.name}`, bold: true });
        for (const a of it.selectedAddOns ?? []) {
            doc.push({ kind: 'text', text: `   + ${a.name}` });
        }
    }
    for (const e of order.extras ?? []) {
        doc.push({ kind: 'text', text: `${e.quantity} x ${e.extra.name}`, bold: true });
    }
    doc.push({ kind: 'divider' });
    return buildPrintJob(doc);
}

function padCols(left: string, right: string, totalWidth = 32): string {
    const space = Math.max(1, totalWidth - left.length - right.length);
    return left + ' '.repeat(space) + right;
}

export function buildBillPacketsCat(order: Order, restaurantName: string): CatJob {
    const time = new Date(order.timestamp).toLocaleString('en-IN', {
        day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true,
    });
    const payLine =
        order.paymentMethod === 'counter' ? '** PAY AT COUNTER **' :
        order.paymentMethod === 'online'  ? '** PAID ONLINE **'   : '';

    const doc: DocLine[] = [
        { kind: 'text', text: restaurantName, bold: true, align: 'center', size: 'large' },
        { kind: 'divider' },
        { kind: 'text', text: `Order: ${order.orderId}` },
        { kind: 'text', text: `Token: ${order.tokenNumber}` },
    ];
    if (order.tableNumber && order.tableNumber !== '0') {
        doc.push({ kind: 'text', text: `Table: ${order.tableNumber}` });
    }
    doc.push({ kind: 'text', text: `Time:  ${time}` });
    doc.push({ kind: 'divider' });

    let totalUnits = 0;
    for (const it of order.items) {
        const name = it.menuItem.name.length > 18 ? it.menuItem.name.slice(0, 18) : it.menuItem.name;
        doc.push({ kind: 'text', text: padCols(`${it.quantity} x ${name}`, `Rs.${it.totalPrice}`) });
        totalUnits += it.quantity;
        for (const a of it.selectedAddOns ?? []) {
            doc.push({ kind: 'text', text: padCols(`   + ${a.name}`, `Rs.${a.price}`) });
        }
    }
    for (const e of order.extras ?? []) {
        doc.push({ kind: 'text', text: padCols(`${e.quantity} x ${e.extra.name}`, `Rs.${e.extra.price * e.quantity}`) });
        totalUnits += e.quantity;
    }
    doc.push({ kind: 'divider' });
    doc.push({ kind: 'text', text: padCols('TOTAL', `Rs.${order.totalAmount}`), bold: true, size: 'large' });
    doc.push({ kind: 'text', text: `Items: ${totalUnits}` });
    if (payLine) {
        doc.push({ kind: 'space' });
        doc.push({ kind: 'text', text: payLine, bold: true, align: 'center' });
    }
    doc.push({ kind: 'space' });
    doc.push({ kind: 'text', text: 'Thank you!', align: 'center' });
    return buildPrintJob(doc);
}

export function buildStatsPacketsCat(orders: Order[], restaurantName: string): CatJob {
    const today = new Date();
    const todayStr = today.toDateString();
    const todayOrders = orders.filter(o => new Date(o.timestamp).toDateString() === todayStr);
    const revenue = todayOrders.reduce((s, o) => s + o.totalAmount, 0);
    const count = todayOrders.length;
    const aov = count > 0 ? Math.round(revenue / count) : 0;
    const status = {
        pending: todayOrders.filter(o => o.status === 'pending').length,
        preparing: todayOrders.filter(o => o.status === 'preparing').length,
        ready: todayOrders.filter(o => o.status === 'ready').length,
        delivered: todayOrders.filter(o => o.status === 'delivered').length,
    };
    const dineIn = todayOrders.filter(o => o.orderType === 'dine-in').length;
    const preorder = todayOrders.filter(o => o.orderType === 'preorder').length;
    const itemCounts: Record<string, number> = {};
    for (const o of todayOrders) for (const it of o.items) {
        itemCounts[it.menuItem.name] = (itemCounts[it.menuItem.name] ?? 0) + it.quantity;
    }
    const top = Object.entries(itemCounts).sort(([, a], [, b]) => b - a).slice(0, 5);

    const doc: DocLine[] = [
        { kind: 'text', text: restaurantName, bold: true, align: 'center', size: 'large' },
        { kind: 'text', text: 'DAILY SUMMARY', align: 'center' },
        { kind: 'text', text: today.toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' }), align: 'center' },
        { kind: 'divider' },
        { kind: 'text', text: 'REVENUE', bold: true },
        { kind: 'text', text: padCols('Total', `Rs.${revenue}`), bold: true, size: 'large' },
        { kind: 'text', text: padCols('Orders', String(count)) },
        { kind: 'text', text: padCols('Avg order', `Rs.${aov}`) },
        { kind: 'divider' },
        { kind: 'text', text: 'STATUS', bold: true },
        { kind: 'text', text: padCols('Pending', String(status.pending)) },
        { kind: 'text', text: padCols('Preparing', String(status.preparing)) },
        { kind: 'text', text: padCols('Ready', String(status.ready)) },
        { kind: 'text', text: padCols('Delivered', String(status.delivered)) },
        { kind: 'divider' },
        { kind: 'text', text: 'ORDER TYPE', bold: true },
        { kind: 'text', text: padCols('Dine-in', String(dineIn)) },
        { kind: 'text', text: padCols('Preorder', String(preorder)) },
    ];
    if (top.length > 0) {
        doc.push({ kind: 'divider' });
        doc.push({ kind: 'text', text: 'TOP SELLERS', bold: true });
        for (const [name, qty] of top) {
            const truncated = name.length > 22 ? name.slice(0, 22) : name;
            doc.push({ kind: 'text', text: padCols(truncated, `x${qty}`) });
        }
    }
    return buildPrintJob(doc);
}
