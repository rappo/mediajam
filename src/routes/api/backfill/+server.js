import { json } from '@sveltejs/kit';
import db from '$lib/server/db.js';
import { getJellyfinApis } from '$lib/server/jellyfin.js';

/** Backfills total_released_children from Jellyfin's RecursiveItemCount */
export async function POST({ locals }) {
    const settings = db.prepare('SELECT jellyfin_url FROM app_settings WHERE id = 1').get();
    const user = locals.user ? db.prepare('SELECT jellyfin_access_token FROM users WHERE id = ?').get(locals.user.id) : null;

    if (!settings?.jellyfin_url || !user?.jellyfin_access_token) {
        return json({ success: false, error: 'Not configured' }, { status: 400 });
    }

    const { api, items: itemsApi } = getJellyfinApis(settings.jellyfin_url, user.jellyfin_access_token);
    const libs = db.prepare('SELECT jellyfin_id, media_type FROM libraries WHERE is_tracked = 1').all();

    let totalUpdated = 0;
    const update = db.prepare('UPDATE media_parents SET total_released_children = ? WHERE jellyfin_id = ?');

    for (const lib of libs) {
        let itemType = '';
        if (lib.media_type === 'tvshows') itemType = 'Series';
        else if (lib.media_type === 'movies') itemType = 'Movie';
        else if (lib.media_type === 'music') itemType = 'MusicArtist';

        try {
            const res = await itemsApi.getItems({
                parentId: lib.jellyfin_id,
                includeItemTypes: [itemType],
                recursive: true,
                fields: ['RecursiveItemCount', 'ChildCount'],
                startIndex: 0,
                limit: 10000
            });

            for (const item of res.data.Items || []) {
                const count = item.RecursiveItemCount || item.ChildCount || 0;
                if (count > 0) {
                    update.run(count, item.Id);
                    totalUpdated++;
                }
            }
        } catch (e) {
            console.error(`[backfill] Error fetching ${itemType}:`, e instanceof Error ? e.message : String(e));
        }
    }

    return json({ success: true, updated: totalUpdated });
}
