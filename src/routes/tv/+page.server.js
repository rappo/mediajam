import db from '$lib/server/db.js';

/** @type {import('./$types').PageServerLoad} */
export function load() {
    const totalShows = /** @type {any} */ (db.prepare('SELECT COUNT(*) as c FROM media_parents WHERE media_type = ?').get('show')).c;

    const episodeStats = /** @type {any} */ (db.prepare(`
        SELECT
            COUNT(*) as total,
            SUM(CASE WHEN watch_status = 'watched' THEN 1 ELSE 0 END) as watched,
            SUM(CASE WHEN watch_status = 'in_progress' THEN 1 ELSE 0 END) as in_progress,
            SUM(CASE WHEN watch_status = 'unwatched' THEN 1 ELSE 0 END) as unwatched,
            SUM(play_count) as total_plays,
            SUM(runtime_ticks) as total_runtime
        FROM media_children mc
        JOIN media_parents mp ON mc.parent_id = mp.id
        WHERE mp.media_type = 'show'
    `).get());

    const runtimeHours = Math.round((episodeStats.total_runtime || 0) / 10000000 / 3600);

    return {
        totalShows,
        episodeStats: {
            total: episodeStats.total || 0,
            watched: episodeStats.watched || 0,
            inProgress: episodeStats.in_progress || 0,
            unwatched: episodeStats.unwatched || 0,
            totalPlays: episodeStats.total_plays || 0
        },
        runtimeHours,
    };
}
