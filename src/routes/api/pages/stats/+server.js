import db from '$lib/server/db.js';
import { json } from '@sveltejs/kit';

/**
 * GET /api/pages/stats — Aggregate stats for the Stats dashboard.
 */
export function GET({ locals }) {
    const userId = locals.user?.id;
    if (!userId) return json({ error: 'Not authenticated' }, { status: 401 });

    const settings = /** @type {any} */ (db.prepare('SELECT jellyfin_url FROM app_settings WHERE id = 1').get());
    const jellyfinUrl = settings?.jellyfin_url || '';

    // ── Library overview ──
    const libCounts = /** @type {any} */ (db.prepare(`
        SELECT
            COUNT(*) as total,
            SUM(CASE WHEN media_type = 'movie' THEN 1 ELSE 0 END) as movies,
            SUM(CASE WHEN media_type = 'show' THEN 1 ELSE 0 END) as shows,
            SUM(CASE WHEN media_type = 'artist' THEN 1 ELSE 0 END) as artists
        FROM media_parents
    `).get());

    const childCounts = /** @type {any} */ (db.prepare(`
        SELECT
            SUM(CASE WHEN mp.media_type = 'show' THEN 1 ELSE 0 END) as episodes,
            SUM(CASE WHEN mp.media_type = 'artist' THEN 1 ELSE 0 END) as albums,
            SUM(CASE WHEN mc.watch_status = 'watched' AND mp.media_type = 'show' THEN 1 ELSE 0 END) as watchedEpisodes,
            SUM(CASE WHEN mc.watch_status = 'watched' AND mp.media_type = 'movie' THEN 1 ELSE 0 END) as watchedMovies,
            SUM(mc.runtime_ticks) as totalRuntimeTicks
        FROM media_children mc
        JOIN media_parents mp ON mc.parent_id = mp.id
    `).get());

    const runtimeHours = Math.round((childCounts?.totalRuntimeTicks || 0) / 10000000 / 3600);
    const personCount = /** @type {any} */ (db.prepare('SELECT COUNT(*) as c FROM persons').get())?.c || 0;

    // ── Playback stats ──
    const playbackStats = /** @type {any} */ (db.prepare(`
        SELECT
            COUNT(*) as totalPlays,
            COUNT(DISTINCT media_id) as uniqueItems,
            COUNT(DISTINCT DATE(timestamp)) as activeDays,
            SUM(duration_consumed_seconds) as totalSeconds,
            MIN(CASE WHEN timestamp > '1900-01-02' THEN timestamp END) as firstPlay
        FROM (
            SELECT DISTINCT media_id,
                   CAST(strftime('%s', timestamp) / 43200 AS INTEGER) as time_bucket,
                   MAX(timestamp) as timestamp,
                   MAX(duration_consumed_seconds) as duration_consumed_seconds
            FROM playback_history
            WHERE user_id = ?
            GROUP BY media_id, time_bucket
        )
    `).get(userId));

    // Estimate total seconds from runtime if duration_consumed_seconds is empty
    let totalSeconds = playbackStats?.totalSeconds || 0;
    if (!totalSeconds) {
        const est = /** @type {any} */ (db.prepare(`
            SELECT SUM(mc.runtime_ticks / 10000000) as s
            FROM playback_history ph
            JOIN media_children mc ON ph.media_id = mc.id
            WHERE ph.user_id = ? AND mc.runtime_ticks > 0
        `).get(userId));
        totalSeconds = est?.s || 0;
    }

    // ── Watch heatmap (last 365 days) ──
    const heatmapRaw = /** @type {any[]} */ (db.prepare(`
        SELECT DATE(timestamp) as day, COUNT(*) as count
        FROM (
            SELECT DISTINCT media_id,
                   CAST(strftime('%s', timestamp) / 43200 AS INTEGER) as time_bucket,
                   MAX(timestamp) as timestamp
            FROM playback_history
            WHERE user_id = ? AND timestamp > date('now', '-365 days')
            GROUP BY media_id, time_bucket
        )
        GROUP BY day
        ORDER BY day
    `).all(userId));

    // ── Hour-of-day distribution ──
    const hourDist = /** @type {any[]} */ (db.prepare(`
        SELECT
            CAST(strftime('%H', timestamp) AS INTEGER) as hour,
            COUNT(*) as count,
            SUM(CASE WHEN mp.media_type = 'show' THEN 1 ELSE 0 END) as tv,
            SUM(CASE WHEN mp.media_type = 'movie' THEN 1 ELSE 0 END) as movie,
            SUM(CASE WHEN mp.media_type = 'artist' THEN 1 ELSE 0 END) as music
        FROM playback_history ph
        JOIN media_children mc ON ph.media_id = mc.id
        JOIN media_parents mp ON mc.parent_id = mp.id
        WHERE ph.user_id = ?
        GROUP BY hour
        ORDER BY hour
    `).all(userId));

    // ── Day-of-week distribution ──
    const dowDist = /** @type {any[]} */ (db.prepare(`
        SELECT
            CAST(strftime('%w', timestamp) AS INTEGER) as dow,
            COUNT(*) as count
        FROM playback_history ph
        WHERE ph.user_id = ?
        GROUP BY dow
        ORDER BY dow
    `).all(userId));

    // ── Decade distribution ──
    const decadeDist = /** @type {any[]} */ (db.prepare(`
        SELECT
            (CAST(release_year AS INTEGER) / 10) * 10 as decade,
            COUNT(*) as count
        FROM media_parents
        WHERE release_year IS NOT NULL AND release_year > 1900
        GROUP BY decade
        ORDER BY decade
    `).all());

    // ── Top people (most-watched directors & actors) ──
    const topPeople = /** @type {any[]} */ (db.prepare(`
        SELECT
            p.id, p.name, p.photo_url, p.slug,
            pc.role_type,
            COUNT(DISTINCT ph.id) as play_count
        FROM persons p
        JOIN person_credits pc ON p.id = pc.person_id
        JOIN media_parents mp ON pc.media_parent_id = mp.id
        JOIN media_children mc ON mc.parent_id = mp.id
        JOIN playback_history ph ON ph.media_id = mc.id AND ph.user_id = ?
        WHERE pc.role_type IN ('actor', 'director')
        GROUP BY p.id, pc.role_type
        ORDER BY play_count DESC
        LIMIT 20
    `).all(userId));

    // ── Personal records ──
    // Longest movie watched
    const longestMovie = /** @type {any} */ (db.prepare(`
        SELECT mp.title, mp.poster_url, mc.runtime_ticks, mp.slug
        FROM playback_history ph
        JOIN media_children mc ON ph.media_id = mc.id
        JOIN media_parents mp ON mc.parent_id = mp.id
        WHERE ph.user_id = ? AND mp.media_type = 'movie' AND mc.runtime_ticks > 0
        ORDER BY mc.runtime_ticks DESC
        LIMIT 1
    `).get(userId));

    // Most rewatched
    const mostRewatched = /** @type {any} */ (db.prepare(`
        SELECT mp.title, mp.poster_url, mp.media_type, mp.slug,
               COUNT(*) as plays
        FROM (
            SELECT DISTINCT media_id,
                   CAST(strftime('%s', timestamp) / 43200 AS INTEGER) as time_bucket,
                   MAX(timestamp) as timestamp
            FROM playback_history
            WHERE user_id = ?
            GROUP BY media_id, time_bucket
        ) deduped
        JOIN media_children mc ON deduped.media_id = mc.id
        JOIN media_parents mp ON mc.parent_id = mp.id
        GROUP BY mp.id
        ORDER BY plays DESC
        LIMIT 1
    `).get(userId));

    // Fastest binge (show completed in fewest days span)
    const fastestBinge = /** @type {any} */ (db.prepare(`
        SELECT mp.title, mp.poster_url, mp.slug,
               CAST(julianday(MAX(ph.timestamp)) - julianday(MIN(ph.timestamp)) AS INTEGER) as days_span,
               COUNT(DISTINCT mc.id) as eps_watched
        FROM playback_history ph
        JOIN media_children mc ON ph.media_id = mc.id
        JOIN media_parents mp ON mc.parent_id = mp.id
        WHERE ph.user_id = ?
          AND mp.media_type = 'show'
        GROUP BY mp.id
        HAVING eps_watched >= 5
        ORDER BY days_span ASC, eps_watched DESC
        LIMIT 1
    `).get(userId));

    // Longest streak
    let longestStreak = 0;
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

    // ── Rewatch index (top rewatched items) ──
    const rewatchIndex = /** @type {any[]} */ (db.prepare(`
        SELECT mp.title, mp.poster_url, mp.media_type, mp.slug,
               COUNT(*) as plays
        FROM (
            SELECT DISTINCT media_id,
                   CAST(strftime('%s', timestamp) / 43200 AS INTEGER) as time_bucket,
                   MAX(timestamp) as timestamp
            FROM playback_history
            WHERE user_id = ?
            GROUP BY media_id, time_bucket
        ) deduped
        JOIN media_children mc ON deduped.media_id = mc.id
        JOIN media_parents mp ON mc.parent_id = mp.id
        GROUP BY mp.id
        HAVING plays > 1
        ORDER BY plays DESC
        LIMIT 15
    `).all(userId));

    // ── Format friendly time ──
    let friendlyTime = '0';
    if (totalSeconds > 0) {
        const days = Math.floor(totalSeconds / 86400);
        const hours = Math.floor((totalSeconds % 86400) / 3600);
        const mins = Math.floor((totalSeconds % 3600) / 60);
        const parts = [];
        const years = Math.floor(days / 365);
        const mo = Math.floor((days % 365) / 30);
        const remainDays = days % 30;
        if (years > 0) parts.push(`${years} yr${years > 1 ? 's' : ''}`);
        if (mo > 0) parts.push(`${mo} mo`);
        if (remainDays > 0 && years === 0) parts.push(`${remainDays} day${remainDays > 1 ? 's' : ''}`);
        if (hours > 0 && years === 0 && mo === 0) parts.push(`${hours} hr${hours > 1 ? 's' : ''}`);
        if (mins > 0 && days === 0 && hours < 10) parts.push(`${mins} min`);
        friendlyTime = parts.slice(0, 2).join(' ') || '< 1 min';
    }

    // Fix poster URLs
    function fixPoster(/** @type {any} */ item) {
        if (!item) return item;
        if (item.poster_url && !item.poster_url.startsWith('http') && jellyfinUrl) {
            item.poster_url = jellyfinUrl + item.poster_url;
        }
        return item;
    }

    return json({
        library: {
            total: libCounts?.total || 0,
            movies: libCounts?.movies || 0,
            shows: libCounts?.shows || 0,
            artists: libCounts?.artists || 0,
            episodes: childCounts?.episodes || 0,
            albums: childCounts?.albums || 0,
            watchedEpisodes: childCounts?.watchedEpisodes || 0,
            watchedMovies: childCounts?.watchedMovies || 0,
            runtimeHours,
            personCount,
        },
        playback: {
            totalPlays: playbackStats?.totalPlays || 0,
            uniqueItems: playbackStats?.uniqueItems || 0,
            activeDays: playbackStats?.activeDays || 0,
            friendlyTime,
            longestStreak,
        },
        heatmap: heatmapRaw,
        hourDistribution: hourDist,
        dowDistribution: dowDist,
        decadeDistribution: decadeDist,
        topPeople: topPeople.map(p => ({
            ...p,
            photo_url: p.photo_url && !p.photo_url.startsWith('http') && jellyfinUrl
                ? jellyfinUrl + p.photo_url : p.photo_url,
        })),
        records: {
            longestMovie: fixPoster(longestMovie),
            mostRewatched: fixPoster(mostRewatched),
            fastestBinge: fixPoster(fastestBinge),
        },
        rewatchIndex: rewatchIndex.map(r => fixPoster(r)),
    });
}
