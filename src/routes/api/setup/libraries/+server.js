import { json } from '@sveltejs/kit';
import db from '$lib/server/db.js';

/** @type {import('./$types').RequestHandler} */
export async function GET({ url }) {
    const jellyfinUrl = url.searchParams.get('jellyfinUrl');
    const accessToken = url.searchParams.get('accessToken');

    if (!jellyfinUrl) {
        return json({ error: 'Missing jellyfinUrl parameter.' }, { status: 400 });
    }

    try {
        // Try authenticated request first
        const headers = { 'Accept': 'application/json' };
        if (accessToken) {
            headers['X-Emby-Token'] = accessToken;
        }

        const res = await fetch(`${jellyfinUrl}/Library/VirtualFolders`, {
            headers
        });

        if (!res.ok) {
            return json({ error: `Jellyfin returned status ${res.status}` }, { status: 502 });
        }

        const folders = await res.json();

        const libraries = folders.map(folder => {
            let type = 'mixed';
            const collType = (folder.CollectionType || '').toLowerCase();
            if (collType === 'movies') type = 'movies';
            else if (collType === 'tvshows') type = 'tvshows';
            else if (collType === 'music') type = 'music';
            else if (collType === 'books') type = 'books';
            else if (collType === 'photos') type = 'photos';
            else if (collType === 'homevideos') type = 'homevideos';

            return {
                id: folder.ItemId,
                name: folder.Name,
                type,
                locations: folder.Locations || []
            };
        });

        return json({ libraries });
    } catch (e) {
        console.error('Libraries fetch error:', e);
        return json({ error: 'Failed to connect to Jellyfin server.' }, { status: 502 });
    }
}

/** @type {import('./$types').RequestHandler} */
export async function POST({ request }) {
    const { libraries } = await request.json();

    try {
        const insert = db.prepare(`
			INSERT OR REPLACE INTO libraries (jellyfin_id, name, media_type, is_tracked)
			VALUES (?, ?, ?, 1)
		`);

        const insertMany = db.transaction((libs) => {
            for (const lib of libs) {
                insert.run(lib.jellyfin_id, lib.name, lib.media_type);
            }
        });

        insertMany(libraries);

        return json({ success: true });
    } catch (e) {
        console.error('Library save error:', e);
        return json({ success: false, error: 'Failed to save library selection.' });
    }
}
