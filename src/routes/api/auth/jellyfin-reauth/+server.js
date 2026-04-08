import { json } from '@sveltejs/kit';
import db from '$lib/server/db.js';
import { createJellyfinApi, getUserApi } from '$lib/server/jellyfin.js';

/**
 * POST /api/auth/jellyfin-reauth
 * Re-authenticate with Jellyfin to refresh a stale access token.
 * Body: { password: string }
 */
export async function POST({ request, locals }) {
    if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

    const { password } = await request.json();
    if (!password) return json({ error: 'Password is required' }, { status: 400 });

    const user = /** @type {any} */ (db.prepare('SELECT id, username, jellyfin_user_id FROM users WHERE id = ?').get(locals.user.id));
    if (!user?.jellyfin_user_id) {
        return json({ error: 'No Jellyfin account linked' }, { status: 400 });
    }

    const settings = /** @type {any} */ (db.prepare('SELECT jellyfin_url FROM app_settings WHERE id = 1').get());
    if (!settings?.jellyfin_url) {
        return json({ error: 'Jellyfin URL not configured' }, { status: 500 });
    }

    try {
        const api = createJellyfinApi(settings.jellyfin_url);
        const result = await getUserApi(api).authenticateUserByName({
            authenticateUserByName: { Username: user.username, Pw: password }
        });

        const accessToken = result.data?.AccessToken;
        if (!accessToken) {
            return json({ error: 'Jellyfin did not return an access token' }, { status: 502 });
        }

        // Store fresh token and clear invalid flag
        db.prepare('UPDATE users SET jellyfin_access_token = ? WHERE id = ?').run(accessToken, user.id);
        db.prepare("UPDATE app_settings SET jellyfin_auth_status = 'ok' WHERE id = 1").run();

        console.log(`[auth] Jellyfin token refreshed for user ${user.username}`);
        return json({ success: true });
    } catch (/** @type {any} */ e) {
        const status = e?.response?.status;
        if (status === 401) {
            return json({ error: 'Invalid Jellyfin password' }, { status: 401 });
        }
        console.error('[auth] Jellyfin re-auth failed:', e);
        return json({ error: 'Could not reach Jellyfin server' }, { status: 502 });
    }
}
