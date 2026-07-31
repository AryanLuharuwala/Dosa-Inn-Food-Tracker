// Next.js's official one-time server-boot hook (stable, no config flag
// needed). Used to start the WhatsApp marketing scheduler exactly once when
// the long-running `next start` process comes up — there's no separate
// cron/worker process for this app.
export async function register() {
    if (process.env.NEXT_RUNTIME === 'nodejs') {
        const { startScheduler } = await import('./lib/marketing/scheduler');
        startScheduler();

        const { startPollScheduler } = await import('./lib/whatsappPollScheduler');
        startPollScheduler();
    }
}
