import db from '$lib/server/db.js';
import { getJellyfinApis, getItemsApi, getSystemApi, getTvShowsApi } from '$lib/server/jellyfin.js';
import { logError, logInfo, logWarn } from '$lib/server/logger.js';
import { logActivity } from '$lib/server/activity-log.js';
import { slugify, ensureUniqueSlug, episodeSlug } from '$lib/server/slugify.js';
import { migrateRatings } from '$lib/server/ratings-engine.js';

/** @type {Set<(data: any) => void>} */
const listeners = new Set();

/** @type {{ running: boolean, paused: boolean, abortController: AbortController | null }} */
let engineState = {
    running: false,
    paused: false,
    abortController: null,
    libraryName: '',
    progress: 0,
    itemsSynced: 0,
    errors: 0
};

/** @type {Array<{time: string, message: string, type: string}>} */
let recentLogs = [];

/** @type {number|null} */
let syncHistoryId = null;

function broadcast(data) {
    // Capture logs and state updates
    if (data.log) {
        recentLogs.push({ time: new Date().toLocaleTimeString(), message: data.log, type: data.logType || 'info' });
        if (recentLogs.length > 5000) recentLogs = recentLogs.slice(-4000);
    }
    if (data.libraryName) engineState.libraryName = data.libraryName;
    if (data.libProgress !== undefined) engineState.progress = data.libProgress;
    if (data.totalSynced !== undefined) engineState.itemsSynced = data.totalSynced;
    if (data.errors !== undefined) engineState.errors = data.errors;
    if (data.totalErrors !== undefined) engineState.errors = data.totalErrors;

    for (const listener of listeners) {
        try {
            listener(data);
        } catch {
            listeners.delete(listener);
        }
    }
}

function updateSyncState(updates) {
    const fields = [];
    const values = [];
    for (const [key, value] of Object.entries(updates)) {
        fields.push(`${key} = ?`);
        values.push(value);
    }
    values.push(1);
    db.prepare(`UPDATE sync_state SET ${fields.join(', ')} WHERE id = ?`).run(...values);
}

function formatDuration(ms) {
    if (ms < 1000) return `${ms}ms`;
    const totalSec = ms / 1000;
    if (totalSec < 60) return `${totalSec.toFixed(1)}s`;
    const min = Math.floor(totalSec / 60);
    const sec = Math.round(totalSec % 60);
    if (min < 60) return sec > 0 ? `${min}m ${sec}s` : `${min}m`;
    const hr = Math.floor(min / 60);
    const remMin = min % 60;
    return remMin > 0 ? `${hr}h ${remMin}m` : `${hr}h`;
}

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitWhilePaused() {
    while (engineState.paused && engineState.running) {
        await sleep(500);
    }
}

/**
 * Fetch items from a Jellyfin library using the SDK (Axios), paginated in batches.
 */
async function fetchJellyfinItems(api, libraryId, mediaType) {
    let itemType = '';
    if (mediaType === 'tvshows') itemType = 'Series';
    else if (mediaType === 'movies') itemType = 'Movie';
    else if (mediaType === 'music') itemType = 'MusicArtist';

    const BATCH_SIZE = 100;
    let startIndex = 0;
    let totalCount = null;
    const allItems = [];

    const itemsApi = getItemsApi(api);

    // Quick connectivity check
    broadcast({ type: 'progress', log: `  🔗 Connecting to Jellyfin...`, logType: 'info' });
    try {
        const pingStart = Date.now();
        const sysInfo = await getSystemApi(api).getPublicSystemInfo();
        const pingTime = Date.now() - pingStart;
        broadcast({ type: 'progress', log: `  ✅ Server reachable (${formatDuration(pingTime)}) — ${sysInfo.data.ServerName} v${sysInfo.data.Version}`, logType: 'info' });
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        const code = e?.code || 'N/A';
        const status = e?.response?.status || 'N/A';
        const responseData = e?.response?.data ? JSON.stringify(e.response.data).slice(0, 200) : 'N/A';
        console.error(`[sync][DEBUG] Jellyfin connectivity check FAILED:`);
        console.error(`[sync][DEBUG]   Error message: ${msg}`);
        console.error(`[sync][DEBUG]   Error code: ${code}`);
        console.error(`[sync][DEBUG]   HTTP status: ${status}`);
        console.error(`[sync][DEBUG]   Response data: ${responseData}`);
        if (e?.cause) console.error(`[sync][DEBUG]   Cause:`, e.cause);
        broadcast({ type: 'error', log: `  ❌ Cannot reach Jellyfin: ${msg} (code: ${code}, status: ${status})`, logType: 'error' });
        return [];
    }

    while (true) {
        if (!engineState.running) return allItems;

        const fetchStart = Date.now();
        const endIndex = totalCount != null ? Math.min(startIndex + BATCH_SIZE, totalCount) : startIndex + BATCH_SIZE;
        broadcast({ type: 'progress', log: `  ⏳ Fetching ${itemType} ${startIndex}-${endIndex}...`, logType: 'info' });

        try {
            const res = await itemsApi.getItems({
                parentId: libraryId,
                includeItemTypes: [itemType],
                recursive: true,
                fields: ['ProviderIds', 'Overview', 'ProductionYear', 'DateLastMediaAdded', 'People'],
                enableUserData: true,
                startIndex,
                limit: BATCH_SIZE
            });

            const fetchTime = Date.now() - fetchStart;
            const data = res.data;
            const items = data.Items || [];
            totalCount = data.TotalRecordCount;

            allItems.push(...items);

            if (items.length > 0) {
                broadcast({
                    type: 'progress',
                    log: `  📦 Fetched ${allItems.length}/${totalCount} ${itemType} (${formatDuration(fetchTime)})`,
                    fetchTime,
                    logType: 'info'
                });
            }

            if (items.length < BATCH_SIZE) break;
            startIndex += BATCH_SIZE;

            await sleep(100);
        } catch (e) {
            const fetchTime = Date.now() - fetchStart;
            const msg = e instanceof Error ? e.message : String(e);
            const httpStatus = e?.response?.status || (msg.includes('401') ? 401 : null);

            if (httpStatus === 401) {
                // Jellyfin token is expired/invalid — flag it globally
                console.error(`[sync] Jellyfin returned 401 — access token is invalid`);
                try { db.prepare("UPDATE app_settings SET jellyfin_auth_status = 'invalid' WHERE id = 1").run(); } catch { /* */ }
                broadcast({ type: 'auth_error', log: `🔑 Jellyfin credentials expired — re-authenticate in Settings → Account`, logType: 'error' });
                return [];
            }

            console.error(`[sync] Failed to fetch ${itemType} batch at ${startIndex} after ${formatDuration(fetchTime)}:`, msg);
            broadcast({ type: 'error', log: `Failed to fetch ${itemType} (batch at ${startIndex}, ${formatDuration(fetchTime)}): ${msg}`, logType: 'error' });
            break;
        }
    }

    console.log(`[sync] Got ${allItems.length} ${itemType} items (total: ${totalCount})`);
    return allItems;
}

/**
 * Fetch ALL episodes for a TV series using the Shows API (includes virtual/missing episodes).
 * The /Items endpoint does NOT return virtual episodes; only /Shows/{id}/Episodes does.
 */
async function fetchJellyfinEpisodes(api, seriesId, userId) {
    try {
        const res = await getTvShowsApi(api).getEpisodes({
            seriesId,
            userId,
            fields: ['ProviderIds'],
            enableUserData: true,
            startIndex: 0,
            limit: 10000
        });
        return res.data.Items || [];
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`[sync] Failed to fetch episodes for ${seriesId}:`, msg);
        return [];
    }
}

/**
 * Fetch albums for a music artist using the SDK.
 */
async function fetchJellyfinAlbums(api, artistId) {
    try {
        const res = await getItemsApi(api).getItems({
            artistIds: [artistId],
            includeItemTypes: ['MusicAlbum'],
            recursive: true,
            fields: ['ProviderIds', 'ProductionYear'],
            enableUserData: true,
            startIndex: 0,
            limit: 10000
        });
        return res.data.Items || [];
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`[sync] Failed to fetch albums for ${artistId}:`, msg);
        return [];
    }
}

/**
 * Fetch tracks for an album (or all tracks for an artist if artistId is provided).
 * When albumId is null and artistId is set, fetches ALL tracks for the artist in one call.
 */
async function fetchJellyfinTracks(api, albumId, artistId = null) {
    try {
        const params = {
            includeItemTypes: ['Audio'],
            recursive: true,
            fields: ['ProviderIds'],
            enableUserData: true,
            startIndex: 0,
            limit: 10000
        };
        if (albumId) {
            params.parentId = albumId;
        } else if (artistId) {
            params.artistIds = [artistId];
        }
        const res = await getItemsApi(api).getItems(params);
        return res.data.Items || [];
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`[sync] Failed to fetch tracks for ${albumId || artistId}:`, msg);
        return [];
    }
}

function getWatchStatus(userData) {
    if (!userData) return 'unwatched';
    if (userData.Played) return 'watched';
    if (userData.PlaybackPositionTicks > 0) return 'in_progress';
    return 'unwatched';
}

export async function startSync(libraryId = null, force = false) {
    if (engineState.running) return;

    engineState.running = true;
    engineState.paused = false;
    engineState.abortController = new AbortController();
    engineState.libraryName = '';
    engineState.progress = 0;
    engineState.itemsSynced = 0;
    engineState.errors = 0;
    recentLogs = [];

    // Record sync start
    const histResult = db.prepare(
        `INSERT INTO sync_history (sync_type, status, started_at) VALUES ('jellyfin', 'running', ?)`
    ).run(new Date().toISOString());
    syncHistoryId = Number(histResult.lastInsertRowid);


    const settings = db.prepare('SELECT * FROM app_settings WHERE id = 1').get();
    const user = db.prepare('SELECT * FROM users LIMIT 1').get();

    let libraries;
    if (libraryId) {
        libraries = db.prepare('SELECT * FROM libraries WHERE is_tracked = 1 AND jellyfin_id = ?').all(libraryId);
    } else {
        libraries = db.prepare('SELECT * FROM libraries WHERE is_tracked = 1').all();
    }

    if (!settings?.jellyfin_url || !user) {
        broadcast({ type: 'error', message: 'Missing Jellyfin configuration or user.' });
        engineState.running = false;
        return;
    }

    const jellyfinUrl = settings.jellyfin_url;
    const accessToken = user.jellyfin_access_token || '';
    const userId = user.jellyfin_user_id || '';

    // === DEBUG: Verbose connectivity logging ===
    const debugLines = [
        `========================================`,
        `Jellyfin URL from DB: "${jellyfinUrl}"`,
        `Access token present: ${!!accessToken} (length: ${accessToken.length})`,
        `User ID: ${userId}`,
        `Libraries to sync: ${libraries.length}`,
    ];
    libraries.forEach((lib, i) => debugLines.push(`  ${i}: ${lib.name} (${lib.media_type}) jellyfin_id=${lib.jellyfin_id}`));

    for (const line of debugLines) {
        console.log(`[sync][DEBUG] ${line}`);
        logInfo('sync', line);
    }

    // Try DNS resolution of the Jellyfin host
    try {
        const url = new URL(jellyfinUrl);
        const dnsMsg = `Parsed URL — protocol: ${url.protocol}, hostname: ${url.hostname}, port: ${url.port || '(default)'}`;
        console.log(`[sync][DEBUG] ${dnsMsg}`);
        logInfo('sync', dnsMsg);
        const dns = await import('dns');
        dns.lookup(url.hostname, (err, address, family) => {
            if (err) {
                const msg = `DNS lookup FAILED for "${url.hostname}": ${err.message}`;
                console.log(`[sync][DEBUG] ${msg}`);
                logError('sync', msg);
            } else {
                const msg = `DNS lookup OK for "${url.hostname}" → ${address} (IPv${family})`;
                console.log(`[sync][DEBUG] ${msg}`);
                logInfo('sync', msg);
            }
        });
    } catch (e) {
        const msg = `URL parse or DNS check error: ${e instanceof Error ? e.message : String(e)}`;
        console.log(`[sync][DEBUG] ${msg}`);
        logError('sync', msg);
    }

    broadcast({ type: 'progress', log: `🔧 DEBUG: Using Jellyfin URL: ${jellyfinUrl}`, logType: 'info' });
    // === END DEBUG ===

    // Create the SDK API instance (uses Axios, no fetch/DNS issues)
    const { api } = getJellyfinApis(jellyfinUrl, accessToken);

    let totalSynced = 0;
    let totalErrors = 0;
    /** @type {string[]} */
    let totalErrorMessages = [];

    updateSyncState({ status: 'syncing', progress_percent: 0 });

    const upsertParent = db.prepare(`
		INSERT INTO media_parents (jellyfin_id, library_id, title, media_type, tvdb_id, tmdb_id, imdb_id, musicbrainz_id, release_year, poster_url, overview, jellyfin_user_rating, total_released_children, collected_children, date_last_modified, jellyfin_child_count, unplayed_count, is_favorite)
		VALUES (@jellyfinId, @libraryId, @title, @mediaType, @tvdbId, @tmdbId, @imdbId, @musicbrainzId, @releaseYear, @posterUrl, @overview, @userRating, @totalReleased, @collectedChildren, @dateLastModified, @jellyfinChildCount, @unplayedCount, @isFavorite)
		ON CONFLICT(jellyfin_id) DO UPDATE SET
			title = @title, tvdb_id = @tvdbId, tmdb_id = @tmdbId, imdb_id = @imdbId, musicbrainz_id = @musicbrainzId,
			release_year = @releaseYear, poster_url = @posterUrl, overview = @overview, jellyfin_user_rating = @userRating,
			total_released_children = @totalReleased,
			collected_children = CASE WHEN (SELECT COUNT(*) FROM media_children WHERE parent_id = media_parents.id AND is_special = 0) > 0
				THEN (SELECT COUNT(*) FROM media_children WHERE parent_id = media_parents.id AND is_collected = 1 AND is_special = 0)
				ELSE @collectedChildren END,
			date_last_modified = @dateLastModified, jellyfin_child_count = @jellyfinChildCount, unplayed_count = @unplayedCount, is_favorite = @isFavorite,
			collection_status = CASE WHEN collection_status = 'external' THEN 'collected' ELSE collection_status END
	`);

    const upsertChild = db.prepare(`
		INSERT INTO media_children (parent_id, jellyfin_id, title, season_number, item_number, is_special, is_collected, watch_status, play_count, runtime_ticks, premiere_date, musicbrainz_id, poster_url, community_rating)
		VALUES (@parentId, @jellyfinId, @title, @seasonNumber, @itemNumber, @isSpecial, 1, @watchStatus, @playCount, @runtimeTicks, @premiereDate, @musicbrainzId, @posterUrl, @communityRating)
		ON CONFLICT(jellyfin_id) DO UPDATE SET
			title = @title, season_number = @seasonNumber, item_number = @itemNumber,
			is_special = @isSpecial, is_collected = 1, watch_status = @watchStatus,
			play_count = @playCount, runtime_ticks = @runtimeTicks, premiere_date = @premiereDate,
			musicbrainz_id = COALESCE(@musicbrainzId, musicbrainz_id),
			poster_url = COALESCE(@posterUrl, poster_url),
			community_rating = COALESCE(@communityRating, community_rating)
	`);

    const upsertMissingChild = db.prepare(`
		INSERT INTO media_children (parent_id, jellyfin_id, title, season_number, item_number, is_special, is_collected, watch_status, play_count, runtime_ticks, premiere_date)
		VALUES (@parentId, @jellyfinId, @title, @seasonNumber, @itemNumber, @isSpecial, 0, 'unwatched', 0, 0, @premiereDate)
		ON CONFLICT(jellyfin_id) DO UPDATE SET
			title = @title, season_number = @seasonNumber, item_number = @itemNumber,
			is_special = @isSpecial, is_collected = 0, premiere_date = @premiereDate
	`);

    const getParentId = db.prepare('SELECT id, date_last_modified, jellyfin_child_count, unplayed_count, total_released_children, collected_children FROM media_parents WHERE jellyfin_id = ?');
    const getChildId = db.prepare('SELECT id FROM media_children WHERE jellyfin_id = ?');
    const countChildren = db.prepare('SELECT COUNT(*) as c FROM media_children WHERE parent_id = ? AND is_special = 0');

    const upsertTrack = db.prepare(`
        INSERT INTO tracks (album_id, jellyfin_id, title, track_number, disc_number, runtime_ticks, musicbrainz_id)
        VALUES (@albumId, @jellyfinId, @title, @trackNumber, @discNumber, @runtimeTicks, @musicbrainzId)
        ON CONFLICT(jellyfin_id) DO UPDATE SET
            title = @title, track_number = @trackNumber, disc_number = @discNumber,
            runtime_ticks = @runtimeTicks, musicbrainz_id = @musicbrainzId
    `);

    const updateParentCounts = db.prepare(`
		UPDATE media_parents SET
			collected_children = (SELECT COUNT(*) FROM media_children WHERE parent_id = media_parents.id AND is_collected = 1 AND is_special = 0),
			watched_children = (SELECT COUNT(*) FROM media_children WHERE parent_id = media_parents.id AND watch_status = 'watched' AND is_special = 0)
		WHERE id = ?
	`);

    const updateTotalReleased = db.prepare(
        'UPDATE media_parents SET total_released_children = ? WHERE id = ?'
    );

    /**
     * Ensure a media_parents row has a slug; generate and save one if missing.
     * @param {number} parentId
     * @param {string} title
     * @param {string} mediaType
     * @param {number|null} releaseYear
     */
    function ensureParentSlug(parentId, title, mediaType, releaseYear) {
        const row = /** @type {any} */ (db.prepare('SELECT slug FROM media_parents WHERE id = ?').get(parentId));
        if (row?.slug) return; // already has a slug
        const addYear = (mediaType === 'movie' || mediaType === 'show') ? releaseYear : null;
        const base = slugify(title || 'untitled', addYear);
        const slug = ensureUniqueSlug(db, 'media_parents', base, parentId);
        db.prepare('UPDATE media_parents SET slug = ? WHERE id = ?').run(slug, parentId);
    }

    /**
     * When merging rows, adopt the older row's slug onto the surviving row.
     * This preserves URLs that users may have bookmarked.
     * @param {string} table - 'media_parents' or 'persons'
     * @param {number} oldId - Row being deleted
     * @param {number} survivingId - Row being kept
     */
    function adoptSlug(table, oldId, survivingId) {
        const oldRow = /** @type {any} */ (db.prepare(`SELECT slug FROM ${table} WHERE id = ?`).get(oldId));
        if (!oldRow?.slug) return;
        const survivingRow = /** @type {any} */ (db.prepare(`SELECT slug FROM ${table} WHERE id = ?`).get(survivingId));
        // Only adopt if surviving row has no slug or a generic one
        if (!survivingRow?.slug || survivingRow.slug.startsWith('untitled')) {
            db.prepare(`UPDATE ${table} SET slug = ? WHERE id = ?`).run(oldRow.slug, survivingId);
        }
    }

    /**
     * Ensure a persons row has a slug; generate and save one if missing.
     * @param {number} personId
     * @param {string} name
     */
    function ensurePersonSlug(personId, name) {
        const row = /** @type {any} */ (db.prepare('SELECT slug FROM persons WHERE id = ?').get(personId));
        if (row?.slug) return;
        const base = slugify(name || 'unknown');
        const slug = ensureUniqueSlug(db, 'persons', base, personId);
        db.prepare('UPDATE persons SET slug = ? WHERE id = ?').run(slug, personId);
    }

    /**
     * Ensure a media_children row has a slug; generate and save one if missing.
     * For TV episodes, uses s01e05-title format. For music albums, uses title-based slugs.
     * @param {number} childId
     * @param {string} title
     */
    function ensureChildSlug(childId, title) {
        const row = /** @type {any} */ (db.prepare('SELECT slug, parent_id, season_number, item_number FROM media_children WHERE id = ?').get(childId));
        if (row?.slug) return;
        // Check if this is a TV show episode
        const parent = /** @type {any} */ (db.prepare('SELECT media_type FROM media_parents WHERE id = ?').get(row?.parent_id));
        let slug;
        if (parent?.media_type === 'show' && row?.season_number != null && row?.item_number != null) {
            slug = episodeSlug(row.season_number, row.item_number, title);
        } else {
            const base = slugify(title || 'untitled');
            slug = ensureUniqueSlug(db, 'media_children', base, childId);
        }
        db.prepare('UPDATE media_children SET slug = ? WHERE id = ?').run(slug, childId);
    }

    // Person upsert: check-then-insert/update to avoid ON CONFLICT with partial unique indexes
    const findPersonByTmdb = db.prepare('SELECT id FROM persons WHERE tmdb_person_id = ?');
    const findPersonByJellyfin = db.prepare('SELECT id FROM persons WHERE jellyfin_id = ?');
    // NOTE: findPersonByName removed — name-only matching causes collisions (e.g. two different "Emma Watson" actors)
    const insertPerson = db.prepare(`
        INSERT INTO persons (name, tmdb_person_id, imdb_person_id, jellyfin_id, photo_url)
        VALUES (@name, @tmdbPersonId, @imdbPersonId, @jellyfinId, @photoUrl)
    `);
    const updatePersonByTmdb = db.prepare(`
        UPDATE persons SET name = @name,
            imdb_person_id = COALESCE(@imdbPersonId, imdb_person_id),
            jellyfin_id = COALESCE(@jellyfinId, jellyfin_id),
            photo_url = COALESCE(@photoUrl, photo_url)
        WHERE tmdb_person_id = @tmdbPersonId
    `);
    const updatePersonByJellyfin = db.prepare(`
        UPDATE persons SET name = @name,
            photo_url = COALESCE(@photoUrl, photo_url)
        WHERE jellyfin_id = @jellyfinId
    `);
    const upsertCredit = db.prepare(`
        INSERT OR IGNORE INTO person_credits (person_id, media_parent_id, role_type, character_name, sort_order)
        VALUES (@personId, @mediaParentId, @roleType, @characterName, @sortOrder)
    `);

    /**
     * Process People array from a Jellyfin item and upsert persons + credits.
     * @param {any[]} people - Jellyfin People array
     * @param {number} mediaParentId - DB media_parents.id
     */
    function syncPeopleForItem(people, mediaParentId) {
        if (!people || !Array.isArray(people) || people.length === 0) return;

        for (let idx = 0; idx < people.length; idx++) {
            const person = people[idx];
            const name = person.Name;
            if (!name) continue;

            const providerIds = person.ProviderIds || {};
            const tmdbId = providerIds.Tmdb || null;
            const imdbId = providerIds.Imdb || null;
            const jellyfinPersonId = person.Id || null;
            const photoUrl = person.PrimaryImageTag && jellyfinPersonId
                ? `${jellyfinUrl}/Items/${jellyfinPersonId}/Images/Primary`
                : null;

            // Map Jellyfin person type to our role_type
            const typeMap = {
                'Actor': 'actor', 'Director': 'director', 'Writer': 'writer',
                'Producer': 'producer', 'Composer': 'composer', 'GuestStar': 'guest',
                'Creator': 'creator', 'Conductor': 'conductor', 'Lyricist': 'lyricist'
            };
            const roleType = typeMap[person.Type] || person.Type?.toLowerCase() || 'other';
            const characterName = person.Role || null;

            try {
                let personId;
                const params = { name, tmdbPersonId: tmdbId, imdbPersonId: imdbId, jellyfinId: jellyfinPersonId, photoUrl };
                if (tmdbId) {
                    const existing = /** @type {any} */ (findPersonByTmdb.get(tmdbId));
                    if (existing) {
                        updatePersonByTmdb.run(params);
                        personId = existing.id;
                    } else {
                        try {
                            insertPerson.run(params);
                            personId = /** @type {any} */ (findPersonByTmdb.get(tmdbId))?.id;
                        } catch {
                            // UNIQUE constraint — another row got this tmdb_person_id
                            const retry = /** @type {any} */ (findPersonByTmdb.get(tmdbId));
                            if (retry) {
                                updatePersonByTmdb.run(params);
                                personId = retry.id;
                            }
                        }
                    }
                } else if (jellyfinPersonId) {
                    // No TMDB ID — try matching by Jellyfin ID
                    const existing = /** @type {any} */ (findPersonByJellyfin.get(jellyfinPersonId));
                    if (existing) {
                        updatePersonByJellyfin.run({ name, jellyfinId: jellyfinPersonId, photoUrl });
                        personId = existing.id;
                    } else {
                        // No Jellyfin match either — create new person
                        // (Don't fall back to name matching: different people can share a name)
                        try {
                            insertPerson.run(params);
                            personId = /** @type {any} */ (findPersonByJellyfin.get(jellyfinPersonId))?.id;
                        } catch {
                            // constraint error — skip
                        }
                    }
                }

                if (personId) {
                    ensurePersonSlug(personId, name);
                    upsertCredit.run({
                        personId,
                        mediaParentId,
                        roleType,
                        characterName,
                        sortOrder: idx
                    });
                }
            } catch (e) {
                // Non-fatal: log and continue
                console.error(`[sync] Failed to upsert person ${name}:`, e instanceof Error ? e.message : String(e));
            }
        }
    }

    try {
        // Sync each library separately with per-library progress
        for (let libIdx = 0; libIdx < libraries.length; libIdx++) {
            const lib = libraries[libIdx];
            if (!engineState.running) return;
            await waitWhilePaused();

            // Broadcast library start
            broadcast({
                type: 'library_start',
                libraryIndex: libIdx,
                libraryCount: libraries.length,
                libraryName: lib.name,
                mediaType: lib.media_type,
                log: `📚 Starting library: ${lib.name} (${lib.media_type})`,
                logType: 'info'
            });

            // Fetch parent items for this library (SDK/Axios)
            const items = await fetchJellyfinItems(api, lib.jellyfin_id, lib.media_type);
            const parentCount = items.length;
            let libSynced = 0;
            let libErrors = 0;
            /** @type {string[]} */
            let libErrorMessages = [];

            const itemLabel = lib.media_type === 'tvshows' ? 'shows' : lib.media_type === 'movies' ? 'movies' : 'artists';

            if (parentCount === 0) {
                libErrors++;
                totalErrors++;
                broadcast({
                    type: 'library_count',
                    libraryIndex: libIdx,
                    libraryName: lib.name,
                    parentCount: 0,
                    log: `⚠️ Found 0 ${itemLabel} in ${lib.name} — fetch may have failed (check Jellyfin connectivity)`,
                    logType: 'warning'
                });
            } else {
                broadcast({
                    type: 'library_count',
                    libraryIndex: libIdx,
                    libraryName: lib.name,
                    parentCount,
                    log: `Found ${parentCount} ${itemLabel} in ${lib.name}`,
                    logType: 'info'
                });
            }

            const libStart = Date.now();
            /** @type {number[]} */
            const itemTimes = [];

            for (let i = 0; i < items.length; i++) {
                const item = items[i];
                const itemStart = Date.now();
                if (!engineState.running) return;
                await waitWhilePaused();

                try {
                    const providerIds = item.ProviderIds || {};

                    // ── Capture pre-upsert values for skip detection ────────────
                    // IMPORTANT: Must read BEFORE upsertParent overwrites these fields,
                    // otherwise the comparison is always equal and children never re-sync.
                    const preUpsertRow = /** @type {any} */ (getParentId.get(item.Id));
                    const preStoredDateModified = preUpsertRow?.date_last_modified || null;
                    const preStoredChildCount = preUpsertRow?.jellyfin_child_count || 0;
                    const preStoredUnplayed = preUpsertRow?.unplayed_count ?? -1;
                    const preStoredTotalReleased = preUpsertRow?.total_released_children || 0;
                    const preStoredCollected = preUpsertRow?.collected_children || 0;

                    const parentParams = {
                        jellyfinId: item.Id,
                        libraryId: lib.jellyfin_id,
                        title: item.Name,
                        mediaType: lib.media_type === 'tvshows' ? 'show' : lib.media_type === 'movies' ? 'movie' : 'artist',
                        tvdbId: providerIds.Tvdb || null,
                        tmdbId: providerIds.Tmdb || null,
                        imdbId: providerIds.Imdb || null,
                        musicbrainzId: providerIds.MusicBrainzArtist || providerIds.MusicBrainzAlbum || null,
                        releaseYear: item.ProductionYear || null,
                        posterUrl: item.ImageTags?.Primary ? `${jellyfinUrl}/Items/${item.Id}/Images/Primary` : null,
                        overview: item.Overview || null,
                        userRating: item.UserData?.Rating || null,
                        totalReleased: item.RecursiveItemCount || 0,
                        collectedChildren: item.RecursiveItemCount || 0,
                        dateLastModified: item.DateLastMediaAdded || item.DateModified || null,
                        jellyfinChildCount: item.ChildCount || 0,
                        unplayedCount: item.UserData?.UnplayedItemCount ?? null,
                        isFavorite: item.UserData?.IsFavorite ? 1 : 0
                    };

                    try {
                        // ── Re-link stale Jellyfin IDs ─────────────────────────────
                        // When a file moves, Jellyfin assigns a new ID. Check if we
                        // already have this item by TMDB/IMDB but with an old jellyfin_id.
                        // ONLY re-link when exactly ONE parent matches — if multiple
                        // parents share the same external ID, re-linking is ambiguous
                        // and would cause ping-ponging (A→B then B→A each sync).
                        const existingByJellyfinId = getParentId.get(item.Id);
                        if (!existingByJellyfinId) {
                            // No match by new jellyfin_id — check external IDs
                            let staleParent = null;
                            if (parentParams.tmdbId) {
                                const count = /** @type {any} */ (db.prepare(
                                    'SELECT COUNT(*) as c FROM media_parents WHERE tmdb_id = ? AND media_type = ?'
                                ).get(parentParams.tmdbId, parentParams.mediaType));
                                if (count?.c === 1) {
                                    staleParent = /** @type {any} */ (db.prepare(
                                        'SELECT id, jellyfin_id FROM media_parents WHERE tmdb_id = ? AND media_type = ? AND (jellyfin_id IS NULL OR jellyfin_id != ?) LIMIT 1'
                                    ).get(parentParams.tmdbId, parentParams.mediaType, item.Id));
                                }
                            }
                            if (!staleParent && parentParams.imdbId) {
                                const count = /** @type {any} */ (db.prepare(
                                    'SELECT COUNT(*) as c FROM media_parents WHERE imdb_id = ? AND media_type = ?'
                                ).get(parentParams.imdbId, parentParams.mediaType));
                                if (count?.c === 1) {
                                    staleParent = /** @type {any} */ (db.prepare(
                                        'SELECT id, jellyfin_id FROM media_parents WHERE imdb_id = ? AND media_type = ? AND (jellyfin_id IS NULL OR jellyfin_id != ?) LIMIT 1'
                                    ).get(parentParams.imdbId, parentParams.mediaType, item.Id));
                                }
                            }
                            if (!staleParent && parentParams.tvdbId) {
                                const count = /** @type {any} */ (db.prepare(
                                    'SELECT COUNT(*) as c FROM media_parents WHERE tvdb_id = ? AND media_type = ?'
                                ).get(parentParams.tvdbId, parentParams.mediaType));
                                if (count?.c === 1) {
                                    staleParent = /** @type {any} */ (db.prepare(
                                        'SELECT id, jellyfin_id FROM media_parents WHERE tvdb_id = ? AND media_type = ? AND (jellyfin_id IS NULL OR jellyfin_id != ?) LIMIT 1'
                                    ).get(parentParams.tvdbId, parentParams.mediaType, item.Id));
                                }
                            }

                            if (staleParent) {
                                const oldJellyfinId = staleParent.jellyfin_id;
                                // Update parent jellyfin_id to new one
                                db.prepare('UPDATE media_parents SET jellyfin_id = ? WHERE id = ?').run(item.Id, staleParent.id);

                                if (oldJellyfinId) {
                                    // Re-link: item moved in Jellyfin (old ID → new ID)
                                    if (parentParams.mediaType === 'movie') {
                                        db.prepare('UPDATE media_children SET jellyfin_id = ? WHERE jellyfin_id = ?')
                                            .run(item.Id + '_child', oldJellyfinId + '_child');
                                    }
                                    db.prepare('UPDATE media_children SET jellyfin_id = ? WHERE jellyfin_id = ?')
                                        .run(item.Id, oldJellyfinId);

                                    broadcast({
                                        type: 'progress',
                                        log: `🔄 ${item.Name}: Jellyfin ID changed (${oldJellyfinId.slice(0, 8)}… → ${item.Id.slice(0, 8)}…), re-linked`,
                                        logType: 'info'
                                    });
                                    logInfo('sync', `Re-linked ${item.Name}: jellyfin_id ${oldJellyfinId} → ${item.Id}`);
                                } else {
                                    // Merge: external-only entry (from TMDb backfill) linked to Jellyfin
                                    broadcast({
                                        type: 'progress',
                                        log: `🔗 ${item.Name}: linked external-only entry to Jellyfin`,
                                        logType: 'info'
                                    });
                                    logInfo('sync', `Merged external-only entry for ${item.Name} (DB id=${staleParent.id}) with Jellyfin ${item.Id}`);
                                }
                            }
                        } else {
                            // ── Pre-merge: Jellyfin row exists, but incoming external IDs may clash ──
                            // When Jellyfin metadata is corrected (e.g. tmdb_id added/changed),
                            // ON CONFLICT(jellyfin_id) DO UPDATE would set tmdb_id on our row, but
                            // if a DIFFERENT row already holds that (tmdb_id, media_type), the UNIQUE
                            // constraint fires. Pre-absorb the conflicting row before the upsert.
                            const currentId = existingByJellyfinId.id;

                            const externalIdChecks = [
                                { field: 'tmdb_id', value: parentParams.tmdbId, label: 'TMDB' },
                                { field: 'imdb_id', value: parentParams.imdbId, label: 'IMDb' },
                            ];

                            for (const { field, value, label } of externalIdChecks) {
                                if (!value) continue;
                                const conflicting = /** @type {any} */ (db.prepare(
                                    `SELECT id, jellyfin_id, title FROM media_parents WHERE ${field} = ? AND media_type = ? AND id != ? LIMIT 1`
                                ).get(value, parentParams.mediaType, currentId));
                                if (!conflicting) continue;

                                // Another row holds this external ID — absorb it
                                try {
                                    // Migrate children
                                    const moved = db.prepare(
                                        'UPDATE media_children SET parent_id = ? WHERE parent_id = ?'
                                    ).run(currentId, conflicting.id);
                                    // Delete source person_credits
                                    db.prepare('DELETE FROM person_credits WHERE media_parent_id = ?')
                                        .run(conflicting.id);
                                    // Adopt slug and migrate ratings
                                    adoptSlug('media_parents', conflicting.id, currentId);
                                    migrateRatings(conflicting.id, currentId);
                                    // Delete conflicting row
                                    db.prepare('DELETE FROM media_parents WHERE id = ?').run(conflicting.id);

                                    broadcast({
                                        type: 'progress',
                                        log: `🔀 ${item.Name}: absorbed conflicting ${label} entry "${conflicting.title}" (id=${conflicting.id}, moved ${moved.changes} children)`,
                                        logType: 'info'
                                    });
                                    logInfo('sync', `Pre-merge: absorbed ${label} entry id=${conflicting.id} ("${conflicting.title}") into Jellyfin entry id=${currentId} for ${item.Name}`);
                                } catch (mergeErr) {
                                    const mergeErrStr = mergeErr instanceof Error ? mergeErr.message : String(mergeErr);
                                    broadcast({ type: 'progress', log: `  ⚠ ${item.Name}: ${label} pre-merge failed: ${mergeErrStr}`, logType: 'warning' });
                                    logWarn('sync', `${label} pre-merge failed for ${item.Name}: ${mergeErrStr}`);
                                }
                            }
                        }

                        upsertParent.run(parentParams);
                        // Ensure slug exists for newly inserted parents
                        const upsertedRow = /** @type {any} */ (getParentId.get(item.Id));
                        if (upsertedRow) ensureParentSlug(upsertedRow.id, parentParams.title, parentParams.mediaType, parentParams.releaseYear);
                    } catch (upsertErr) {
                        const errStr = String(upsertErr);
                        if (errStr.includes('UNIQUE constraint')) {
                            // Determine which ID caused the conflict and retry without it
                            const retryParams = { ...parentParams };
                            let conflictField = '';

                            if (errStr.includes('musicbrainz_id') && parentParams.musicbrainzId) {
                                conflictField = 'MusicBrainz ID';
                                const existing = /** @type {any} */ (db.prepare(
                                    'SELECT id, title, jellyfin_id FROM media_parents WHERE musicbrainz_id = ? AND media_type = ? LIMIT 1'
                                ).get(parentParams.musicbrainzId, parentParams.mediaType));

                                // Find/create the current Jellyfin row (without musicbrainz_id)
                                retryParams.musicbrainzId = null;
                                upsertParent.run(retryParams);
                                const currentRow = /** @type {any} */ (db.prepare(
                                    'SELECT id, title, musicbrainz_id FROM media_parents WHERE jellyfin_id = ?'
                                ).get(item.Id));
                                const currentId = currentRow?.id;

                                if (existing && currentId && existing.id !== currentId) {
                                    if (!existing.jellyfin_id) {
                                        // External-only row holds musicbrainz_id — auto-merge:
                                        // Move musicbrainz_id to the Jellyfin entry, migrate children, delete external
                                        try {
                                            // Migrate children from external to Jellyfin entry
                                            const moved = db.prepare(
                                                'UPDATE media_children SET parent_id = ? WHERE parent_id = ?'
                                            ).run(currentId, existing.id);
                                            // Delete source person_credits (target will re-sync its own)
                                            db.prepare('DELETE FROM person_credits WHERE media_parent_id = ?')
                                                .run(existing.id);
                                            // Adopt slug and migrate ratings before removing
                                            adoptSlug('media_parents', existing.id, currentId);
                                            migrateRatings(existing.id, currentId);
                                            db.prepare('DELETE FROM media_parents WHERE id = ?').run(existing.id);
                                            // Apply the correct musicbrainz_id to the Jellyfin entry
                                            db.prepare('UPDATE media_parents SET musicbrainz_id = ? WHERE id = ?')
                                                .run(parentParams.musicbrainzId, currentId);

                                            broadcast({ type: 'progress', log: `  🔀 ${item.Name}: auto-merged external MusicBrainz entry (moved ${moved.changes} children, adopted musicbrainz_id from id=${existing.id})`, logType: 'info' });
                                            logInfo('sync', `Auto-merged MusicBrainz entry: ${item.Name} (${parentParams.musicbrainzId}), deleted external id=${existing.id}`);
                                        } catch (mergeErr) {
                                            const mergeErrStr = mergeErr instanceof Error ? mergeErr.message : String(mergeErr);
                                            broadcast({ type: 'progress', log: `  ❌ ${item.Name}: MusicBrainz auto-merge failed: ${mergeErrStr}`, logType: 'error' });
                                            logWarn('sync', `MusicBrainz auto-merge failed for ${item.Name}: ${mergeErrStr}`);
                                        }
                                    } else {
                                        // Both rows have jellyfin_ids — genuinely two Jellyfin items sharing musicbrainz_id
                                        // Skip if this external_id was already resolved/dismissed
                                        const alreadyHandled = /** @type {any} */ (db.prepare(
                                            `SELECT 1 FROM sync_conflicts WHERE conflict_type = 'shared_musicbrainz_id' AND external_id = ? AND status = 'resolved' LIMIT 1`
                                        ).get(parentParams.musicbrainzId));
                                        if (!alreadyHandled) {
                                            try {
                                                db.prepare(
                                                    `INSERT OR IGNORE INTO sync_conflicts (conflict_type, primary_id, secondary_id, external_id, status)
                                                     VALUES ('shared_musicbrainz_id', ?, ?, ?, 'pending')`
                                                ).run(existing.id, currentId, parentParams.musicbrainzId);
                                            } catch { /* ignore duplicate */ }
                                            broadcast({ type: 'progress', log: `  ⚠ ${item.Name}: two Jellyfin items share MusicBrainz ID with ${existing.title} — resolve in Settings`, logType: 'warning' });
                                        }
                                    }
                                } else if (!existing) {
                                    broadcast({ type: 'progress', log: `  ⚠ ${item.Name}: shared MusicBrainz ID, syncing without it`, logType: 'warning' });
                                }
                            } else if (errStr.includes('tmdb_id') && parentParams.tmdbId) {
                                conflictField = 'TMDB ID';
                                // Find the OTHER parent that has this tmdb_id (the one we're conflicting with)
                                const existing = /** @type {any} */ (db.prepare(
                                    'SELECT id, title, jellyfin_id FROM media_parents WHERE tmdb_id = ? AND media_type = ? LIMIT 1'
                                ).get(parentParams.tmdbId, parentParams.mediaType));

                                // Find the current row (the one that matched jellyfin_id in the upsert)
                                const currentRow = /** @type {any} */ (db.prepare(
                                    'SELECT id, title, tmdb_id FROM media_parents WHERE jellyfin_id = ?'
                                ).get(item.Id));

                                broadcast({ type: 'progress', log: `  🔍 ${item.Name}: TMDB conflict debug — existing: id=${existing?.id} jf=${existing?.jellyfin_id?.slice(0,8)}, current: id=${currentRow?.id} tmdb=${currentRow?.tmdb_id}`, logType: 'info' });

                                if (existing && currentRow && existing.id !== currentRow.id) {
                                    // Two different parents: currentRow has our jellyfin_id, existing has our tmdb_id
                                    // Merge them: keep existing (which has tmdb_id), delete currentRow
                                    try {
                                        // Migrate children and history from currentRow to existing
                                        const keepChild = /** @type {any} */ (db.prepare(
                                            'SELECT id FROM media_children WHERE parent_id = ? LIMIT 1'
                                        ).get(existing.id));
                                        const staleChildren = /** @type {any[]} */ (db.prepare(
                                            'SELECT id FROM media_children WHERE parent_id = ?'
                                        ).all(currentRow.id));
                                        if (keepChild) {
                                            for (const sc of staleChildren) {
                                                db.prepare('UPDATE playback_history SET media_id = ? WHERE media_id = ?').run(keepChild.id, sc.id);
                                            }
                                        }
                                        db.prepare('DELETE FROM media_children WHERE parent_id = ?').run(currentRow.id);
                                        db.prepare('DELETE FROM person_credits WHERE media_parent_id = ?').run(currentRow.id);
                                        // Adopt slug and migrate ratings before removing
                                        adoptSlug('media_parents', currentRow.id, existing.id);
                                        migrateRatings(currentRow.id, existing.id);
                                        db.prepare('DELETE FROM media_parents WHERE id = ?').run(currentRow.id);

                                        // Now update the existing entry with fresh metadata and the current jellyfin_id
                                        db.prepare(`UPDATE media_parents SET
                                            jellyfin_id = ?, title = ?, poster_url = COALESCE(?, poster_url), overview = COALESCE(?, overview),
                                            release_year = ?, jellyfin_user_rating = ?,
                                            date_last_modified = ?, jellyfin_child_count = ?,
                                            unplayed_count = ?, is_favorite = ?,
                                            imdb_id = COALESCE(?, imdb_id),
                                            tvdb_id = COALESCE(?, tvdb_id)
                                        WHERE id = ?`).run(
                                            item.Id, parentParams.title, parentParams.posterUrl, parentParams.overview,
                                            parentParams.releaseYear, parentParams.userRating,
                                            parentParams.dateLastModified, parentParams.jellyfinChildCount,
                                            parentParams.unplayedCount, parentParams.isFavorite,
                                            parentParams.imdbId, parentParams.tvdbId,
                                            existing.id
                                        );

                                        // Update movie child jellyfin_id
                                        if (parentParams.mediaType === 'movie' && existing.jellyfin_id) {
                                            db.prepare('UPDATE media_children SET jellyfin_id = ? WHERE jellyfin_id = ?')
                                                .run(item.Id + '_child', existing.jellyfin_id + '_child');
                                        }

                                        broadcast({ type: 'progress', log: `  🔀 ${item.Name}: auto-merged TMDB duplicate (kept id=${existing.id}, deleted id=${currentRow.id})`, logType: 'info' });
                                        logInfo('sync', `Auto-merged TMDB duplicate: ${item.Name} (${parentParams.tmdbId})`);
                                    } catch (mergeErr) {
                                        const mergeErrStr = mergeErr instanceof Error ? mergeErr.message : String(mergeErr);
                                        broadcast({ type: 'progress', log: `  ❌ ${item.Name}: auto-merge failed: ${mergeErrStr}`, logType: 'error' });
                                        logWarn('sync', `TMDB auto-merge failed for ${item.Name}: ${mergeErrStr}`);
                                    }
                                } else if (existing && !currentRow && !existing.jellyfin_id) {
                                    // External-only row exists (from trakt/backfill import) with tmdb_id but no jellyfin_id.
                                    // Adopt it: set jellyfin_id and update metadata on the existing row.
                                    try {
                                        db.prepare(`UPDATE media_parents SET
                                            jellyfin_id = ?, library_id = ?, title = ?, poster_url = COALESCE(?, poster_url), overview = COALESCE(?, overview),
                                            release_year = ?, jellyfin_user_rating = ?,
                                            date_last_modified = ?, jellyfin_child_count = ?,
                                            unplayed_count = ?, is_favorite = ?,
                                            collection_status = CASE WHEN collection_status = 'external' THEN 'default' ELSE collection_status END,
                                            imdb_id = COALESCE(?, imdb_id),
                                            tvdb_id = COALESCE(?, tvdb_id)
                                        WHERE id = ?`).run(
                                            item.Id, parentParams.libraryId, parentParams.title, parentParams.posterUrl, parentParams.overview,
                                            parentParams.releaseYear, parentParams.userRating,
                                            parentParams.dateLastModified, parentParams.jellyfinChildCount,
                                            parentParams.unplayedCount, parentParams.isFavorite,
                                            parentParams.imdbId, parentParams.tvdbId,
                                            existing.id
                                        );

                                        // For movies, create the child entry if missing
                                        if (parentParams.mediaType === 'movie') {
                                            const existingChild = /** @type {any} */ (db.prepare(
                                                'SELECT id FROM media_children WHERE parent_id = ? LIMIT 1'
                                            ).get(existing.id));
                                            if (existingChild) {
                                                // Update existing child with jellyfin_id
                                                db.prepare('UPDATE media_children SET jellyfin_id = ? WHERE id = ?')
                                                    .run(item.Id + '_child', existingChild.id);
                                            }
                                        }

                                        broadcast({ type: 'progress', log: `  🔗 ${item.Name}: adopted external entry (id=${existing.id}) — linked to Jellyfin`, logType: 'info' });
                                        logInfo('sync', `Adopted external TMDB entry: ${item.Name} (${parentParams.tmdbId})`);
                                    } catch (adoptErr) {
                                        const adoptErrStr = adoptErr instanceof Error ? adoptErr.message : String(adoptErr);
                                        broadcast({ type: 'progress', log: `  ❌ ${item.Name}: adopt failed: ${adoptErrStr}`, logType: 'error' });
                                        logWarn('sync', `TMDB adopt failed for ${item.Name}: ${adoptErrStr}`);
                                    }
                                } else if (existing && !currentRow && existing.jellyfin_id) {
                                    // Existing row has a different jellyfin_id — the old Jellyfin item
                                    // was removed/re-added. Update existing to point to the new item.
                                    try {
                                        const oldJellyfinId = existing.jellyfin_id;
                                        db.prepare(`UPDATE media_parents SET
                                            jellyfin_id = ?, library_id = ?, title = ?, poster_url = COALESCE(?, poster_url), overview = COALESCE(?, overview),
                                            release_year = ?, jellyfin_user_rating = ?,
                                            date_last_modified = ?, jellyfin_child_count = ?,
                                            unplayed_count = ?, is_favorite = ?,
                                            imdb_id = COALESCE(?, imdb_id),
                                            tvdb_id = COALESCE(?, tvdb_id)
                                        WHERE id = ?`).run(
                                            item.Id, parentParams.libraryId, parentParams.title, parentParams.posterUrl, parentParams.overview,
                                            parentParams.releaseYear, parentParams.userRating,
                                            parentParams.dateLastModified, parentParams.jellyfinChildCount,
                                            parentParams.unplayedCount, parentParams.isFavorite,
                                            parentParams.imdbId, parentParams.tvdbId,
                                            existing.id
                                        );

                                        // Update movie child jellyfin_id
                                        if (parentParams.mediaType === 'movie' && oldJellyfinId) {
                                            db.prepare('UPDATE media_children SET jellyfin_id = ? WHERE jellyfin_id = ?')
                                                .run(item.Id + '_child', oldJellyfinId + '_child');
                                        }

                                        broadcast({ type: 'progress', log: `  🔗 ${item.Name}: Jellyfin ID updated on existing TMDB entry (${oldJellyfinId?.slice(0,8)}… → ${item.Id.slice(0,8)}…)`, logType: 'info' });
                                        logInfo('sync', `Re-linked TMDB entry: ${item.Name} (${parentParams.tmdbId}), jellyfin_id ${oldJellyfinId} → ${item.Id}`);
                                    } catch (relinkErr) {
                                        const relinkErrStr = relinkErr instanceof Error ? relinkErr.message : String(relinkErr);
                                        broadcast({ type: 'progress', log: `  ❌ ${item.Name}: re-link failed: ${relinkErrStr}`, logType: 'error' });
                                        logWarn('sync', `TMDB re-link failed for ${item.Name}: ${relinkErrStr}`);
                                    }
                                } else {
                                    // Truly unresolvable: existing has same jellyfin_id as incoming
                                    // (should not happen, but handle gracefully)
                                    broadcast({ type: 'progress', log: `  ⚠ ${item.Name}: TMDB conflict could not be resolved — existing: id=${existing?.id}, tmdb=${parentParams.tmdbId}`, logType: 'warning' });
                                }
                            } else if (errStr.includes('imdb_id') && parentParams.imdbId) {
                                conflictField = 'IMDb ID';
                                const existing = /** @type {any} */ (db.prepare(
                                    'SELECT id, title, jellyfin_id FROM media_parents WHERE imdb_id = ? LIMIT 1'
                                ).get(parentParams.imdbId));

                                // Find/create the current Jellyfin row (without imdb_id)
                                retryParams.imdbId = null;
                                upsertParent.run(retryParams);
                                const currentRow = /** @type {any} */ (db.prepare(
                                    'SELECT id, title FROM media_parents WHERE jellyfin_id = ?'
                                ).get(item.Id));
                                const currentId = currentRow?.id;

                                if (existing && currentId && existing.id !== currentId) {
                                    if (!existing.jellyfin_id) {
                                        // External-only row holds imdb_id — auto-merge
                                        try {
                                            db.prepare('UPDATE media_children SET parent_id = ? WHERE parent_id = ?')
                                                .run(currentId, existing.id);
                                            // Delete source person_credits (target will re-sync its own)
                                            db.prepare('DELETE FROM person_credits WHERE media_parent_id = ?')
                                                .run(existing.id);
                                            // Adopt slug and migrate ratings before removing
                                            adoptSlug('media_parents', existing.id, currentId);
                                            migrateRatings(existing.id, currentId);
                                            db.prepare('DELETE FROM media_parents WHERE id = ?').run(existing.id);
                                            db.prepare('UPDATE media_parents SET imdb_id = ? WHERE id = ?')
                                                .run(parentParams.imdbId, currentId);

                                            broadcast({ type: 'progress', log: `  🔀 ${item.Name}: auto-merged external IMDb entry (adopted imdb_id from id=${existing.id})`, logType: 'info' });
                                            logInfo('sync', `Auto-merged IMDb entry: ${item.Name} (${parentParams.imdbId}), deleted external id=${existing.id}`);
                                        } catch (mergeErr) {
                                            const mergeErrStr = mergeErr instanceof Error ? mergeErr.message : String(mergeErr);
                                            broadcast({ type: 'progress', log: `  ❌ ${item.Name}: IMDb auto-merge failed: ${mergeErrStr}`, logType: 'error' });
                                            logWarn('sync', `IMDb auto-merge failed for ${item.Name}: ${mergeErrStr}`);
                                        }
                                    } else {
                                        // Both rows have jellyfin_ids
                                        // Skip if this external_id was already resolved/dismissed
                                        const alreadyHandled = /** @type {any} */ (db.prepare(
                                            `SELECT 1 FROM sync_conflicts WHERE conflict_type = 'shared_imdb_id' AND external_id = ? AND status = 'resolved' LIMIT 1`
                                        ).get(parentParams.imdbId));
                                        if (!alreadyHandled) {
                                            try {
                                                db.prepare(
                                                    `INSERT OR IGNORE INTO sync_conflicts (conflict_type, primary_id, secondary_id, external_id, status)
                                                     VALUES ('shared_imdb_id', ?, ?, ?, 'pending')`
                                                ).run(existing.id, currentId, parentParams.imdbId);
                                            } catch { /* ignore duplicate */ }
                                            broadcast({ type: 'progress', log: `  ⚠ ${item.Name}: two Jellyfin items share IMDb ID with "${existing.title}" — resolve in Settings`, logType: 'warning' });
                                        }
                                    }
                                } else {
                                    broadcast({ type: 'progress', log: `  ⚠ ${item.Name}: unresolved IMDb conflict, synced without IMDb ID`, logType: 'warning' });
                                }

                            } else {
                                throw upsertErr;
                            }
                        } else {
                            throw upsertErr;
                        }
                    }

                    libSynced++;
                    totalSynced++;
                    const parentRow = /** @type {any} */ (getParentId.get(item.Id));
                    const parentId = parentRow?.id;
                    const jellyfinDateModified = item.DateLastMediaAdded || item.DateModified || null;
                    const jellyfinChildCount = item.ChildCount || 0;
                    let childCount = 0;

                    // Smart skip: compare Jellyfin values against PRE-UPSERT DB values
                    // (preUpsertRow was captured BEFORE the upsert overwrote date_last_modified etc.)
                    const jellyfinUnplayed = item.UserData?.UnplayedItemCount ?? -1;
                    const jellyfinTotalEpisodes = item.RecursiveItemCount || 0;
                    const needsChildSync = force ||
                        !preUpsertRow ||
                        preStoredDateModified !== jellyfinDateModified ||
                        preStoredChildCount !== jellyfinChildCount ||
                        jellyfinUnplayed !== preStoredUnplayed ||
                        (lib.media_type === 'tvshows'
                            ? jellyfinTotalEpisodes !== preStoredCollected
                            : jellyfinTotalEpisodes !== preStoredTotalReleased);

                    // Sync children (skip if nothing changed)
                    if (lib.media_type === 'tvshows' && parentId) {
                        const existingChildren = /** @type {any} */ (countChildren.get(parentId))?.c || 0;
                        if (!needsChildSync && existingChildren > 0) {
                            // Fully synced — skip expensive episode fetch
                            updateParentCounts.run(parentId);
                            broadcast({
                                type: 'progress',
                                libraryIndex: libIdx,
                                libraryName: lib.name,
                                parentIndex: i + 1,
                                parentCount,
                                currentItem: item.Name,
                                childCount: existingChildren,
                                itemsSynced: libSynced,
                                totalSynced,
                                errors: totalErrors,
                                log: `  ⏭ ${item.Name} (${existingChildren} episodes already synced)`,
                                logType: 'info'
                            });
                            continue;
                        }

                        broadcast({
                            type: 'progress',
                            libraryIndex: libIdx,
                            libraryName: lib.name,
                            parentIndex: i,
                            parentCount,
                            currentItem: item.Name,
                            itemsSynced: libSynced,
                            totalSynced,
                            errors: totalErrors,
                            log: `  → Fetching episodes for ${item.Name}...`,
                            logType: 'info'
                        });

                        const episodes = await fetchJellyfinEpisodes(api, item.Id, userId);

                        for (const ep of episodes) {
                            // Determine if episode is on disk by checking LocationType
                            const isOnDisk = ep.LocationType !== 'Virtual';
                            try {
                                if (isOnDisk) {
                                    upsertChild.run({
                                        parentId,
                                        jellyfinId: ep.Id,
                                        title: ep.Name || `Episode ${ep.IndexNumber || '?'}`,
                                        seasonNumber: ep.ParentIndexNumber || 0,
                                        itemNumber: ep.IndexNumber || 0,
                                        isSpecial: (ep.ParentIndexNumber === 0) ? 1 : 0,
                                        watchStatus: getWatchStatus(ep.UserData),
                                        playCount: ep.UserData?.PlayCount || 0,
                                        runtimeTicks: ep.RunTimeTicks || 0,
                                        premiereDate: ep.PremiereDate || null,
                                        musicbrainzId: null,
                                        posterUrl: null,
                                        communityRating: ep.CommunityRating || null
                                    });
                                } else {
                                    upsertMissingChild.run({
                                        parentId,
                                        jellyfinId: ep.Id,
                                        title: ep.Name || `Episode ${ep.IndexNumber || '?'}`,
                                        seasonNumber: ep.ParentIndexNumber || 0,
                                        itemNumber: ep.IndexNumber || 0,
                                        isSpecial: (ep.ParentIndexNumber === 0) ? 1 : 0,
                                        premiereDate: ep.PremiereDate || null
                                    });
                                }
                                childCount++;
                                totalSynced++;
                            } catch (e) {
                                totalErrors++;
                                libErrors++;
                                const msg = `${item.Name}: episode upsert failed`;
                                libErrorMessages.push(msg);
                                totalErrorMessages.push(msg);
                            }
                        }

                        // ── Dedup: merge duplicate episodes with same season/episode number ──
                        // Jellyfin sometimes reports the same episode twice (e.g. virtual + on-disk),
                        // producing two media_children rows with different jellyfin_ids.
                        // Keep the collected (is_collected=1) entry; delete the virtual duplicate.
                        const dupeEpisodes = /** @type {any[]} */ (db.prepare(`
                            SELECT season_number, item_number, GROUP_CONCAT(id) as ids, COUNT(*) as cnt
                            FROM media_children
                            WHERE parent_id = ? AND season_number IS NOT NULL
                            GROUP BY season_number, item_number
                            HAVING cnt > 1
                        `).all(parentId));
                        if (dupeEpisodes.length > 0) {
                            const migrateHistory = db.prepare('UPDATE playback_history SET media_id = ? WHERE media_id = ?');
                            const deleteChild = db.prepare('DELETE FROM media_children WHERE id = ?');
                            db.transaction(() => {
                                for (const dupe of dupeEpisodes) {
                                    const ids = dupe.ids.split(',').map(Number);
                                    const rows = /** @type {any[]} */ (db.prepare(
                                        `SELECT id, is_collected, jellyfin_id, watch_status, play_count FROM media_children WHERE id IN (${ids.join(',')})`
                                    ).all());
                                    // Sort: prefer is_collected=1, then most plays, then highest id
                                    rows.sort((a, b) => {
                                        if (a.is_collected !== b.is_collected) return b.is_collected - a.is_collected;
                                        if ((a.play_count || 0) !== (b.play_count || 0)) return (b.play_count || 0) - (a.play_count || 0);
                                        return b.id - a.id;
                                    });
                                    const keepId = rows[0].id;
                                    for (const row of rows.slice(1)) {
                                        migrateHistory.run(keepId, row.id);
                                        deleteChild.run(row.id);
                                    }
                                }
                            })();
                            broadcast({ type: 'progress', log: `  🧹 ${item.Name}: deduped ${dupeEpisodes.length} duplicate episode(s)`, logType: 'info' });
                        }

                        const collectedNonSpecial = episodes.filter(ep => ep.LocationType !== 'Virtual' && (ep.ParentIndexNumber || 0) !== 0).length;
                        const missingNonSpecial = episodes.filter(ep => ep.LocationType === 'Virtual' && (ep.ParentIndexNumber || 0) !== 0).length;
                        updateTotalReleased.run(collectedNonSpecial + missingNonSpecial, parentId);
                        updateParentCounts.run(parentId);
                        // Sync cast & crew for TV shows
                        try { syncPeopleForItem(item.People, parentId); } catch (pe) {
                            console.error(`[sync] People sync failed for ${item.Name}:`, pe instanceof Error ? pe.message : String(pe));
                        }
                    } else if (lib.media_type === 'movies' && parentId) {
                        upsertChild.run({
                            parentId,
                            jellyfinId: item.Id + '_child',
                            title: item.Name,
                            seasonNumber: null,
                            itemNumber: 1,
                            isSpecial: 0,
                            watchStatus: getWatchStatus(item.UserData),
                            playCount: item.UserData?.PlayCount || 0,
                            runtimeTicks: item.RunTimeTicks || 0,
                            premiereDate: item.PremiereDate || null,
                            musicbrainzId: null,
                            posterUrl: null,
                            communityRating: item.CommunityRating || null
                        });

                        // Upgrade watch status from playback history (Trakt/Last.fm may know about watches Jellyfin doesn't)
                        const movieChildRow = /** @type {any} */ (getChildId.get(item.Id + '_child'));
                        if (movieChildRow) {
                            const histCount = /** @type {any} */ (db.prepare(
                                'SELECT COUNT(*) as c FROM playback_history WHERE media_id = ?'
                            ).get(movieChildRow.id))?.c || 0;
                            if (histCount > 0) {
                                db.prepare(
                                    "UPDATE media_children SET watch_status = 'watched', play_count = MAX(play_count, ?) WHERE id = ?"
                                ).run(histCount, movieChildRow.id);
                            }
                        }

                        childCount++;
                        totalSynced++;
                        updateParentCounts.run(parentId);
                        // Sync cast & crew
                        try { syncPeopleForItem(item.People, parentId); } catch (pe) {
                            console.error(`[sync] People sync failed for ${item.Name}:`, pe instanceof Error ? pe.message : String(pe));
                        }
                    } else if (lib.media_type === 'music' && parentId) {
                        // Count only Jellyfin-sourced albums (with jellyfin_id), not external/lastfm entries
                        const existingJellyfinAlbums = /** @type {any} */ (
                            db.prepare('SELECT COUNT(*) as c FROM media_children WHERE parent_id = ? AND is_special = 0 AND jellyfin_id IS NOT NULL').get(parentId)
                        )?.c || 0;

                        // Music-specific skip: Jellyfin MusicArtist items don't report useful
                        // ChildCount/DateLastMediaAdded, so needsChildSync is always false.
                        // Instead, fetch the album list once and compare counts to detect new albums.
                        const albums = await fetchJellyfinAlbums(api, item.Id);

                        if (!force && existingJellyfinAlbums > 0 && albums.length === existingJellyfinAlbums) {
                            // Album count matches — skip expensive track fetch
                            updateParentCounts.run(parentId);
                            broadcast({
                                type: 'progress',
                                libraryIndex: libIdx,
                                libraryName: lib.name,
                                parentIndex: i + 1,
                                parentCount,
                                currentItem: item.Name,
                                childCount: existingJellyfinAlbums,
                                itemsSynced: libSynced,
                                totalSynced,
                                errors: totalErrors,
                                log: `  ⏭ ${item.Name} (${existingJellyfinAlbums} albums up to date)`,
                                logType: 'info'
                            });
                            continue;
                        }

                        if (existingJellyfinAlbums > 0 && albums.length !== existingJellyfinAlbums) {
                            broadcast({
                                type: 'progress',
                                log: `  🔄 ${item.Name}: album count changed (local: ${existingJellyfinAlbums}, Jellyfin: ${albums.length}), re-syncing...`,
                                logType: 'info'
                            });
                        }

                        broadcast({
                            type: 'progress',
                            libraryIndex: libIdx,
                            libraryName: lib.name,
                            parentIndex: i,
                            parentCount,
                            currentItem: item.Name,
                            itemsSynced: libSynced,
                            totalSynced,
                            errors: totalErrors,
                            log: `  → Syncing ${albums.length} albums for ${item.Name}...`,
                            logType: 'info'
                        });

                        // First pass: upsert all albums
                        const albumIdMap = new Map(); // jellyfinId -> dbId
                        for (const album of albums) {
                            try {
                                upsertChild.run({
                                    parentId,
                                    jellyfinId: album.Id,
                                    title: album.Name,
                                    seasonNumber: null,
                                    itemNumber: album.ProductionYear || 0,
                                    isSpecial: 0,
                                    watchStatus: getWatchStatus(album.UserData),
                                    playCount: album.UserData?.PlayCount || 0,
                                    runtimeTicks: album.RunTimeTicks || 0,
                                    premiereDate: album.PremiereDate || null,
                                    musicbrainzId: album.ProviderIds?.MusicBrainzReleaseGroup || album.ProviderIds?.MusicBrainzAlbum || null,
                                    posterUrl: album.ImageTags?.Primary ? `${jellyfinUrl}/Items/${album.Id}/Images/Primary` : null,
                                    communityRating: album.CommunityRating || null
                                });
                                childCount++;
                                totalSynced++;
                                const albumRow = /** @type {any} */ (getChildId.get(album.Id));
                                if (albumRow) albumIdMap.set(album.Id, albumRow.id);
                            } catch (e) {
                                totalErrors++;
                                libErrors++;
                                const errDetail = e instanceof Error ? e.message : String(e);
                                const msg = `${item.Name}: album "${album.Name}" upsert failed: ${errDetail}`;
                                libErrorMessages.push(msg);
                                totalErrorMessages.push(msg);
                            }
                        }

                        // Second pass: fetch ALL tracks for this artist in ONE call (bulk)
                        try {
                            const allTracks = await fetchJellyfinTracks(api, null, item.Id);
                            for (const track of allTracks) {
                                const dbAlbumId = albumIdMap.get(track.AlbumId);
                                if (!dbAlbumId) continue; // track belongs to unknown album
                                try {
                                    upsertTrack.run({
                                        albumId: dbAlbumId,
                                        jellyfinId: track.Id,
                                        title: track.Name || 'Unknown Track',
                                        trackNumber: track.IndexNumber || 0,
                                        discNumber: track.ParentIndexNumber || 1,
                                        runtimeTicks: track.RunTimeTicks || 0,
                                        musicbrainzId: track.ProviderIds?.MusicBrainzTrack || null
                                    });
                                } catch { /* skip bad track */ }
                            }
                        } catch (trackErr) {
                            console.error(`[sync] Failed to bulk-fetch tracks for ${item.Name}:`, trackErr instanceof Error ? trackErr.message : String(trackErr));
                        }

                        updateParentCounts.run(parentId);
                        // For music: total_released = actual album count from Jellyfin
                        updateTotalReleased.run(albums.length, parentId);
                    }

                    // Per-item success broadcast
                    const itemElapsed = Date.now() - itemStart;
                    itemTimes.push(itemElapsed);
                    const libProgress = Math.round(((i + 1) / parentCount) * 100);
                    const avgItemTime = itemTimes.reduce((a, b) => a + b, 0) / itemTimes.length;
                    const remaining = parentCount - (i + 1);
                    const eta = remaining > 0 ? formatDuration(Math.round(avgItemTime * remaining)) : '';

                    broadcast({
                        type: 'progress',
                        libraryIndex: libIdx,
                        libraryName: lib.name,
                        parentIndex: i + 1,
                        parentCount,
                        currentItem: item.Name,
                        childCount,
                        libProgress,
                        itemsSynced: libSynced,
                        totalSynced,
                        errors: totalErrors,
                        log: `  ✓ ${item.Name}${childCount > 0 ? ` (${childCount} items)` : ''} [${formatDuration(itemElapsed)}]${eta ? ` — ETA: ${eta}` : ''}`,
                        logType: 'success'
                    });

                } catch (e) {
                    totalErrors++;
                    libErrors++;
                    const errMsg = e instanceof Error ? e.message : String(e);
                    libErrorMessages.push(`${item.Name}: ${errMsg}`);
                    totalErrorMessages.push(`${item.Name}: ${errMsg}`);
                    broadcast({
                        type: 'progress',
                        libraryIndex: libIdx,
                        libraryName: lib.name,
                        parentIndex: i + 1,
                        parentCount,
                        currentItem: item.Name,
                        errors: totalErrors,
                        totalSynced,
                        log: `  ✗ Error: ${item.Name}: ${errMsg}`,
                        logType: 'error'
                    });
                }

                // Small delay to not overwhelm Jellyfin
                await sleep(50);
            }

            // Library complete
            const libElapsed = Date.now() - libStart;
            const libFailed = parentCount === 0 && libSynced === 0;
            broadcast({
                type: 'library_complete',
                libraryIndex: libIdx,
                libraryName: lib.name,
                libSynced,
                libErrors,
                totalSynced,
                totalErrors,
                log: libFailed
                    ? `❌ ${lib.name} failed — could not fetch items from Jellyfin`
                    : libErrors > 0
                        ? `⚠️ ${lib.name} completed with errors — ${libSynced} items synced, ${libErrors} errors (${formatDuration(libElapsed)})\n${libErrorMessages.slice(0, 5).map(m => `   • ${m}`).join('\n')}${libErrorMessages.length > 5 ? `\n   … and ${libErrorMessages.length - 5} more` : ''}`
                        : `✅ ${lib.name} complete — ${libSynced} items synced (${formatDuration(libElapsed)})`,
                logType: libFailed ? 'error' : libErrors > 0 ? 'warning' : 'success'
            });
        }

        // === Generate playback_history entries from Jellyfin played items ===
        // The sync stores play_count/watch_status on media_children, but the History
        // page reads from playback_history. Create synthetic entries for anything
        // Jellyfin says is played but has no history record yet.
        try {
            const dbUser = /** @type {any} */ (db.prepare('SELECT id FROM users LIMIT 1').get());
            if (dbUser) {
                const playedWithoutHistory = /** @type {any[]} */ (db.prepare(`
                    SELECT mc.id, mc.play_count, mc.title, mc.premiere_date,
                           mp.title AS parent_title, mp.media_type
                    FROM media_children mc
                    JOIN media_parents mp ON mp.id = mc.parent_id
                    WHERE mc.watch_status = 'watched'
                      AND mc.play_count > 0
                      AND NOT EXISTS (
                          SELECT 1 FROM playback_history ph
                          WHERE ph.media_id = mc.id AND ph.user_id = ?
                      )
                `).all(dbUser.id));

                if (playedWithoutHistory.length > 0) {
                    broadcast({ type: 'progress', log: `📊 Generating ${playedWithoutHistory.length} history entries from Jellyfin play data...`, logType: 'info' });

                    const insertHistory = db.prepare(`
                        INSERT OR IGNORE INTO playback_history (user_id, media_id, source, timestamp, completion_pct, external_event_id)
                        VALUES (?, ?, 'jellyfin_sync', ?, 100, ?)
                    `);

                    const txn = db.transaction(() => {
                        for (const item of playedWithoutHistory) {
                            // Don't use premiere_date — that's the release date, not when it was watched.
                            // Use '' for unknown date (column is NOT NULL); the UI will display "—" instead of a wrong date.
                            const timestamp = '';
                            const eventId = `jellyfin_sync:${item.id}`;
                            try {
                                insertHistory.run(dbUser.id, item.id, timestamp, eventId);
                            } catch { /* ignore duplicate */ }
                        }
                    });
                    txn();
                    broadcast({ type: 'progress', log: `✅ Created ${playedWithoutHistory.length} history entries`, logType: 'success' });
                }
            }
        } catch (histErr) {
            console.error('[sync] History generation error:', histErr);
            broadcast({ type: 'progress', log: `⚠️ History generation failed: ${histErr instanceof Error ? histErr.message : String(histErr)}`, logType: 'warning' });
        }

        // All done
        updateSyncState({
            status: 'idle',
            progress_percent: 100,
            items_synced: totalSynced,
            items_total: totalSynced,
            errors: totalErrors,
            last_sync_timestamp: new Date().toISOString()
        });

        const allFailed = totalSynced === 0 && totalErrors > 0;
        const hasErrors = totalErrors > 0;
        broadcast({
            type: 'complete',
            totalSynced,
            totalErrors,
            log: allFailed
                ? `❌ Sync failed — could not fetch any items (${totalErrors} errors)`
                : hasErrors
                    ? `⚠️ Sync completed with errors — ${totalSynced} items synced, ${totalErrors} errors\n${totalErrorMessages.slice(0, 5).map(m => `   • ${m}`).join('\n')}${totalErrorMessages.length > 5 ? `\n   … and ${totalErrorMessages.length - 5} more` : ''}`
                    : `🎉 Sync complete! ${totalSynced} items synced.`,
            logType: allFailed ? 'error' : hasErrors ? 'warning' : 'success'
        });

        // Record sync completion
        if (syncHistoryId) {
            const status = allFailed ? 'failed' : 'success';
            const summary = `${totalSynced} items synced, ${totalErrors} errors`;
            db.prepare('UPDATE sync_history SET status = ?, finished_at = ?, summary = ? WHERE id = ?')
                .run(status, new Date().toISOString(), summary, syncHistoryId);
        }
        const detailParts = [`${totalSynced.toLocaleString()} items synced`];
        if (totalErrors > 0) detailParts.push(`${totalErrors} errors`);
        if (totalErrorMessages.length > 0) detailParts.push(totalErrorMessages.slice(0, 3).join(', '));
        logActivity({
            category: 'sync', action: 'jellyfin_sync_completed',
            title: allFailed ? 'Jellyfin sync failed' : hasErrors ? `Jellyfin sync — ${totalSynced.toLocaleString()} items, ${totalErrors} errors` : `Jellyfin sync — ${totalSynced.toLocaleString()} items synced`,
            detail: detailParts.join(' · '),
            icon: allFailed ? '❌' : hasErrors ? '⚠️' : '✅',
            status: allFailed ? 'error' : hasErrors ? 'warning' : 'success',
            actionable: true, actionType: 'navigate', actionData: {
                href: '/settings/admin?tab=sync',
                errors: totalErrorMessages.slice(0, 10),
                totalErrors,
                totalSynced
            }
        });

        // ── Post-sync dedup ─────────────────────────────────────────────────
        if (!allFailed) {
            try {
                broadcast({ type: 'progress', log: '🧹 Running post-sync dedup...', logType: 'info' });
                const { deduplicateParents: dedupP, deduplicateParentsByTitle: dedupPT, deduplicateChildren: dedupC, deduplicatePlaybackHistory: dedupPH } = await import('$lib/server/reconcile.js');
                const dp = dedupP();
                const dpt = dedupPT();
                const dc = dedupC();
                const dph = dedupPH();
                const dedupTotal = dp + dpt + dc + dph;
                if (dedupTotal > 0) {
                    broadcast({ type: 'progress', log: `🧹 Dedup: ${dp} parents(extID), ${dpt} parents(title), ${dc} children, ${dph} history dupes`, logType: 'info' });
                    console.log(`[sync] Post-sync dedup: ${dp} parents, ${dpt} by-title, ${dc} children, ${dph} history`);
                }
            } catch (dedupErr) {
                console.warn('[sync] Post-sync dedup failed:', dedupErr instanceof Error ? dedupErr.message : dedupErr);
            }

            // Invalidate precomputed sections so next page load gets fresh data
            try {
                const { invalidatePrecomputed } = await import('$lib/server/section-cache.js');
                invalidatePrecomputed();
                broadcast({ type: 'progress', log: '🔄 Smart section cache invalidated (will rebuild on next page load)', logType: 'info' });
            } catch (e) {
                console.warn('[sync] Section cache invalidation failed:', e instanceof Error ? e.message : e);
            }

            // Warm poster image cache (non-blocking background)
            try {
                const { warmCache } = await import('$lib/server/image-cache.js');
                const posterRows = /** @type {any[]} */ (db.prepare(
                    `SELECT poster_url FROM media_parents WHERE poster_url IS NOT NULL
                     UNION ALL
                     SELECT poster_url FROM media_children WHERE poster_url IS NOT NULL`
                ).all());
                const urls = posterRows.map(r => r.poster_url).filter(Boolean);
                if (urls.length > 0) {
                    broadcast({ type: 'progress', log: `🖼️ Warming image cache for ${urls.length} posters...`, logType: 'info' });
                    warmCache(urls, 8).then(() => {
                        broadcast({ type: 'progress', log: `🖼️ Image cache warm complete`, logType: 'info' });
                    }).catch(() => { /* non-fatal */ });
                }
            } catch (e) {
                console.warn('[sync] Poster cache warm failed:', e instanceof Error ? e.message : e);
            }
        }

    } catch (e) {
        console.error('Sync engine error:', e);
        const errMsg = e instanceof Error ? e.message : String(e);
        updateSyncState({ status: 'error', current_task: errMsg });
        broadcast({ type: 'error', message: errMsg });
        if (syncHistoryId) {
            db.prepare('UPDATE sync_history SET status = ?, finished_at = ?, summary = ? WHERE id = ?')
                .run('failed', new Date().toISOString(), errMsg, syncHistoryId);
        }
        logActivity({ category: 'sync', action: 'jellyfin_sync_failed', title: 'Jellyfin sync failed', detail: errMsg, icon: '❌', status: 'error', actionable: true, actionType: 'navigate', actionData: { href: '/settings/admin' } });
    } finally {
        engineState.running = false;
    }
}

export function pauseSync() {
    engineState.paused = true;
    updateSyncState({ status: 'paused' });
}

export function resumeSync() {
    engineState.paused = false;
    updateSyncState({ status: 'syncing' });
}

export function stopSync() {
    engineState.running = false;
    engineState.paused = false;
    updateSyncState({ status: 'idle' });
    if (syncHistoryId) {
        db.prepare('UPDATE sync_history SET status = ?, finished_at = ? WHERE id = ?')
            .run('interrupted', new Date().toISOString(), syncHistoryId);
    }
}

export function addListener(callback) {
    listeners.add(callback);
    return () => listeners.delete(callback);
}

export { broadcast };

export function isRunning() {
    return engineState.running;
}

export function resetSync() {
    engineState.running = false;
    engineState.paused = false;
    engineState.abortController = null;
    updateSyncState({ status: 'idle', progress_percent: 0 });
}

// Re-export from standalone module for backward compatibility
export { reconcileExternalMedia, deduplicateParents, deduplicateChildren, deduplicateParentsByTitle } from '$lib/server/reconcile.js';

/**
 * Refresh episodes for a single TV show by re-fetching from Jellyfin.
 * Lightweight alternative to a full sync — only touches one show's episodes.
 * Used by calendar-triggered refresh to keep episode data current.
 *
 * @param {number} parentId - media_parents.id of the show
 * @returns {Promise<{ success: boolean, episodeCount?: number, error?: string }>}
 */
export async function refreshShowEpisodes(parentId) {
    try {
        const show = /** @type {any} */ (db.prepare(
            'SELECT id, jellyfin_id, title FROM media_parents WHERE id = ? AND media_type = \'show\''
        ).get(parentId));
        if (!show?.jellyfin_id) return { success: false, error: 'No Jellyfin ID' };

        const settings = /** @type {any} */ (db.prepare('SELECT jellyfin_url FROM app_settings WHERE id = 1').get());
        const user = /** @type {any} */ (db.prepare('SELECT jellyfin_access_token, jellyfin_user_id FROM users LIMIT 1').get());
        if (!settings?.jellyfin_url || !user?.jellyfin_access_token) {
            return { success: false, error: 'Missing Jellyfin config' };
        }

        const { api } = getJellyfinApis(settings.jellyfin_url, user.jellyfin_access_token);
        const episodes = await fetchJellyfinEpisodes(api, show.jellyfin_id, user.jellyfin_user_id);

        if (episodes.length === 0) {
            return { success: true, episodeCount: 0 };
        }

        // Prepared statements for episode upsert
        const upsertEp = db.prepare(`
            INSERT INTO media_children (parent_id, jellyfin_id, title, season_number, item_number, is_special, is_collected, watch_status, play_count, runtime_ticks, premiere_date, community_rating)
            VALUES (@parentId, @jellyfinId, @title, @seasonNumber, @itemNumber, @isSpecial, 1, @watchStatus, @playCount, @runtimeTicks, @premiereDate, @communityRating)
            ON CONFLICT(jellyfin_id) DO UPDATE SET
                title = @title, season_number = @seasonNumber, item_number = @itemNumber,
                is_special = @isSpecial, is_collected = 1, watch_status = @watchStatus,
                play_count = @playCount, runtime_ticks = @runtimeTicks, premiere_date = @premiereDate,
                community_rating = COALESCE(@communityRating, community_rating)
        `);
        const upsertMissing = db.prepare(`
            INSERT INTO media_children (parent_id, jellyfin_id, title, season_number, item_number, is_special, is_collected, watch_status, play_count, runtime_ticks, premiere_date)
            VALUES (@parentId, @jellyfinId, @title, @seasonNumber, @itemNumber, @isSpecial, 0, 'unwatched', 0, 0, @premiereDate)
            ON CONFLICT(jellyfin_id) DO UPDATE SET
                title = @title, season_number = @seasonNumber, item_number = @itemNumber,
                is_special = @isSpecial, is_collected = 0, premiere_date = @premiereDate
        `);

        db.transaction(() => {
            for (const ep of episodes) {
                const isOnDisk = ep.LocationType !== 'Virtual';
                const params = {
                    parentId,
                    jellyfinId: ep.Id,
                    title: ep.Name || `Episode ${ep.IndexNumber || '?'}`,
                    seasonNumber: ep.ParentIndexNumber || 0,
                    itemNumber: ep.IndexNumber || 0,
                    isSpecial: (ep.ParentIndexNumber === 0) ? 1 : 0,
                    premiereDate: ep.PremiereDate || null,
                };
                if (isOnDisk) {
                    upsertEp.run({
                        ...params,
                        watchStatus: getWatchStatus(ep.UserData),
                        playCount: ep.UserData?.PlayCount || 0,
                        runtimeTicks: ep.RunTimeTicks || 0,
                        communityRating: ep.CommunityRating || null,
                    });
                } else {
                    upsertMissing.run(params);
                }
            }

            // Dedup episodes with same season/episode number
            const dupes = /** @type {any[]} */ (db.prepare(`
                SELECT season_number, item_number, GROUP_CONCAT(id) as ids, COUNT(*) as cnt
                FROM media_children
                WHERE parent_id = ? AND season_number IS NOT NULL
                GROUP BY season_number, item_number
                HAVING cnt > 1
            `).all(parentId));
            if (dupes.length > 0) {
                const migrateHistory = db.prepare('UPDATE playback_history SET media_id = ? WHERE media_id = ?');
                const deleteChild = db.prepare('DELETE FROM media_children WHERE id = ?');
                for (const dupe of dupes) {
                    const ids = dupe.ids.split(',').map(Number);
                    const rows = /** @type {any[]} */ (db.prepare(
                        `SELECT id, is_collected, play_count FROM media_children WHERE id IN (${ids.join(',')})`
                    ).all());
                    rows.sort((a, b) => {
                        if (a.is_collected !== b.is_collected) return b.is_collected - a.is_collected;
                        if ((a.play_count || 0) !== (b.play_count || 0)) return (b.play_count || 0) - (a.play_count || 0);
                        return b.id - a.id;
                    });
                    const keepId = rows[0].id;
                    for (const row of rows.slice(1)) {
                        migrateHistory.run(keepId, row.id);
                        deleteChild.run(row.id);
                    }
                }
            }

            // Update parent counts
            const collectedNonSpecial = episodes.filter(ep => ep.LocationType !== 'Virtual' && (ep.ParentIndexNumber || 0) !== 0).length;
            const missingNonSpecial = episodes.filter(ep => ep.LocationType === 'Virtual' && (ep.ParentIndexNumber || 0) !== 0).length;
            db.prepare('UPDATE media_parents SET total_released_children = ? WHERE id = ?').run(
                collectedNonSpecial + missingNonSpecial, parentId
            );
            db.prepare(`
                UPDATE media_parents SET
                    collected_children = (SELECT COUNT(*) FROM media_children WHERE parent_id = ? AND is_collected = 1 AND is_special = 0),
                    watched_children = (SELECT COUNT(*) FROM media_children WHERE parent_id = ? AND watch_status = 'watched' AND is_special = 0),
                    last_episode_refresh = datetime('now')
                WHERE id = ?
            `).run(parentId, parentId, parentId);
        })();

        console.log(`[episode-refresh] ✅ ${show.title}: ${episodes.length} episodes refreshed`);
        return { success: true, episodeCount: episodes.length };
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[episode-refresh] ❌ parentId=${parentId}: ${msg}`);
        return { success: false, error: msg };
    }
}

export function getStatus() {
    return {
        running: engineState.running,
        paused: engineState.paused,
        libraryName: engineState.libraryName,
        progress: engineState.progress,
        itemsSynced: engineState.itemsSynced,
        errors: engineState.errors,
        logs: recentLogs
    };
}
