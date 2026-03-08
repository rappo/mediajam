import { redirect } from '@sveltejs/kit';
import db from '$lib/server/db.js';
import { verifySession, SESSION_COOKIE } from '$lib/server/session.js';
import { startAutoSyncScheduler } from '$lib/server/auto-sync.js';
import { logError } from '$lib/server/logger.js';

// Prevent unhandled errors from crashing the entire process
process.on('unhandledRejection', (reason) => {
    const msg = reason instanceof Error ? reason.stack || reason.message : String(reason);
    console.error('[FATAL] Unhandled promise rejection:', msg);
    logError('process', `Unhandled rejection: ${msg}`);
});

process.on('uncaughtException', (err) => {
    console.error('[FATAL] Uncaught exception:', err.stack || err.message);
    logError('process', `Uncaught exception: ${err.stack || err.message}`);
});

/** @type {import('@sveltejs/kit').Handle} */
export async function handle({ event, resolve }) {
    // Check if setup is complete
    const settings = db.prepare('SELECT setup_complete, theme FROM app_settings WHERE id = 1').get();
    const isSetupComplete = settings?.setup_complete === 1;
    const theme = settings?.theme || 'dark';

    // Start auto-sync scheduler once setup is complete
    if (isSetupComplete) {
        startAutoSyncScheduler();
    }

    event.locals.isSetupComplete = isSetupComplete;
    event.locals.theme = theme;

    // Redirect to setup if not complete (unless already on setup or API)
    if (!isSetupComplete && !event.url.pathname.startsWith('/setup') && !event.url.pathname.startsWith('/api')) {
        throw redirect(302, '/setup');
    }

    // Redirect away from setup if already complete
    if (isSetupComplete && event.url.pathname.startsWith('/setup')) {
        throw redirect(302, '/');
    }

    // ─── Session Auth ────────────────────────────────────────────────────────
    if (isSetupComplete) {
        const sessionCookie = event.cookies.get(SESSION_COOKIE);
        const userId = verifySession(sessionCookie);

        if (userId) {
            const user = /** @type {any} */ (db.prepare(
                'SELECT id, username, is_admin, avatar_url FROM users WHERE id = ?'
            ).get(userId));
            if (user) {
                event.locals.user = {
                    id: user.id,
                    username: user.username,
                    isAdmin: user.is_admin === 1,
                    avatarUrl: user.avatar_url || null
                };
            }
        }

        // Require auth for everything except /login, /api/auth, and /api/setup
        // TODO: Remove '/api/debug' from public paths once album research is complete
        const publicPaths = ['/login', '/reset-password', '/api/auth', '/api/setup', '/api/debug'];
        const isPublic = publicPaths.some(p => event.url.pathname.startsWith(p));

        if (!event.locals.user && !isPublic) {
            throw redirect(302, '/login');
        }
    }

    const response = await resolve(event, {
        transformPageChunk: ({ html }) => {
            return html.replace('data-theme="dark"', `data-theme="${theme}"`);
        }
    });

    return response;
}
