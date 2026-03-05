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

    // Get Jellyfin credentials
    const identity = /** @type {any} */ (db.prepare(
        "SELECT provider_uid, access_token FROM user_identities WHERE user_id = ? AND provider = 'jellyfin'"
    ).get(locals.user.id));
    const settings = /** @type {any} */ (db.prepare('SELECT jellyfin_url FROM app_settings WHERE id = 1').get());

    if (type === 'media') {
        // Update local DB
        db.prepare('UPDATE media_parents SET is_favorite = ? WHERE id = ?').run(favoriteVal, id);

        // Push to Jellyfin if we have the jellyfin_id
        const parent = /** @type {any} */ (db.prepare('SELECT jellyfin_id FROM media_parents WHERE id = ?').get(id));
        if (parent?.jellyfin_id && identity?.access_token && settings?.jellyfin_url) {
            try {
                const method = isFavorite ? 'POST' : 'DELETE';
                await fetch(
                    `${settings.jellyfin_url}/Users/${identity.provider_uid}/FavoriteItems/${parent.jellyfin_id}`,
                    {
                        method,
                        headers: { 'X-Emby-Token': identity.access_token }
                    }
                );
            } catch (e) {
                console.error('[favorite] Jellyfin API error:', e);
            }
        }

        return json({ success: true, type: 'media', id, isFavorite });
    }

    if (type === 'person') {
        // Update local DB
        db.prepare('UPDATE persons SET is_favorite = ? WHERE id = ?').run(favoriteVal, id);

        // Push to Jellyfin if we have the jellyfin_id
        const person = /** @type {any} */ (db.prepare('SELECT jellyfin_id FROM persons WHERE id = ?').get(id));
        if (person?.jellyfin_id && identity?.access_token && settings?.jellyfin_url) {
            try {
                const method = isFavorite ? 'POST' : 'DELETE';
                await fetch(
                    `${settings.jellyfin_url}/Users/${identity.provider_uid}/FavoriteItems/${person.jellyfin_id}`,
                    {
                        method,
                        headers: { 'X-Emby-Token': identity.access_token }
                    }
                );
            } catch (e) {
                console.error('[favorite] Jellyfin API error:', e);
            }
        }

        return json({ success: true, type: 'person', id, isFavorite });
    }

    return json({ error: 'Invalid type' }, { status: 400 });
}
