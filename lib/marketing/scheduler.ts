/**
 * In-process scheduler for the WhatsApp marketing platform. No cron/queue
 * infra exists in this project — this runs as a single setInterval inside
 * the same long-running `next start` process PM2 already keeps alive
 * (see instrumentation.ts for the one-time startup hook).
 */

import { sendWhatsApp } from '@/lib/whatsapp';
import { getOrders } from '@/lib/localDb';
import {
    listDueCampaigns, tryClaimCampaignForSending, recordCampaignSend, markCampaignSent,
    listActiveSubscriberPhones, listRules, tryClaimFire, getCampaign,
    type Campaign,
} from '@/lib/marketing/db';

const TICK_MS = 60_000;
// Pacing between individual sends within one campaign — deliberately not
// all-at-once. A tight burst of dozens of messages in a few seconds is
// exactly the pattern that gets an unofficial WhatsApp client (Baileys)
// flagged; a few seconds' gap makes it look like what it is, a person
// sending messages one at a time.
const SEND_GAP_MS = 4000;

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function sendCampaignTo(campaign: Campaign, phone: string): Promise<void> {
    try {
        await sendWhatsApp(phone, campaign.linkUrl ? `${campaign.message}\n\n${campaign.linkUrl}` : campaign.message, 'marketing', campaign.imageUrl ?? undefined);
        await recordCampaignSend(campaign.id, phone, true);
    } catch (err) {
        await recordCampaignSend(campaign.id, phone, false, (err as Error).message);
    }
}

async function runDueCampaigns(): Promise<void> {
    const due = await listDueCampaigns();
    for (const campaign of due) {
        if (!await tryClaimCampaignForSending(campaign.id)) continue; // another tick already has it
        const targets = await listActiveSubscriberPhones(campaign.targetGroupId);
        for (const phone of targets) {
            await sendCampaignTo(campaign, phone);
            await sleep(SEND_GAP_MS);
        }
        await markCampaignSent(campaign.id);
    }
}

async function runOrderReadyUncollected(ruleId: string, campaign: Campaign, minutes: number): Promise<void> {
    const orders = await getOrders();
    const cutoff = Date.now() - minutes * 60_000;
    for (const order of orders) {
        if (order.status !== 'ready' || order.orderType !== 'preorder') continue;
        if (!order.readyAt || !order.customerPhone) continue;
        if (new Date(order.readyAt).getTime() > cutoff) continue; // not waited long enough yet
        if (!await tryClaimFire(ruleId, order.orderId)) continue; // already reminded
        await sendCampaignTo(campaign, order.customerPhone);
    }
}

async function runCustomerInactive(ruleId: string, campaign: Campaign, days: number): Promise<void> {
    const orders = await getOrders();
    const lastOrderByPhone = new Map<string, number>();
    for (const o of orders) {
        if (!o.customerPhone) continue;
        const ts = new Date(o.timestamp).getTime();
        const prev = lastOrderByPhone.get(o.customerPhone);
        if (!prev || ts > prev) lastOrderByPhone.set(o.customerPhone, ts);
    }

    const cutoff = Date.now() - days * 24 * 60 * 60_000;
    const candidates = await listActiveSubscriberPhones(campaign.targetGroupId);
    for (const phone of candidates) {
        const lastOrder = lastOrderByPhone.get(phone);
        // No order on record at all counts as inactive too — a subscriber
        // who opted in but never ordered is exactly who a win-back nudge is for.
        if (lastOrder !== undefined && lastOrder > cutoff) continue;
        if (!await tryClaimFire(ruleId, phone)) continue;
        await sendCampaignTo(campaign, phone);
    }
}

async function runAutomationRules(): Promise<void> {
    const rules = await listRules();
    for (const rule of rules) {
        if (!rule.enabled) continue;
        const campaign = await getCampaign(rule.campaignId);
        if (!campaign) continue;

        if (rule.triggerKind === 'order_ready_uncollected') {
            const minutes = rule.triggerParams.minutes ?? 20;
            await runOrderReadyUncollected(rule.id, campaign, minutes);
        } else if (rule.triggerKind === 'customer_inactive') {
            const days = rule.triggerParams.days ?? 14;
            await runCustomerInactive(rule.id, campaign, days);
        }
    }
}

let started = false;

export function startScheduler(): void {
    if (started) return; // instrumentation.ts's register() can fire more than once in dev
    started = true;
    console.log('[marketing] scheduler started, tick every', TICK_MS / 1000, 's');

    const tick = async () => {
        try {
            await runDueCampaigns();
            await runAutomationRules();
        } catch (err) {
            console.warn('[marketing] scheduler tick failed:', (err as Error).message);
        }
    };

    setInterval(tick, TICK_MS).unref();
    tick(); // don't wait a full minute for the first run
}
