import { json } from '@sveltejs/kit';
import db from '$lib/server/db.js';
import { tmdbFetch, getTmdbKey } from '$lib/server/tmdb.js';

const TMDB_IMG = 'https://image.tmdb.org/t/p/w92';
const MB_BASE = 'https://musicbrainz.org/ws/2';
const MB_UA = 'Mediajam/1.0 (https://github.com/mediajam/mediajam)';

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

    // ── Cross-reference results against the local library ────────────────────
    // Adds media_parent_id / in_library / library_status / arr_monitored to each
    // result so an agent can route a pick straight to add-to-arr (when already a
    // DB row) or to prepare-media first (when new). Additive — existing callers
    // (SearchBar) ignore the extra fields.
    annotateLibraryStatus([...movies, ...shows], 'tmdb_id', ['movie', 'show']);
    annotateLibraryStatus(artists, 'musicbrainz_id', ['artist']);

    return json({
        movies: movies.slice(0, 10),
        shows: shows.slice(0, 10),
        artists: artists.slice(0, 8),
        totalCount: movies.length + shows.length + artists.length,
    });
}

/**
 * Mutates each result, attaching library status by matching an external id
 * against media_parents. One batched query covers the whole set.
 * @param {any[]} items - result objects to annotate
 * @param {'tmdb_id'|'musicbrainz_id'} idField - which external id to match on
 * @param {string[]} mediaTypes - media_parents.media_type values to consider
 */
function annotateLibraryStatus(items, idField, mediaTypes) {
    // Default the new fields so shape is consistent even with no matches.
    for (const it of items) {
        it.media_parent_id = null;
        it.in_library = false;
        it.library_status = null;
        it.arr_monitored = false;
    }

    const ids = [...new Set(items.map(it => it[idField]).filter(Boolean).map(String))];
    if (ids.length === 0) return;

    const idPlaceholders = ids.map(() => '?').join(',');
    const typePlaceholders = mediaTypes.map(() => '?').join(',');
    const column = idField; // 'tmdb_id' or 'musicbrainz_id' — both indexed on media_parents
    const rows = /** @type {any[]} */ (db.prepare(`
        SELECT id, ${column} AS ext_id, media_type, collection_status, jellyfin_id,
               arr_monitored, radarr_id, sonarr_id, lidarr_id
        FROM media_parents
        WHERE ${column} IN (${idPlaceholders}) AND media_type IN (${typePlaceholders})
    `).all(...ids, ...mediaTypes));

    // Key by external id; a tmdb_id is unique per media_type, and the item's own
    // type disambiguates movie vs show when both share this helper call.
    const byId = new Map();
    for (const r of rows) byId.set(`${r.media_type}:${String(r.ext_id)}`, r);

    for (const it of items) {
        const extId = it[idField];
        if (!extId) continue;
        const localType = it.type === 'artist' ? 'artist' : it.type; // 'movie' | 'show' | 'artist'
        const row = byId.get(`${localType}:${String(extId)}`);
        if (!row) continue;
        it.media_parent_id = row.id;
        it.in_library = !!row.jellyfin_id || row.collection_status === 'collected';
        it.library_status = row.collection_status || null;
        it.arr_monitored = !!row.arr_monitored || !!(row.radarr_id || row.sonarr_id || row.lidarr_id);
    }
}
