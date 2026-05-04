import fs from 'fs';
import path from 'path';
import type { DocLine } from './types';
import { PAPER_WIDTH, BYTES_PER_ROW } from './types';

type TextSize = 'normal' | 'large' | 'huge' | undefined;
const sizePx  = (s: TextSize) => s === 'huge' ? 48 : s === 'large' ? 32 : 22;
const lineH   = (s: TextSize) => s === 'huge' ? 56 : s === 'large' ? 38 : 28;

function font(bold: boolean | undefined, s: TextSize) {
    return `${bold ? 'bold ' : ''}${sizePx(s)}px sans-serif`;
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
        } else if (line.kind === 'image') {
            h += (line.size ?? 180) + 8;
        } else {
            h += (line as { px?: number }).px ?? 8;
        }
    }
    return h + 12;
}

/** Convert canvas ImageData to MSB-first 1-bit packed bytes. */
function imageDataToMSBFirst(
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
                out[y * BYTES_PER_ROW + (x >> 3)] |= 0x80 >> (x & 7);
            }
        }
    }
    return out;
}

/** Render a receipt doc to a 1-bit MSB-first raster using node-canvas.
 *  Server-only — never call from browser code. */
export async function renderDocServer(doc: DocLine[]): Promise<{ data: Buffer; width: number; height: number }> {
    const { createCanvas, loadImage } = await import('canvas');

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
        } else if (line.kind === 'image') {
            const imgSize = line.size ?? 180;
            const src = await resolveImageSrc(line.src);
            if (src) {
                try {
                    const img = await loadImage(src as Parameters<typeof loadImage>[0]);
                    const x = Math.round((PAPER_WIDTH - imgSize) / 2);
                    ctx.drawImage(img, x, y, imgSize, imgSize);
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
    const data = imageDataToMSBFirst(
        imgData.data as unknown as Uint8ClampedArray,
        PAPER_WIDTH,
        height,
    );

    return { data, width: PAPER_WIDTH, height };
}
