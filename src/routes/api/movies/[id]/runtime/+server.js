import { json } from '@sveltejs/kit';
import db from '$lib/server/db.js';

/**
 * GET /api/movies/[id]/runtime
 * Returns the runtime, fetching from TMDB on demand if needed.
 */
export async function GET({ params, locals }) {
    if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
    const movieId = parseInt(params.id);

    const movie = /** @type {any} */ (db.prepare(`
        SELECT mp.id, mp.tmdb_id, mp.runtime_minutes as external_runtime,
               ROUND(mc.runtime_ticks / 10000000.0 / 60, 0) as local_runtime
        FROM media_parents mp
        LEFT JOIN media_children mc ON mc.parent_id = mp.id
        WHERE mp.id = ? AND mp.media_type = 'movie'
    `).get(movieId));

    if (!movie) return json({ error: 'Not found' }, { status: 404 });

    const runtime = movie.local_runtime || movie.external_runtime || null;
    if (runtime) {
        return json({ runtime, source: movie.local_runtime ? 'local' : 'external' });
    }

    // No runtime — try TMDB
    if (movie.tmdb_id) {
        try {
            const { tmdbFetch } = await import('$lib/server/tmdb.js');
            const res = await tmdbFetch(`/movie/${movie.tmdb_id}`);
            if (res.ok) {
                const d = await res.json();
                const tmdbRuntime = d.runtime || null;
                if (tmdbRuntime) {
                    db.prepare('UPDATE media_parents SET runtime_minutes = ? WHERE id = ?')
                        .run(tmdbRuntime, movieId);
                    return json({ runtime: tmdbRuntime, source: 'tmdb', fetched: true });
                }
            }
        } catch (e) {
            console.error(`[runtime] TMDB fetch error for movie ${movieId}:`, e instanceof Error ? e.message : String(e));
        }
    }

    return json({ runtime: null, source: null });
}
