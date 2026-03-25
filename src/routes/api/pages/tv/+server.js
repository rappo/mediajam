import db from '$lib/server/db.js';
import {
    getHomepagePrefs,
    getAiringThisWeek,
    getNewUnwatchedEpisodes,
    getBehindOnShows,
    getUpcomingEpisodes,
    getRecentlyWatchedShows,
    getNextUp,
} from '$lib/server/homepage-engine.js';
import { json } from '@sveltejs/kit';
import { getPrecomputed, setPrecomputed } from '$lib/server/section-cache.js';

export function GET({ locals, url }) {
    const userId = locals.user?.id || 0;
    const prefs = getHomepagePrefs();
    const view = url.searchParams.get('view') || 'smart';

    if (view === 'library') {
        // ── LIBRARY VIEW: table + charts ──────────────────────────
        const shows = db.prepare(`
            WITH play_stats AS (
                SELECT mc2.parent_id,
                       COUNT(*) as watch_count,
                       MAX(timestamp) as last_watched
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
            )
            SELECT
                mp.id, mp.title, mp.release_year, mp.poster_url,
                mp.tmdb_id, mp.imdb_id,
                mp.collected_children, mp.total_released_children,
                mp.collection_status, mp.arr_status,
                COALESCE(ps.watch_count, 0) as play_count,
                ps.last_watched
            FROM media_parents mp
            LEFT JOIN play_stats ps ON ps.parent_id = mp.id
            WHERE mp.media_type = 'show'
            ORDER BY mp.title
        `).all(userId);

        const topShowsByWatchCount = db.prepare(`
            SELECT mp.title, COUNT(*) as play_count
            FROM media_parents mp
            JOIN media_children mc ON mc.parent_id = mp.id
            JOIN (
                SELECT DISTINCT media_id, CAST(strftime('%s', timestamp) / 43200 AS INTEGER) as time_bucket
                FROM playback_history
            ) deduped ON deduped.media_id = mc.id
            WHERE mp.media_type = 'show'
            GROUP BY mp.id
            ORDER BY play_count DESC LIMIT 10
        `).all();

        const showsByYear = db.prepare(`
            SELECT release_year as year, COUNT(*) as count
            FROM media_parents WHERE media_type = 'show' AND release_year IS NOT NULL
            GROUP BY release_year ORDER BY release_year
        `).all();

        const completionBuckets = (() => {
            const rows = db.prepare(`
                SELECT
                    CASE
                        WHEN COALESCE(watched_pct, 0) = 0 THEN 'none'
                        WHEN watched_pct < 100 THEN 'partial'
                        ELSE 'full'
                    END as bucket,
                    COUNT(*) as count
                FROM (
                    SELECT mp.id,
                        CASE WHEN COUNT(mc.id) > 0 THEN
                            ROUND(100.0 * SUM(CASE WHEN mc.watch_status = 'watched' THEN 1 ELSE 0 END) / COUNT(mc.id))
                        ELSE 0 END as watched_pct
                    FROM media_parents mp
                    LEFT JOIN media_children mc ON mc.parent_id = mp.id
                    WHERE mp.media_type = 'show'
                    GROUP BY mp.id
                )
                GROUP BY bucket
            `).all();
            /** @type {Record<string, number>} */
            const out = { full: 0, partial: 0, none: 0 };
            for (const r of rows) out[/** @type {any} */ (r).bucket] = /** @type {any} */ (r).count;
            return out;
        })();

        const collectionRow = /** @type {any} */ (db.prepare(`
            SELECT COALESCE(SUM(collected_children), 0) as totalCollected,
                   COALESCE(SUM(total_released_children), 0) as totalReleased
            FROM media_parents WHERE media_type = 'show'
        `).get());

        const collectionBuckets = (() => {
            const rows = db.prepare(`
                SELECT
                    CASE
                        WHEN collected_children >= total_released_children AND total_released_children > 0 THEN 'complete'
                        WHEN collected_children > 0 THEN 'partial'
                        ELSE 'missing'
                    END as bucket,
                    COUNT(*) as count
                FROM media_parents WHERE media_type = 'show'
                GROUP BY bucket
            `).all();
            /** @type {Record<string, number>} */
            const out = { complete: 0, partial: 0, missing: 0 };
            for (const r of rows) out[/** @type {any} */ (r).bucket] = /** @type {any} */ (r).count;
            return out;
        })();

        return json({
            shows,
            topShowsByWatchCount,
            showsByYear,
            completionBuckets,
            collectionBuckets,
            collectionStats: {
                totalCollected: collectionRow.totalCollected,
                totalReleased: collectionRow.totalReleased,
                overallPct: collectionRow.totalReleased > 0 ? Math.round((collectionRow.totalCollected / collectionRow.totalReleased) * 100) : 100
            },
        });
    }

    // ── SMART VIEW: serve from precomputed cache, fallback to live ──
    const cacheKey = `tv-smart-${userId}`;
    const cached = getPrecomputed(cacheKey);
    if (cached) {
        return json(cached.data);
    }

    // Cache miss — compute live, save for next time
    let airingThisWeek = [], newUnwatched = [], behindOn = [], comingUp = [], recentlyWatched = [], nextUp = [];
    try { airingThisWeek = getAiringThisWeek(prefs, userId); } catch (e) {
        console.error('[tv] airingThisWeek error:', e instanceof Error ? e.message : e);
    }
    try { newUnwatched = getNewUnwatchedEpisodes(prefs, userId); } catch (e) {
        console.error('[tv] newUnwatched error:', e instanceof Error ? e.message : e);
    }
    try { behindOn = getBehindOnShows(userId); } catch (e) {
        console.error('[tv] behindOn error:', e instanceof Error ? e.message : e);
    }
    try { comingUp = getUpcomingEpisodes(prefs, userId); } catch (e) {
        console.error('[tv] comingUp error:', e instanceof Error ? e.message : e);
    }
    try { recentlyWatched = getRecentlyWatchedShows(userId, prefs.maxItemsPerSection); } catch (e) {
        console.error('[tv] recentlyWatched error:', e instanceof Error ? e.message : e);
    }
    try { nextUp = getNextUp(userId); } catch (e) {
        console.error('[tv] nextUp error:', e instanceof Error ? e.message : e);
    }

    const result = {
        sections: { airingThisWeek, newUnwatched, behindOn, comingUp, recentlyWatched, nextUp }
    };

    try { setPrecomputed(cacheKey, result); } catch { /* non-fatal */ }

    return json(result);
}

