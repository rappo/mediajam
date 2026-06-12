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
    const calendarTypes = (url.searchParams.get('calendarTypes') || 'movie,show,artist').split(',');
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
        timedAsync('getUpcomingDays', () => getUpcomingDays(calendarDays, calendarTypes)),
        timedAsync('getLibrarySizes', () => getLibrarySizes()),
    ]);
    console.log(`[dashboard] parallel block: ${(performance.now() - tParallel).toFixed(0)}ms`);

    // Local queries (synchronous SQLite)
    const tLocal = performance.now();
    const stats = { ...getLibraryStats(), ...libSizes };
    const greeting = getGreeting();
    const watchlist = getWatchlistItems(userId, 10);
    const actorDeepDive = getActorDeepDive(userId);
    const recentlyAdded = getRecentlyAdded(20);
    console.log(`[dashboard] local SQLite queries: ${(performance.now() - tLocal).toFixed(0)}ms`);

    // Hot albums — most-played albums in the library
    let hotAlbums = [];
    try {
        hotAlbums = /** @type {any[]} */ (db.prepare(`
            SELECT mc.id, mc.title, mc.poster_url, mc.play_count,
                   mp.id as artist_id, mp.title as artist_name, mp.poster_url as artist_poster, mp.slug as artist_slug
            FROM media_children mc
            JOIN media_parents mp ON mc.parent_id = mp.id
            WHERE mp.media_type = 'artist'
              AND mc.play_count > 0
              AND (mc.poster_url IS NOT NULL OR mp.poster_url IS NOT NULL)
            ORDER BY mc.play_count DESC
            LIMIT 20
        `).all()).map(a => ({
            href: `/music/${a.artist_slug || a.artist_id}`,
            title: a.title,
            subtitle: a.artist_name,
            poster_url: a.poster_url || a.artist_poster,
            badge: `${a.play_count} plays`,
            icon: '🎵',
        }));
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
        hotAlbums,
        recentlyAdded,
    });
}
