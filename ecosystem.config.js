const path = require('path');
const isWin = process.platform === 'win32';

require('dotenv').config({ path: path.join(__dirname, '.env.local') });

// On Windows, .bin executables have a .cmd extension
const nextBin = path.join(__dirname, 'node_modules', '.bin', isWin ? 'next.cmd' : 'next');

module.exports = {
    apps: [
        {
            name: 'dosa-inn-web',
            script: nextBin,
            args: 'start',
            cwd: __dirname,
            instances: 1,
            autorestart: true,
            watch: false,
            max_memory_restart: '512M',
            env: {
                NODE_ENV: 'production',
                PORT: 3000,
                // Without this, lib/whatsapp.ts's getServiceUrl() has no way
                // to find the whatsapp-service process below — every
                // sendWhatsApp() call silently no-ops (by design, so a
                // missing service never breaks the order flow), so order
                // status updates never reach customers. Must match
                // dosa-inn-whatsapp's own WA_SERVICE_PORT below.
                WA_SERVICE_PORT: 3478,
                // Shared secret between the two apps: dosa-inn-web sends it
                // as Bearer auth to whatsapp-service, and whatsapp-service
                // sends it back as Bearer auth on inbound webhook calls to
                // /api/whatsapp/inbound (which fails closed without it —
                // that route can trigger real orders). Must match
                // dosa-inn-whatsapp's own BOT_API_TOKEN below. Set in
                // .env.local — generated automatically by install.ps1/install.sh.
                BOT_API_TOKEN: process.env.BOT_API_TOKEN,
            },
            error_file: path.join(__dirname, 'logs', 'web-error.log'),
            out_file: path.join(__dirname, 'logs', 'web-out.log'),
            log_date_format: 'YYYY-MM-DD HH:mm:ss',
        },
        {
            name: 'dosa-inn-whatsapp',
            script: path.join(__dirname, 'whatsapp-service', 'server.js'),
            cwd: path.join(__dirname, 'whatsapp-service'),
            instances: 1,
            autorestart: true,
            watch: false,
            max_memory_restart: '256M',
            env: {
                NODE_ENV: 'production',
                WA_SERVICE_PORT: 3478,
                // Where to forward inbound messages/poll votes for the
                // poll-based ordering conversation. Must match dosa-inn-web's PORT above.
                NEXT_APP_URL: 'http://127.0.0.1:3000',
                BOT_API_TOKEN: process.env.BOT_API_TOKEN,
            },
            error_file: path.join(__dirname, 'logs', 'wa-error.log'),
            out_file: path.join(__dirname, 'logs', 'wa-out.log'),
            log_date_format: 'YYYY-MM-DD HH:mm:ss',
        },
    ],
};
