/**
 * WhatsApp Service — long-running Node.js process.
 * Manages a single WhatsApp session via Baileys (direct WebSocket protocol —
 * no headless browser/Chromium involved).
 * Exposes a local HTTP API on PORT (default 3478) for Next.js to call, and
 * forwards inbound text messages / poll votes to Next.js's webhook so the
 * poll-based ordering conversation can run there (SQLite is the source of
 * truth for conversation state — this process only owns the live socket and
 * the poll-decryption cache, which can't live outside it).
 *
 * Endpoints:
 *   GET  /status          → { status, phone, name }
 *   GET  /qr               → { qr }  (base64 PNG data-URL)
 *   POST /send             → { to, message, imageUrl? }
 *   POST /send-poll        → { to, name, values, selectableCount } -> { pollId }
 *   POST /logout           → disconnect & clear session
 *
 * Env:
 *   WA_SERVICE_PORT  — port to listen on (default 3478)
 *   NEXT_APP_URL     — base URL of the Next.js app, for the inbound webhook (default http://127.0.0.1:3000)
 *   BOT_API_TOKEN    — shared secret sent as Bearer auth on the outbound webhook call
 */

import express from 'express';
import makeWASocket, {
    useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion,
    normalizeMessageContent, getKeyAuthor, decryptPollVote,
    updateMessageWithPollUpdate, getAggregateVotesInPollMessage, jidNormalizedUser,
} from '@whiskeysockets/baileys';
import qrcode from 'qrcode';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = process.env.WA_SERVICE_PORT || 3478;
const SESSION_DIR = path.join(__dirname, '.baileys_auth');
const NEXT_APP_URL = (process.env.NEXT_APP_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');

// ── State ─────────────────────────────────────────────────────────────────────

let sock = null;
let status = 'disconnected'; // disconnected | qr | connecting | ready
let currentQr = null;        // raw QR string from Baileys
let botInfo = null;           // { phone, name } once connected
let messageQueue = [];        // simple in-process queue (text + poll sends)
let queueRunning = false;
let reconnectTimer = null;

// Sent-poll cache, keyed by the poll message's own id — holds what's needed
// to decrypt later votes on it (the encryption key lives in the poll
// message itself; there's no persistence story for it, so this cache is
// the one piece of state that has to live in this process rather than SQLite).
// { message, pollUpdates, messageSecret, key, createdAt }
const pollCache = new Map();
const POLL_CACHE_TTL_MS = 2 * 60 * 60_000;

function pruneOldPolls() {
    const cutoff = Date.now() - POLL_CACHE_TTL_MS;
    for (const [id, entry] of pollCache) {
        if (entry.createdAt < cutoff) pollCache.delete(id);
    }
}

// ── Message queue ─────────────────────────────────────────────────────────────

function normalizePhone(to) {
    const raw = to.includes('@') ? to.split('@')[0] : to;
    const digits = raw.replace(/\D/g, '');
    // Already has country code (11+ digits starting with 91)
    if (digits.length >= 11 && digits.startsWith('91')) return digits;
    // 10-digit Indian mobile — prepend 91
    if (digits.length === 10) return `91${digits}`;
    // Otherwise trust as-is
    return digits;
}

async function flushQueue() {
    if (queueRunning) return;
    queueRunning = true;
    while (messageQueue.length > 0) {
        const item = messageQueue.shift();
        try {
            const number = normalizePhone(item.to);
            // onWhatsApp resolves the real WA JID and validates the number exists
            const [result] = await sock.onWhatsApp(number);
            if (!result?.exists) {
                console.warn(`[WA] Number not on WhatsApp: ${number}`);
                item.resolve(null);
                continue;
            }

            if (item.kind === 'poll') {
                const sent = await sock.sendMessage(result.jid, {
                    poll: { name: item.name, values: item.values, selectableCount: item.selectableCount },
                });
                pollCache.set(sent.key.id, {
                    message: sent.message,
                    pollUpdates: [],
                    messageSecret: sent.message?.messageContextInfo?.messageSecret,
                    key: sent.key,
                    createdAt: Date.now(),
                });
                pruneOldPolls();
                item.resolve(sent);
            } else {
                const content = item.imageUrl
                    ? { image: { url: item.imageUrl }, caption: item.message }
                    : { text: item.message };
                const sent = await sock.sendMessage(result.jid, content);
                item.resolve(sent);
            }
        } catch (err) {
            console.warn(`[WA] send error: ${err.message}`);
            item.reject(err);
        }
    }
    queueRunning = false;
}

function queueSend(to, message, imageUrl) {
    return new Promise((resolve, reject) => {
        messageQueue.push({ kind: 'text', to, message, imageUrl, resolve, reject });
        if (status === 'ready') flushQueue();
    });
}

function queuePoll(to, name, values, selectableCount) {
    return new Promise((resolve, reject) => {
        messageQueue.push({ kind: 'poll', to, name, values, selectableCount, resolve, reject });
        if (status === 'ready') flushQueue();
    });
}

// ── Inbound: text + poll votes ──────────────────────────────────────────────

async function forwardToWebhook(payload) {
    const token = process.env.BOT_API_TOKEN;
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    try {
        await fetch(`${NEXT_APP_URL}/api/whatsapp/inbound`, {
            method: 'POST',
            headers,
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(5000),
        });
    } catch (err) {
        console.warn('[WA] webhook forward failed:', err.message);
    }
}

// Poll votes arrive as a normal inbound message whose content is a
// pollUpdateMessage (an encrypted vote, not a decoded tally) — Baileys does
// not decrypt/aggregate these automatically in this version, so this
// reimplements that pipeline using the same primitives Baileys itself uses
// internally (decryptPollVote / updateMessageWithPollUpdate /
// getAggregateVotesInPollMessage), against the sent-poll cache above in
// place of the getMessage() store Baileys would otherwise need.
async function handlePollVote(m, pollUpdateMessage) {
    const creationKey = pollUpdateMessage.pollCreationMessageKey;
    const cached = creationKey?.id ? pollCache.get(creationKey.id) : null;
    if (!cached) {
        console.warn('[WA] vote for unknown/expired poll', creationKey?.id);
        return;
    }

    const meIdNorm = jidNormalizedUser(sock.user.id);
    const pollCreatorJid = getKeyAuthor(cached.key, meIdNorm);
    const voterJid = getKeyAuthor(m.key, meIdNorm);

    let voteMsg;
    try {
        voteMsg = decryptPollVote(pollUpdateMessage.vote, {
            pollEncKey: cached.messageSecret,
            pollCreatorJid,
            pollMsgId: creationKey.id,
            voterJid,
        });
    } catch (err) {
        console.warn('[WA] failed to decrypt poll vote:', err.message);
        return;
    }

    updateMessageWithPollUpdate(cached, {
        pollUpdateMessageKey: m.key,
        vote: voteMsg,
        senderTimestampMs: Date.now(),
    });
    const aggregation = getAggregateVotesInPollMessage(cached, meIdNorm);
    const selectedOptionTexts = aggregation.filter(a => a.voters.length > 0).map(a => a.name);

    await forwardToWebhook({
        type: 'poll_vote',
        from: normalizePhone(m.key.remoteJid),
        pollId: creationKey.id,
        selectedOptionTexts,
    });
}

async function handleIncoming(m) {
    if (!m.message || m.key.fromMe) return;
    const remoteJid = m.key.remoteJid || '';
    if (remoteJid.endsWith('@g.us') || remoteJid === 'status@broadcast') return; // 1:1 chats only

    const content = normalizeMessageContent(m.message);
    if (content?.pollUpdateMessage) {
        await handlePollVote(m, content.pollUpdateMessage);
        return;
    }

    const text = content?.conversation || content?.extendedTextMessage?.text;
    if (!text) return; // not a plain-text message (image, sticker, etc.) — ignored

    await forwardToWebhook({ type: 'text', from: normalizePhone(remoteJid), text });
}

// ── Bot init ──────────────────────────────────────────────────────────────────

function scheduleReconnect(delay) {
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        initClient();
    }, delay);
}

async function initClient() {
    const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);
    // The WA protocol version bundled with Baileys goes stale — WhatsApp
    // rejects outdated versions with a 405, so fetch the live one each start.
    const { version } = await fetchLatestBaileysVersion();

    sock = makeWASocket({
        auth: state,
        version,
        printQRInTerminal: false,
        syncFullHistory: false,
    });

    status = 'connecting';
    currentQr = null;

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('messages.upsert', ({ messages, type }) => {
        if (type !== 'notify') return; // skip history-sync replays
        for (const m of messages) {
            handleIncoming(m).catch(err => console.warn('[WA] inbound handling error:', err.message));
        }
    });

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            status = 'qr';
            currentQr = qr;
            console.log('[WA] QR ready — scan in admin panel');
        }

        if (connection === 'open') {
            status = 'ready';
            currentQr = null;
            const id = sock.user?.id ?? '';
            const phone = id.split(':')[0].split('@')[0];
            botInfo = { phone, name: sock.user?.name || phone };
            console.log(`[WA] Ready as ${botInfo.name} (${botInfo.phone})`);
            flushQueue(); // drain any queued messages
        }

        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            const loggedOut = statusCode === DisconnectReason.loggedOut || statusCode === DisconnectReason.badSession;
            console.log(`[WA] Disconnected (code ${statusCode ?? 'unknown'})`);
            status = 'disconnected';
            botInfo = null;

            if (loggedOut) {
                try { fs.rmSync(SESSION_DIR, { recursive: true, force: true }); } catch (_) {}
            }

            // restartRequired fires right after first-time pairing — reconnect fast
            const delay = statusCode === DisconnectReason.restartRequired ? 300 : loggedOut ? 3000 : 5000;
            scheduleReconnect(delay);
        }
    });
}

// Auto-start on launch
initClient();

// ── Express API ───────────────────────────────────────────────────────────────

const app = express();
app.use(express.json());

// Only accept calls from localhost
app.use((req, _res, next) => {
    const ip = req.socket.remoteAddress || '';
    if (ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1') return next();
    _res.status(403).json({ error: 'Forbidden' });
});

app.get('/status', (_req, res) => {
    res.json({ status, ...(botInfo || {}) });
});

app.get('/qr', async (_req, res) => {
    if (!currentQr) return res.json({ qr: null });
    try {
        const dataUrl = await qrcode.toDataURL(currentQr, { width: 300, margin: 2 });
        res.json({ qr: dataUrl });
    } catch {
        res.status(500).json({ error: 'QR generation failed' });
    }
});

app.post('/send', async (req, res) => {
    const { to, message, imageUrl } = req.body;
    if (!to || !message) return res.status(400).json({ error: 'to and message required' });
    if (status !== 'ready') return res.status(503).json({ error: 'WhatsApp not connected' });
    try {
        await queueSend(to, message, imageUrl);
        res.json({ ok: true });
    } catch (err) {
        // Don't 500 — caller (Next.js) treats any error as critical
        console.warn('[WA] send rejected:', err.message);
        res.json({ ok: false, error: err.message });
    }
});

app.post('/send-poll', async (req, res) => {
    const { to, name, values, selectableCount } = req.body;
    if (!to || !name || !Array.isArray(values) || values.length < 1) {
        return res.status(400).json({ error: 'to, name, values required' });
    }
    if (status !== 'ready') return res.status(503).json({ error: 'WhatsApp not connected' });
    try {
        const sent = await queuePoll(to, name, values, selectableCount ?? values.length);
        if (!sent) return res.json({ ok: false, error: 'Number not on WhatsApp' });
        res.json({ ok: true, pollId: sent.key.id });
    } catch (err) {
        console.warn('[WA] send-poll rejected:', err.message);
        res.json({ ok: false, error: err.message });
    }
});

app.post('/logout', async (_req, res) => {
    try {
        if (sock && status !== 'disconnected') {
            await sock.logout().catch(() => {});
        } else {
            try { fs.rmSync(SESSION_DIR, { recursive: true, force: true }); } catch (_) {}
            scheduleReconnect(500);
        }
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Return last N lines from the pm2-managed log files (or stdout fallback)
app.get('/logs', (_req, res) => {
    const logFile = path.join(__dirname, '..', 'logs', 'wa-out.log');
    const errFile = path.join(__dirname, '..', 'logs', 'wa-error.log');
    function readTail(file, n = 200) {
        try {
            const content = fs.readFileSync(file, 'utf8');
            return content.split('\n').slice(-n).join('\n');
        } catch {
            return '';
        }
    }
    const out = readTail(logFile);
    const err = readTail(errFile);
    res.json({ out, err, status, inMemoryQueueLength: messageQueue.length });
});

app.listen(PORT, '127.0.0.1', () => {
    console.log(`[WA] Service listening on 127.0.0.1:${PORT}`);
});
