import { json } from '@sveltejs/kit';
import db from '$lib/server/db.js';

/**
 * GET /api/users/:userId/stats — Collection and playback statistics.
 * Unauthenticated endpoint for external consumption.
 * @type {import('./$types').RequestHandler}
 */
export async function GET({ params }) {
    const userId = parseInt(params.userId);

    // Collection stats
    const collection = /** @type {any} */ (db.prepare(`
        SELECT
            COUNT(DISTINCT CASE WHEN mp.media_type = 'show' THEN mp.id END) as shows,
            COUNT(DISTINCT CASE WHEN mp.media_type = 'movie' THEN mp.id END) as movies,
            COUNT(DISTINCT CASE WHEN mp.media_type = 'artist' THEN mp.id END) as artists,
            SUM(CASE WHEN mc.is_collected = 1 THEN 1 ELSE 0 END) as collected_items,
            SUM(mc.runtime_ticks) as total_runtime_ticks
        FROM media_children mc
        JOIN media_parents mp ON mc.parent_id = mp.id
    `).get());

    // Playback stats from history
    const playback = /** @type {any} */ (db.prepare(`
        SELECT
            COUNT(*) as total_plays,
            COUNT(DISTINCT media_id) as unique_items_played,
            SUM(duration_consumed_seconds) as total_seconds_played,
            MIN(timestamp) as first_play,
            MAX(timestamp) as last_play
        FROM playback_history
        WHERE user_id = ?
    `).get(userId));

    // Top items by play count
    const topItems = db.prepare(`
        SELECT
            mp.title as parent_title,
            mc.title as item_title,
            mp.media_type,
            COUNT(*) as play_count
        FROM playback_history ph
        JOIN media_children mc ON ph.media_id = mc.id
        JOIN media_parents mp ON mc.parent_id = mp.id
        WHERE ph.user_id = ?
        GROUP BY ph.media_id
        ORDER BY play_count DESC
        LIMIT 10
    `).all(userId);

    const totalRuntimeHours = collection?.total_runtime_ticks
        ? Math.round(collection.total_runtime_ticks / 10000000 / 3600)
        : 0;

    const totalPlayedHours = playback?.total_seconds_played
        ? Math.round(playback.total_seconds_played / 3600)
        : 0;

    return json({
        userId,
        collection: {
            shows: collection?.shows || 0,
            movies: collection?.movies || 0,
            artists: collection?.artists || 0,
            collectedItems: collection?.collected_items || 0,
            totalRuntimeHours
        },
        playback: {
            totalPlays: playback?.total_plays || 0,
            uniqueItemsPlayed: playback?.unique_items_played || 0,
            totalPlayedHours,
            firstPlay: playback?.first_play || null,
            lastPlay: playback?.last_play || null
        },
        topItems
    });
}
