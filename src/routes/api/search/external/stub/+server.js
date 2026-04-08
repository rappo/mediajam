import { json } from '@sveltejs/kit';
import db from '$lib/server/db.js';

/**
 * POST /api/search/external/stub
 * Find or create a local media_parents stub for an external result.
 * Body: { type: 'movie'|'show'|'artist', tmdb_id?, musicbrainz_id?, title, release_year?, poster_url?, overview? }
 * Returns: { id, href }
 */
export async function POST({ request, locals }) {
    if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

    const body = await request.json();
    const { type, tmdb_id, musicbrainz_id, title, release_year, poster_url, overview } = body;

    if (!type || !title) return json({ error: 'type and title required' }, { status: 400 });

    const mediaType = type === 'movie' ? 'movie' : type === 'show' ? 'show' : 'artist';
    const routePrefix = type === 'movie' ? '/movies' : type === 'show' ? '/tv' : '/music';

    // Try to find existing entry by external ID first
    /** @type {any} */
    let existing = null;

    if (tmdb_id) {
        existing = db.prepare(
            'SELECT id FROM media_parents WHERE tmdb_id = ? AND media_type = ?'
        ).get(String(tmdb_id), mediaType);
    }
    if (!existing && musicbrainz_id) {
        existing = db.prepare(
            'SELECT id FROM media_parents WHERE musicbrainz_id = ? AND media_type = ?'
        ).get(musicbrainz_id, mediaType);
    }

    if (existing) {
        return json({ id: existing.id, href: `${routePrefix}/${existing.id}` });
    }

    // Create a new stub with collection_status = 'external'
    try {
        const result = db.prepare(`
            INSERT INTO media_parents (title, media_type, tmdb_id, musicbrainz_id, release_year, poster_url, overview, collection_status)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'external')
        `).run(
            title,
            mediaType,
            tmdb_id ? String(tmdb_id) : null,
            musicbrainz_id || null,
            release_year ? parseInt(release_year) : null,
            poster_url || null,
            overview || null
        );

        const id = Number(result.lastInsertRowid);
        return json({ id, href: `${routePrefix}/${id}` });
    } catch (/** @type {any} */ e) {
        // UNIQUE constraint — race condition, another request created it
        if (String(e).includes('UNIQUE constraint')) {
            let retry = null;
            if (tmdb_id) {
                retry = /** @type {any} */ (db.prepare(
                    'SELECT id FROM media_parents WHERE tmdb_id = ? AND media_type = ?'
                ).get(String(tmdb_id), mediaType));
            }
            if (!retry && musicbrainz_id) {
                retry = /** @type {any} */ (db.prepare(
                    'SELECT id FROM media_parents WHERE musicbrainz_id = ? AND media_type = ?'
                ).get(musicbrainz_id, mediaType));
            }
            if (retry) {
                return json({ id: retry.id, href: `${routePrefix}/${retry.id}` });
            }
        }
        return json({ error: e?.message || String(e) }, { status: 500 });
    }
}
