import { json } from '@sveltejs/kit';
import { tmdbFetch, getTmdbKey } from '$lib/server/tmdb.js';

const TMDB_IMG = 'https://image.tmdb.org/t/p/w92';
const MB_BASE = 'https://musicbrainz.org/ws/2';
const MB_UA = 'Mediajam/1.0 (https://github.com/rappo/mediajam)';

/**
 * GET /api/search/external?q=...&type=all|movie|tv|music
 * Searches TMDb (movies/TV) and MusicBrainz (artists) externally.
 */
export async function GET({ url, locals }) {
    if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

    const q = url.searchParams.get('q')?.trim();
    const type = url.searchParams.get('type') || 'all'; // all, movie, tv, music
    if (!q || q.length < 2) return json({ error: 'Query too short' }, { status: 400 });

    /** @type {any[]} */
    const movies = [];
    /** @type {any[]} */
    const shows = [];
    /** @type {any[]} */
    const artists = [];

    const promises = [];

    // TMDb multi-search (movies + TV)
    if ((type === 'all' || type === 'movie' || type === 'tv') && getTmdbKey()) {
        promises.push(
            tmdbFetch('/search/multi', { query: q, page: '1' })
                .then(async (res) => {
                    if (!res.ok) return;
                    const data = await res.json();
                    for (const item of (data.results || [])) {
                        if (item.media_type === 'movie' && (type === 'all' || type === 'movie')) {
                            movies.push({
                                type: 'movie',
                                tmdb_id: String(item.id),
                                title: item.title || item.original_title,
                                release_year: (item.release_date || '').split('-')[0] || null,
                                poster_url: item.poster_path ? `${TMDB_IMG}${item.poster_path}` : null,
                                overview: (item.overview || '').slice(0, 120),
                            });
                        } else if (item.media_type === 'tv' && (type === 'all' || type === 'tv')) {
                            shows.push({
                                type: 'show',
                                tmdb_id: String(item.id),
                                title: item.name || item.original_name,
                                release_year: (item.first_air_date || '').split('-')[0] || null,
                                poster_url: item.poster_path ? `${TMDB_IMG}${item.poster_path}` : null,
                                overview: (item.overview || '').slice(0, 120),
                            });
                        }
                    }
                })
                .catch(e => console.error('[search/external] TMDb error:', e))
        );
    }

    // MusicBrainz artist search
    if (type === 'all' || type === 'music') {
        promises.push(
            fetch(`${MB_BASE}/artist/?query=${encodeURIComponent(q)}&fmt=json&limit=8`, {
                headers: { 'User-Agent': MB_UA, 'Accept': 'application/json' }
            })
                .then(async (res) => {
                    if (!res.ok) return;
                    const data = await res.json();
                    for (const artist of (data.artists || [])) {
                        artists.push({
                            type: 'artist',
                            musicbrainz_id: artist.id,
                            title: artist.name,
                            disambiguation: artist.disambiguation || null,
                            country: artist.country || null,
                            poster_url: null, // MusicBrainz doesn't provide images directly
                        });
                    }
                })
                .catch(e => console.error('[search/external] MusicBrainz error:', e))
        );
    }

    await Promise.all(promises);

    return json({
        movies: movies.slice(0, 10),
        shows: shows.slice(0, 10),
        artists: artists.slice(0, 8),
        totalCount: movies.length + shows.length + artists.length,
    });
}
