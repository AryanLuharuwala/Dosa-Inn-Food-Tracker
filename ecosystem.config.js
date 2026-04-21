const path = require('path');
const isWin = process.platform === 'win32';

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
            },
            error_file: path.join(__dirname, 'logs', 'wa-error.log'),
            out_file: path.join(__dirname, 'logs', 'wa-out.log'),
            log_date_format: 'YYYY-MM-DD HH:mm:ss',
        },
    ],
};
