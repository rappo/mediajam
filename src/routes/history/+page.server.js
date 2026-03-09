import db from '$lib/server/db.js';

export function load({ locals, url }) {
    const userId = locals.user?.id;
    const settings = db.prepare('SELECT jellyfin_url FROM app_settings WHERE id = 1').get();
    const jellyfinUrl = /** @type {any} */ (settings)?.jellyfin_url || '';

    // URL query params for filtering
    const fromDate = url.searchParams.get('from') || '';
    const toDate = url.searchParams.get('to') || '';
    const search = url.searchParams.get('q') || '';
    const mediaType = url.searchParams.get('type') || '';

    // Build WHERE clause dynamically
    const conditions = ['ph.user_id = ?'];
    const params = [userId];

    if (fromDate) {
        conditions.push("ph.timestamp >= ?");
        params.push(fromDate + 'T00:00:00.000Z');
    }
    if (toDate) {
        conditions.push("ph.timestamp <= ?");
        params.push(toDate + 'T23:59:59.999Z');
    }
    if (search) {
        conditions.push("(mc.title LIKE ? OR mp.title LIKE ? OR ph.track_name LIKE ?)");
        const likePattern = `%${search}%`;
        params.push(likePattern, likePattern, likePattern);
    }
    if (mediaType && mediaType !== 'all') {
        conditions.push("mp.media_type = ?");
        params.push(mediaType);
    }

    const whereClause = conditions.join(' AND ');

    // Get playback history with filters applied
    const history = userId ? /** @type {any[]} */ (db.prepare(`
        SELECT
            ph.id,
            ph.timestamp,
            ph.duration_consumed_seconds,
            ph.completion_pct,
            ph.source,
            ph.media_id,
            ph.track_name,
            mc.title as item_title,
            mc.season_number,
            mc.item_number,
            mc.jellyfin_id as item_jellyfin_id,
            mp.id as parent_id,
            mp.title as parent_title,
            mp.media_type,
            mp.poster_url,
            mp.jellyfin_id as parent_jellyfin_id,
            mp.collection_status
        FROM playback_history ph
        JOIN media_children mc ON ph.media_id = mc.id
        JOIN media_parents mp ON mc.parent_id = mp.id
        WHERE ${whereClause}
        ORDER BY ph.timestamp DESC
        LIMIT 500
    `).all(...params)) : [];

    // Build album art URLs for music entries
    for (const entry of history) {
        if (entry.media_type === 'artist' && entry.item_jellyfin_id) {
            entry.album_art_url = `${jellyfinUrl}/Items/${entry.item_jellyfin_id}/Images/Primary?maxHeight=80`;
        }
    }

    // Get active sessions
    db.prepare("DELETE FROM active_sessions WHERE last_update < datetime('now', '-30 minutes')").run();
    const activeSessions = db.prepare('SELECT * FROM active_sessions ORDER BY last_update DESC').all();

    // Summary stats (unfiltered — always show totals)
    const stats = userId ? /** @type {any} */ (db.prepare(`
        SELECT
            COUNT(*) as total_plays,
            COUNT(DISTINCT media_id) as unique_items,
            COUNT(DISTINCT DATE(timestamp)) as active_days,
            SUM(duration_consumed_seconds) as total_seconds
        FROM playback_history
        WHERE user_id = ?
    `).get(userId)) : {};

    // Longest streak
    let longestStreak = 0;
    if (userId) {
        const playDates = /** @type {any[]} */ (db.prepare(`
            SELECT DISTINCT DATE(timestamp) as play_date
            FROM playback_history
            WHERE user_id = ?
            ORDER BY play_date
        `).all(userId));

        let currentStreak = 1;
        for (let i = 1; i < playDates.length; i++) {
            const prev = new Date(playDates[i - 1].play_date);
            const curr = new Date(playDates[i].play_date);
            const diffDays = (curr.getTime() - prev.getTime()) / (1000 * 60 * 60 * 24);
            if (diffDays === 1) {
                currentStreak++;
            } else {
                if (currentStreak > longestStreak) longestStreak = currentStreak;
                currentStreak = 1;
            }
        }
        if (currentStreak > longestStreak) longestStreak = currentStreak;
        if (playDates.length === 0) longestStreak = 0;
    }

    // Today's scrobbles
    const todayCount = userId ? /** @type {any} */ (db.prepare(`
        SELECT COUNT(*) as count FROM playback_history
        WHERE user_id = ? AND DATE(timestamp) = DATE('now')
    `).get(userId))?.count || 0 : 0;

    // Year map for scrubber (year → count)
    const yearMap = userId ? /** @type {any[]} */ (db.prepare(`
        SELECT strftime('%Y', timestamp) as year, COUNT(*) as count
        FROM playback_history
        WHERE user_id = ? AND timestamp > '1900-01-02'
        GROUP BY year
        ORDER BY year DESC
    `).all(userId)) : [];

    // Group history by date
    /** @type {Record<string, any[]>} */
    const grouped = {};
    for (const entry of history) {
        const ts = entry.timestamp;
        let date;
        if (!ts || ts.startsWith('1900-01-01')) {
            date = 'Unknown Date';
        } else {
            date = new Date(ts).toLocaleDateString('en-US', {
                weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
            });
        }
        if (!grouped[date]) grouped[date] = [];
        grouped[date].push(entry);
    }

    const timeline = Object.entries(grouped).map(([date, entries]) => ({ date, entries }));

    return {
        history,
        activeSessions,
        timeline,
        jellyfinUrl,
        yearMap,
        filters: { from: fromDate, to: toDate, search, mediaType },
        stats: {
            totalPlays: stats?.total_plays || 0,
            uniqueItems: stats?.unique_items || 0,
            activeDays: stats?.active_days || 0,
            totalHours: stats?.total_seconds ? Math.round(stats.total_seconds / 3600) : 0,
            todayCount,
            longestStreak
        }
    };
}
