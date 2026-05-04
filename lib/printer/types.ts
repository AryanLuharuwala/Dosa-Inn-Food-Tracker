export type DocLine =
    | { kind: 'text'; text: string; bold?: boolean; align?: 'left' | 'center' | 'right'; size?: 'normal' | 'large' | 'huge' }
    | { kind: 'divider' }
    | { kind: 'space'; px?: number };

export const PAPER_WIDTH = 384;   // pixels (58mm @ 8 dots/mm)
export const BYTES_PER_ROW = PAPER_WIDTH / 8;  // 48
export const FEED_LINES = 32;
