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

    const [trendingMovies, trendingShows, recommended, upcoming, libSizes, incomingData] = await Promise.all([
        timedAsync('getTrendingMovies', () => getTrendingMovies(genreProfile, 20)),
        timedAsync('getTrendingShows', () => getTrendingShows(genreProfile, 20)),
        timedAsync('getSmartRecommendations', () => getSmartRecommendations(userId, 20)),
        timedAsync('getUpcomingDays', () => getUpcomingDays(calendarDays, calendarTypes)),
        timedAsync('getLibrarySizes', () => getLibrarySizes()),
        timedAsync('getIncoming', () => fetchIncomingForDashboard()),
    ]);
    console.log(`[dashboard] parallel block: ${(performance.now() - tParallel).toFixed(0)}ms`);

    // Local queries (synchronous SQLite)
    const tLocal = performance.now();
    const stats = { ...getLibraryStats(), ...libSizes };
    const greeting = getGreeting();
    const watchlist = getWatchlistItems(userId, 20);
    const actorDeepDive = getActorDeepDive(userId);
    const recentlyAdded = getRecentlyAdded(20);
    console.log(`[dashboard] local SQLite queries: ${(performance.now() - tLocal).toFixed(0)}ms`);

    // New Albums — recently released albums in the library
    let newAlbums = [];
    let recentlyPlayedAlbums = [];
    try {
        // Recently played albums (by playback history)
        recentlyPlayedAlbums = /** @type {any[]} */ (db.prepare(`
            SELECT mc.id, mc.title, mc.poster_url, mc.play_count,
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
        `).all(userId)).map(a => ({
            href: `/music/${a.artist_slug || a.artist_id}`,
            title: a.title,
            subtitle: a.artist_name,
            poster_url: a.poster_url || a.artist_poster,
            badge: `${a.play_count} plays`,
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
        recentlyAdded,
        incoming: incomingData?.items || [],
        incomingSummary: incomingData?.summary || null,
        arrHealth: incomingData?.health || null,
    });
}

/**
 * Fetch incoming/wanted data for the dashboard.
 * Calls the internal wanted API and builds arr health from the summary.
 */
async function fetchIncomingForDashboard() {
    try {
        const settings = /** @type {any} */ (db.prepare(
            `SELECT sonarr_url, sonarr_api_key, radarr_url, radarr_api_key, lidarr_url, lidarr_api_key FROM app_settings WHERE id = 1`
        ).get());

        // Check if any arr service is configured
        const hasArr = (settings?.sonarr_api_key && settings?.sonarr_url) ||
                       (settings?.radarr_api_key && settings?.radarr_url) ||
                       (settings?.lidarr_api_key && settings?.lidarr_url);
        if (!hasArr) return null;

        // Fetch wanted data via internal HTTP call (reuses caching)
        const baseUrl = `http://localhost:${process.env.PORT || 3000}`;
        const apiKey = db.prepare('SELECT api_key FROM users WHERE is_admin = 1 LIMIT 1').get()?.api_key;
        if (!apiKey) return null;

        const res = await fetch(`${baseUrl}/api/arr/wanted`, {
            headers: { 'Authorization': `Bearer ${apiKey}` },
            signal: AbortSignal.timeout(20000),
        });
        if (!res.ok) return null;
        const data = await res.json();

        // Build arr health from summary
        const health = {
            services: [],
            totalWanted: data.summary?.totalItems || 0,
        };

        // Per-service health
        const serviceConfigs = [
            { key: 'sonarr', name: 'Sonarr', color: '0.65 0.17 250', hasConfig: !!settings?.sonarr_api_key },
            { key: 'radarr', name: 'Radarr', color: '0.72 0.18 40', hasConfig: !!settings?.radarr_api_key },
            { key: 'lidarr', name: 'Lidarr', color: '0.70 0.17 145', hasConfig: !!settings?.lidarr_api_key },
        ];

        for (const svc of serviceConfigs) {
            if (!svc.hasConfig) continue;
            const wantedCount = data.summary?.byService?.[svc.key] || 0;
            const failedCount = (data.items || []).filter(i => i.service === svc.key && i.reason === 'failed').length;
            const queueCount = (data.items || []).filter(i => i.service === svc.key && i.reason === 'in_queue').length;

            health.services.push({
                key: svc.key,
                name: svc.name,
                color: svc.color,
                wanted: wantedCount,
                failed: failedCount,
                queue: queueCount,
                status: failedCount > 0 ? 'warning' : 'ok',
            });
        }

        return { items: data.items || [], summary: data.summary, health };
    } catch (e) {
        console.error('[dashboard] incoming fetch failed:', e.message);
        return null;
    }
}
