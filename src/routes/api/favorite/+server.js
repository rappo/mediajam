import { json } from '@sveltejs/kit';
import db from '$lib/server/db.js';

/**
 * Toggle favorite status on a media item or person.
 * Bidirectional: updates local DB and pushes to Jellyfin.
 *
 * POST /api/favorite
 * Body: { type: 'media' | 'person', id: number, isFavorite: boolean }
 */
export async function POST({ request, locals }) {
    if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

    const { type, id, isFavorite } = await request.json();
    if (!type || !id) return json({ error: 'Missing type or id' }, { status: 400 });

    const favoriteVal = isFavorite ? 1 : 0;

    // Get Jellyfin credentials — use the same source as checkJellyfinFavorite (users table)
    const settings = /** @type {any} */ (db.prepare('SELECT jellyfin_url FROM app_settings WHERE id = 1').get());
    const user = /** @type {any} */ (db.prepare('SELECT jellyfin_access_token, jellyfin_user_id FROM users WHERE id = ?').get(locals.user.id));
    const jellyfinUrl = settings?.jellyfin_url;
    const accessToken = user?.jellyfin_access_token;
    const jellyfinUserId = user?.jellyfin_user_id;

    /**
     * Push favorite status to Jellyfin.
     * @param {string} jellyfinItemId
     * @returns {Promise<{ok: boolean, status?: number}>}
     */
    async function pushToJellyfin(jellyfinItemId) {
        if (!jellyfinItemId || !accessToken || !jellyfinUrl || !jellyfinUserId) {
            return { ok: true }; // No Jellyfin credentials — local-only is fine
        }
        try {
            const method = isFavorite ? 'POST' : 'DELETE';
            const url = `${jellyfinUrl}/Users/${jellyfinUserId}/FavoriteItems/${jellyfinItemId}`;
            const jfRes = await fetch(url, {
                method,
                headers: { 'X-Emby-Token': accessToken }
            });
            if (!jfRes.ok) {
                console.error(`[favorite] Jellyfin push failed: ${jfRes.status} ${jfRes.statusText}`);
                return { ok: false, status: jfRes.status };
            }
            return { ok: true };
        } catch (e) {
            console.error('[favorite] Jellyfin API error:', e instanceof Error ? e.message : String(e));
            return { ok: false };
        }
    }

    if (type === 'media') {
        db.prepare('UPDATE media_parents SET is_favorite = ? WHERE id = ?').run(favoriteVal, id);
        const parent = /** @type {any} */ (db.prepare('SELECT jellyfin_id FROM media_parents WHERE id = ?').get(id));
        const jf = await pushToJellyfin(parent?.jellyfin_id);
        if (!jf.ok) {
            // Revert DB on Jellyfin failure
            db.prepare('UPDATE media_parents SET is_favorite = ? WHERE id = ?').run(isFavorite ? 0 : 1, id);
            return json({ error: 'Jellyfin sync failed', status: jf.status }, { status: 502 });
        }
        return json({ success: true, type: 'media', id, isFavorite });
    }

    if (type === 'person') {
        db.prepare('UPDATE persons SET is_favorite = ? WHERE id = ?').run(favoriteVal, id);
        const person = /** @type {any} */ (db.prepare('SELECT jellyfin_id FROM persons WHERE id = ?').get(id));
        const jf = await pushToJellyfin(person?.jellyfin_id);
        if (!jf.ok) {
            db.prepare('UPDATE persons SET is_favorite = ? WHERE id = ?').run(isFavorite ? 0 : 1, id);
            return json({ error: 'Jellyfin sync failed', status: jf.status }, { status: 502 });
        }
        return json({ success: true, type: 'person', id, isFavorite });
    }

    return json({ error: 'Invalid type' }, { status: 400 });
}
