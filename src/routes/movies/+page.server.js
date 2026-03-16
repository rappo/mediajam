import db from '$lib/server/db.js';

/** @type {import('./$types').PageServerLoad} */
export function load() {
    const totalMovies = /** @type {any} */ (db.prepare('SELECT COUNT(*) as c FROM media_parents WHERE media_type = ?').get('movie')).c;

    const movieStats = /** @type {any} */ (db.prepare(`
        SELECT
            COUNT(CASE WHEN mc.watch_status = 'watched' OR ph_count.c > 0 THEN 1 END) as watched,
            COUNT(CASE WHEN mc.watch_status = 'in_progress' AND COALESCE(ph_count.c, 0) = 0 THEN 1 END) as in_progress,
            COUNT(CASE WHEN mc.watch_status = 'unwatched' AND COALESCE(ph_count.c, 0) = 0 THEN 1 END) as unwatched,
            COALESCE(SUM(ph_count.c), 0) as total_plays,
            SUM(mc.runtime_ticks) as total_runtime
        FROM media_children mc
        JOIN media_parents mp ON mc.parent_id = mp.id
        LEFT JOIN (
            SELECT media_id, COUNT(*) as c FROM (
                SELECT DISTINCT media_id, CAST(strftime('%s', timestamp) / 43200 AS INTEGER) as time_bucket
                FROM playback_history
            ) GROUP BY media_id
        ) ph_count ON ph_count.media_id = mc.id
        WHERE mp.media_type = 'movie'
    `).get());

    const runtimeHours = Math.round((movieStats.total_runtime || 0) / 10000000 / 3600);

    return {
        totalMovies,
        movieStats: {
            watched: movieStats.watched || 0,
            inProgress: movieStats.in_progress || 0,
            unwatched: movieStats.unwatched || 0,
            totalPlays: movieStats.total_plays || 0
        },
        runtimeHours,
    };
}
