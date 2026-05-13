import fs from 'fs';
import path from 'path';
import type { DocLine } from './types';
import { PAPER_WIDTH, BYTES_PER_ROW } from './types';

// Vercel's serverless runtime has no system fonts installed, so node-canvas
// renders missing-glyph boxes (the "tofu" □□□ pattern) for every character
// unless we register a TTF ourselves. Bundle Noto Sans Latin (~28 KB) in the
// repo and register it once at module load. The same file is used for both
// regular and bold requests — there's no true bold weight, but the text
// renders rather than tofuing out.
const FONT_FAMILY = 'PrintFont';

/** Resolve the bundled TTF. On Vercel's standalone build, cwd is
 *  ".next/standalone" and the file is copied to the same lib/printer/fonts
 *  path under that root (thanks to outputFileTracingIncludes in next.config).
 *  Try a couple of locations so this also works in `next dev`. */
function findFontPath(): string | null {
    const candidates = [
        path.join(process.cwd(), 'lib', 'printer', 'fonts', 'NotoSans-Regular.ttf'),
        path.join(process.cwd(), '.next', 'standalone', 'lib', 'printer', 'fonts', 'NotoSans-Regular.ttf'),
        // When this file is bundled, __dirname points into .next; resolve up to repo root
        path.resolve(__dirname, '..', '..', 'lib', 'printer', 'fonts', 'NotoSans-Regular.ttf'),
    ];
    for (const p of candidates) {
        try { if (fs.existsSync(p)) return p; } catch { /* ignore */ }
    }
    return null;
}

let fontRegistered = false;
let fontLoggedMissing = false;
async function ensureFontRegistered() {
    if (fontRegistered) return;
    const fontPath = findFontPath();
    if (!fontPath) {
        if (!fontLoggedMissing) {
            console.error('[print] FONT MISSING — receipts will render as tofu. cwd=' + process.cwd());
            fontLoggedMissing = true;
        }
        return;
    }
    try {
        const { registerFont } = await import('canvas');
        registerFont(fontPath, { family: FONT_FAMILY, weight: 'normal' });
        registerFont(fontPath, { family: FONT_FAMILY, weight: 'bold' });
        fontRegistered = true;
        console.log('[print] font registered from ' + fontPath);
    } catch (err) {
        console.error('[print] registerFont failed:', err);
    }
}

type TextSize = 'normal' | 'large' | 'huge' | undefined;
const sizePx  = (s: TextSize) => s === 'huge' ? 48 : s === 'large' ? 32 : 22;
const lineH   = (s: TextSize) => s === 'huge' ? 56 : s === 'large' ? 38 : 28;

function font(bold: boolean | undefined, s: TextSize) {
    return `${bold ? 'bold ' : ''}${sizePx(s)}px "${FONT_FAMILY}", sans-serif`;
}

// Resolve a src string to a Buffer for loadImage.
// Accepts /public-relative paths (e.g. /upi-qr.jpg) and https:// URLs.
async function resolveImageSrc(src: string): Promise<Buffer | string | null> {
    try {
        if (src.startsWith('/')) {
            const filePath = path.join(process.cwd(), 'public', src);
            if (fs.existsSync(filePath)) return fs.readFileSync(filePath);
            return null;
        }
        if (src.startsWith('http://') || src.startsWith('https://')) return src;
        return null;
    } catch {
        return null;
    }
}

/** Measure total canvas height needed for a doc (two-pass approach). */
async function measureHeight(doc: DocLine[], mctx: CanvasRenderingContext2D): Promise<number> {
    let h = 12;
    for (const line of doc) {
        if (line.kind === 'text') {
            mctx.font = font(line.bold, line.size);
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
            h += lineH(line.size) * (wraps + 1);
        } else if (line.kind === 'divider') {
            h += 6;
        } else if (line.kind === 'image' || line.kind === 'qr') {
            h += (line.size ?? 180) + 8;
        } else {
            h += (line as { px?: number }).px ?? 8;
        }
    }
    return h + 12;
}

/** Convert canvas ImageData to LSB-first 1-bit packed bytes — what the
 *  cat-printer firmware expects (matches imageDataToBitmap in catPrinter.ts).
 *  Each output byte is 8 horizontal pixels with bit 0 = leftmost. */
function imageDataToBitmap(
    data: Uint8ClampedArray,
    width: number,
    height: number,
): Buffer {
    const out = Buffer.alloc(BYTES_PER_ROW * height, 0);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const i = (y * width + x) * 4;
            const a = data[i + 3];
            if (a === 0) continue; // transparent → white
            const lum = (data[i] + data[i + 1] + data[i + 2]) / 3;
            if (lum < 128) {
                out[y * BYTES_PER_ROW + (x >> 3)] |= 1 << (x & 7);
            }
        }
    }
    return out;
}

/** Render a receipt doc to a 1-bit MSB-first raster using node-canvas.
 *  Server-only — never call from browser code. */
export async function renderDocServer(doc: DocLine[]): Promise<{ data: Buffer; width: number; height: number }> {
    const { createCanvas, loadImage } = await import('canvas');
    await ensureFontRegistered();

    // First pass: measure
    const measure = createCanvas(PAPER_WIDTH, 1);
    const mctx = measure.getContext('2d') as unknown as CanvasRenderingContext2D;
    const height = await measureHeight(doc, mctx);

    // Second pass: render
    const canvas = createCanvas(PAPER_WIDTH, height);
    const ctx = canvas.getContext('2d') as unknown as CanvasRenderingContext2D;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, PAPER_WIDTH, height);
    ctx.fillStyle = '#000';
    ctx.textBaseline = 'top';

    let y = 12;
    for (const line of doc) {
        if (line.kind === 'text') {
            const lh = lineH(line.size);
            ctx.font = font(line.bold, line.size);
            const align = line.align ?? 'left';
            ctx.textAlign = align === 'center' ? 'center' : align === 'right' ? 'right' : 'left';
            const xAnchor = align === 'center' ? PAPER_WIDTH / 2 : align === 'right' ? PAPER_WIDTH - 4 : 4;
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
            if (cur) { ctx.fillText(cur, xAnchor, y); y += lh; }
        } else if (line.kind === 'divider') {
            ctx.fillRect(4, y + 2, PAPER_WIDTH - 8, 2);
            y += 6;
        } else if (line.kind === 'qr') {
            const imgSize = line.size ?? 180;
            try {
                const QRCode = await import('qrcode');
                const buf = await QRCode.toBuffer(line.data, {
                    width: imgSize,
                    margin: 1,
                    color: { dark: '#000000', light: '#ffffff' },
                });
                const img = await loadImage(buf);
                const x = Math.round((PAPER_WIDTH - imgSize) / 2);
                ctx.drawImage(img as unknown as CanvasImageSource, x, y, imgSize, imgSize);
            } catch {
                // QR generation failed — leave blank space
            }
            y += imgSize + 8;
        } else if (line.kind === 'image') {
            const imgSize = line.size ?? 180;
            const src = await resolveImageSrc(line.src);
            if (src) {
                try {
                    const img = await loadImage(src as Parameters<typeof loadImage>[0]);
                    const x = Math.round((PAPER_WIDTH - imgSize) / 2);
                    ctx.drawImage(img as unknown as CanvasImageSource, x, y, imgSize, imgSize);
                } catch {
                    // image load failed — leave blank space
                }
            }
            y += imgSize + 8;
        } else {
            y += (line as { px?: number }).px ?? 8;
        }
    }

    const imgData = ctx.getImageData(0, 0, PAPER_WIDTH, height);
    const data = imageDataToBitmap(
        imgData.data as unknown as Uint8ClampedArray,
        PAPER_WIDTH,
        height,
    );

    return { data, width: PAPER_WIDTH, height };
}
