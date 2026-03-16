import db from '$lib/server/db.js';
import {
    getHomepagePrefs,
    detectMoviePatterns,
    getPersonRecommendations,
    getRecentlyWatchedMovies,
    getUnwatchedMovies,
    getRecommendedMovies,
} from '$lib/server/homepage-engine.js';
import { json } from '@sveltejs/kit';

/** @type {import('./$types').RequestHandler} */
export function GET({ locals }) {
    const t0 = Date.now();
    const userId = locals.user?.id || 0;
    const prefs = getHomepagePrefs();

    // Full movie list for table
    let t = Date.now();
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
    console.log(`[movies-api] movie list: ${Date.now() - t}ms (${movies.length} rows)`);

    // Charts
    t = Date.now();
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
    console.log(`[movies-api] charts: ${Date.now() - t}ms`);

    // Smart Sections
    let hero = null, personRecs = [], recentlyWatched = [], unwatched = [], recommended = [];
    t = Date.now();
    try { hero = detectMoviePatterns(userId, prefs); } catch (e) {
        console.error('[movies] hero error:', e instanceof Error ? e.message : e);
    }
    console.log(`[movies-api] detectMoviePatterns: ${Date.now() - t}ms`);

    t = Date.now();
    try { recommended = getRecommendedMovies(userId, prefs.maxItemsPerSection); } catch (e) {
        console.error('[movies] recommended error:', e instanceof Error ? e.message : e);
    }
    console.log(`[movies-api] getRecommendedMovies: ${Date.now() - t}ms`);

    t = Date.now();
    try { personRecs = getPersonRecommendations(userId, prefs); } catch (e) {
        console.error('[movies] personRecs error:', e instanceof Error ? e.message : e);
    }
    console.log(`[movies-api] getPersonRecommendations: ${Date.now() - t}ms`);

    t = Date.now();
    try { recentlyWatched = getRecentlyWatchedMovies(userId, prefs.maxItemsPerSection); } catch (e) {
        console.error('[movies] recentlyWatched error:', e instanceof Error ? e.message : e);
    }
    console.log(`[movies-api] getRecentlyWatchedMovies: ${Date.now() - t}ms`);

    t = Date.now();
    try { unwatched = getUnwatchedMovies(prefs.maxItemsPerSection); } catch (e) {
        console.error('[movies] unwatched error:', e instanceof Error ? e.message : e);
    }
    console.log(`[movies-api] getUnwatchedMovies: ${Date.now() - t}ms`);
    console.log(`[movies-api] TOTAL: ${Date.now() - t0}ms`);

    return json({
        movies,
        moviesByDecade,
        moviesByYear,
        mostRewatched,
        sections: { hero, recommended, personRecs, recentlyWatched, unwatched }
    });
}
