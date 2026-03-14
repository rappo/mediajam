import db from '$lib/server/db.js';
import {
    getHomepagePrefs,
    detectMoviePatterns,
    getBecauseYouLove,
    getRecentlyWatchedMovies,
    getUnwatchedMovies,
    getRecommendedMovies,
} from '$lib/server/homepage-engine.js';

/** @type {import('./$types').PageServerLoad} */
export function load({ locals }) {
    const userId = locals.user?.id || 0;
    const prefs = getHomepagePrefs();

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

    // Movies with watch status — for table view
    const movies = db.prepare(`
        WITH play_stats AS (
            SELECT media_id,
                   COUNT(*) as watch_count,
                   MAX(timestamp) as last_watched
            FROM (
                SELECT DISTINCT media_id,
                       CAST(strftime('%s', timestamp) / 43200 AS INTEGER) as time_bucket,
                       MAX(timestamp) as timestamp
                FROM playback_history WHERE user_id = ?
                GROUP BY media_id, time_bucket
            )
            GROUP BY media_id
        )
        SELECT
            mp.id, mp.title, mp.release_year, mp.poster_url, mp.overview,
            mp.tmdb_id, mp.imdb_id, mp.collected_children, mp.total_released_children,
            mp.collection_status, mp.arr_status,
            CASE
                WHEN mp.collection_status = 'wanted' THEN 'wanted'
                WHEN COALESCE(ps.watch_count, 0) > 0 THEN 'watched'
                ELSE mc.watch_status
            END as watch_status,
            COALESCE(ps.watch_count, 0) as play_count,
            COALESCE(ROUND(mc.runtime_ticks / 10000000.0 / 60, 0), mp.runtime_minutes) as runtime_minutes,
            COALESCE(ps.watch_count, 0) as watch_count,
            ps.last_watched
        FROM media_parents mp
        LEFT JOIN media_children mc ON mc.parent_id = mp.id
        LEFT JOIN play_stats ps ON ps.media_id = mc.id
        WHERE mp.media_type = 'movie'
        ORDER BY mp.title
    `).all(userId);

    // Movies by decade (for charts)
    const moviesByDecade = db.prepare(`
        SELECT (release_year / 10) * 10 as decade, COUNT(*) as count
        FROM media_parents WHERE media_type = 'movie' AND release_year IS NOT NULL
        GROUP BY decade ORDER BY decade
    `).all();

    const moviesByYear = db.prepare(`
        SELECT release_year as year, COUNT(*) as count
        FROM media_parents WHERE media_type = 'movie' AND release_year IS NOT NULL
        GROUP BY release_year ORDER BY release_year
    `).all();

    const mostRewatched = db.prepare(`
        SELECT mp.title, COUNT(*) as play_count
        FROM media_parents mp
        JOIN media_children mc ON mc.parent_id = mp.id
        JOIN (
            SELECT DISTINCT media_id, CAST(strftime('%s', timestamp) / 43200 AS INTEGER) as time_bucket
            FROM playback_history
        ) deduped ON deduped.media_id = mc.id
        WHERE mp.media_type = 'movie'
        GROUP BY mp.id HAVING COUNT(*) > 1
        ORDER BY play_count DESC LIMIT 10
    `).all();

    // ── Smart Sections (each isolated so one failure doesn't block the rest) ──
    let hero = null, becauseYouLove = [], recentlyWatched = [], unwatched = [], recommended = [];
    try { hero = detectMoviePatterns(userId, prefs); } catch (e) {
        console.error('[movies] hero error:', e instanceof Error ? e.message : e);
    }
    try { recommended = getRecommendedMovies(userId, prefs.maxItemsPerSection); } catch (e) {
        console.error('[movies] recommended error:', e instanceof Error ? e.message : e);
    }
    try { becauseYouLove = getBecauseYouLove(userId, prefs); } catch (e) {
        console.error('[movies] becauseYouLove error:', e instanceof Error ? e.message : e);
    }
    try { recentlyWatched = getRecentlyWatchedMovies(userId, prefs.maxItemsPerSection); } catch (e) {
        console.error('[movies] recentlyWatched error:', e instanceof Error ? e.message : e);
    }
    try { unwatched = getUnwatchedMovies(prefs.maxItemsPerSection); } catch (e) {
        console.error('[movies] unwatched error:', e instanceof Error ? e.message : e);
    }

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
        mostRewatched,
        sections: { hero, recommended, becauseYouLove, recentlyWatched, unwatched }
    };
}
