import { json } from '@sveltejs/kit';
import db from '$lib/server/db.js';
import { getJellyfinApis } from '$lib/server/jellyfin.js';

export async function GET({ params }) {
    const albumJellyfinId = params.albumId;
    const settings = db.prepare('SELECT jellyfin_url FROM app_settings WHERE id = 1').get();
    const user = db.prepare('SELECT jellyfin_access_token FROM users LIMIT 1').get();

    if (!settings?.jellyfin_url || !user?.jellyfin_access_token) {
        return json([]);
    }

    try {
        const { items: itemsApi } = getJellyfinApis(settings.jellyfin_url, user.jellyfin_access_token);
        const res = await itemsApi.getItems({
            parentId: albumJellyfinId,
            includeItemTypes: ['Audio'],
            recursive: true,
            fields: ['ProviderIds'],
            enableUserData: true,
            sortBy: ['SortName'],
            sortOrder: ['Ascending'],
            startIndex: 0,
            limit: 500
        });
        return json(res.data.Items || []);
    } catch (e) {
        console.error('[tracks] Failed to fetch:', e instanceof Error ? e.message : String(e));
        return json([]);
    }
}
