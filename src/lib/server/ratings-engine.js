/**
 * External Ratings Engine
 * 
 * Fetches and caches external ratings from multiple sources:
 * - Discogs (music albums — community rating)
 * - MusicBrainz (music albums — fallback when no Discogs score)
 * - OMDb (movies/TV — IMDb, Rotten Tomatoes, Metacritic in one call)
 * - TMDB (movies/TV — community score, already have API key)
 * 
 * All scores are normalized to 0–100 scale for consistency.
 * Raw values are preserved in the `raw_value` column.
 */
import db from '$lib/server/db.js';
import { tmdbFetch } from '$lib/server/tmdb.js';

const DISCOGS_API = 'https://api.discogs.com';
const DISCOGS_USER_AGENT = 'MediaJam/1.0';
const OMDB_API = 'https://www.omdbapi.com';
const TMDB_API = 'https://api.themoviedb.org/3';
const MB_API = 'https://musicbrainz.org/ws/2';
const MB_USER_AGENT = 'MediaJam/1.0 (https://github.com/mediajam)';

// Staleness threshold: 6 months in milliseconds
const STALE_MS = 6 * 30 * 24 * 60 * 60 * 1000;

/** @param {number} ms */
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/**
 * Get API keys from settings
 * @returns {{ omdbApiKey: string|null, discogsToken: string|null, tmdbApiKey: string|null }}
 */
function getApiKeys() {
    const settings = /** @type {any} */ (db.prepare('SELECT omdb_api_key, discogs_token, tmdb_api_key FROM app_settings WHERE id = 1').get());
    return {
        omdbApiKey: settings?.omdb_api_key || null,
        discogsToken: settings?.discogs_token || null,
        tmdbApiKey: settings?.tmdb_api_key || null,
    };
}

// ── Prepared statements ────────────────────────────────────────────────────────

const upsertRating = db.prepare(`
    INSERT INTO external_ratings (media_parent_id, media_child_id, source, rating_type, value, vote_count, raw_value, fetched_at)
    VALUES (@mediaParentId, @mediaChildId, @source, @ratingType, @value, @voteCount, @rawValue, datetime('now'))
    ON CONFLICT(media_parent_id, media_child_id, source, rating_type)
    DO UPDATE SET value = @value, vote_count = @voteCount, raw_value = @rawValue, fetched_at = datetime('now')
`);

const getRatings = db.prepare(`
    SELECT * FROM external_ratings WHERE media_parent_id = ? ORDER BY source
`);

const getChildRatings = db.prepare(`
    SELECT * FROM external_ratings WHERE media_child_id = ? ORDER BY source
`);

const hasRatingForSource = db.prepare(`
    SELECT 1 FROM external_ratings WHERE media_parent_id = ? AND source = ? LIMIT 1
`);

// ── Discogs ────────────────────────────────────────────────────────────────────

/**
 * Fetch album rating from Discogs community.
 * @param {string} artistName 
 * @param {string} albumTitle 
 * @param {string} token 
 * @returns {Promise<{rating: number, voteCount: number, rawValue: string} | null>}
 */
async function fetchDiscogsRating(artistName, albumTitle, token) {
    try {
        const headers = {
            'User-Agent': DISCOGS_USER_AGENT,
            'Authorization': `Discogs token=${token}`
        };

        // Search for the master release
        const searchUrl = `${DISCOGS_API}/database/search?type=master&artist=${encodeURIComponent(artistName)}&release_title=${encodeURIComponent(albumTitle)}&per_page=1`;
        const searchRes = await fetch(searchUrl, { headers, signal: AbortSignal.timeout(10000) });
        if (!searchRes.ok) return null;
        const searchData = await searchRes.json();

        if (!searchData.results?.length) return null;
        const masterId = searchData.results[0].id;

        await sleep(1100); // Discogs rate limit

        // Get master release to find main release
        const masterRes = await fetch(`${DISCOGS_API}/masters/${masterId}`, { headers, signal: AbortSignal.timeout(10000) });
        if (!masterRes.ok) return null;
        const masterData = await masterRes.json();

        const mainReleaseId = masterData.main_release;
        if (!mainReleaseId) return null;

        await sleep(1100);

        // Get release with community rating
        const releaseRes = await fetch(`${DISCOGS_API}/releases/${mainReleaseId}`, { headers, signal: AbortSignal.timeout(10000) });
        if (!releaseRes.ok) return null;
        const releaseData = await releaseRes.json();

        const avg = releaseData.community?.rating?.average;
        const count = releaseData.community?.rating?.count;
        if (!avg || avg === 0) return null;

        return {
            rating: Math.round(avg * 20), // normalize 5-scale → 0-100
            voteCount: count || 0,
            rawValue: `${avg.toFixed(2)}/5`
        };
    } catch {
        return null;
    }
}

// ── MusicBrainz (fallback) ─────────────────────────────────────────────────────

/**
 * Fetch album rating from MusicBrainz release group.
 * Used as fallback when Discogs has no result.
 * @param {string} musicbrainzId - The release-group or artist MBID
 * @param {string} albumTitle
 * @returns {Promise<{rating: number, voteCount: number, rawValue: string} | null>}
 */
async function fetchMusicBrainzAlbumRating(musicbrainzId, albumTitle) {
    try {
        // Search for the release group by artist MBID + album title
        const searchUrl = `${MB_API}/release-group/?query=releasegroup:"${encodeURIComponent(albumTitle)}" AND arid:${musicbrainzId}&fmt=json&limit=1`;
        const searchRes = await fetch(searchUrl, {
            headers: { 'User-Agent': MB_USER_AGENT, 'Accept': 'application/json' },
            signal: AbortSignal.timeout(10000)
        });
        if (!searchRes.ok) return null;
        const searchData = await searchRes.json();

        const rg = searchData['release-groups']?.[0];
        if (!rg) return null;

        await sleep(1100); // MB rate limit

        // Fetch release group with ratings
        const detailRes = await fetch(`${MB_API}/release-group/${rg.id}?inc=ratings&fmt=json`, {
            headers: { 'User-Agent': MB_USER_AGENT, 'Accept': 'application/json' },
            signal: AbortSignal.timeout(10000)
        });
        if (!detailRes.ok) return null;
        const detail = await detailRes.json();

        const rating = detail.rating?.value;
        const votes = detail.rating?.['votes-count'] || 0;
        if (!rating || rating === 0) return null;

        return {
            rating: Math.round(rating * 20), // normalize 5-scale → 0-100
            voteCount: votes,
            rawValue: `${rating.toFixed(2)}/5`
        };
    } catch {
        return null;
    }
}

// ── OMDb (IMDb + Rotten Tomatoes + Metacritic) ─────────────────────────────────

/**
 * Fetch ratings from OMDb (single call returns IMDb, RT, and Metacritic).
 * @param {string} imdbId 
 * @param {string} apiKey 
 * @returns {Promise<Array<{source: string, rating: number, voteCount: number|null, rawValue: string}>>}
 */
async function fetchOmdbRatings(imdbId, apiKey) {
    const results = [];
    try {
        const url = `${OMDB_API}/?i=${encodeURIComponent(imdbId)}&apikey=${apiKey}`;
        const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
        if (!res.ok) return results;
        const data = await res.json();
        if (data.Response === 'False') return results;

        // IMDb rating (e.g. "7.2")
        if (data.imdbRating && data.imdbRating !== 'N/A') {
            const val = parseFloat(data.imdbRating);
            if (!isNaN(val)) {
                results.push({
                    source: 'omdb_imdb',
                    rating: Math.round(val * 10), // 10-scale → 0-100
                    voteCount: data.imdbVotes ? parseInt(data.imdbVotes.replace(/,/g, '')) : null,
                    rawValue: `${data.imdbRating}/10`
                });
            }
        }

        // Metacritic (e.g. "85")
        if (data.Metascore && data.Metascore !== 'N/A') {
            const val = parseInt(data.Metascore);
            if (!isNaN(val)) {
                results.push({
                    source: 'omdb_metacritic',
                    rating: val, // already 0-100
                    voteCount: null,
                    rawValue: `${data.Metascore}/100`
                });
            }
        }

        // Rotten Tomatoes (from Ratings array)
        const rtRating = data.Ratings?.find((/** @type {any} */ r) => r.Source === 'Rotten Tomatoes');
        if (rtRating?.Value) {
            const val = parseInt(rtRating.Value); // e.g. "85%"
            if (!isNaN(val)) {
                results.push({
                    source: 'omdb_rt',
                    rating: val, // already 0-100
                    voteCount: null,
                    rawValue: rtRating.Value
                });
            }
        }
    } catch { /* ignore */ }
    return results;
}

// ── TMDB ───────────────────────────────────────────────────────────────────────

/**
 * Fetch TMDB community rating.
 * @param {string} tmdbId 
 * @param {string} mediaType - 'movie' or 'tv'
 * @param {string} apiKey 
 * @returns {Promise<{rating: number, voteCount: number, rawValue: string} | null>}
 */
async function fetchTmdbRating(tmdbId, mediaType, _apiKey) {
    try {
        const type = mediaType === 'show' ? 'tv' : 'movie';
        const res = await tmdbFetch(`/${type}/${tmdbId}`);
        if (!res.ok) return null;
        const data = await res.json();

        if (data.vote_average && data.vote_average > 0) {
            return {
                rating: Math.round(data.vote_average * 10), // 10-scale → 0-100
                voteCount: data.vote_count || 0,
                rawValue: `${data.vote_average.toFixed(1)}/10`
            };
        }
        return null;
    } catch {
        return null;
    }
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Get all cached ratings for a media parent.
 * @param {number} mediaParentId 
 * @returns {Array<any>}
 */
export function getRatingsForParent(mediaParentId) {
    return /** @type {Array<any>} */ (getRatings.all(mediaParentId));
}

/**
 * Get all cached ratings for a media child (episode/album).
 * @param {number} mediaChildId 
 * @returns {Array<any>}
 */
export function getRatingsForChild(mediaChildId) {
    return /** @type {Array<any>} */ (getChildRatings.all(mediaChildId));
}

/**
 * Fetch and store ratings for a media parent.
 * @param {number} mediaParentId 
 * @param {{ force?: boolean }} options 
 * @returns {Promise<{ fetched: string[], errors: string[] }>}
 */
export async function fetchRatingsForParent(mediaParentId, { force = false } = {}) {
    const parent = /** @type {any} */ (db.prepare(`
        SELECT id, title, media_type, tmdb_id, imdb_id, musicbrainz_id
        FROM media_parents WHERE id = ?
    `).get(mediaParentId));

    if (!parent) return { fetched: [], errors: ['Media parent not found'] };

    const keys = getApiKeys();
    const fetched = [];
    const errors = [];

    if (parent.media_type === 'movie' || parent.media_type === 'show') {
        // OMDb (IMDb + RT + Metacritic)
        if (keys.omdbApiKey && parent.imdb_id) {
            const shouldFetch = force || !hasRatingForSource.get(mediaParentId, 'omdb_imdb');
            if (shouldFetch) {
                try {
                    const omdbRatings = await fetchOmdbRatings(parent.imdb_id, keys.omdbApiKey);
                    for (const r of omdbRatings) {
                        upsertRating.run({
                            mediaParentId,
                            mediaChildId: null,
                            source: r.source,
                            ratingType: 'score',
                            value: r.rating,
                            voteCount: r.voteCount,
                            rawValue: r.rawValue
                        });
                        fetched.push(r.source);
                    }
                } catch (e) {
                    errors.push(`OMDb: ${e instanceof Error ? e.message : String(e)}`);
                }
            }
        }

        // TMDB
        if (keys.tmdbApiKey && parent.tmdb_id) {
            const shouldFetch = force || !hasRatingForSource.get(mediaParentId, 'tmdb');
            if (shouldFetch) {
                try {
                    const tmdb = await fetchTmdbRating(parent.tmdb_id, parent.media_type, keys.tmdbApiKey);
                    if (tmdb) {
                        upsertRating.run({
                            mediaParentId,
                            mediaChildId: null,
                            source: 'tmdb',
                            ratingType: 'score',
                            value: tmdb.rating,
                            voteCount: tmdb.voteCount,
                            rawValue: tmdb.rawValue
                        });
                        fetched.push('tmdb');
                    }
                } catch (e) {
                    errors.push(`TMDB: ${e instanceof Error ? e.message : String(e)}`);
                }
            }
        }
    } else if (parent.media_type === 'artist') {
        // For artists, fetch ratings for their albums
        const albums = /** @type {Array<{id: number, title: string}>} */ (
            db.prepare('SELECT id, title FROM media_children WHERE parent_id = ?').all(mediaParentId)
        );

        for (const album of albums) {
            await fetchRatingsForAlbum(album.id, parent.title, album.title, parent.musicbrainz_id, { force });
            // Rate limit between albums
            await sleep(200);
        }
        fetched.push('albums');
    }

    return { fetched, errors };
}

/**
 * Fetch and store ratings for a specific album (media child).
 * @param {number} mediaChildId 
 * @param {string} artistName 
 * @param {string} albumTitle 
 * @param {string|null} musicbrainzId - Artist's MusicBrainz ID
 * @param {{ force?: boolean }} options 
 * @returns {Promise<{ fetched: string[], errors: string[] }>}
 */
export async function fetchRatingsForAlbum(mediaChildId, artistName, albumTitle, musicbrainzId, { force = false } = {}) {
    const keys = getApiKeys();
    const fetched = [];
    const errors = [];

    // Get the parent_id from the album for the media_parent_id column
    const album = /** @type {any} */ (db.prepare('SELECT parent_id FROM media_children WHERE id = ?').get(mediaChildId));
    const parentId = album?.parent_id || null;

    // Discogs
    if (keys.discogsToken) {
        const shouldFetch = force || !hasRatingForSource.get(parentId, `discogs_album_${mediaChildId}`);
        // Check if we have a Discogs rating for this specific child
        const hasChildRating = force ? false : !!db.prepare(
            'SELECT 1 FROM external_ratings WHERE media_child_id = ? AND source = ? LIMIT 1'
        ).get(mediaChildId, 'discogs');

        if (!hasChildRating) {
            try {
                const discogs = await fetchDiscogsRating(artistName, albumTitle, keys.discogsToken);
                if (discogs) {
                    upsertRating.run({
                        mediaParentId: parentId,
                        mediaChildId,
                        source: 'discogs',
                        ratingType: 'score',
                        value: discogs.rating,
                        voteCount: discogs.voteCount,
                        rawValue: discogs.rawValue
                    });
                    fetched.push('discogs');
                } else if (musicbrainzId) {
                    // Fallback to MusicBrainz
                    await sleep(1100);
                    const mb = await fetchMusicBrainzAlbumRating(musicbrainzId, albumTitle);
                    if (mb) {
                        upsertRating.run({
                            mediaParentId: parentId,
                            mediaChildId,
                            source: 'musicbrainz',
                            ratingType: 'score',
                            value: mb.rating,
                            voteCount: mb.voteCount,
                            rawValue: mb.rawValue
                        });
                        fetched.push('musicbrainz');
                    }
                }
            } catch (e) {
                errors.push(`Discogs: ${e instanceof Error ? e.message : String(e)}`);
            }
        }
    } else if (musicbrainzId) {
        // No Discogs token — only try MusicBrainz
        const hasChildRating = force ? false : !!db.prepare(
            'SELECT 1 FROM external_ratings WHERE media_child_id = ? AND source = ? LIMIT 1'
        ).get(mediaChildId, 'musicbrainz');

        if (!hasChildRating) {
            try {
                const mb = await fetchMusicBrainzAlbumRating(musicbrainzId, albumTitle);
                if (mb) {
                    upsertRating.run({
                        mediaParentId: parentId,
                        mediaChildId,
                        source: 'musicbrainz',
                        ratingType: 'score',
                        value: mb.rating,
                        voteCount: mb.voteCount,
                        rawValue: mb.rawValue
                    });
                    fetched.push('musicbrainz');
                }
            } catch (e) {
                errors.push(`MusicBrainz: ${e instanceof Error ? e.message : String(e)}`);
            }
        }
    }

    return { fetched, errors };
}

/**
 * Check if ratings are stale (older than 6 months).
 * @param {number} mediaParentId 
 * @returns {boolean}
 */
export function areRatingsStale(mediaParentId) {
    const oldest = /** @type {any} */ (db.prepare(`
        SELECT MIN(fetched_at) as oldest FROM external_ratings WHERE media_parent_id = ?
    `).get(mediaParentId));
    if (!oldest?.oldest) return true; // no ratings = stale
    const fetchedAt = new Date(oldest.oldest).getTime();
    return Date.now() - fetchedAt > STALE_MS;
}

/**
 * Batch-fetch ratings for ALL media parents that don't have ratings yet.
 * Streams progress via the onProgress callback.
 * @param {{ force?: boolean, onProgress?: (data: any) => void, signal?: AbortSignal }} options
 * @returns {Promise<{ total: number, fetched: number, errors: number }>}
 */
export async function fetchAllRatings({ force = false, onProgress, signal } = {}) {
    const parents = /** @type {Array<{id: number, title: string, media_type: string}>} */ (
        db.prepare(`SELECT id, title, media_type FROM media_parents ORDER BY title`).all()
    );

    const total = parents.length;
    let fetched = 0;
    let errorCount = 0;

    onProgress?.({ type: 'ratings_start', total });

    for (let i = 0; i < parents.length; i++) {
        if (signal?.aborted) break;

        const parent = parents[i];

        // Skip if already has non-stale ratings (unless force)
        if (!force && !areRatingsStale(parent.id)) {
            onProgress?.({
                type: 'ratings_progress',
                current: i + 1,
                total,
                title: parent.title,
                skipped: true,
                fetched,
                errors: errorCount
            });
            continue;
        }

        try {
            const result = await fetchRatingsForParent(parent.id, { force });
            if (result.fetched.length > 0) fetched++;
            if (result.errors.length > 0) errorCount++;

            onProgress?.({
                type: 'ratings_progress',
                current: i + 1,
                total,
                title: parent.title,
                sources: result.fetched,
                errors: result.errors,
                fetched,
                errorCount
            });
        } catch (e) {
            errorCount++;
            onProgress?.({
                type: 'ratings_progress',
                current: i + 1,
                total,
                title: parent.title,
                errors: [e instanceof Error ? e.message : String(e)],
                fetched,
                errorCount
            });
        }

        // Rate limit between items (OMDb: 1000/day, TMDB is lenient, Discogs: 60/min)
        await sleep(300);
    }

    onProgress?.({ type: 'ratings_done', total, fetched, errors: errorCount });
    return { total, fetched, errors: errorCount };
}
