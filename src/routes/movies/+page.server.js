import db from '$lib/server/db.js';

/** @type {import('./$types').PageServerLoad} */
export function load({ locals }) {
    const totalMovies = db.prepare('SELECT COUNT(*) as c FROM media_parents WHERE media_type = ?').get('movie').c;

    const movieStats = db.prepare(`
        SELECT
            SUM(CASE WHEN mc.watch_status = 'watched' THEN 1 ELSE 0 END) as watched,
            SUM(CASE WHEN mc.watch_status = 'in_progress' THEN 1 ELSE 0 END) as in_progress,
            SUM(CASE WHEN mc.watch_status = 'unwatched' THEN 1 ELSE 0 END) as unwatched,
            SUM(mc.play_count) as total_plays,
            SUM(mc.runtime_ticks) as total_runtime
        FROM media_children mc
        JOIN media_parents mp ON mc.parent_id = mp.id
        WHERE mp.media_type = 'movie'
    `).get();

    const runtimeHours = Math.round((movieStats.total_runtime || 0) / 10000000 / 3600);

    // Movies with watch status
    const movies = db.prepare(`
        SELECT
            mp.id,
            mp.title,
            mp.release_year,
            mp.poster_url,
            mp.overview,
            mp.tmdb_id,
            mp.imdb_id,
            mp.collected_children,
            mp.total_released_children,
            mc.watch_status,
            mc.play_count,
            ROUND(mc.runtime_ticks / 10000000.0 / 60, 0) as runtime_minutes,
            COALESCE((SELECT COUNT(*) FROM playback_history ph WHERE ph.media_id = mc.id AND ph.user_id = ?), 0) as watch_count,
            (SELECT MAX(ph.timestamp) FROM playback_history ph WHERE ph.media_id = mc.id AND ph.user_id = ?) as last_watched
        FROM media_parents mp
        LEFT JOIN media_children mc ON mc.parent_id = mp.id
        WHERE mp.media_type = 'movie'
        ORDER BY mp.title
    `).all(locals.user?.id || 0, locals.user?.id || 0);

    // Movies by decade
    const moviesByDecade = db.prepare(`
        SELECT
            (release_year / 10) * 10 as decade,
            COUNT(*) as count
        FROM media_parents
        WHERE media_type = 'movie' AND release_year IS NOT NULL
        GROUP BY decade
        ORDER BY decade
    `).all();

    // Movies by year (recent 20 years)
    const moviesByYear = db.prepare(`
        SELECT release_year as year, COUNT(*) as count
        FROM media_parents
        WHERE media_type = 'movie' AND release_year IS NOT NULL AND release_year >= 2000
        GROUP BY release_year
        ORDER BY release_year
    `).all();

    // Most re-watched
    const mostRewatched = db.prepare(`
        SELECT mp.title, mc.play_count
        FROM media_parents mp
        JOIN media_children mc ON mc.parent_id = mp.id
        WHERE mp.media_type = 'movie' AND mc.play_count > 1
        ORDER BY mc.play_count DESC
        LIMIT 10
    `).all();

    return {
        totalMovies,
        movieStats: {
            watched: movieStats.watched || 0,
            inProgress: movieStats.in_progress || 0,
            unwatched: movieStats.unwatched || 0,
            totalPlays: movieStats.total_plays || 0
        },
        runtimeHours,
        movies,
        moviesByDecade,
        moviesByYear,
        mostRewatched
    };
}
