import db from '$lib/server/db.js';

/** @type {import('./$types').PageServerLoad} */
export function load({ locals }) {
    // Use authenticated user from session
    const user = locals.user ? /** @type {any} */ (db.prepare('SELECT id, username, is_admin, avatar_url, created_at FROM users WHERE id = ?').get(locals.user.id)) : null;

    // Load connected services from user_identities
    const identities = user
        ? /** @type {any[]} */ (db.prepare('SELECT provider, provider_uid, auto_sync, last_auto_sync_at, created_at FROM user_identities WHERE user_id = ?').all(user.id))
        : [];

    // Check if app credentials are configured (needed for OAuth flows)
    const settings = /** @type {any} */ (db.prepare('SELECT trakt_client_id, lastfm_api_key FROM app_settings WHERE id = 1').get());

    return {
        user: user ? {
            id: user.id,
            username: user.username,
            isAdmin: user.is_admin === 1,
            avatarUrl: user.avatar_url || null,
            createdAt: user.created_at
        } : null,
        connectedServices: {
            trakt: identities.find(i => i.provider === 'trakt') || null,
            lastfm: identities.find(i => i.provider === 'lastfm') || null,
            jellyfin: identities.find(i => i.provider === 'jellyfin') || null
        },
        appCredentials: {
            hasTraktCreds: !!(settings?.trakt_client_id),
            hasLastfmCreds: !!(settings?.lastfm_api_key)
        }
    };
}
