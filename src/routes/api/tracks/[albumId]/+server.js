import { json } from '@sveltejs/kit';
import db from '$lib/server/db.js';

/**
 * GET /api/tracks/[albumId] — Return tracks for an album from local DB.
 * albumId here is the media_children.jellyfin_id (for backwards compat with client fetch).
 */
export async function GET({ params }) {
    const jellyfinId = params.albumId;

    // Look up the local album by jellyfin_id
    const album = /** @type {any} */ (
        db.prepare('SELECT id FROM media_children WHERE jellyfin_id = ?').get(jellyfinId)
    );

    if (!album) {
        return json([]);
    }

    // Fetch tracks from local DB, formatted like Jellyfin API response for compat
    const tracks = /** @type {any[]} */ (
        db.prepare(`
            SELECT
                t.jellyfin_id as Id,
                t.title as Name,
                t.track_number as IndexNumber,
                t.disc_number as ParentIndexNumber,
                t.runtime_ticks as RunTimeTicks,
                t.musicbrainz_id
            FROM tracks t
            WHERE t.album_id = ?
            ORDER BY t.disc_number ASC, t.track_number ASC
        `).all(album.id)
    );

    return json(tracks);
}
