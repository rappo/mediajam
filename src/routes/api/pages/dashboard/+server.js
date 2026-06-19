import { json } from '@sveltejs/kit';
import db from '$lib/server/db.js';
import {
    getUserGenreProfile, getTrendingMovies, getTrendingShows,
    getActorDeepDive, getRecentlyAdded, getWatchlistItems,
    getUpcomingDays, getLibraryStats, getLibrarySizes, getGreeting, getSmartRecommendations
} from '$lib/server/discovery-engine.js';

export async function GET({ url, locals }) {
    const userId = locals.user.id;
    const calendarDays = parseInt(url.searchParams.get('calendarDays') || '7');

    const userRow = /** @type {any} */ (db.prepare('SELECT preferences FROM users WHERE id = ?').get(userId));
    let timezone = 'UTC';
    try {
        const prefs = userRow?.preferences ? JSON.parse(userRow.preferences) : {};
        if (prefs.timezone) timezone = prefs.timezone;
    } catch { /* empty */ }

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

    // Full dashboard load
    const t0 = performance.now();
    const genreProfile = getUserGenreProfile(userId);

    // Parallel: external API calls (trending, recommendations, arr calendar)
    const tParallel = performance.now();

    const timedAsync = async (label, fn) => {
        const s = performance.now();
        const result = await fn();
        console.log(`[dashboard] ${label}: ${(performance.now() - s).toFixed(0)}ms`);
        return result;
    };

    const [trendingMovies, trendingShows, recommended, upcoming, libSizes] = await Promise.all([
        timedAsync('getTrendingMovies', () => getTrendingMovies(genreProfile, 20)),
        timedAsync('getTrendingShows', () => getTrendingShows(genreProfile, 20)),
        timedAsync('getSmartRecommendations', () => getSmartRecommendations(userId, 20)),
        timedAsync('getUpcomingDays', () => getUpcomingDays(calendarDays, calendarTypes, timezone)),
        timedAsync('getLibrarySizes', () => getLibrarySizes()),
    ]);
    console.log(`[dashboard] parallel block: ${(performance.now() - tParallel).toFixed(0)}ms`);

    // Local queries (synchronous SQLite)
    const tLocal = performance.now();
    const stats = { ...getLibraryStats(), ...libSizes };
    const greeting = getGreeting();
    const watchlist = getWatchlistItems(userId, 20);
    const actorDeepDive = getActorDeepDive(userId);
    const recentlyAdded = await getRecentlyAdded(20);
    console.log(`[dashboard] local SQLite queries: ${(performance.now() - tLocal).toFixed(0)}ms`);

    // New Albums — recently released albums in the library
    let newAlbums = [];
    let recentlyPlayedAlbums = [];
    try {
        // Recently played albums (by playback history)
        // Count track plays per album from playback_history (deduplicated by 5-min buckets)
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

        // Build set of recently played IDs for de-dup
        const playedIds = new Set(recentlyPlayedAlbums.map(a => a._id));

        // New albums — recently released, excluding ones already in recently played
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

        // Clean up internal _id from recently played
        recentlyPlayedAlbums = recentlyPlayedAlbums.map(({ _id, ...rest }) => rest);
    } catch { /* music tables might not exist */ }

    // Recently Watched Movies — last 20 movies with playback history
    let recentlyWatchedMovies = [];
    try {
        recentlyWatchedMovies = /** @type {any[]} */ (db.prepare(`
            SELECT mc.id, mc.title, mc.poster_url, mc.slug,
                   mp.title as parent_title, mp.slug as parent_slug,
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
            href: `/movies/${m.slug || m.parent_slug || m.id}`,
            title: m.title,
            poster_url: m.poster_url,
        }));
    } catch { /* */ }

    // Recently Watched TV — last 20 distinct shows with playback history
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

    console.log(`[dashboard] TOTAL: ${(performance.now() - t0).toFixed(0)}ms`);

    return json({
        greeting,
        stats,
        watchlist,
        upcoming,
        trendingMovies,
        trendingShows,
        recommended,
        actorDeepDive,
        newAlbums,
        recentlyPlayedAlbums,
        recentlyWatchedMovies,
        recentlyWatchedTV,
        recentlyAdded,
    });
}
