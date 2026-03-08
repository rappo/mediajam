// TODO: Remove this debug endpoint once album research/iteration is complete
import db from '$lib/server/db.js';
import { json } from '@sveltejs/kit';

/** @type {import('./$types').RequestHandler} */
export function GET({ params }) {
    const artistId = parseInt(params.artistId);
    
    const artist = /** @type {any} */ (db.prepare(`SELECT id, title, musicbrainz_id, jellyfin_id, lidarr_id FROM media_parents WHERE id = ?`).get(artistId));
    
    const allAlbums = /** @type {any[]} */ (db.prepare(`
        SELECT mc.id, mc.title, mc.jellyfin_id, mc.musicbrainz_id, mc.is_collected, 
               mc.item_number as release_year, mc.play_count, mc.watch_status,
               mc.poster_url, mc.is_special
        FROM media_children mc
        WHERE mc.parent_id = ?
        ORDER BY mc.item_number ASC, mc.title ASC
    `).all(artistId));

    const unmatched = allAlbums.filter(a => !a.jellyfin_id);
    const matched = allAlbums.filter(a => a.jellyfin_id);

    // Check playback history for unmatched albums
    const unmatchedWithHistory = unmatched.map(u => {
        const plays = /** @type {any} */ (db.prepare(`
            SELECT COUNT(*) as cnt, GROUP_CONCAT(DISTINCT track_name) as tracks
            FROM playback_history WHERE media_id = ?
        `).get(u.id));
        return { ...u, playbackCount: plays?.cnt || 0, playedTracks: plays?.tracks || '' };
    });

    return json({
        artist,
        totalAlbums: allAlbums.length,
        matched: matched.length,
        unmatchedCount: unmatched.length,
        unmatched: unmatchedWithHistory,
        matchedAlbums: matched.map(m => ({ id: m.id, title: m.title, musicbrainz_id: m.musicbrainz_id, release_year: m.release_year }))
    });
}
