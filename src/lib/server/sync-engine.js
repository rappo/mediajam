import db from '$lib/server/db.js';
import { getJellyfinApis, getItemsApi, getSystemApi, getTvShowsApi } from '$lib/server/jellyfin.js';

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

function broadcast(data) {
    // Capture logs and state updates
    if (data.log) {
        recentLogs.push({ time: new Date().toLocaleTimeString(), message: data.log, type: data.logType || 'info' });
        if (recentLogs.length > 150) recentLogs = recentLogs.slice(-150);
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
        broadcast({ type: 'error', log: `  ❌ Cannot reach Jellyfin: ${msg}`, logType: 'error' });
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
                fields: ['ProviderIds', 'Overview', 'ProductionYear', 'DateLastMediaAdded'],
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
 * Fetch tracks for an album using the SDK.
 */
async function fetchJellyfinTracks(api, albumId) {
    try {
        const res = await getItemsApi(api).getItems({
            parentId: albumId,
            includeItemTypes: ['Audio'],
            recursive: true,
            fields: ['ProviderIds'],
            enableUserData: true,
            startIndex: 0,
            limit: 10000
        });
        return res.data.Items || [];
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`[sync] Failed to fetch tracks for ${albumId}:`, msg);
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

    // Create the SDK API instance (uses Axios, no fetch/DNS issues)
    const { api } = getJellyfinApis(jellyfinUrl, accessToken);

    let totalSynced = 0;
    let totalErrors = 0;

    updateSyncState({ status: 'syncing', progress_percent: 0 });

    const upsertParent = db.prepare(`
		INSERT INTO media_parents (jellyfin_id, library_id, title, media_type, tvdb_id, tmdb_id, imdb_id, musicbrainz_id, release_year, poster_url, overview, jellyfin_user_rating, total_released_children, date_last_modified, jellyfin_child_count)
		VALUES (@jellyfinId, @libraryId, @title, @mediaType, @tvdbId, @tmdbId, @imdbId, @musicbrainzId, @releaseYear, @posterUrl, @overview, @userRating, @totalReleased, @dateLastModified, @jellyfinChildCount)
		ON CONFLICT(jellyfin_id) DO UPDATE SET
			title = @title, tvdb_id = @tvdbId, tmdb_id = @tmdbId, imdb_id = @imdbId, musicbrainz_id = @musicbrainzId,
			release_year = @releaseYear, poster_url = @posterUrl, overview = @overview, jellyfin_user_rating = @userRating,
			total_released_children = @totalReleased, date_last_modified = @dateLastModified, jellyfin_child_count = @jellyfinChildCount
	`);

    const upsertChild = db.prepare(`
		INSERT INTO media_children (parent_id, jellyfin_id, title, season_number, item_number, is_special, is_collected, watch_status, play_count, runtime_ticks)
		VALUES (@parentId, @jellyfinId, @title, @seasonNumber, @itemNumber, @isSpecial, 1, @watchStatus, @playCount, @runtimeTicks)
		ON CONFLICT(jellyfin_id) DO UPDATE SET
			title = @title, season_number = @seasonNumber, item_number = @itemNumber,
			is_special = @isSpecial, is_collected = 1, watch_status = @watchStatus,
			play_count = @playCount, runtime_ticks = @runtimeTicks
	`);

    const upsertMissingChild = db.prepare(`
		INSERT INTO media_children (parent_id, jellyfin_id, title, season_number, item_number, is_special, is_collected, watch_status, play_count, runtime_ticks)
		VALUES (@parentId, @jellyfinId, @title, @seasonNumber, @itemNumber, @isSpecial, 0, 'unwatched', 0, 0)
		ON CONFLICT(jellyfin_id) DO UPDATE SET
			title = @title, season_number = @seasonNumber, item_number = @itemNumber,
			is_special = @isSpecial, is_collected = 0
	`);

    const getParentId = db.prepare('SELECT id, date_last_modified, jellyfin_child_count FROM media_parents WHERE jellyfin_id = ?');
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

                    upsertParent.run({
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
                        totalReleased: 0,
                        dateLastModified: item.DateLastMediaAdded || item.DateModified || null,
                        jellyfinChildCount: item.ChildCount || 0
                    });

                    libSynced++;
                    totalSynced++;
                    const parentRow = /** @type {any} */ (getParentId.get(item.Id));
                    const parentId = parentRow?.id;
                    const storedDateModified = parentRow?.date_last_modified;
                    const storedChildCount = parentRow?.jellyfin_child_count || 0;
                    const jellyfinDateModified = item.DateLastMediaAdded || item.DateModified || null;
                    const jellyfinChildCount = item.ChildCount || 0;
                    let childCount = 0;

                    // Smart skip: only re-fetch children if date or count changed
                    const needsChildSync = force ||
                        storedDateModified !== jellyfinDateModified ||
                        storedChildCount !== jellyfinChildCount;

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
                                        runtimeTicks: ep.RunTimeTicks || 0
                                    });
                                } else {
                                    upsertMissingChild.run({
                                        parentId,
                                        jellyfinId: ep.Id,
                                        title: ep.Name || `Episode ${ep.IndexNumber || '?'}`,
                                        seasonNumber: ep.ParentIndexNumber || 0,
                                        itemNumber: ep.IndexNumber || 0,
                                        isSpecial: (ep.ParentIndexNumber === 0) ? 1 : 0
                                    });
                                }
                                childCount++;
                                totalSynced++;
                            } catch (e) {
                                totalErrors++;
                                libErrors++;
                            }
                        }

                        const collectedNonSpecial = episodes.filter(ep => ep.LocationType !== 'Virtual' && (ep.ParentIndexNumber || 0) !== 0).length;
                        const missingNonSpecial = episodes.filter(ep => ep.LocationType === 'Virtual' && (ep.ParentIndexNumber || 0) !== 0).length;
                        updateTotalReleased.run(collectedNonSpecial + missingNonSpecial, parentId);
                        updateParentCounts.run(parentId);
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
                            runtimeTicks: item.RunTimeTicks || 0
                        });
                        childCount++;
                        totalSynced++;
                        updateParentCounts.run(parentId);
                    } else if (lib.media_type === 'music' && parentId) {
                        const existingChildren = /** @type {any} */ (countChildren.get(parentId))?.c || 0;
                        if (!needsChildSync && existingChildren > 0) {
                            // Fully synced — skip expensive album/track fetch
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
                                log: `  ⏭ ${item.Name} (${existingChildren} albums already synced)`,
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
                            log: `  → Fetching albums for ${item.Name}...`,
                            logType: 'info'
                        });

                        const albums = await fetchJellyfinAlbums(api, item.Id);

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
                                    runtimeTicks: album.RunTimeTicks || 0
                                });
                                childCount++;
                                totalSynced++;
                                const albumRow = /** @type {any} */ (getChildId.get(album.Id));
                                if (albumRow) albumIdMap.set(album.Id, albumRow.id);
                            } catch (e) {
                                totalErrors++;
                                libErrors++;
                            }
                        }

                        // Second pass: fetch ALL tracks in parallel
                        const CONCURRENCY = 5;
                        const albumEntries = [...albumIdMap.entries()];
                        for (let b = 0; b < albumEntries.length; b += CONCURRENCY) {
                            const batch = albumEntries.slice(b, b + CONCURRENCY);
                            const trackResults = await Promise.allSettled(
                                batch.map(([jellyfinId]) => fetchJellyfinTracks(api, jellyfinId))
                            );
                            for (let r = 0; r < batch.length; r++) {
                                const [, dbAlbumId] = batch[r];
                                const result = trackResults[r];
                                if (result.status === 'fulfilled') {
                                    for (const track of result.value) {
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
                                }
                            }
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
                        ? `⚠️ ${lib.name} completed with errors — ${libSynced} items synced, ${libErrors} errors (${formatDuration(libElapsed)})`
                        : `✅ ${lib.name} complete — ${libSynced} items synced (${formatDuration(libElapsed)})`,
                logType: libFailed ? 'error' : libErrors > 0 ? 'warning' : 'success'
            });
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
                    ? `⚠️ Sync completed with errors — ${totalSynced} items synced, ${totalErrors} errors`
                    : `🎉 Sync complete! ${totalSynced} items synced.`,
            logType: allFailed ? 'error' : hasErrors ? 'warning' : 'success'
        });

    } catch (e) {
        console.error('Sync engine error:', e);
        const errMsg = e instanceof Error ? e.message : String(e);
        updateSyncState({ status: 'error', current_task: errMsg });
        broadcast({ type: 'error', message: errMsg });
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
}

export function addListener(callback) {
    listeners.add(callback);
    return () => listeners.delete(callback);
}

export function isRunning() {
    return engineState.running;
}

export function resetSync() {
    engineState.running = false;
    engineState.paused = false;
    engineState.abortController = null;
    updateSyncState({ status: 'idle', progress_percent: 0 });
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
