export type DocLine =
    | { kind: 'text'; text: string; bold?: boolean; align?: 'left' | 'center' | 'right'; size?: 'normal' | 'large' | 'huge' }
    | { kind: 'divider' }
    | { kind: 'space'; px?: number }
    | { kind: 'image'; src: string; size?: number }   // src: /public path or https URL; size: px square, default 180
    | { kind: 'qr'; data: string; size?: number };    // generates a crisp QR at render time; size: px square, default 180

export const PAPER_WIDTH = 384;   // pixels (58mm @ 8 dots/mm)
export const BYTES_PER_ROW = PAPER_WIDTH / 8;  // 48
export const FEED_LINES = 32;
