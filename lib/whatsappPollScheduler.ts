/**
 * Debounce ticker for the poll-based ordering conversation. A second,
 * faster setInterval alongside lib/marketing/scheduler.ts's — same
 * instrumentation.ts one-time-boot hook, same "no cron/queue infra" reason.
 *
 * Each tick finds polls that are due to settle (voted-on and quiet for
 * VOTE_DEBOUNCE_MS, or never voted on and older than NO_VOTE_TIMEOUT_MS so a
 * batched poll nobody taps doesn't hang the conversation forever), marks
 * them settled, and — once every poll in that phone's current batch has
 * settled — merges the tallies and advances the conversation: category ->
 * items -> quantities -> real order.
 */

import type { PollOption } from '@/lib/whatsappConversation';
import {
    getConversation, setConversationStep, endConversation, startConversation,
    createPoll, getOutstandingPolls, getAllPollsForPhoneKind, clearPollsForPhoneKind,
    getDuePolls, markPollSettled,
} from '@/lib/whatsappConversation';
import type { Selections } from '@/lib/whatsappConversation';
import { getCategories, getMenuItems } from '@/lib/localDb';
import { sendWhatsApp, sendWhatsAppPoll } from '@/lib/whatsapp';
import { createOrderFromPollSelections } from '@/lib/whatsappOrderFromPolls';

const TICK_MS = 2000;
const VOTE_DEBOUNCE_MS = 8000;
const NO_VOTE_TIMEOUT_MS = 3 * 60_000;
// Pacing between polls within one batch — short enough that they all land
// within a few seconds (WhatsApp doesn't auto-scroll, so several polls
// staying visible together is the point), long enough not to look like a burst.
const POLL_SEND_GAP_MS = 1500;

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

const QUANTITY_OPTIONS: PollOption[] = ['1', '2', '3', '4', '5+'].map(v => ({ id: v, label: v }));

function parseQuantity(label: string): number {
    const n = parseInt(label, 10);
    return Number.isFinite(n) && n > 0 ? n : 1;
}

/** Begins the order conversation for a phone: sends the category poll.
 *  Used both by the trigger-word match in the inbound webhook and by the
 *  admin "test order flow now" button. */
export async function startOrderFlow(phone: string): Promise<void> {
    await endConversation(phone); // clear any stale/abandoned state first
    await startConversation(phone);

    const [categories, menuItems] = await Promise.all([getCategories(), getMenuItems()]);
    const availableCategoryIds = new Set(menuItems.filter(i => i.isAvailable).map(i => i.categoryId));
    const usable = categories.filter(c => availableCategoryIds.has(c.id));

    if (usable.length === 0) {
        await endConversation(phone);
        await sendWhatsApp(phone, "Sorry, nothing's available to order right now — please call us.", 'auto_reply');
        return;
    }

    const options: PollOption[] = usable.map(c => ({ id: c.id, label: c.name }));
    const pollId = await sendWhatsAppPoll(phone, 'What would you like to order? (pick as many as you like)', options.map(o => o.label), options.length);
    if (!pollId) {
        await endConversation(phone); // sendWhatsAppPoll already logged the failure
        return;
    }
    await createPoll({ pollId, phone, kind: 'category', options });
}

async function sendItemPollBatch(phone: string, categoryIds: string[]): Promise<void> {
    const [categories, menuItems] = await Promise.all([getCategories(), getMenuItems()]);
    const catById = new Map(categories.map(c => [c.id, c]));

    let anySent = false;
    for (const categoryId of categoryIds) {
        const category = catById.get(categoryId);
        const items = menuItems.filter(i => i.categoryId === categoryId && i.isAvailable);
        if (!category || items.length === 0) continue;

        const options: PollOption[] = items.map(i => ({ id: i.id, label: `${i.name} — ₹${i.price}` }));
        const pollId = await sendWhatsAppPoll(phone, `${category.name} — pick your items`, options.map(o => o.label), options.length);
        if (pollId) {
            await createPoll({ pollId, phone, kind: 'item', context: categoryId, options });
            anySent = true;
        }
        await sleep(POLL_SEND_GAP_MS);
    }

    if (!anySent) {
        await endConversation(phone);
        await sendWhatsApp(phone, "Sorry, nothing's available in what you picked right now. Text *menu* to try again.", 'auto_reply');
    }
}

async function sendQuantityPollBatch(phone: string, itemIds: string[]): Promise<void> {
    const menuItems = await getMenuItems();
    const itemById = new Map(menuItems.map(i => [i.id, i]));

    let anySent = false;
    for (const itemId of itemIds) {
        const item = itemById.get(itemId);
        if (!item) continue;
        const pollId = await sendWhatsAppPoll(phone, `How many ${item.name}?`, QUANTITY_OPTIONS.map(o => o.label), 1);
        if (pollId) {
            await createPoll({ pollId, phone, kind: 'quantity', context: itemId, options: QUANTITY_OPTIONS });
            anySent = true;
        }
        await sleep(POLL_SEND_GAP_MS);
    }

    if (!anySent) {
        await endConversation(phone);
        await sendWhatsApp(phone, "Sorry, those items are no longer available. Text *menu* to try again.", 'auto_reply');
    }
}

async function advanceConversation(phone: string, kind: 'category' | 'item' | 'quantity'): Promise<void> {
    const conversation = await getConversation(phone);
    if (!conversation) return; // already ended/cleaned up elsewhere

    const polls = await getAllPollsForPhoneKind(phone, kind);
    await clearPollsForPhoneKind(phone, kind);

    if (kind === 'category') {
        const categoryIds = Array.from(new Set(polls.flatMap(p => p.currentSelection)));
        if (categoryIds.length === 0) {
            await endConversation(phone);
            await sendWhatsApp(phone, "No worries — text *menu* anytime you're ready to order.", 'auto_reply');
            return;
        }
        const selections: Selections = { categoryIds, itemIds: [], quantities: {} };
        await setConversationStep(phone, 'awaiting_items', selections);
        await sendItemPollBatch(phone, categoryIds);
        return;
    }

    if (kind === 'item') {
        const itemIds = Array.from(new Set(polls.flatMap(p => p.currentSelection)));
        if (itemIds.length === 0) {
            await endConversation(phone);
            await sendWhatsApp(phone, 'No items selected — text *menu* anytime to start over.', 'auto_reply');
            return;
        }
        const selections: Selections = { ...conversation.selections, itemIds, quantities: {} };
        await setConversationStep(phone, 'awaiting_quantities', selections);
        await sendQuantityPollBatch(phone, itemIds);
        return;
    }

    // kind === 'quantity'
    const quantities: Record<string, number> = {};
    for (const poll of polls) {
        const itemId = poll.context;
        if (!itemId) continue;
        const chosenId = poll.currentSelection[0];
        const option = poll.options.find(o => o.id === chosenId);
        quantities[itemId] = option ? parseQuantity(option.label) : 1; // never voted -> assume 1 rather than drop the item
    }
    const selections: Selections = { ...conversation.selections, quantities };
    await endConversation(phone); // clears conversation row + any stray polls

    const result = await createOrderFromPollSelections(phone, selections);
    if (!result.ok) {
        await sendWhatsApp(phone, `Sorry — couldn't place your order (${result.reason}). Please try again or call us.`, 'auto_reply');
    }
}

async function processDuePolls(): Promise<void> {
    const due = await getDuePolls(VOTE_DEBOUNCE_MS, NO_VOTE_TIMEOUT_MS);
    if (due.length === 0) return;

    for (const poll of due) {
        await markPollSettled(poll.pollId);
    }

    const seen = new Set<string>();
    for (const poll of due) {
        const key = `${poll.phone}:${poll.kind}`;
        if (seen.has(key)) continue;
        seen.add(key);

        const outstanding = await getOutstandingPolls(poll.phone, poll.kind);
        if (outstanding.length > 0) continue; // sibling poll(s) in this batch still open

        await advanceConversation(poll.phone, poll.kind);
    }
}

let started = false;

export function startPollScheduler(): void {
    if (started) return; // instrumentation.ts's register() can fire more than once in dev
    started = true;
    console.log('[whatsapp-polls] scheduler started, tick every', TICK_MS / 1000, 's');

    const tick = async () => {
        try {
            await processDuePolls();
        } catch (err) {
            console.warn('[whatsapp-polls] scheduler tick failed:', (err as Error).message);
        }
    };

    setInterval(tick, TICK_MS).unref();
    tick();
}
