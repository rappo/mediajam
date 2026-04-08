import db from '$lib/server/db.js';

/** @type {import('./$types').PageServerLoad} */
export function load() {
    const totalArtists = /** @type {any} */ (
        db.prepare('SELECT COUNT(*) as c FROM media_parents WHERE media_type = ?').get('artist')
    ).c;

    const albumStats = /** @type {any} */ (db.prepare(`
        SELECT COUNT(*) as total_albums, SUM(play_count) as total_plays
        FROM media_children mc
        JOIN media_parents mp ON mc.parent_id = mp.id
        WHERE mp.media_type = 'artist'
    `).get());

    return {
        totalArtists,
        totalAlbums: albumStats?.total_albums || 0,
        totalPlays: albumStats?.total_plays || 0,
    };
}
