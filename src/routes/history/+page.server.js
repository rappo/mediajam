import db from '$lib/server/db.js';

export function load() {
    const settings = db.prepare('SELECT jellyfin_url FROM app_settings WHERE id = 1').get();
    const jellyfinUrl = /** @type {any} */ (settings)?.jellyfin_url || '';

    // Get recent playback history (last 100 entries)
    const history = db.prepare(`
        SELECT
            ph.id,
            ph.timestamp,
            ph.duration_consumed_seconds,
            ph.completion_pct,
            ph.source,
            mc.title as item_title,
            mc.season_number,
            mc.item_number,
            mc.jellyfin_id as item_jellyfin_id,
            mp.title as parent_title,
            mp.media_type,
            mp.poster_url,
            mp.jellyfin_id as parent_jellyfin_id
        FROM playback_history ph
        JOIN media_children mc ON ph.media_id = mc.id
        JOIN media_parents mp ON mc.parent_id = mp.id
        ORDER BY ph.timestamp DESC
        LIMIT 100
    `).all();

    // Get active sessions
    db.prepare("DELETE FROM active_sessions WHERE last_update < datetime('now', '-30 minutes')").run();
    const activeSessions = db.prepare('SELECT * FROM active_sessions ORDER BY last_update DESC').all();

    // Summary stats
    const stats = /** @type {any} */ (db.prepare(`
        SELECT
            COUNT(*) as total_plays,
            COUNT(DISTINCT media_id) as unique_items,
            COUNT(DISTINCT DATE(timestamp)) as active_days,
            SUM(duration_consumed_seconds) as total_seconds
        FROM playback_history
    `).get());

    // Today's scrobbles
    const todayCount = /** @type {any} */ (db.prepare(`
        SELECT COUNT(*) as count FROM playback_history
        WHERE DATE(timestamp) = DATE('now')
    `).get())?.count || 0;

    // Group history by date for the timeline view
    /** @type {Record<string, any[]>} */
    const grouped = {};
    for (const entry of history) {
        const date = entry.timestamp ? new Date(entry.timestamp).toLocaleDateString('en-US', {
            weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
        }) : 'Unknown Date';
        if (!grouped[date]) grouped[date] = [];
        grouped[date].push(entry);
    }

    const timeline = Object.entries(grouped).map(([date, entries]) => ({ date, entries }));

    return {
        history,
        activeSessions,
        timeline,
        jellyfinUrl,
        stats: {
            totalPlays: stats?.total_plays || 0,
            uniqueItems: stats?.unique_items || 0,
            activeDays: stats?.active_days || 0,
            totalHours: stats?.total_seconds ? Math.round(stats.total_seconds / 3600) : 0,
            todayCount
        }
    };
}
