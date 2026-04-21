module.exports = {
    apps: [
        {
            name: 'dosa-inn-web',
            script: 'node_modules/.bin/next',
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
            error_file: 'logs/web-error.log',
            out_file: 'logs/web-out.log',
            log_date_format: 'YYYY-MM-DD HH:mm:ss',
        },
        {
            name: 'dosa-inn-whatsapp',
            script: 'server.js',
            cwd: __dirname + '/whatsapp-service',
            instances: 1,
            autorestart: true,
            watch: false,
            max_memory_restart: '256M',
            env: {
                NODE_ENV: 'production',
                WA_SERVICE_PORT: 3478,
            },
            error_file: '../logs/wa-error.log',
            out_file: '../logs/wa-out.log',
            log_date_format: 'YYYY-MM-DD HH:mm:ss',
        },
    ],
};
