import db from '$lib/server/db.js';
import { tmdbFetch } from '$lib/server/tmdb.js';

const TMDB_IMG = 'https://image.tmdb.org/t/p';

/**
 * Fetch the best TMDB backdrop for a movie or TV show.
 * Prefers textless (iso_639_1 === null) images, sorted by vote_average desc.
 * @param {'movie' | 'tv'} type
 * @param {string} tmdbId
 * @returns {Promise<string | null>} Full image URL or null
 */
export async function fetchTmdbBackdrop(type, tmdbId) {
    try {
        const res = await tmdbFetch(`/${type}/${tmdbId}/images`);
        if (!res.ok) return null;
        const data = await res.json();
        const backdrops = data.backdrops || [];
        if (backdrops.length === 0) return null;

        // Prefer textless backdrops (no text overlay), sorted by quality
        const textless = backdrops.filter((/** @type {any} */ b) => b.iso_639_1 === null);
        const best = textless.length > 0
            ? textless.sort((/** @type {any} */ a, /** @type {any} */ b) => (b.vote_average || 0) - (a.vote_average || 0))[0]
            : backdrops.sort((/** @type {any} */ a, /** @type {any} */ b) => (b.vote_average || 0) - (a.vote_average || 0))[0];

        return best?.file_path ? `${TMDB_IMG}/w1280${best.file_path}` : null;
    } catch {
        return null;
    }
}

/**
 * Fetch a TMDB person profile image suitable for backdrop use.
 * Uses h632 size for consistent height.
 * @param {string} tmdbPersonId
 * @returns {Promise<string | null>}
 */
export async function fetchTmdbPersonBackdrop(tmdbPersonId) {
    try {
        const res = await tmdbFetch(`/person/${tmdbPersonId}/images`);
        if (!res.ok) return null;
        const data = await res.json();
        const profiles = data.profiles || [];
        if (profiles.length === 0) return null;

        // Pick highest-voted profile
        const best = profiles.sort((/** @type {any} */ a, /** @type {any} */ b) => (b.vote_average || 0) - (a.vote_average || 0))[0];
        return best?.file_path ? `${TMDB_IMG}/h632${best.file_path}` : null;
    } catch {
        return null;
    }
}

/**
 * Fetch artist background from Fanart.tv.
 * @param {string} musicbrainzId
 * @returns {Promise<string | null>} Image URL with /preview suffix, or null
 */
export async function fetchFanartBackdrop(musicbrainzId) {
    const settings = /** @type {any} */ (db.prepare('SELECT fanart_api_key FROM app_settings WHERE id = 1').get());
    const apiKey = settings?.fanart_api_key?.trim();
    if (!apiKey) return null;

    try {
        const res = await fetch(`https://webservice.fanart.tv/v3/music/${musicbrainzId}?api_key=${apiKey}`, {
            headers: { 'Accept': 'application/json' }
        });
        if (!res.ok) return null;
        const data = await res.json();

        // artistbackground is the wide-angle concert/promo shots
        const backgrounds = data.artistbackground || [];
        if (backgrounds.length === 0) return null;

        // Pick highest-liked background, append /preview for compressed version
        const best = backgrounds.sort((/** @type {any} */ a, /** @type {any} */ b) => (parseInt(b.likes) || 0) - (parseInt(a.likes) || 0))[0];
        return best?.url || null;
    } catch {
        return null;
    }
}

/**
 * Resolve the best backdrop URL for a media parent.
 * Checks DB cache first, fetches from API if missing, and caches the result.
 * @param {number} mediaParentId
 * @returns {Promise<string | null>}
 */
export async function resolveBackdrop(mediaParentId) {
    const row = /** @type {any} */ (db.prepare(
        'SELECT backdrop_url, media_type, tmdb_id, musicbrainz_id FROM media_parents WHERE id = ?'
    ).get(mediaParentId));
    if (!row) return null;

    // Already cached
    if (row.backdrop_url) return row.backdrop_url;

    let url = null;

    if (row.media_type === 'movie' && row.tmdb_id) {
        url = await fetchTmdbBackdrop('movie', row.tmdb_id);
    } else if (row.media_type === 'show' && row.tmdb_id) {
        url = await fetchTmdbBackdrop('tv', row.tmdb_id);
    } else if (row.media_type === 'artist' && row.musicbrainz_id) {
        url = await fetchFanartBackdrop(row.musicbrainz_id);
    }

    if (url) {
        db.prepare('UPDATE media_parents SET backdrop_url = ? WHERE id = ?').run(url, mediaParentId);
    }

    return url;
}
