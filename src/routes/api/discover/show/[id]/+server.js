import db from '$lib/server/db.js';
import { json } from '@sveltejs/kit';
import { tmdbFetch, getTmdbKey } from '$lib/server/tmdb.js';

const TMDB_IMG = 'https://image.tmdb.org/t/p/w185';

/**
 * GET /api/discover/show/[id] — fetch similar & recommended TV shows from TMDb.
 * Cross-references with local library to mark "in_library" items.
 */
export async function GET({ params, locals }) {
    if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

    try {
        const mediaParentId = parseInt(params.id);
        const show = /** @type {any} */ (db.prepare(
            'SELECT id, title, tmdb_id FROM media_parents WHERE id = ? AND media_type = ?'
        ).get(mediaParentId, 'show'));
        if (!show) return json({ error: 'Show not found' }, { status: 404 });
        if (!show.tmdb_id) return json({ error: 'No TMDb ID — cannot discover related shows' }, { status: 400 });

        if (!getTmdbKey()) {
            return json({ error: 'TMDb API key not configured. Add it in Settings → System.' }, { status: 400 });
        }

        // Fetch both similar and recommendations
        const [similarRes, recsRes] = await Promise.all([
            tmdbFetch(`/tv/${show.tmdb_id}/similar`, { page: '1' }),
            tmdbFetch(`/tv/${show.tmdb_id}/recommendations`, { page: '1' }),
        ]);

        /** @type {Map<string, any>} */
        const seen = new Map();

        for (const res of [recsRes, similarRes]) {
            if (!res.ok) continue;
            const data = await res.json();
            for (const item of (data.results || [])) {
                const tmdbId = String(item.id);
                if (seen.has(tmdbId)) continue;
                const title = item.name || item.original_name;
                if (!title) continue;
                seen.set(tmdbId, {
                    tmdb_id: tmdbId,
                    media_type: 'show',
                    title,
                    release_year: (item.first_air_date || '').split('-')[0] || null,
                    poster_url: item.poster_path ? `${TMDB_IMG}${item.poster_path}` : null,
                    overview: item.overview || '',
                    popularity: item.popularity || 0,
                    vote_average: item.vote_average || 0,
                    genre_ids: item.genre_ids || [],
                    in_library: false,
                    library_id: null,
                });
            }
        }

        // Cross-reference with local library
        const checkLibrary = db.prepare('SELECT id FROM media_parents WHERE tmdb_id = ? AND media_type = ? LIMIT 1');
        const results = [...seen.values()];
        for (const item of results) {
            const existing = /** @type {any} */ (checkLibrary.get(item.tmdb_id, 'show'));
            if (existing) {
                item.in_library = true;
                item.library_id = existing.id;
            }
        }

        // Sort by vote average
        results.sort((a, b) => (b.vote_average || 0) - (a.vote_average || 0));

        return json({
            show: { id: show.id, title: show.title },
            items: results.filter(r => !r.in_library),
            inLibrary: results.filter(r => r.in_library),
            total: results.length,
        });
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`[discover/show] Error:`, msg);
        return json({ error: `Discovery failed: ${msg}` }, { status: 500 });
    }
}
