import db from '$lib/server/db.js';
import { createJellyfinApi, getItemsApi } from '$lib/server/jellyfin.js';

/**
 * Check Jellyfin for the live IsFavorite status of an item.
 * Updates the local DB and returns the current value.
 * Non-blocking — returns stored value on any error.
 *
 * @param {string|null} jellyfinId - Jellyfin item ID
 * @param {'media_parents'|'persons'} table - Which table to update
 * @param {number} localId - Local DB row ID
 * @returns {Promise<boolean|null>} true/false for favorite, null if unknown
 */
export async function checkJellyfinFavorite(jellyfinId, table, localId) {
    if (!jellyfinId) return null;

    try {
        const settings = /** @type {any} */ (db.prepare('SELECT jellyfin_url FROM app_settings WHERE id = 1').get());
        const user = /** @type {any} */ (db.prepare('SELECT jellyfin_access_token, jellyfin_user_id FROM users LIMIT 1').get());

        if (!settings?.jellyfin_url || !user?.jellyfin_access_token || !user?.jellyfin_user_id) return null;

        const api = createJellyfinApi(settings.jellyfin_url, user.jellyfin_access_token);
        const itemsApi = getItemsApi(api);

        const res = await itemsApi.getItems({
            ids: [jellyfinId],
            userId: user.jellyfin_user_id,
            enableUserData: true,
            limit: 1
        });

        const item = res.data?.Items?.[0];
        if (!item) return null;

        const isFavorite = item.UserData?.IsFavorite === true;

        // Update local DB
        if (table === 'media_parents') {
            db.prepare('UPDATE media_parents SET is_favorite = ? WHERE id = ?').run(isFavorite ? 1 : 0, localId);
        } else if (table === 'persons') {
            db.prepare('UPDATE persons SET is_favorite = ? WHERE id = ?').run(isFavorite ? 1 : 0, localId);
        }

        return isFavorite;
    } catch (/** @type {any} */ e) {
        const status = e?.response?.status;
        if (status === 401) {
            try { db.prepare("UPDATE app_settings SET jellyfin_auth_status = 'invalid' WHERE id = 1").run(); } catch { /* */ }
        }
        // Non-blocking — return null so page uses stored value
        return null;
    }
}
