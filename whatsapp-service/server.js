/**
 * WhatsApp Service — long-running Node.js process.
 * Manages a single WhatsApp Web session via whatsapp-web.js.
 * Exposes a local HTTP API on PORT (default 3478) for Next.js to call.
 *
 * Endpoints:
 *   GET  /status          → { status, phone, name }
 *   GET  /qr              → { qr }  (base64 PNG data-URL)
 *   POST /send            → { to, message }
 *   POST /logout          → disconnect & clear session
 */

const express = require('express');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const fs = require('fs');
const path = require('path');

const PORT = process.env.WA_SERVICE_PORT || 3478;
const SESSION_DIR = path.join(__dirname, '.wwebjs_auth');

// ── State ─────────────────────────────────────────────────────────────────────

let client = null;
let status = 'disconnected'; // disconnected | qr | connecting | ready
let currentQr = null;        // raw QR string from whatsapp-web.js
let botInfo = null;           // { phone, name } once connected
let messageQueue = [];        // simple in-process queue
let queueRunning = false;

// ── Message queue ─────────────────────────────────────────────────────────────

function normalizePhone(to) {
    if (to.includes('@')) return to;
    // Strip non-digits
    const digits = to.replace(/\D/g, '');
    // Already has country code (11+ digits starting with 91)
    if (digits.length >= 11 && digits.startsWith('91')) return `${digits}@c.us`;
    // 10-digit Indian mobile — prepend 91
    if (digits.length === 10) return `91${digits}@c.us`;
    // Otherwise trust as-is
    return `${digits}@c.us`;
}

async function flushQueue() {
    if (queueRunning) return;
    queueRunning = true;
    while (messageQueue.length > 0) {
        const { to, message, resolve, reject } = messageQueue.shift();
        try {
            const chatId = normalizePhone(to);
            // getNumberId resolves the WA internal ID and validates the number exists
            const numberId = await client.getNumberId(chatId.replace('@c.us', ''));
            if (!numberId) {
                console.warn(`[WA] Number not on WhatsApp: ${chatId}`);
                resolve(null);
                continue;
            }
            const sent = await client.sendMessage(numberId._serialized, message);
            resolve(sent);
        } catch (err) {
            console.warn(`[WA] send error: ${err.message}`);
            reject(err);
        }
    }
    queueRunning = false;
}

function queueSend(to, message) {
    return new Promise((resolve, reject) => {
        messageQueue.push({ to, message, resolve, reject });
        if (status === 'ready') flushQueue();
    });
}

// ── Bot init ──────────────────────────────────────────────────────────────────

function initClient() {
    if (client) {
        try { client.destroy(); } catch (_) {}
    }

    client = new Client({
        authStrategy: new LocalAuth({ clientId: 'dosa-inn', dataPath: SESSION_DIR }),
        puppeteer: {
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
        },
    });

    status = 'connecting';
    currentQr = null;

    client.on('qr', (qr) => {
        status = 'qr';
        currentQr = qr;
        console.log('[WA] QR ready — scan in admin panel');
    });

    client.on('ready', async () => {
        status = 'ready';
        currentQr = null;
        const info = client.info;
        botInfo = { phone: info.wid.user, name: info.pushname || info.wid.user };
        console.log(`[WA] Ready as ${botInfo.name} (${botInfo.phone})`);
        flushQueue(); // drain any queued messages
    });

    client.on('authenticated', () => {
        status = 'connecting';
        currentQr = null;
        console.log('[WA] Authenticated, loading session…');
    });

    client.on('auth_failure', () => {
        console.log('[WA] Auth failure — clearing session');
        status = 'disconnected';
        try { fs.rmSync(path.join(SESSION_DIR, 'session-dosa-inn'), { recursive: true, force: true }); } catch (_) {}
        setTimeout(initClient, 3000);
    });

    client.on('disconnected', (reason) => {
        console.log(`[WA] Disconnected: ${reason}`);
        status = 'disconnected';
        botInfo = null;
        setTimeout(initClient, 5000);
    });

    client.initialize();
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
    const { to, message } = req.body;
    if (!to || !message) return res.status(400).json({ error: 'to and message required' });
    if (status !== 'ready') return res.status(503).json({ error: 'WhatsApp not connected' });
    try {
        await queueSend(to, message);
        res.json({ ok: true });
    } catch (err) {
        // Don't 500 — caller (Next.js) treats any error as critical
        console.warn('[WA] send rejected:', err.message);
        res.json({ ok: false, error: err.message });
    }
});

app.post('/logout', async (_req, res) => {
    try {
        if (client) await client.logout().catch(() => {});
        try { fs.rmSync(path.join(SESSION_DIR, 'session-dosa-inn'), { recursive: true, force: true }); } catch (_) {}
        status = 'disconnected';
        botInfo = null;
        currentQr = null;
        setTimeout(initClient, 1000);
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
