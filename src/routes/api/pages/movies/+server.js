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
import { getPrecomputed, setPrecomputed } from '$lib/server/section-cache.js';

/** @type {import('./$types').RequestHandler} */
export function GET({ locals, url }) {
    const userId = locals.user?.id || 0;
    const view = url.searchParams.get('view') || 'smart';
    const prefs = getHomepagePrefs();

    if (view === 'library') {
        // ── LIBRARY VIEW: table + charts ──────────────────────
        const movies = db.prepare(`
            SELECT mp.id, mp.title, mp.release_year, mp.poster_url,
                   mp.tmdb_id, mp.imdb_id, mp.jellyfin_id,
                   mp.collection_status, mp.arr_status,
                   COALESCE(pc.play_count, 0) as play_count,
                   pc.last_played
            FROM media_parents mp
            LEFT JOIN (
                SELECT mc2.parent_id, COUNT(*) as play_count, MAX(deduped.timestamp) as last_played
                FROM (
                    SELECT DISTINCT ph.media_id,
                           CAST(strftime('%s', ph.timestamp) / 43200 AS INTEGER) as time_bucket,
                           MAX(ph.timestamp) as timestamp
                    FROM playback_history ph
                    JOIN media_children mc2 ON ph.media_id = mc2.id
                    WHERE ph.user_id = ?
                    GROUP BY ph.media_id, time_bucket
                ) deduped
                JOIN media_children mc2 ON deduped.media_id = mc2.id
                GROUP BY mc2.parent_id
            ) pc ON pc.parent_id = mp.id
            WHERE mp.media_type = 'movie'
            ORDER BY mp.title
        `).all(userId);

        const moviesByDecade = db.prepare(`
            SELECT (release_year / 10) * 10 as decade, count(*) as count
            FROM media_parents WHERE media_type = 'movie' AND release_year IS NOT NULL
            GROUP BY decade ORDER BY decade
        `).all();

        const moviesByYear = db.prepare(`
            SELECT release_year as year, count(*) as count
            FROM media_parents WHERE media_type = 'movie' AND release_year IS NOT NULL
            GROUP BY year ORDER BY year
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
            GROUP BY mp.id HAVING play_count > 1
            ORDER BY play_count DESC LIMIT 15
        `).all();

        return json({ movies, moviesByDecade, moviesByYear, mostRewatched });
    }

    // ── SMART VIEW: serve from precomputed cache, fallback to live ──
    const cacheKey = `movies-smart-${userId}`;
    const cached = getPrecomputed(cacheKey);
    if (cached) {
        return json(cached.data);
    }

    // Cache miss — compute live, save for next time
    let hero = null, personRecs = [], recentlyWatched = [], unwatched = [], recommended = [];

    try { hero = detectMoviePatterns(userId, prefs); } catch (e) {
        console.error('[movies] hero error:', e instanceof Error ? e.message : e);
    }
    try { recommended = getRecommendedMovies(userId, prefs.maxItemsPerSection); } catch (e) {
        console.error('[movies] recommended error:', e instanceof Error ? e.message : e);
    }
    try { personRecs = getPersonRecommendations(userId, prefs); } catch (e) {
        console.error('[movies] personRecs error:', e instanceof Error ? e.message : e);
    }
    try { recentlyWatched = getRecentlyWatchedMovies(userId, prefs.maxItemsPerSection); } catch (e) {
        console.error('[movies] recentlyWatched error:', e instanceof Error ? e.message : e);
    }
    try { unwatched = getUnwatchedMovies(prefs.maxItemsPerSection); } catch (e) {
        console.error('[movies] unwatched error:', e instanceof Error ? e.message : e);
    }

    const result = {
        sections: { hero, recommended, personRecs, recentlyWatched, unwatched },
    };

    // Save result to cache for next time
    try { setPrecomputed(cacheKey, result); } catch { /* non-fatal */ }

    return json(result);
}
