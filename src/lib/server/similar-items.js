/**
 * Similar-items ("More Like This") for movie/TV detail pages.
 *
 * TMDB recommendations are cached in precomputed_sections (stale-while-revalidate)
 * so detail-page loads never block on a live TMDB call after the first visit.
 * Classification against the local library is cheap SQLite and runs every load.
 */
import db from '$lib/server/db.js';
import { tmdbFetch, getTmdbKey } from './tmdb.js';
import { getPrecomputed, setPrecomputed, isPrecomputedFresh } from './section-cache.js';

// Recommendations for a title change rarely; serve stale copies while refreshing.
const RECS_CACHE_MS = 24 * 60 * 60 * 1000;

/**
 * Fetch and normalize TMDB recommendations for a title.
 * @param {'movie'|'show'} mediaType
 * @param {string|number} tmdbId
 * @returns {Promise<any[]|null>} normalized recs, or null on fetch failure
 */
async function fetchRecs(mediaType, tmdbId) {
    const path = mediaType === 'movie'
        ? `/movie/${tmdbId}/recommendations`
        : `/tv/${tmdbId}/recommendations`;
    const res = await tmdbFetch(path);
    if (!res.ok) return null;
    const data = await res.json();
    return (data.results || []).slice(0, 20).map(/** @param {any} r */ (r) => ({
        tmdb_id: String(r.id),
        title: (mediaType === 'movie' ? r.title || r.original_title : r.name || r.original_name) || 'Unknown',
        year: mediaType === 'movie'
            ? (r.release_date ? r.release_date.slice(0, 4) : '')
            : (r.first_air_date ? r.first_air_date.slice(0, 4) : ''),
        poster_url: r.poster_path ? `https://image.tmdb.org/t/p/w300${r.poster_path}` : null,
        overview: r.overview || null,
    }));
}

/**
 * Cached recommendations, stale-while-revalidate.
 * @param {'movie'|'show'} mediaType
 * @param {string|number} tmdbId
 * @returns {Promise<any[]>}
 */
async function getCachedRecs(mediaType, tmdbId) {
    const cacheKey = `tmdb-recs-${mediaType}-${tmdbId}`;
    const cached = getPrecomputed(cacheKey);
    if (cached) {
        if (!isPrecomputedFresh(cacheKey, RECS_CACHE_MS)) {
            fetchRecs(mediaType, tmdbId)
                .then(fresh => { if (fresh) try { setPrecomputed(cacheKey, fresh); } catch { /* non-fatal */ } })
                .catch(() => { /* background refresh failed — keep serving stale */ });
        }
        return cached.data;
    }
    const fresh = await fetchRecs(mediaType, tmdbId);
    if (fresh) try { setPrecomputed(cacheKey, fresh); } catch { /* non-fatal */ }
    return fresh || [];
}

/**
 * Build "In Your Library" / "You Might Like" rows for a detail page.
 * Creates browsable local stubs for recs not yet in media_parents.
 * @param {string|number|null} tmdbId - TMDB id of the current title
 * @param {'movie'|'show'} mediaType
 * @param {string} jellyfinUrl
 * @returns {Promise<{similarInLibrary: any[], similarYouMightLike: any[]}>}
 */
export async function getSimilarItems(tmdbId, mediaType, jellyfinUrl) {
    /** @type {any[]} */
    const similarInLibrary = [];
    /** @type {any[]} */
    const similarYouMightLike = [];
    const result = { similarInLibrary, similarYouMightLike };

    if (!tmdbId || !getTmdbKey()) return result;

    /** @type {any[]} */
    let recs = [];
    try {
        recs = await getCachedRecs(mediaType, tmdbId);
    } catch (e) {
        console.warn('[similar] Failed to fetch TMDB recommendations:', e instanceof Error ? e.message : e);
        return result;
    }
    if (recs.length === 0) return result;

    const basePath = mediaType === 'movie' ? '/movies' : '/tv';
    const tmdbExternalPath = mediaType === 'movie' ? 'movie' : 'tv';

    // Batch lookup: which tmdb_ids are in our library (including previously created stubs)?
    // IMPORTANT: tmdb_id is stored as TEXT — must match as strings
    const tmdbIds = recs.map(r => r.tmdb_id);
    const placeholders = tmdbIds.map(() => '?').join(',');
    const inLib = /** @type {any[]} */ (db.prepare(
        `SELECT id, slug, tmdb_id, title, poster_url, release_year, jellyfin_id, collection_status, arr_has_file
         FROM media_parents
         WHERE tmdb_id IN (${placeholders}) AND media_type = ?`
    ).all(...tmdbIds, mediaType));

    const libByTmdb = new Map(inLib.map(m => [String(m.tmdb_id), m]));

    // Prepared statements for stub creation (partial unique index doesn't support ON CONFLICT)
    const findStub = db.prepare(`SELECT id, slug, poster_url FROM media_parents WHERE tmdb_id = ? AND media_type = ?`);
    const insertStub = db.prepare(`
        INSERT INTO media_parents (tmdb_id, title, media_type, release_year, poster_url, overview, collection_status)
        VALUES (@tmdbId, @title, @mediaType, @releaseYear, @posterUrl, @overview, 'external')
    `);

    for (const rec of recs) {
        const localMatch = libByTmdb.get(rec.tmdb_id);
        if (localMatch) {
            const pUrl = localMatch.jellyfin_id
                ? `${jellyfinUrl}/Items/${localMatch.jellyfin_id}/Images/Primary?maxHeight=400`
                : localMatch.poster_url;
            const item = {
                href: `${basePath}/${localMatch.slug || localMatch.id}`,
                poster_url: pUrl,
                title: localMatch.title,
                subtitle: localMatch.release_year ? String(localMatch.release_year) : '',
            };
            // Engaged = jellyfin_id, wanted, or arr_has_file
            if (localMatch.jellyfin_id || localMatch.collection_status === 'wanted' || localMatch.arr_has_file === 1) {
                similarInLibrary.push(item);
            } else {
                similarYouMightLike.push(item);
            }
        } else {
            // Create a local stub so the item is browsable
            try {
                const stubParams = {
                    tmdbId: rec.tmdb_id,
                    title: rec.title,
                    mediaType,
                    releaseYear: rec.year ? parseInt(rec.year) : null,
                    posterUrl: rec.poster_url,
                    overview: rec.overview,
                };
                // Insert may race with a concurrent request creating the same stub
                // (unique index on tmdb_id+media_type) — re-find covers both outcomes
                try { insertStub.run(stubParams); } catch { /* already exists */ }
                const existing = /** @type {any} */ (findStub.get(rec.tmdb_id, mediaType));
                if (existing) {
                    similarYouMightLike.push({
                        href: `${basePath}/${existing.slug || existing.id}`,
                        poster_url: existing.poster_url || rec.poster_url,
                        title: rec.title,
                        subtitle: rec.year,
                    });
                }
            } catch {
                // If stub creation fails, still show with TMDB poster
                similarYouMightLike.push({
                    href: `https://www.themoviedb.org/${tmdbExternalPath}/${rec.tmdb_id}`,
                    poster_url: rec.poster_url,
                    title: rec.title,
                    subtitle: rec.year,
                    external: true,
                });
            }
        }
    }

    return result;
}
