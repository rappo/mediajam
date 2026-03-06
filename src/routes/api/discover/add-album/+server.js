import db from '$lib/server/db.js';
import { json } from '@sveltejs/kit';

/**
 * POST /api/discover/add-album — Create a media_children stub (album) under an existing artist.
 * Body: { artistId, title, release_year?, mbid?, cover_url? }
 */
export async function POST({ request, locals }) {
    if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

    const { artistId, title, release_year, mbid, cover_url } = await request.json();

    if (!artistId || !title) {
        return json({ error: 'artistId and title are required' }, { status: 400 });
    }

    // Verify artist exists
    const artist = /** @type {any} */ (db.prepare(
        "SELECT id, title, musicbrainz_id FROM media_parents WHERE id = ? AND media_type = 'artist'"
    ).get(artistId));
    if (!artist) return json({ error: 'Artist not found' }, { status: 404 });

    // Check if album already exists by title match (case-insensitive)
    const existing = /** @type {any} */ (db.prepare(
        `SELECT id FROM media_children WHERE parent_id = ? AND LOWER(title) = LOWER(?) LIMIT 1`
    ).get(artistId, title.trim()));

    if (existing) {
        return json({ albumId: existing.id, existed: true });
    }

    // Create stub album as media_child
    const result = db.prepare(`
        INSERT INTO media_children (parent_id, title, item_number, is_collected, season_number)
        VALUES (?, ?, ?, 0, NULL)
    `).run(artistId, title.trim(), release_year || null);

    const albumId = /** @type {number} */ (result.lastInsertRowid);

    // Try to enrich with MusicBrainz data if we have mbid
    if (mbid) {
        try {
            const url = `https://musicbrainz.org/ws/2/release-group/${mbid}?inc=releases&fmt=json`;
            const res = await fetch(url, {
                headers: {
                    'User-Agent': 'Mediajam/1.0 (https://github.com/mediajam)',
                    'Accept': 'application/json'
                }
            });
            if (res.ok) {
                const data = await res.json();
                // Get first release date if not already set
                if (!release_year && data['first-release-date']) {
                    const year = data['first-release-date'].split('-')[0];
                    if (year) {
                        db.prepare('UPDATE media_children SET item_number = ? WHERE id = ?').run(parseInt(year), albumId);
                    }
                }
            }
        } catch { /* ignore enrichment errors */ }
    }

    console.log(`[discover] Created album stub: "${title}" under artist "${artist.title}" (id=${albumId})`);
    return json({ albumId, existed: false });
}
