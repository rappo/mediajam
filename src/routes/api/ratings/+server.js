import { json } from '@sveltejs/kit';
import { getRatingsForParent, getRatingsForChild, fetchRatingsForParent, fetchRatingsForAlbum } from '$lib/server/ratings-engine.js';
import db from '$lib/server/db.js';

/** @type {import('./$types').RequestHandler} */
export async function GET({ url }) {
    const mediaParentId = url.searchParams.get('mediaParentId');
    const mediaChildId = url.searchParams.get('mediaChildId');

    if (mediaChildId) {
        const ratings = getRatingsForChild(parseInt(mediaChildId));
        return json({ ratings });
    }

    if (mediaParentId) {
        const ratings = getRatingsForParent(parseInt(mediaParentId));
        return json({ ratings });
    }

    return json({ error: 'mediaParentId or mediaChildId required' }, { status: 400 });
}

/** @type {import('./$types').RequestHandler} */
export async function POST({ request }) {
    const body = await request.json();
    const { mediaParentId, mediaChildId, refresh } = body;

    if (mediaChildId) {
        // Fetch ratings for a specific album
        const album = /** @type {any} */ (db.prepare(`
            SELECT mc.id, mc.title, mc.parent_id, mp.title as artist_title, mp.musicbrainz_id
            FROM media_children mc
            JOIN media_parents mp ON mc.parent_id = mp.id
            WHERE mc.id = ?
        `).get(mediaChildId));

        if (!album) {
            return json({ error: 'Album not found' }, { status: 404 });
        }

        const result = await fetchRatingsForAlbum(
            album.id,
            album.artist_title,
            album.title,
            album.musicbrainz_id,
            { force: !!refresh }
        );
        return json({ success: true, ...result });
    }

    if (mediaParentId) {
        const result = await fetchRatingsForParent(parseInt(mediaParentId), { force: !!refresh });
        const ratings = getRatingsForParent(parseInt(mediaParentId));
        return json({ success: true, ...result, ratings });
    }

    return json({ error: 'mediaParentId or mediaChildId required' }, { status: 400 });
}
