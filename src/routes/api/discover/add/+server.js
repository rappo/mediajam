import db from '$lib/server/db.js';
import { json } from '@sveltejs/kit';

/**
 * POST /api/discover/add — Create a media_parents stub from discovered TMDb data.
 * Used when adding a discovered item to *arr: we need a media_parents record first.
 * Body: { tmdb_id, media_type, title, release_year?, poster_url?, overview? }
 */
export async function POST({ request, locals }) {
    if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

    const { tmdb_id, media_type, title, release_year, poster_url, overview } = await request.json();

    if (!tmdb_id || !media_type || !title) {
        return json({ error: 'tmdb_id, media_type, and title are required' }, { status: 400 });
    }

    // Check if we already have this item in the library
    const existing = /** @type {any} */ (db.prepare(
        'SELECT id FROM media_parents WHERE tmdb_id = ? AND media_type = ? LIMIT 1'
    ).get(String(tmdb_id), media_type));

    if (existing) {
        return json({ mediaParentId: existing.id });
    }

    // For Sonarr, we need a tvdb_id. Try to look it up from TMDb.
    let tvdbId = null;
    if (media_type === 'show') {
        const settings = /** @type {any} */ (db.prepare('SELECT tmdb_api_key FROM app_settings WHERE id = 1').get());
        if (settings?.tmdb_api_key) {
            try {
                const res = await fetch(
                    `https://api.themoviedb.org/3/tv/${tmdb_id}/external_ids?api_key=${settings.tmdb_api_key}`
                );
                if (res.ok) {
                    const ids = await res.json();
                    tvdbId = ids.tvdb_id ? String(ids.tvdb_id) : null;
                }
            } catch { /* fallback: no tvdb_id */ }
        }
    }

    // Create the stub
    const result = db.prepare(`
        INSERT INTO media_parents (title, media_type, tmdb_id, tvdb_id, release_year, poster_url, overview, collection_status)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'discovered')
    `).run(title, media_type, String(tmdb_id), tvdbId, release_year || null, poster_url || null, overview || null);

    // Also create a media_children entry (movies need a child row for the arr add to work)
    if (media_type === 'movie') {
        db.prepare(`
            INSERT INTO media_children (parent_id, title, is_collected, season_number, item_number)
            VALUES (?, ?, 0, NULL, NULL)
        `).run(result.lastInsertRowid, title);
    }

    return json({ mediaParentId: /** @type {number} */ (result.lastInsertRowid) });
}
