/**
 * WhatsApp marketing data layer — subscribers, groups, campaigns, automation
 * rules. Same read/write patterns as lib/localDb.ts and lib/printer/printerDb.ts
 * (getDb() + prepared statements, JSON-blob-free here since every field maps
 * to a real column).
 */

import { randomBytes } from 'crypto';
import { getDb } from '@/lib/db';

function nowIso(): string {
    return new Date().toISOString();
}

function newId(): string {
    return randomBytes(8).toString('hex');
}

// ── Subscribers ──────────────────────────────────────────────────────────────

export interface Subscriber {
    phone: string;
    name: string | null;
    subscribedAt: string;
    optedOutAt: string | null;
    source: string | null;
}

function rowToSubscriber(r: { phone: string; name: string | null; subscribed_at: string; opted_out_at: string | null; source: string | null }): Subscriber {
    return { phone: r.phone, name: r.name, subscribedAt: r.subscribed_at, optedOutAt: r.opted_out_at, source: r.source };
}

/** Upsert — re-subscribing after an opt-out clears the opt-out flag. */
export async function subscribe(phone: string, name?: string, source?: string): Promise<void> {
    const db = getDb();
    const digits = phone.replace(/\D/g, '');
    const existing = db.prepare('SELECT phone FROM marketing_subscribers WHERE phone = ?').get(digits);
    if (existing) {
        db.prepare('UPDATE marketing_subscribers SET opted_out_at = NULL, name = COALESCE(?, name) WHERE phone = ?').run(name ?? null, digits);
    } else {
        db.prepare('INSERT INTO marketing_subscribers (phone, name, subscribed_at, opted_out_at, source) VALUES (?, ?, ?, NULL, ?)')
            .run(digits, name ?? null, nowIso(), source ?? null);
    }
}

export async function unsubscribe(phone: string): Promise<void> {
    const db = getDb();
    db.prepare('UPDATE marketing_subscribers SET opted_out_at = ? WHERE phone = ?').run(nowIso(), phone.replace(/\D/g, ''));
}

export async function removeSubscriber(phone: string): Promise<void> {
    const db = getDb();
    const digits = phone.replace(/\D/g, '');
    db.prepare('DELETE FROM marketing_subscribers WHERE phone = ?').run(digits);
    db.prepare('DELETE FROM marketing_group_members WHERE phone = ?').run(digits);
}

export async function listSubscribers(): Promise<Subscriber[]> {
    const db = getDb();
    const rows = db.prepare('SELECT * FROM marketing_subscribers ORDER BY subscribed_at DESC').all() as Parameters<typeof rowToSubscriber>[0][];
    return rows.map(rowToSubscriber);
}

export async function listActiveSubscriberPhones(groupId?: string | null): Promise<string[]> {
    const db = getDb();
    if (groupId) {
        const rows = db.prepare(`
            SELECT s.phone FROM marketing_subscribers s
            JOIN marketing_group_members m ON m.phone = s.phone
            WHERE s.opted_out_at IS NULL AND m.group_id = ?
        `).all(groupId) as { phone: string }[];
        return rows.map(r => r.phone);
    }
    const rows = db.prepare('SELECT phone FROM marketing_subscribers WHERE opted_out_at IS NULL').all() as { phone: string }[];
    return rows.map(r => r.phone);
}

// ── Groups ───────────────────────────────────────────────────────────────────

export interface MarketingGroup {
    id: string;
    name: string;
    createdAt: string;
    memberCount: number;
}

export async function createGroup(name: string): Promise<MarketingGroup> {
    const db = getDb();
    const id = newId();
    const createdAt = nowIso();
    db.prepare('INSERT INTO marketing_groups (id, name, created_at) VALUES (?, ?, ?)').run(id, name, createdAt);
    return { id, name, createdAt, memberCount: 0 };
}

export async function deleteGroup(id: string): Promise<void> {
    const db = getDb();
    db.prepare('DELETE FROM marketing_group_members WHERE group_id = ?').run(id);
    db.prepare('DELETE FROM marketing_groups WHERE id = ?').run(id);
}

export async function listGroups(): Promise<MarketingGroup[]> {
    const db = getDb();
    const rows = db.prepare(`
        SELECT g.id, g.name, g.created_at, COUNT(m.phone) as member_count
        FROM marketing_groups g
        LEFT JOIN marketing_group_members m ON m.group_id = g.id
        GROUP BY g.id
        ORDER BY g.created_at DESC
    `).all() as { id: string; name: string; created_at: string; member_count: number }[];
    return rows.map(r => ({ id: r.id, name: r.name, createdAt: r.created_at, memberCount: r.member_count }));
}

export async function getGroupMemberPhones(groupId: string): Promise<string[]> {
    const db = getDb();
    const rows = db.prepare('SELECT phone FROM marketing_group_members WHERE group_id = ?').all(groupId) as { phone: string }[];
    return rows.map(r => r.phone);
}

export async function addGroupMember(groupId: string, phone: string): Promise<void> {
    const db = getDb();
    db.prepare('INSERT OR IGNORE INTO marketing_group_members (group_id, phone) VALUES (?, ?)').run(groupId, phone.replace(/\D/g, ''));
}

export async function removeGroupMember(groupId: string, phone: string): Promise<void> {
    const db = getDb();
    db.prepare('DELETE FROM marketing_group_members WHERE group_id = ? AND phone = ?').run(groupId, phone.replace(/\D/g, ''));
}

// ── Campaigns ────────────────────────────────────────────────────────────────

export type CampaignStatus = 'draft' | 'scheduled' | 'sending' | 'sent' | 'cancelled' | 'active';
export type TriggerType = 'manual' | 'scheduled' | 'rule';

export interface Campaign {
    id: string;
    name: string;
    message: string;
    imageUrl: string | null;
    linkUrl: string | null;
    targetGroupId: string | null;
    triggerType: TriggerType;
    scheduledAt: string | null;
    status: CampaignStatus;
    createdAt: string;
    sentCount: number;
    failedCount: number;
}

interface CampaignRow {
    id: string; name: string; message: string; image_url: string | null; link_url: string | null;
    target_group_id: string | null; trigger_type: TriggerType; scheduled_at: string | null;
    status: CampaignStatus; created_at: string; sent_count: number; failed_count: number;
}

function rowToCampaign(r: CampaignRow): Campaign {
    return {
        id: r.id, name: r.name, message: r.message, imageUrl: r.image_url, linkUrl: r.link_url,
        targetGroupId: r.target_group_id, triggerType: r.trigger_type, scheduledAt: r.scheduled_at,
        status: r.status, createdAt: r.created_at, sentCount: r.sent_count, failedCount: r.failed_count,
    };
}

export async function createCampaign(params: {
    name: string; message: string; imageUrl?: string; linkUrl?: string;
    targetGroupId?: string; scheduledAt?: string; // omit scheduledAt + not a rule → draft
}): Promise<Campaign> {
    const db = getDb();
    const id = newId();
    const createdAt = nowIso();
    const status: CampaignStatus = params.scheduledAt ? 'scheduled' : 'draft';
    db.prepare(`
        INSERT INTO marketing_campaigns
            (id, name, message, image_url, link_url, target_group_id, trigger_type, scheduled_at, status, created_at, sent_count, failed_count)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0)
    `).run(
        id, params.name, params.message, params.imageUrl ?? null, params.linkUrl ?? null,
        params.targetGroupId ?? null, params.scheduledAt ? 'scheduled' : 'manual', params.scheduledAt ?? null,
        status, createdAt,
    );
    return {
        id, name: params.name, message: params.message, imageUrl: params.imageUrl ?? null, linkUrl: params.linkUrl ?? null,
        targetGroupId: params.targetGroupId ?? null, triggerType: params.scheduledAt ? 'scheduled' : 'manual',
        scheduledAt: params.scheduledAt ?? null, status, createdAt, sentCount: 0, failedCount: 0,
    };
}

/** "Send now" and "schedule for later" are the same mechanism — sending now
 *  just schedules for the current instant, so the same interval-driven
 *  scheduler path handles both (no separate synchronous send codepath that
 *  could block a request for as long as a large, paced campaign takes). */
export async function scheduleCampaignNow(id: string): Promise<void> {
    const db = getDb();
    db.prepare("UPDATE marketing_campaigns SET status = 'scheduled', trigger_type = 'scheduled', scheduled_at = ? WHERE id = ? AND status IN ('draft','scheduled')")
        .run(nowIso(), id);
}

export async function cancelCampaign(id: string): Promise<void> {
    const db = getDb();
    db.prepare("UPDATE marketing_campaigns SET status = 'cancelled' WHERE id = ? AND status IN ('draft','scheduled')").run(id);
}

export async function listCampaigns(): Promise<Campaign[]> {
    const db = getDb();
    const rows = db.prepare('SELECT * FROM marketing_campaigns ORDER BY created_at DESC').all() as CampaignRow[];
    return rows.map(rowToCampaign);
}

export async function getCampaign(id: string): Promise<Campaign | null> {
    const db = getDb();
    const row = db.prepare('SELECT * FROM marketing_campaigns WHERE id = ?').get(id) as CampaignRow | undefined;
    return row ? rowToCampaign(row) : null;
}

/** Due, one-off scheduled campaigns — picked up by the scheduler. */
export async function listDueCampaigns(): Promise<Campaign[]> {
    const db = getDb();
    const rows = db.prepare("SELECT * FROM marketing_campaigns WHERE status = 'scheduled' AND scheduled_at <= ?").all(nowIso()) as CampaignRow[];
    return rows.map(rowToCampaign);
}

/** Atomic claim — only succeeds (returns true) if the campaign is still
 *  'scheduled', so two overlapping scheduler ticks can't both start sending
 *  the same campaign to every recipient. */
export async function tryClaimCampaignForSending(id: string): Promise<boolean> {
    const db = getDb();
    const res = db.prepare("UPDATE marketing_campaigns SET status = 'sending' WHERE id = ? AND status = 'scheduled'").run(id);
    return res.changes > 0;
}

export async function recordCampaignSend(campaignId: string, phone: string, ok: boolean, error?: string): Promise<void> {
    const db = getDb();
    db.prepare('INSERT INTO marketing_sends (campaign_id, phone, status, sent_at, error) VALUES (?, ?, ?, ?, ?)')
        .run(campaignId, phone, ok ? 'sent' : 'failed', nowIso(), error ?? null);
    db.prepare(`UPDATE marketing_campaigns SET ${ok ? 'sent_count' : 'failed_count'} = ${ok ? 'sent_count' : 'failed_count'} + 1 WHERE id = ?`).run(campaignId);
}

export async function markCampaignSent(id: string): Promise<void> {
    const db = getDb();
    db.prepare("UPDATE marketing_campaigns SET status = 'sent' WHERE id = ?").run(id);
}

// ── Automation rules ─────────────────────────────────────────────────────────

export type TriggerKind = 'order_ready_uncollected' | 'customer_inactive';

export interface AutomationRule {
    id: string;
    name: string;
    enabled: boolean;
    triggerKind: TriggerKind;
    triggerParams: Record<string, number>;
    campaignId: string;
    createdAt: string;
}

interface RuleRow {
    id: string; name: string; enabled: number; trigger_kind: TriggerKind;
    trigger_params: string; campaign_id: string; created_at: string;
}

function rowToRule(r: RuleRow): AutomationRule {
    return {
        id: r.id, name: r.name, enabled: !!r.enabled, triggerKind: r.trigger_kind,
        triggerParams: JSON.parse(r.trigger_params), campaignId: r.campaign_id, createdAt: r.created_at,
    };
}

export async function createRule(params: {
    name: string; triggerKind: TriggerKind; triggerParams: Record<string, number>; campaignId: string;
}): Promise<AutomationRule> {
    const db = getDb();
    const id = newId();
    const createdAt = nowIso();
    db.prepare('INSERT INTO automation_rules (id, name, enabled, trigger_kind, trigger_params, campaign_id, created_at) VALUES (?, ?, 1, ?, ?, ?, ?)')
        .run(id, params.name, params.triggerKind, JSON.stringify(params.triggerParams), params.campaignId, createdAt);
    // Rule-driven campaigns don't go through the draft/scheduled states.
    db.prepare("UPDATE marketing_campaigns SET status = 'active', trigger_type = 'rule' WHERE id = ?").run(params.campaignId);
    return { id, name: params.name, enabled: true, triggerKind: params.triggerKind, triggerParams: params.triggerParams, campaignId: params.campaignId, createdAt };
}

export async function setRuleEnabled(id: string, enabled: boolean): Promise<void> {
    const db = getDb();
    db.prepare('UPDATE automation_rules SET enabled = ? WHERE id = ?').run(enabled ? 1 : 0, id);
}

export async function deleteRule(id: string): Promise<void> {
    const db = getDb();
    db.prepare('DELETE FROM automation_rules WHERE id = ?').run(id);
    db.prepare('DELETE FROM automation_fired WHERE rule_id = ?').run(id);
}

export async function listRules(): Promise<AutomationRule[]> {
    const db = getDb();
    const rows = db.prepare('SELECT * FROM automation_rules ORDER BY created_at DESC').all() as RuleRow[];
    return rows.map(rowToRule);
}

export async function countFired(ruleId: string): Promise<number> {
    const db = getDb();
    return (db.prepare('SELECT COUNT(*) c FROM automation_fired WHERE rule_id = ?').get(ruleId) as { c: number }).c;
}

/** Atomically claims (rule, subject) — returns true only for the caller that
 *  actually wins the insert, false if it's already fired. Must be called
 *  BEFORE sending (not after) so two overlapping scheduler ticks can't both
 *  pass a check-then-insert race and double-send the same subject. */
export async function tryClaimFire(ruleId: string, subject: string): Promise<boolean> {
    const db = getDb();
    const res = db.prepare('INSERT OR IGNORE INTO automation_fired (rule_id, subject, fired_at) VALUES (?, ?, ?)').run(ruleId, subject, nowIso());
    return res.changes > 0;
}
