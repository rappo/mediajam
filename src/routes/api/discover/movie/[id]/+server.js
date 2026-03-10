import db from '$lib/server/db.js';
import { json } from '@sveltejs/kit';
import { tmdbFetch, getTmdbKey } from '$lib/server/tmdb.js';

const TMDB_IMG = 'https://image.tmdb.org/t/p/w185';

/**
 * GET /api/discover/movie/[id] — fetch similar & recommended movies from TMDb.
 * Cross-references with local library to mark "in_library" items.
 */
export async function GET({ params, locals }) {
    if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

    try {
        const mediaParentId = parseInt(params.id);
        const movie = /** @type {any} */ (db.prepare(
            'SELECT id, title, tmdb_id FROM media_parents WHERE id = ? AND media_type = ?'
        ).get(mediaParentId, 'movie'));
        if (!movie) return json({ error: 'Movie not found' }, { status: 404 });
        if (!movie.tmdb_id) return json({ error: 'No TMDb ID — cannot discover related movies' }, { status: 400 });

        if (!getTmdbKey()) {
            return json({ error: 'TMDb API key not configured. Add it in Settings → System.' }, { status: 400 });
        }

        // Fetch both similar and recommendations
        const [similarRes, recsRes] = await Promise.all([
            tmdbFetch(`/movie/${movie.tmdb_id}/similar`, { page: '1' }),
            tmdbFetch(`/movie/${movie.tmdb_id}/recommendations`, { page: '1' }),
        ]);

        /** @type {Map<string, any>} */
        const seen = new Map();

        for (const res of [recsRes, similarRes]) {
            if (!res.ok) continue;
            const data = await res.json();
            for (const item of (data.results || [])) {
                const tmdbId = String(item.id);
                if (seen.has(tmdbId)) continue;
                if (!item.title) continue;
                seen.set(tmdbId, {
                    tmdb_id: tmdbId,
                    media_type: 'movie',
                    title: item.title,
                    release_year: (item.release_date || '').split('-')[0] || null,
                    poster_url: item.poster_path ? `${TMDB_IMG}${item.poster_path}` : null,
                    overview: item.overview || '',
                    popularity: item.popularity || 0,
                    vote_average: item.vote_average || 0,
                    in_library: false,
                    library_id: null,
                });
            }
        }

        // Cross-reference with local library
        const checkLibrary = db.prepare('SELECT id FROM media_parents WHERE tmdb_id = ? AND media_type = ? LIMIT 1');
        const results = [...seen.values()];
        for (const item of results) {
            const existing = /** @type {any} */ (checkLibrary.get(item.tmdb_id, 'movie'));
            if (existing) {
                item.in_library = true;
                item.library_id = existing.id;
            }
        }

        // Sort: recommendations first (higher relevance), then by popularity
        results.sort((a, b) => (b.vote_average || 0) - (a.vote_average || 0));

        return json({
            movie: { id: movie.id, title: movie.title },
            items: results.filter(r => !r.in_library),
            inLibrary: results.filter(r => r.in_library),
            total: results.length,
        });
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`[discover/movie] Error:`, msg);
        return json({ error: `Discovery failed: ${msg}` }, { status: 500 });
    }
}
