import { json } from '@sveltejs/kit';
import db from '$lib/server/db.js';
import {
    getUserGenreProfile, getTrendingMovies, getTrendingShows,
    getActorDeepDive, getRecentlyAdded, getWatchlistItems,
    getUpcomingDays, getLibraryStats, getLibrarySizes, getGreeting, getSmartRecommendations
} from '$lib/server/discovery-engine.js';
import { getPrecomputed, setPrecomputed, isPrecomputedFresh } from '$lib/server/section-cache.js';

// External (TMDB/*arr) sections are daily-seeded, so a few hours of staleness is fine.
// Stale entries are still served instantly and rebuilt in the background.
const EXTERNAL_CACHE_MS = 6 * 60 * 60 * 1000;

/**
 * Fast, local-only sections (synchronous SQLite — no network).
 * These paint the dashboard immediately.
 * @param {number} userId
 * @param {number} [tzOffsetMin] — user's UTC offset, for day-bucketing the activity heatmap
 */
function buildLocalSections(userId, tzOffsetMin = 0) {
    const stats = getLibraryStats();
    const greeting = getGreeting();
    const watchlist = getWatchlistItems(userId, 20);
    const actorDeepDive = getActorDeepDive(userId);

    // New Albums / Recently Played Albums
    let newAlbums = [];
    let recentlyPlayedAlbums = [];
    try {
        recentlyPlayedAlbums = /** @type {any[]} */ (db.prepare(`
            SELECT mc.id, mc.title, mc.poster_url,
                   (SELECT COUNT(*) FROM (
                       SELECT DISTINCT CAST(strftime('%s', ph2.timestamp) / 300 AS INTEGER) as tb
                       FROM playback_history ph2
                       WHERE ph2.media_id = mc.id AND ph2.user_id = ?
                   )) as track_plays,
                   mp.id as artist_id, mp.title as artist_name, mp.poster_url as artist_poster, mp.slug as artist_slug,
                   MAX(ph.timestamp) as last_played
            FROM playback_history ph
            JOIN media_children mc ON ph.media_id = mc.id
            JOIN media_parents mp ON mc.parent_id = mp.id
            WHERE mp.media_type = 'artist'
              AND ph.user_id = ?
              AND (mc.poster_url IS NOT NULL OR mp.poster_url IS NOT NULL)
            GROUP BY mc.id
            ORDER BY last_played DESC
            LIMIT 20
        `).all(userId, userId)).map(a => ({
            href: `/music/${a.artist_slug || a.artist_id}`,
            title: a.title,
            subtitle: a.artist_name,
            poster_url: a.poster_url || a.artist_poster,
            badge: `${a.track_plays} plays`,
            icon: '🎵',
            _id: a.id,
        }));

        const playedIds = new Set(recentlyPlayedAlbums.map(a => a._id));

        newAlbums = /** @type {any[]} */ (db.prepare(`
            SELECT mc.id, mc.title, mc.poster_url, mc.premiere_date,
                   mp.id as artist_id, mp.title as artist_name, mp.poster_url as artist_poster, mp.slug as artist_slug
            FROM media_children mc
            JOIN media_parents mp ON mc.parent_id = mp.id
            WHERE mp.media_type = 'artist'
              AND mp.collection_status = 'collected'
              AND (mc.poster_url IS NOT NULL OR mp.poster_url IS NOT NULL)
              AND mc.premiere_date IS NOT NULL
            ORDER BY mc.premiere_date DESC
            LIMIT 30
        `).all())
            .filter(a => !playedIds.has(a.id))
            .slice(0, 20)
            .map(a => ({
                href: `/music/${a.artist_slug || a.artist_id}`,
                title: a.title,
                subtitle: a.artist_name,
                poster_url: a.poster_url || a.artist_poster,
                badge: a.premiere_date ? new Date(a.premiere_date).getFullYear().toString() : '',
                icon: '🎵',
            }));

        recentlyPlayedAlbums = recentlyPlayedAlbums.map(({ _id, ...rest }) => rest);
    } catch { /* music tables might not exist */ }

    // Recently Watched Movies
    let recentlyWatchedMovies = [];
    try {
        recentlyWatchedMovies = /** @type {any[]} */ (db.prepare(`
            SELECT mc.id, mc.title, mp.poster_url, mp.slug,
                   MAX(ph.timestamp) as last_watched
            FROM playback_history ph
            JOIN media_children mc ON ph.media_id = mc.id
            JOIN media_parents mp ON mc.parent_id = mp.id
            WHERE mp.media_type = 'movie'
              AND ph.user_id = ?
              AND ph.completion_pct >= 75
            GROUP BY mc.id
            ORDER BY last_watched DESC
            LIMIT 20
        `).all(userId)).map(m => ({
            href: `/movies/${m.slug || m.id}`,
            title: m.title,
            poster_url: m.poster_url,
        }));
    } catch { /* */ }

    // Recently Watched TV
    let recentlyWatchedTV = [];
    try {
        recentlyWatchedTV = /** @type {any[]} */ (db.prepare(`
            SELECT mp.id, mp.title, mp.poster_url, mp.slug,
                   MAX(ph.timestamp) as last_watched,
                   mc.title as episode_title
            FROM playback_history ph
            JOIN media_children mc ON ph.media_id = mc.id
            JOIN media_parents mp ON mc.parent_id = mp.id
            WHERE mp.media_type = 'show'
              AND ph.user_id = ?
              AND ph.completion_pct >= 75
            GROUP BY mp.id
            ORDER BY last_watched DESC
            LIMIT 20
        `).all(userId)).map(s => ({
            href: `/tv/${s.slug || s.id}`,
            title: s.title,
            subtitle: s.episode_title,
            poster_url: s.poster_url,
        }));
    } catch { /* */ }

    // ── Activity heatmap: daily watch/listen time, last ~53 weeks ──────────
    // Per-play time is tiered: real consumed duration when recorded, otherwise
    // a track estimate for music scrobbles (album runtime would overcount a
    // single Last.fm scrobble), otherwise the file runtime × completion, with
    // per-type constants as the last resort.
    // The inner GROUP BY dedupes multi-source logging: the same movie/episode
    // recorded by Trakt AND Jellyfin on the same day counts once (MAX duration).
    // Music stays per-scrobble — replaying a track the same day is real listening.
    let activity = [];
    try {
        activity = /** @type {any[]} */ (db.prepare(`
            SELECT day, type, COUNT(*) AS plays, CAST(SUM(sec) AS INTEGER) AS seconds
            FROM (
                SELECT date(ph.timestamp, ?) AS day,
                       mp.media_type AS type,
                       MAX(CASE
                           WHEN ph.duration_consumed_seconds IS NOT NULL THEN ph.duration_consumed_seconds
                           WHEN mp.media_type = 'artist' THEN 210
                           WHEN NULLIF(mc.runtime_ticks, 0) IS NOT NULL
                               THEN (mc.runtime_ticks / 10000000.0) * (COALESCE(NULLIF(ph.completion_pct, 0), 100) / 100.0)
                           WHEN mp.media_type = 'movie' THEN 6600
                           ELSE 1500
                       END) AS sec
                FROM playback_history ph
                JOIN media_children mc ON mc.id = ph.media_id
                JOIN media_parents mp ON mp.id = mc.parent_id
                WHERE ph.user_id = ?
                  AND ph.timestamp IS NOT NULL AND ph.timestamp != ''
                  AND ph.timestamp >= date('now', '-371 days')
                GROUP BY day, mp.media_type, ph.media_id,
                         CASE WHEN mp.media_type = 'artist' THEN ph.id ELSE 0 END
            )
            GROUP BY day, type ORDER BY day
        `).all(`${tzOffsetMin} minutes`, userId));
    } catch { /* heatmap simply stays hidden */ }

    return {
        greeting, stats, watchlist, actorDeepDive,
        newAlbums, recentlyPlayedAlbums, recentlyWatchedMovies, recentlyWatchedTV,
        activity,
    };
}

/**
 * Slow, network-bound sections (TMDB trending/recommendations + *arr sizes/imports).
 * `upcoming` is NOT included here — it depends on calendar params and is fetched live.
 * `stats` holds only the *arr disk-size fields, to be merged into local stats client-side.
 */
async function buildExternalSections(userId) {
    const genreProfile = getUserGenreProfile(userId);
    const [trendingMovies, trendingShows, recommended, libSizes, recentlyAdded] = await Promise.all([
        getTrendingMovies(genreProfile, 20),
        getTrendingShows(genreProfile, 20),
        getSmartRecommendations(userId, 20),
        getLibrarySizes(),
        getRecentlyAdded(20),
    ]);
    return { trendingMovies, trendingShows, recommended, recentlyAdded, stats: libSizes };
}

/**
 * Serve external sections from the precomputed cache, stale-while-revalidate.
 * On a cache miss the sections are built inline; if the cached copy is stale it is
 * still returned immediately and refreshed in the background for the next load.
 */
async function getExternalSections(userId) {
    const cacheKey = `dashboard-ext-${userId}`;
    const cached = getPrecomputed(cacheKey);
    if (cached) {
        if (!isPrecomputedFresh(cacheKey, EXTERNAL_CACHE_MS)) {
            buildExternalSections(userId)
                .then(fresh => { try { setPrecomputed(cacheKey, fresh); } catch { /* non-fatal */ } })
                .catch(() => { /* background refresh failed — keep serving stale */ });
        }
        return cached.data;
    }
    const fresh = await buildExternalSections(userId);
    try { setPrecomputed(cacheKey, fresh); } catch { /* non-fatal */ }
    return fresh;
}

export async function GET({ url, locals }) {
    const userId = locals.user.id;
    const calendarDays = parseInt(url.searchParams.get('calendarDays') || '7');

    const userRow = /** @type {any} */ (db.prepare('SELECT preferences FROM users WHERE id = ?').get(userId));
    let timezone = 'UTC';
    try {
        const prefs = userRow?.preferences ? JSON.parse(userRow.preferences) : {};
        if (prefs.timezone) timezone = prefs.timezone;
    } catch { /* empty */ }

    // Current UTC offset of the user's timezone (approximation across DST is fine
    // for day-bucketing the activity heatmap)
    let tzOffsetMin = 0;
    try {
        const now = new Date();
        const tzDate = new Date(now.toLocaleString('en-US', { timeZone: timezone }));
        const utcDate = new Date(now.toLocaleString('en-US', { timeZone: 'UTC' }));
        tzOffsetMin = Math.round((tzDate.getTime() - utcDate.getTime()) / 60000);
    } catch { /* stay UTC */ }

    // Build default calendar types from DB settings
    const calSettings = /** @type {any} */ (db.prepare(
        'SELECT calendar_show_movies, calendar_show_shows, calendar_show_music FROM app_settings WHERE id = 1'
    ).get());
    const defaultTypes = [];
    if (calSettings?.calendar_show_movies !== 0) defaultTypes.push('movie');
    if (calSettings?.calendar_show_shows !== 0) defaultTypes.push('show');
    if (calSettings?.calendar_show_music !== 0) defaultTypes.push('artist');

    const calendarTypes = url.searchParams.has('calendarTypes')
        ? url.searchParams.get('calendarTypes').split(',').filter(Boolean)
        : defaultTypes;
    const trendingMoviePage = parseInt(url.searchParams.get('trendingMoviePage') || '1');
    const trendingShowPage = parseInt(url.searchParams.get('trendingShowPage') || '1');
    const section = url.searchParams.get('section'); // for lazy loading individual sections

    // If requesting a specific section (for "show more" / pagination)
    if (section === 'trendingMovies') {
        const genreProfile = getUserGenreProfile(userId);
        const data = await getTrendingMovies(genreProfile, 20, trendingMoviePage);
        return json(data);
    }
    if (section === 'trendingShows') {
        const genreProfile = getUserGenreProfile(userId);
        const data = await getTrendingShows(genreProfile, 20, trendingShowPage);
        return json(data);
    }
    if (section === 'upcoming') {
        // Calendar-only refresh (settings change) — skips the external sections
        const upcoming = await getUpcomingDays(calendarDays, calendarTypes, timezone);
        return json({ upcoming });
    }

    // ── Scoped loads ──────────────────────────────────────────────────────────
    // scope=local    → fast SQLite sections only (paints the page immediately)
    // scope=external → cached TMDB/*arr sections + live `upcoming` calendar
    // (no scope)     → full payload (both), kept for compatibility / external callers
    const scope = url.searchParams.get('scope');

    if (scope === 'local') {
        return json(buildLocalSections(userId, tzOffsetMin));
    }

    if (scope === 'external') {
        const [external, upcoming] = await Promise.all([
            getExternalSections(userId),
            getUpcomingDays(calendarDays, calendarTypes, timezone),
        ]);
        return json({ ...external, upcoming });
    }

    // Full load (compatibility path)
    const local = buildLocalSections(userId, tzOffsetMin);
    const [external, upcoming] = await Promise.all([
        getExternalSections(userId),
        getUpcomingDays(calendarDays, calendarTypes, timezone),
    ]);

    return json({
        ...local,
        ...external,
        upcoming,
        // merge *arr disk sizes into the local library counts
        stats: { ...local.stats, ...external.stats },
    });
}
