/**
 * *arr Sync Engine — reads state from Radarr/Sonarr/Lidarr into Mediajam.
 *
 * For each configured *arr service:
 * 1. Fetches all items via arrFetch
 * 2. Matches to existing media_parents by external ID (tmdb/tvdb/musicbrainz)
 * 3. Updates radarr_id/sonarr_id/lidarr_id, arr_monitored, arr_has_file, arr_quality_profile
 */

import db from '$lib/server/db.js';
import { arrFetch } from '$lib/server/arr-client.js';

/**
 * @typedef {{ service: string, url: string, apiKey: string, apiVersion: string, listEndpoint: string, idColumn: string, matchField: string, dbMatchColumn: string, fallbackField?: string, dbFallbackColumn?: string }} ArrServiceConfig
 */

/** @type {Record<string, { apiVersion: string, listEndpoint: string, idColumn: string, matchField: string, dbMatchColumn: string, fallbackField?: string, dbFallbackColumn?: string }>} */
const SERVICE_MAP = {
    radarr: {
        apiVersion: 'v3',
        listEndpoint: 'movie',
        idColumn: 'radarr_id',
        matchField: 'tmdbId',
        dbMatchColumn: 'tmdb_id',
        fallbackField: 'imdbId',
        dbFallbackColumn: 'imdb_id',
    },
    sonarr: {
        apiVersion: 'v3',
        listEndpoint: 'series',
        idColumn: 'sonarr_id',
        matchField: 'tvdbId',
        dbMatchColumn: 'tvdb_id',
        fallbackField: 'imdbId',
        dbFallbackColumn: 'imdb_id',
    },
    lidarr: {
        apiVersion: 'v1',
        listEndpoint: 'artist',
        idColumn: 'lidarr_id',
        matchField: 'foreignArtistId',
        dbMatchColumn: 'musicbrainz_id',
    },
};

/**
 * Fetch quality profile names keyed by ID from an *arr service.
 * @param {string} url
 * @param {string} apiKey
 * @param {string} service
 * @returns {Promise<Record<number, string>>}
 */
async function fetchQualityProfiles(url, apiKey, service) {
    try {
        const profiles = await arrFetch(url, apiKey, service, 'qualityprofile');
        /** @type {Record<number, string>} */
        const map = {};
        for (const p of profiles) {
            map[p.id] = p.name;
        }
        return map;
    } catch {
        return {};
    }
}

/**
 * Map *arr service to Mediajam media_type and metadata extraction helpers.
 * @type {Record<string, { mediaType: string, extractTitle: (item: any) => string, extractYear: (item: any) => number|null, extractOverview: (item: any) => string|null, extractPoster: (item: any) => string|null, extractStatus: (item: any) => string|null, extractExternalIds: (item: any) => Record<string, string|null> }>}
 */
const SERVICE_META = {
    radarr: {
        mediaType: 'movie',
        extractTitle: (item) => item.title || item.originalTitle || 'Unknown',
        extractYear: (item) => item.year || null,
        extractOverview: (item) => item.overview || null,
        extractPoster: (item) => {
            const img = (item.images || []).find(/** @param {any} i */(i) => i.coverType === 'poster');
            return img?.remoteUrl || img?.url || null;
        },
        extractStatus: (item) => item.status || null, // announced | inCinemas | released
        extractExternalIds: (item) => ({
            tmdb_id: item.tmdbId ? String(item.tmdbId) : null,
            imdb_id: item.imdbId || null,
        }),
    },
    sonarr: {
        mediaType: 'show',
        extractTitle: (item) => item.title || item.originalTitle || 'Unknown',
        extractYear: (item) => item.year || null,
        extractOverview: (item) => item.overview || null,
        extractPoster: (item) => {
            const img = (item.images || []).find(/** @param {any} i */(i) => i.coverType === 'poster');
            return img?.remoteUrl || img?.url || null;
        },
        extractStatus: (item) => item.status || null, // continuing | ended | upcoming
        extractExternalIds: (item) => ({
            tvdb_id: item.tvdbId ? String(item.tvdbId) : null,
            imdb_id: item.imdbId || null,
            tmdb_id: item.tmdbId ? String(item.tmdbId) : null,
        }),
    },
    lidarr: {
        mediaType: 'artist',
        extractTitle: (item) => item.artistName || 'Unknown',
        extractYear: (item) => null,
        extractOverview: (item) => item.overview || null,
        extractPoster: (item) => {
            const img = (item.images || []).find(/** @param {any} i */(i) => i.coverType === 'poster' || i.coverType === 'fanart');
            return img?.remoteUrl || img?.url || null;
        },
        extractStatus: (item) => item.status || null, // continuing | ended
        extractExternalIds: (item) => ({
            musicbrainz_id: item.foreignArtistId || null,
        }),
    },
};

/**
 * Sync a single *arr service into media_parents.
 * - Matches existing rows by external ID and updates *arr columns
 * - Creates stub media_parents for *arr items with no Jellyfin match
 * @param {string} service - radarr | sonarr | lidarr
 * @param {string} url
 * @param {string} apiKey
 * @returns {Promise<{ matched: number, created: number, total: number, errors: string[] }>}
 */
export async function syncArrService(service, url, apiKey) {
    const config = SERVICE_MAP[service];
    const meta = SERVICE_META[service];
    if (!config || !meta) return { matched: 0, created: 0, total: 0, errors: [`Unknown service: ${service}`] };

    /** @type {string[]} */
    const errors = [];

    // Fetch all items from *arr
    let items;
    try {
        items = await arrFetch(url, apiKey, service, config.listEndpoint);
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return { matched: 0, created: 0, total: 0, errors: [`Failed to fetch ${service}: ${msg}`] };
    }

    if (!Array.isArray(items)) {
        return { matched: 0, created: 0, total: 0, errors: [`${service} returned non-array response`] };
    }

    // Fetch quality profiles to map IDs to names
    const qualityProfiles = await fetchQualityProfiles(url, apiKey, service);

    // Prepare update statement (for matched items)
    const updateStmt = db.prepare(`
        UPDATE media_parents SET
            ${config.idColumn} = ?,
            arr_monitored = ?,
            arr_has_file = ?,
            arr_quality_profile = ?,
            arr_status = ?,
            arr_slug = ?,
            arr_sync_pending = 0
        WHERE id = ?
    `);

    // For Lidarr: also update musicbrainz_id since Lidarr's foreignArtistId
    // is more authoritative than Jellyfin's MusicBrainzArtist provider ID
    const updateMbId = service === 'lidarr'
        ? db.prepare('UPDATE media_parents SET musicbrainz_id = ? WHERE id = ? AND (musicbrainz_id IS NULL OR musicbrainz_id != ?)')
        : null;

    // Prepare insert statement (for unmatched *arr-only items)
    const insertStmt = db.prepare(`
        INSERT INTO media_parents (
            title, media_type, release_year, poster_url, overview,
            tmdb_id, imdb_id, tvdb_id, musicbrainz_id,
            collection_status, ${config.idColumn},
            arr_monitored, arr_has_file, arr_quality_profile, arr_status, arr_slug
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'wanted', ?, ?, ?, ?, ?, ?)
    `);

    // Prepare match queries — always filter by media_type to avoid cross-type collisions
    const findByPrimary = db.prepare(
        `SELECT id FROM media_parents WHERE ${config.dbMatchColumn} = ? AND media_type = ? LIMIT 1`
    );
    const findByFallback = config.dbFallbackColumn
        ? db.prepare(`SELECT id FROM media_parents WHERE ${config.dbFallbackColumn} = ? AND media_type = ? LIMIT 1`)
        : null;

    // Also check by *arr ID (for stubs we created in a previous sync)
    const findByArrId = db.prepare(
        `SELECT id FROM media_parents WHERE ${config.idColumn} = ? LIMIT 1`
    );

    // Broad fallback: find any item matching ANY external ID (catches items missed by primary/fallback)
    const findByAnyExternalId = db.prepare(
        `SELECT id FROM media_parents WHERE media_type = ? AND (
            (tmdb_id IS NOT NULL AND tmdb_id = ?) OR
            (imdb_id IS NOT NULL AND imdb_id = ?) OR
            (tvdb_id IS NOT NULL AND tvdb_id = ?) OR
            (musicbrainz_id IS NOT NULL AND musicbrainz_id = ?)
        ) LIMIT 1`
    );

    // Title-based fallback — catches Lidarr artists where Jellyfin had the wrong MB ID
    // (e.g. Jellyfin says Sleep is MB:xyz but Lidarr says Sleep is MB:abc)
    const findByTitle = db.prepare(
        `SELECT id FROM media_parents WHERE title = ? COLLATE NOCASE AND media_type = ? AND jellyfin_id IS NOT NULL LIMIT 1`
    );

    let matched = 0;
    let created = 0;

    // ── Track existing wanted stubs for cleanup after sync ──
    // Instead of deleting all wanted stubs upfront (which destroys person_credits),
    // we track which stubs exist before the sync and remove only those
    // that aren't matched by any current *arr item.
    const existingWantedIds = new Set(
        /** @type {any[]} */(db.prepare(
        `SELECT id FROM media_parents WHERE ${config.idColumn} IS NOT NULL AND collection_status = 'wanted'`
    ).all()).map((/** @type {any} */ r) => r.id)
    );
    /** @type {Set<number>} */
    const seenWantedIds = new Set();

    // Also look up wanted stubs by external ID when the *arr ID match fails
    const findWantedByExternalId = db.prepare(
        `SELECT id FROM media_parents WHERE collection_status = 'wanted' AND media_type = ? AND (
            (tmdb_id IS NOT NULL AND tmdb_id = ?) OR
            (imdb_id IS NOT NULL AND imdb_id = ?) OR
            (tvdb_id IS NOT NULL AND tvdb_id = ?) OR
            (musicbrainz_id IS NOT NULL AND musicbrainz_id = ?)
        ) LIMIT 1`
    );

    // Update statement for wanted stubs (preserves their ID and person_credits)
    const updateWantedStmt = db.prepare(`
        UPDATE media_parents SET
            title = ?, release_year = ?, poster_url = COALESCE(?, poster_url), overview = COALESCE(?, overview),
            tmdb_id = COALESCE(?, tmdb_id), imdb_id = COALESCE(?, imdb_id),
            tvdb_id = COALESCE(?, tvdb_id), musicbrainz_id = COALESCE(?, musicbrainz_id),
            ${config.idColumn} = ?, arr_monitored = ?, arr_has_file = ?,
            arr_quality_profile = ?, arr_status = ?, arr_slug = ?
        WHERE id = ?
    `);

    // Main sync transaction
    db.transaction(() => {
        // Mark existing *arr-linked items as pending (instead of clearing IDs upfront)
        db.prepare(`UPDATE media_parents SET arr_sync_pending = 1 WHERE ${config.idColumn} IS NOT NULL AND collection_status != 'wanted'`).run();

        for (const item of items) {
            const externalId = String(item[config.matchField] || '');
            if (!externalId) continue;

            const hasFile = service === 'lidarr'
                ? (item.statistics?.percentOfTracks > 0 ? 1 : 0)
                : (item.hasFile ? 1 : 0);
            const qualityProfileName = qualityProfiles[item.qualityProfileId] || null;
            const arrStatus = meta.extractStatus(item);

            // Try primary match (filtered by media_type)
            let match = /** @type {any} */ (findByPrimary.get(externalId, meta.mediaType));

            // Try fallback match (filtered by media_type)
            if (!match && findByFallback && config.fallbackField) {
                const fallbackId = String(item[config.fallbackField] || '');
                if (fallbackId) {
                    match = /** @type {any} */ (findByFallback.get(fallbackId, meta.mediaType));
                }
            }

            // Try matching by *arr ID (stubs from previous sync)
            if (!match) {
                match = /** @type {any} */ (findByArrId.get(item.id));
            }

            // Broad external ID fallback — catches items missed by primary/fallback
            if (!match) {
                const ids = meta.extractExternalIds(item);
                match = /** @type {any} */ (findByAnyExternalId.get(
                    meta.mediaType,
                    ids.tmdb_id || '', ids.imdb_id || '', ids.tvdb_id || '', ids.musicbrainz_id || ''
                ));
            }

            // Title-based fallback — last resort for when Jellyfin has the wrong external IDs
            if (!match) {
                const title = meta.extractTitle(item);
                match = /** @type {any} */ (findByTitle.get(title, meta.mediaType));
            }

            if (match) {
                const slug = service === 'lidarr'
                    ? (item.foreignArtistId || item.titleSlug || null)
                    : (item.titleSlug || item.foreignArtistId || null);
                updateStmt.run(
                    item.id,
                    item.monitored ? 1 : 0,
                    hasFile,
                    qualityProfileName,
                    arrStatus,
                    slug,
                    match.id
                );
                // Lidarr: correct musicbrainz_id if Jellyfin had the wrong one
                if (updateMbId && item.foreignArtistId) {
                    updateMbId.run(item.foreignArtistId, match.id, item.foreignArtistId);
                }
                if (existingWantedIds.has(match.id)) seenWantedIds.add(match.id);
                matched++;
            } else {
                // No Jellyfin match — check for existing wanted stub before creating
                const title = meta.extractTitle(item);
                const year = meta.extractYear(item);
                const overview = meta.extractOverview(item);
                const poster = meta.extractPoster(item);
                const ids = meta.extractExternalIds(item);
                const slug = service === 'lidarr'
                    ? (item.foreignArtistId || item.titleSlug || null)
                    : (item.titleSlug || item.foreignArtistId || null);

                // Try to find an existing wanted stub by external IDs
                let existingStub = /** @type {any} */ (findWantedByExternalId.get(
                    meta.mediaType,
                    ids.tmdb_id || '', ids.imdb_id || '', ids.tvdb_id || '', ids.musicbrainz_id || ''
                ));

                if (existingStub) {
                    // Update the existing stub in-place (preserves person_credits, ID, etc.)
                    updateWantedStmt.run(
                        title, year, poster, overview,
                        ids.tmdb_id || null, ids.imdb_id || null,
                        ids.tvdb_id || null, ids.musicbrainz_id || null,
                        item.id, item.monitored ? 1 : 0, hasFile,
                        qualityProfileName, arrStatus, slug,
                        existingStub.id
                    );
                    seenWantedIds.add(existingStub.id);
                    matched++;
                } else {
                    try {
                        insertStmt.run(
                            title, meta.mediaType, year, poster, overview,
                            ids.tmdb_id || null, ids.imdb_id || null,
                            ids.tvdb_id || null, ids.musicbrainz_id || null,
                            item.id, item.monitored ? 1 : 0, hasFile,
                            qualityProfileName, arrStatus, slug
                        );
                        created++;
                    } catch (insertErr) {
                        // UNIQUE constraint — an existing entry shares an external ID
                        // This is a normal case (item exists from Jellyfin), not a real error
                        let existing = null;
                        if (ids.tmdb_id) existing = /** @type {any} */ (db.prepare('SELECT id FROM media_parents WHERE tmdb_id = ? AND media_type = ? LIMIT 1').get(ids.tmdb_id, meta.mediaType));
                        if (!existing && ids.imdb_id) existing = /** @type {any} */ (db.prepare('SELECT id FROM media_parents WHERE imdb_id = ? AND media_type = ? LIMIT 1').get(ids.imdb_id, meta.mediaType));
                        if (!existing && ids.tvdb_id) existing = /** @type {any} */ (db.prepare('SELECT id FROM media_parents WHERE tvdb_id = ? AND media_type = ? LIMIT 1').get(ids.tvdb_id, meta.mediaType));
                        if (!existing && ids.musicbrainz_id) existing = /** @type {any} */ (db.prepare('SELECT id FROM media_parents WHERE musicbrainz_id = ? AND media_type = ? LIMIT 1').get(ids.musicbrainz_id, meta.mediaType));

                        if (existing) {
                            updateStmt.run(item.id, item.monitored ? 1 : 0, hasFile, qualityProfileName, arrStatus, slug, existing.id);
                            if (existingWantedIds.has(existing.id)) seenWantedIds.add(existing.id);
                            matched++;
                        } else {
                            // Genuine error — can't find the conflicting row
                            errors.push(`${title}: ${insertErr instanceof Error ? insertErr.message : String(insertErr)}`);
                        }
                    }
                }
            }
        }
    })();

    // ── Cleanup: clear *arr IDs for items still pending (no longer in *arr) ──
    try {
        const pendingCleared = db.prepare(`
            UPDATE media_parents SET
                ${config.idColumn} = NULL, arr_monitored = 0, arr_has_file = NULL,
                arr_status = NULL, arr_slug = NULL, arr_quality_profile = NULL,
                arr_sync_pending = 0
            WHERE arr_sync_pending = 1 AND collection_status != 'wanted'
        `).run();
        if (pendingCleared.changes > 0) {
            console.log(`[arr-sync] ${service}: cleared *arr IDs from ${pendingCleared.changes} items no longer in *arr`);
        }
    } catch (clearErr) {
        console.warn(`[arr-sync] ${service}: pending cleanup failed:`, clearErr instanceof Error ? clearErr.message : clearErr);
    }

    // ── Cleanup: remove wanted stubs no longer in *arr ──
    const staleWantedIds = [...existingWantedIds].filter(id => !seenWantedIds.has(id));
    if (staleWantedIds.length > 0) {
        db.pragma('foreign_keys = OFF');
        try {
            db.transaction(() => {
                for (const staleId of staleWantedIds) {
                    db.prepare('DELETE FROM external_ratings WHERE media_parent_id = ?').run(staleId);
                    db.prepare('DELETE FROM person_credits WHERE media_parent_id = ?').run(staleId);
                    db.prepare('DELETE FROM media_children WHERE parent_id = ?').run(staleId);
                    db.prepare('DELETE FROM media_parents WHERE id = ?').run(staleId);
                }
            })();
            console.log(`[arr-sync] ${service}: cleaned up ${staleWantedIds.length} stale wanted stubs`);
        } catch (cleanupErr) {
            console.warn(`[arr-sync] ${service}: cleanup of stale stubs failed:`, cleanupErr instanceof Error ? cleanupErr.message : cleanupErr);
        }
        db.pragma('foreign_keys = ON');
    }

    console.log(`[arr-sync] ${service}: ${matched} matched, ${created} created (${items.length} total)`);

    // Enrich with TMDb cast data (Radarr/Sonarr only)
    if (service === 'radarr' || service === 'sonarr') {
        const enriched = await enrichWithTmdbCast(service);
        if (enriched > 0) {
            console.log(`[arr-sync] ${service}: enriched ${enriched} items with TMDb cast data`);
        }
    }

    return { matched, created, total: items.length, errors };
}

/**
 * Enrich media_parents that came from *arr sync with TMDb cast/crew data.
 * Finds items with a tmdb_id but no person_credits, fetches from TMDb, creates persons + credits.
 * @param {string} service - radarr | sonarr
 * @returns {Promise<number>} - number of items enriched
 */
async function enrichWithTmdbCast(service) {
    const { tmdbFetch, getTmdbKey } = await import('$lib/server/tmdb.js');
    if (!getTmdbKey()) return 0;

    const mediaType = service === 'radarr' ? 'movie' : 'show';
    const tmdbType = service === 'radarr' ? 'movie' : 'tv';

    // Find items with tmdb_id but no person_credits
    const needsEnrichment = /** @type {any[]} */ (db.prepare(`
        SELECT mp.id, mp.tmdb_id FROM media_parents mp
        WHERE mp.tmdb_id IS NOT NULL AND mp.tmdb_id != ''
          AND mp.media_type = ?
          AND NOT EXISTS (SELECT 1 FROM person_credits pc WHERE pc.media_parent_id = mp.id)
    `).all(mediaType));

    if (needsEnrichment.length === 0) return 0;

    // Limit batch size to avoid blocking the server for too long
    const BATCH_LIMIT = 25;
    const batch = needsEnrichment.slice(0, BATCH_LIMIT);
    const remaining = needsEnrichment.length - batch.length;
    console.log(`[arr-sync] ${service}: enriching ${batch.length} of ${needsEnrichment.length} items with TMDb cast${remaining > 0 ? ` (${remaining} remaining for next sync)` : ''}`);

    // Prepared statements for person upserts
    const findPersonByTmdb = db.prepare('SELECT id FROM persons WHERE tmdb_person_id = ?');
    // NOTE: findPersonByName removed — name-only matching causes collisions (e.g. two different "Emma Watson" actors)
    const insertPerson = db.prepare(`
        INSERT INTO persons (name, tmdb_person_id, photo_url)
        VALUES (?, ?, ?)
    `);
    const updatePersonPhoto = db.prepare('UPDATE persons SET photo_url = COALESCE(?, photo_url) WHERE id = ?');
    const upsertCredit = db.prepare(`
        INSERT OR IGNORE INTO person_credits (person_id, media_parent_id, role_type, character_name, sort_order)
        VALUES (?, ?, ?, ?, ?)
    `);

    let enriched = 0;

    for (const item of batch) {
        try {
            const res = await tmdbFetch(`/${tmdbType}/${item.tmdb_id}/credits`);
            if (!res.ok) continue;

            const data = await res.json();
            const cast = (data.cast || []).slice(0, 20); // Top 20 cast
            const crew = (data.crew || []).filter(/** @param {any} c */(c) =>
                ['Director', 'Writer', 'Screenplay', 'Producer', 'Original Music Composer', 'Creator'].includes(c.job || c.department)
            ).slice(0, 5); // Top 5 key crew

            const people = [
                ...cast.map(/** @param {any} c @param {number} i */(c, i) => ({
                    tmdb_id: String(c.id), name: c.name,
                    photo: c.profile_path ? `https://image.tmdb.org/t/p/w185${c.profile_path}` : null,
                    role_type: 'actor', character: c.character || null, order: i
                })),
                ...crew.map(/** @param {any} c @param {number} i */(c, i) => ({
                    tmdb_id: String(c.id), name: c.name,
                    photo: c.profile_path ? `https://image.tmdb.org/t/p/w185${c.profile_path}` : null,
                    role_type: c.job === 'Director' ? 'director' : c.job === 'Writer' || c.job === 'Screenplay' ? 'writer' :
                        c.job === 'Producer' ? 'producer' : c.job === 'Original Music Composer' ? 'composer' : 'creator',
                    character: null, order: 100 + i
                }))
            ];

            db.transaction(() => {
                for (const p of people) {
                    let personId = null;
                    // Find by TMDb ID first
                    const existing = /** @type {any} */ (findPersonByTmdb.get(p.tmdb_id));
                    if (existing) {
                        personId = existing.id;
                        if (p.photo) updatePersonPhoto.run(p.photo, personId);
                    } else {
                        // No TMDB match — create new person
                        // (Don't fall back to name matching: different people can share a name)
                        const result = insertPerson.run(p.name, p.tmdb_id, p.photo);
                        personId = /** @type {number} */ (result.lastInsertRowid);
                    }

                    upsertCredit.run(personId, item.id, p.role_type, p.character, p.order);
                }
            })();

            enriched++;
            // Rate limit: 150ms between TMDb requests
            await new Promise(r => setTimeout(r, 150));
        } catch (e) {
            console.warn(`[arr-sync] TMDb enrich failed for tmdb:${item.tmdb_id}:`, e instanceof Error ? e.message : e);
        }
    }

    return enriched;
}

/**
 * Sync all configured *arr services.
 * Reads URL/API keys from app_settings and syncs each one.
 * @returns {Promise<{ results: Record<string, { matched: number, total: number, errors: string[] }> }>}
 */
export async function syncAllArr() {
    const settings = /** @type {any} */ (db.prepare(
        'SELECT radarr_url, radarr_api_key, sonarr_url, sonarr_api_key, lidarr_url, lidarr_api_key FROM app_settings WHERE id = 1'
    ).get());

    if (!settings) return { results: {} };

    /** @type {Record<string, { matched: number, total: number, errors: string[] }>} */
    const results = {};

    const services = [
        { service: 'radarr', url: settings.radarr_url, apiKey: settings.radarr_api_key },
        { service: 'sonarr', url: settings.sonarr_url, apiKey: settings.sonarr_api_key },
        { service: 'lidarr', url: settings.lidarr_url, apiKey: settings.lidarr_api_key },
    ];

    for (const { service, url, apiKey } of services) {
        if (!url || !apiKey) continue;
        try {
            results[service] = await syncArrService(service, url, apiKey);
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            results[service] = { matched: 0, total: 0, errors: [msg] };
            console.error(`[arr-sync] ${service} error:`, msg);
        }
    }

    return { results };
}

/**
 * Fetch quality profiles and root folders from all configured *arr services.
 * Used by the UI to populate dropdowns for add/configure flows.
 * @returns {Promise<Record<string, { profiles: any[], rootFolders: any[], metadataProfiles?: any[] }>>}
 */
export async function fetchArrOptions() {
    const settings = /** @type {any} */ (db.prepare(
        'SELECT radarr_url, radarr_api_key, sonarr_url, sonarr_api_key, lidarr_url, lidarr_api_key FROM app_settings WHERE id = 1'
    ).get());

    if (!settings) return {};

    /** @type {Record<string, { profiles: any[], rootFolders: any[], metadataProfiles?: any[] }>} */
    const options = {};

    const services = [
        { service: 'radarr', url: settings.radarr_url, apiKey: settings.radarr_api_key },
        { service: 'sonarr', url: settings.sonarr_url, apiKey: settings.sonarr_api_key },
        { service: 'lidarr', url: settings.lidarr_url, apiKey: settings.lidarr_api_key },
    ];

    for (const { service, url, apiKey } of services) {
        if (!url || !apiKey) continue;
        try {
            const [profiles, rootFolders] = await Promise.all([
                arrFetch(url, apiKey, service, 'qualityprofile'),
                arrFetch(url, apiKey, service, 'rootfolder'),
            ]);

            /** @type {any} */
            const entry = { profiles, rootFolders };

            // Lidarr also has metadata profiles
            if (service === 'lidarr') {
                try {
                    entry.metadataProfiles = await arrFetch(url, apiKey, service, 'metadataprofile');
                } catch { /* optional */ }
            }

            options[service] = entry;
        } catch (e) {
            console.warn(`[arr-sync] Failed to fetch options for ${service}:`, e);
        }
    }

    return options;
}
