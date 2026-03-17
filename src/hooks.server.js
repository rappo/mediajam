import { redirect } from '@sveltejs/kit';
import db from '$lib/server/db.js';
import { verifySession, SESSION_COOKIE } from '$lib/server/session.js';
import { startAutoSyncScheduler } from '$lib/server/auto-sync.js';
import { startPrPoller } from '$lib/server/pr-poller.js';
import { startBackupScheduler } from '$lib/server/backup-engine.js';
import { startPipelineScheduler } from '$lib/server/nightly-pipeline.js';
import { logError } from '$lib/server/logger.js';
import { prefetchIcons } from '$lib/server/icon-cache.js';

// Prefetch service icons from CDN on boot (non-blocking)
prefetchIcons().catch(err => console.warn('[icon-cache] Prefetch failed:', err.message));

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
        startPrPoller();
        startBackupScheduler();
        startPipelineScheduler();
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
        // Check for API key Bearer token first
        const authHeader = event.request.headers.get('authorization');
        if (authHeader?.startsWith('Bearer mj_')) {
            const token = authHeader.slice(7); // "Bearer " = 7 chars
            const { createHash } = await import('crypto');
            const keyHash = createHash('sha256').update(token).digest('hex');

            const apiKey = /** @type {any} */ (db.prepare(
                `SELECT ak.id, ak.user_id, ak.permissions, ak.expires_at
                 FROM api_keys ak WHERE ak.key_hash = ?`
            ).get(keyHash));

            if (apiKey) {
                // Check expiry
                const isExpired = apiKey.expires_at && new Date(apiKey.expires_at) < new Date();
                if (!isExpired) {
                    const user = /** @type {any} */ (db.prepare(
                        'SELECT id, username, is_admin, avatar_url FROM users WHERE id = ?'
                    ).get(apiKey.user_id));

                    if (user) {
                        event.locals.user = {
                            id: user.id,
                            username: user.username,
                            isAdmin: user.is_admin === 1,
                            avatarUrl: user.avatar_url || null
                        };
                        event.locals.apiKeyPermissions = JSON.parse(apiKey.permissions || '[]');

                        // Update last_used_at (non-blocking)
                        db.prepare('UPDATE api_keys SET last_used_at = datetime(\'now\') WHERE id = ?').run(apiKey.id);
                    }
                }
            }
        }

        // Fall through to session cookie auth if no API key matched
        if (!event.locals.user) {
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
        }

        // Require auth for everything except /login, /api/auth, and /api/setup
        const publicPaths = ['/login', '/reset-password', '/api/auth', '/api/setup', '/api/icons'];
        const isPublic = publicPaths.some(p => event.url.pathname.startsWith(p));

        if (!event.locals.user && !isPublic) {
            // API requests get 401 JSON, page requests get redirected
            if (event.url.pathname.startsWith('/api/')) {
                return new Response(JSON.stringify({ error: 'Unauthorized' }), {
                    status: 401,
                    headers: { 'Content-Type': 'application/json' }
                });
            }
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
