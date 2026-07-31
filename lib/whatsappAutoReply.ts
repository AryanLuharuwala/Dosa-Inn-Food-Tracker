/**
 * Keyword -> reply rules for inbound WhatsApp messages. Same getDb() +
 * prepared-statement pattern as every other lib this session.
 */

import { randomBytes } from 'crypto';
import { getDb } from '@/lib/db';

export type MatchType = 'exact' | 'contains';
export type ResponseType = 'start_order_flow' | 'text';

export interface AutoReplyRule {
    id: string;
    keyword: string;
    matchType: MatchType;
    responseType: ResponseType;
    responseText: string | null;
    responseImageUrl: string | null;
    enabled: boolean;
    createdAt: string;
}

interface RuleRow {
    id: string; keyword: string; match_type: MatchType; response_type: ResponseType;
    response_text: string | null; response_image_url: string | null; enabled: number; created_at: string;
}

function rowToRule(r: RuleRow): AutoReplyRule {
    return {
        id: r.id, keyword: r.keyword, matchType: r.match_type, responseType: r.response_type,
        responseText: r.response_text, responseImageUrl: r.response_image_url,
        enabled: !!r.enabled, createdAt: r.created_at,
    };
}

export async function listAutoReplyRules(): Promise<AutoReplyRule[]> {
    const db = getDb();
    const rows = db.prepare('SELECT * FROM whatsapp_auto_replies ORDER BY created_at DESC').all() as RuleRow[];
    return rows.map(rowToRule);
}

export async function listEnabledAutoReplyRules(): Promise<AutoReplyRule[]> {
    const db = getDb();
    const rows = db.prepare('SELECT * FROM whatsapp_auto_replies WHERE enabled = 1 ORDER BY created_at ASC').all() as RuleRow[];
    return rows.map(rowToRule);
}

export async function createAutoReplyRule(params: {
    keyword: string; matchType: MatchType; responseType: ResponseType;
    responseText?: string; responseImageUrl?: string;
}): Promise<AutoReplyRule> {
    const db = getDb();
    const id = randomBytes(8).toString('hex');
    const createdAt = new Date().toISOString();
    db.prepare(`
        INSERT INTO whatsapp_auto_replies (id, keyword, match_type, response_type, response_text, response_image_url, enabled, created_at)
        VALUES (?, ?, ?, ?, ?, ?, 1, ?)
    `).run(id, params.keyword.trim().toLowerCase(), params.matchType, params.responseType, params.responseText ?? null, params.responseImageUrl ?? null, createdAt);
    return {
        id, keyword: params.keyword.trim().toLowerCase(), matchType: params.matchType, responseType: params.responseType,
        responseText: params.responseText ?? null, responseImageUrl: params.responseImageUrl ?? null, enabled: true, createdAt,
    };
}

export async function setAutoReplyRuleEnabled(id: string, enabled: boolean): Promise<void> {
    const db = getDb();
    db.prepare('UPDATE whatsapp_auto_replies SET enabled = ? WHERE id = ?').run(enabled ? 1 : 0, id);
}

export async function deleteAutoReplyRule(id: string): Promise<void> {
    const db = getDb();
    db.prepare('DELETE FROM whatsapp_auto_replies WHERE id = ?').run(id);
}

/** Case-insensitive, trimmed. First enabled rule that matches wins. */
export function matchAutoReplyRule(rules: AutoReplyRule[], text: string): AutoReplyRule | null {
    const normalized = text.trim().toLowerCase();
    if (!normalized) return null;
    for (const rule of rules) {
        if (rule.matchType === 'exact' && normalized === rule.keyword) return rule;
        if (rule.matchType === 'contains' && normalized.includes(rule.keyword)) return rule;
    }
    return null;
}
