import { json } from '@sveltejs/kit';
import db from '$lib/server/db.js';

/** @type {import('./$types').RequestHandler} */
export async function GET({ url }) {
    const artistId = parseInt(url.searchParams.get('artistId') || '0');
    if (!artistId) return json([]);

    const albums = db.prepare(`
        SELECT mc.id, mc.title
        FROM media_children mc
        WHERE mc.parent_id = ? AND mc.jellyfin_id IS NOT NULL
        ORDER BY mc.title ASC
    `).all(artistId);

    return json(albums);
}
