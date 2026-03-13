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
    const rawHistory = userId ? /** @type {any[]} */ (db.prepare(`
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
            mc.runtime_ticks as child_runtime_ticks,
            mp.id as parent_id,
            mp.title as parent_title,
            mp.media_type,
            mp.poster_url,
            mp.jellyfin_id as parent_jellyfin_id,
            mp.collection_status,
            t.runtime_ticks as track_runtime_ticks
        FROM playback_history ph
        JOIN media_children mc ON ph.media_id = mc.id
        JOIN media_parents mp ON mc.parent_id = mp.id
        LEFT JOIN tracks t ON t.album_id = mc.id AND t.title = ph.track_name
        WHERE ${whereClause}
        ORDER BY ph.timestamp DESC
        LIMIT 500
    `).all(...params)) : [];

    // Dedup strategy differs by media type:
    // - Video: Map-based 12-hour window keyed on media_id (Trakt UTC vs Jellyfin local can differ ~7-8h)
    // - Music: adjacency-based — only merge back-to-back entries of the SAME track.
    //   A→B→A = 2 plays of A. A→A (from different sources) = 1 play.
    const VIDEO_DEDUP_MS = 12 * 60 * 60 * 1000; // 12 hours
    /** @type {any[]} */
    const history = [];
    /** @type {Map<string, any>} */
    const recentByKey = new Map(); // used for video only

    for (const entry of rawHistory) {
        const isMusic = entry.media_type === 'artist';

        if (isMusic) {
            // Adjacency dedup: merge only if the previous history entry is the same track
            const prev = history.length > 0 ? history[history.length - 1] : null;
            if (prev && prev.media_type === 'artist'
                && prev.media_id === entry.media_id
                && (prev.track_name || '') === (entry.track_name || '')) {
                // Back-to-back same track — merge sources
                const sources = new Set((prev.source || '').split(' + '));
                sources.add(entry.source);
                prev.source = [...sources].join(' + ');
                if (!prev.duration_consumed_seconds && entry.duration_consumed_seconds) {
                    prev.duration_consumed_seconds = entry.duration_consumed_seconds;
                }
                continue;
            }
        } else {
            // Video: Map-based window dedup
            const dedupKey = String(entry.media_id);
            const existing = recentByKey.get(dedupKey);
            if (existing) {
                const existingTime = new Date(existing.timestamp).getTime();
                const entryTime = new Date(entry.timestamp).getTime();
                if (Math.abs(existingTime - entryTime) <= VIDEO_DEDUP_MS) {
                    const sources = new Set((existing.source || '').split(' + '));
                    sources.add(entry.source);
                    existing.source = [...sources].join(' + ');
                    if (!existing.duration_consumed_seconds && entry.duration_consumed_seconds) {
                        existing.duration_consumed_seconds = entry.duration_consumed_seconds;
                    }
                    if (!existing.completion_pct && entry.completion_pct) {
                        existing.completion_pct = entry.completion_pct;
                    }
                    continue;
                }
            }
            recentByKey.set(dedupKey, entry);
        }
        history.push(entry);
    }

    // Build album art URLs for music entries
    for (const entry of history) {
        if (entry.media_type === 'artist' && entry.item_jellyfin_id) {
            entry.album_art_url = `${jellyfinUrl}/Items/${entry.item_jellyfin_id}/Images/Primary?maxHeight=80`;
        }
    }

    // Get active sessions
    db.prepare("DELETE FROM active_sessions WHERE last_update < datetime('now', '-30 minutes')").run();
    const activeSessions = db.prepare('SELECT * FROM active_sessions ORDER BY last_update DESC').all();

    // Summary stats (unfiltered — always show totals, deduplicated by 12-hour window)
    const stats = userId ? /** @type {any} */ (db.prepare(`
        SELECT
            COUNT(*) as total_plays,
            COUNT(DISTINCT media_id) as unique_items,
            COUNT(DISTINCT DATE(timestamp)) as active_days,
            SUM(duration_consumed_seconds) as total_seconds,
            MIN(CASE WHEN timestamp > '1900-01-02' THEN timestamp END) as first_checkin
        FROM (
            SELECT DISTINCT media_id,
                   CAST(strftime('%s', timestamp) / 43200 AS INTEGER) as time_bucket,
                   MAX(timestamp) as timestamp,
                   MAX(duration_consumed_seconds) as duration_consumed_seconds
            FROM playback_history
            WHERE user_id = ?
            GROUP BY media_id, time_bucket
        )
    `).get(userId)) : {};

    // Estimate total time from runtime_ticks if duration_consumed_seconds isn't tracked
    let totalSeconds = stats?.total_seconds || 0;
    if (!totalSeconds && userId) {
        // Estimate: sum runtime of each unique played item × play count
        const estimated = /** @type {any} */ (db.prepare(`
            SELECT SUM(mc.runtime_ticks / 10000000) as est_seconds
            FROM playback_history ph
            JOIN media_children mc ON ph.media_id = mc.id
            WHERE ph.user_id = ? AND mc.runtime_ticks > 0
        `).get(userId));
        totalSeconds = estimated?.est_seconds || 0;
    }

    // First check-in date stats
    const firstCheckIn = stats?.first_checkin || null;
    let totalDaysSince = 0;
    let activePct = 0;
    let firstCheckInLabel = '';
    if (firstCheckIn) {
        const first = new Date(firstCheckIn);
        const now = new Date();
        totalDaysSince = Math.floor((now.getTime() - first.getTime()) / (1000 * 60 * 60 * 24));
        activePct = totalDaysSince > 0 ? Math.round((stats.active_days / totalDaysSince) * 100) : 100;
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        firstCheckInLabel = `${months[first.getMonth()]} '${String(first.getFullYear()).slice(2)}`;
    }

    // Format total seconds into friendly relative time
    let friendlyTime = '0';
    if (totalSeconds > 0) {
        const days = Math.floor(totalSeconds / 86400);
        const hours = Math.floor((totalSeconds % 86400) / 3600);
        const mins = Math.floor((totalSeconds % 3600) / 60);
        const parts = [];
        const years = Math.floor(days / 365);
        const months = Math.floor((days % 365) / 30);
        const remainDays = days % 30;
        if (years > 0) parts.push(`${years} yr${years > 1 ? 's' : ''}`);
        if (months > 0) parts.push(`${months} mo`);
        if (remainDays > 0 && years === 0) parts.push(`${remainDays} day${remainDays > 1 ? 's' : ''}`);
        if (hours > 0 && years === 0 && months === 0) parts.push(`${hours} hr${hours > 1 ? 's' : ''}`);
        if (mins > 0 && days === 0 && hours < 10) parts.push(`${mins} min`);
        friendlyTime = parts.slice(0, 2).join(' ') || '< 1 min';
    }

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

    // Today's scrobbles (deduplicated)
    const todayCount = userId ? /** @type {any} */ (db.prepare(`
        SELECT COUNT(*) as count FROM (
            SELECT DISTINCT media_id, CAST(strftime('%s', timestamp) / 43200 AS INTEGER) as time_bucket
            FROM playback_history
            WHERE user_id = ? AND DATE(timestamp) = DATE('now')
            GROUP BY media_id, time_bucket
        )
    `).get(userId))?.count || 0 : 0;

    // Year map for scrubber (year → count, deduplicated)
    const yearMap = userId ? /** @type {any[]} */ (db.prepare(`
        SELECT strftime('%Y', timestamp) as year, COUNT(*) as count
        FROM (
            SELECT DISTINCT media_id, CAST(strftime('%s', timestamp) / 43200 AS INTEGER) as time_bucket,
                   MAX(timestamp) as timestamp
            FROM playback_history
            WHERE user_id = ? AND timestamp > '1900-01-02'
            GROUP BY media_id, time_bucket
        )
        GROUP BY year
        ORDER BY year DESC
    `).all(userId)) : [];

    // Load user's timezone preference (fallback to server's local timezone, not UTC)
    const serverTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    let userTimezone = serverTimezone;
    if (userId) {
        try {
            const userRow = /** @type {any} */ (db.prepare('SELECT preferences FROM users WHERE id = ?').get(userId));
            const prefs = userRow?.preferences ? JSON.parse(userRow.preferences) : {};
            if (prefs.timezone) userTimezone = prefs.timezone;
        } catch { /* use default */ }
    }

    // Group history by date (using user's timezone)
    /** @type {Record<string, any[]>} */
    const grouped = {};
    for (const entry of history) {
        const ts = entry.timestamp;
        let date;
        if (!ts || ts.startsWith('1900-01-01')) {
            date = 'Unknown Date';
        } else {
            date = new Date(ts).toLocaleDateString('en-US', {
                weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
                timeZone: userTimezone,
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
        userTimezone,
        filters: { from: fromDate, to: toDate, search, mediaType },
        stats: {
            totalPlays: stats?.total_plays || 0,
            uniqueItems: stats?.unique_items || 0,
            activeDays: stats?.active_days || 0,
            friendlyTime,
            totalDaysSince,
            activePct,
            firstCheckInLabel,
            todayCount,
            longestStreak
        }
    };
}
