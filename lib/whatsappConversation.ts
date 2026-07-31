/**
 * Poll-based ordering conversation state. Each phone has one active
 * conversation; each conversation step can have several simultaneous polls
 * outstanding (one item-poll per selected category, one quantity-poll per
 * selected item) — each poll tracks its own current vote tally
 * independently, and gets merged into the conversation's selections only
 * once every poll for that step has settled (see lib/whatsappPollScheduler.ts).
 */

import { getDb } from '@/lib/db';

export type ConversationStep = 'awaiting_categories' | 'awaiting_items' | 'awaiting_quantities' | 'done';
export type PollKind = 'category' | 'item' | 'quantity';

export interface Selections {
    categoryIds: string[];
    itemIds: string[];
    quantities: Record<string, number>;
}

export interface ConversationState {
    phone: string;
    step: ConversationStep;
    selections: Selections;
    updatedAt: string;
}

export interface PollOption {
    id: string;
    label: string;
}

export interface PollRecord {
    pollId: string;
    phone: string;
    kind: PollKind;
    context: string | null;
    options: PollOption[];
    currentSelection: string[];
    createdAt: string;
    lastVoteAt: string | null;
    settled: boolean;
}

function emptySelections(): Selections {
    return { categoryIds: [], itemIds: [], quantities: {} };
}

function nowIso(): string {
    return new Date().toISOString();
}

export async function getConversation(phone: string): Promise<ConversationState | null> {
    const db = getDb();
    const row = db.prepare('SELECT * FROM whatsapp_conversations WHERE phone = ?').get(phone) as
        { phone: string; step: ConversationStep; selections: string; updated_at: string } | undefined;
    if (!row) return null;
    return { phone: row.phone, step: row.step, selections: JSON.parse(row.selections), updatedAt: row.updated_at };
}

export async function startConversation(phone: string): Promise<ConversationState> {
    const db = getDb();
    const now = nowIso();
    const selections = emptySelections();
    db.prepare(`
        INSERT INTO whatsapp_conversations (phone, step, selections, updated_at) VALUES (?, 'awaiting_categories', ?, ?)
        ON CONFLICT(phone) DO UPDATE SET step = 'awaiting_categories', selections = excluded.selections, updated_at = excluded.updated_at
    `).run(phone, JSON.stringify(selections), now);
    return { phone, step: 'awaiting_categories', selections, updatedAt: now };
}

export async function setConversationStep(phone: string, step: ConversationStep, selections: Selections): Promise<void> {
    const db = getDb();
    db.prepare('UPDATE whatsapp_conversations SET step = ?, selections = ?, updated_at = ? WHERE phone = ?')
        .run(step, JSON.stringify(selections), nowIso(), phone);
}

export async function endConversation(phone: string): Promise<void> {
    const db = getDb();
    db.prepare('DELETE FROM whatsapp_conversations WHERE phone = ?').run(phone);
    db.prepare('DELETE FROM whatsapp_polls WHERE phone = ? AND settled = 0').run(phone);
}

function rowToPoll(r: {
    poll_id: string; phone: string; kind: PollKind; context: string | null; options: string;
    current_selection: string; created_at: string; last_vote_at: string | null; settled: number;
}): PollRecord {
    return {
        pollId: r.poll_id, phone: r.phone, kind: r.kind, context: r.context,
        options: JSON.parse(r.options), currentSelection: JSON.parse(r.current_selection),
        createdAt: r.created_at, lastVoteAt: r.last_vote_at, settled: !!r.settled,
    };
}

export async function createPoll(params: {
    pollId: string; phone: string; kind: PollKind; context?: string; options: PollOption[];
}): Promise<void> {
    const db = getDb();
    db.prepare(`
        INSERT INTO whatsapp_polls (poll_id, phone, kind, context, options, current_selection, created_at, last_vote_at, settled)
        VALUES (?, ?, ?, ?, ?, '[]', ?, NULL, 0)
    `).run(params.pollId, params.phone, params.kind, params.context ?? null, JSON.stringify(params.options), nowIso());
}

export async function getPoll(pollId: string): Promise<PollRecord | null> {
    const db = getDb();
    const row = db.prepare('SELECT * FROM whatsapp_polls WHERE poll_id = ?').get(pollId) as Parameters<typeof rowToPoll>[0] | undefined;
    return row ? rowToPoll(row) : null;
}

/** Records the FULL current tally for a poll (WhatsApp poll votes are
 *  snapshots, not deltas) by resolving the voted option labels back to
 *  real ids via the poll's own stored options list. */
export async function recordVote(pollId: string, selectedOptionLabels: string[]): Promise<void> {
    const db = getDb();
    const poll = await getPoll(pollId);
    if (!poll) return;
    const ids = poll.options.filter(o => selectedOptionLabels.includes(o.label)).map(o => o.id);
    db.prepare('UPDATE whatsapp_polls SET current_selection = ?, last_vote_at = ? WHERE poll_id = ?')
        .run(JSON.stringify(ids), nowIso(), pollId);
}

export async function getOutstandingPolls(phone: string, kind: PollKind): Promise<PollRecord[]> {
    const db = getDb();
    const rows = db.prepare('SELECT * FROM whatsapp_polls WHERE phone = ? AND kind = ? AND settled = 0').all(phone, kind) as Parameters<typeof rowToPoll>[0][];
    return rows.map(rowToPoll);
}

/** All polls (settled or not) for a phone+kind — used once a batch has
 *  fully settled, to merge every poll's tally into the conversation. */
export async function getAllPollsForPhoneKind(phone: string, kind: PollKind): Promise<PollRecord[]> {
    const db = getDb();
    const rows = db.prepare('SELECT * FROM whatsapp_polls WHERE phone = ? AND kind = ?').all(phone, kind) as Parameters<typeof rowToPoll>[0][];
    return rows.map(rowToPoll);
}

export async function clearPollsForPhoneKind(phone: string, kind: PollKind): Promise<void> {
    const db = getDb();
    db.prepare('DELETE FROM whatsapp_polls WHERE phone = ? AND kind = ?').run(phone, kind);
}

/** Polls due to settle: either voted-on and quiet for `voteDebounceMs`, or
 *  never voted on at all and older than `noVoteTimeoutMs` (an ignored poll
 *  in a batch shouldn't hang the whole conversation forever). */
export async function getDuePolls(voteDebounceMs: number, noVoteTimeoutMs: number): Promise<PollRecord[]> {
    const db = getDb();
    const voteCutoff = new Date(Date.now() - voteDebounceMs).toISOString();
    const noVoteCutoff = new Date(Date.now() - noVoteTimeoutMs).toISOString();
    const rows = db.prepare(`
        SELECT * FROM whatsapp_polls
        WHERE settled = 0 AND (
            (last_vote_at IS NOT NULL AND last_vote_at <= ?)
            OR (last_vote_at IS NULL AND created_at <= ?)
        )
    `).all(voteCutoff, noVoteCutoff) as Parameters<typeof rowToPoll>[0][];
    return rows.map(rowToPoll);
}

export async function markPollSettled(pollId: string): Promise<void> {
    const db = getDb();
    db.prepare('UPDATE whatsapp_polls SET settled = 1 WHERE poll_id = ?').run(pollId);
}
