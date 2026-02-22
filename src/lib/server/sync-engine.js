import db from '$lib/server/db.js';

/** @type {Set<(data: any) => void>} */
const listeners = new Set();

/** @type {{ running: boolean, paused: boolean, abortController: AbortController | null }} */
let engineState = {
    running: false,
    paused: false,
    abortController: null
};

function broadcast(data) {
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

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitWhilePaused() {
    while (engineState.paused && engineState.running) {
        await sleep(500);
    }
}

async function fetchJellyfinItems(jellyfinUrl, accessToken, libraryId, mediaType) {
    const headers = { 'Accept': 'application/json', 'X-Emby-Token': accessToken };

    let itemType = '';
    if (mediaType === 'tvshows') itemType = 'Series';
    else if (mediaType === 'movies') itemType = 'Movie';
    else if (mediaType === 'music') itemType = 'MusicArtist';

    const params = new URLSearchParams({
        ParentId: libraryId,
        IncludeItemTypes: itemType,
        Recursive: 'true',
        Fields: 'ProviderIds,Overview,ProductionYear,UserData,RecursiveItemCount,ChildCount',
        StartIndex: '0',
        Limit: '10000'
    });

    const url = `${jellyfinUrl}/Items?${params}`;
    console.log(`[sync] Fetching ${itemType} from ${jellyfinUrl} (library ${libraryId})...`);

    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 30000);

        const res = await fetch(url, {
            headers,
            signal: controller.signal
        });

        clearTimeout(timeout);

        if (!res.ok) {
            console.error(`[sync] HTTP ${res.status} from ${url}`);
            broadcast({ type: 'error', log: `HTTP ${res.status} fetching ${itemType}`, logType: 'error' });
            return [];
        }
        const data = await res.json();
        console.log(`[sync] Got ${data.Items?.length || 0} ${itemType} items (total: ${data.TotalRecordCount})`);
        return data.Items || [];
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`[sync] Failed to fetch ${itemType} from library ${libraryId}:`, msg);
        broadcast({ type: 'error', log: `Failed to fetch ${itemType}: ${msg}`, logType: 'error' });
        return [];
    }
}

async function fetchJellyfinEpisodes(jellyfinUrl, accessToken, seriesId) {
    const headers = { 'Accept': 'application/json', 'X-Emby-Token': accessToken };

    const params = new URLSearchParams({
        Fields: 'ProviderIds,UserData,Overview',
        Recursive: 'true',
        IncludeItemTypes: 'Episode',
        StartIndex: '0',
        Limit: '10000'
    });

    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 30000);
        const res = await fetch(`${jellyfinUrl}/Shows/${seriesId}/Episodes?${params}`, { headers, signal: controller.signal });
        clearTimeout(timeout);
        if (!res.ok) return [];
        const data = await res.json();
        return data.Items || [];
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`[sync] Failed to fetch episodes for ${seriesId}:`, msg);
        return [];
    }
}

async function fetchJellyfinAlbums(jellyfinUrl, accessToken, artistId) {
    const headers = { 'Accept': 'application/json', 'X-Emby-Token': accessToken };

    const params = new URLSearchParams({
        ArtistIds: artistId,
        IncludeItemTypes: 'MusicAlbum',
        Recursive: 'true',
        Fields: 'ProviderIds,UserData,ProductionYear',
        StartIndex: '0',
        Limit: '10000'
    });

    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 30000);
        const res = await fetch(`${jellyfinUrl}/Items?${params}`, { headers, signal: controller.signal });
        clearTimeout(timeout);
        if (!res.ok) return [];
        const data = await res.json();
        return data.Items || [];
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`[sync] Failed to fetch albums for ${artistId}:`, msg);
        return [];
    }
}

async function fetchJellyfinTracks(jellyfinUrl, accessToken, albumId) {
    const headers = { 'Accept': 'application/json', 'X-Emby-Token': accessToken };

    const params = new URLSearchParams({
        ParentId: albumId,
        IncludeItemTypes: 'Audio',
        Recursive: 'true',
        Fields: 'ProviderIds,UserData',
        StartIndex: '0',
        Limit: '10000'
    });

    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 30000);
        const res = await fetch(`${jellyfinUrl}/Items?${params}`, { headers, signal: controller.signal });
        clearTimeout(timeout);
        if (!res.ok) return [];
        const data = await res.json();
        return data.Items || [];
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

export async function startSync() {
    if (engineState.running) return;

    engineState.running = true;
    engineState.paused = false;
    engineState.abortController = new AbortController();

    const settings = db.prepare('SELECT * FROM app_settings WHERE id = 1').get();
    const user = db.prepare('SELECT * FROM users LIMIT 1').get();
    const libraries = db.prepare('SELECT * FROM libraries WHERE is_tracked = 1').all();

    if (!settings?.jellyfin_url || !user) {
        broadcast({ type: 'error', message: 'Missing Jellyfin configuration or user.' });
        engineState.running = false;
        return;
    }

    const jellyfinUrl = settings.jellyfin_url;
    const accessToken = user.jellyfin_access_token || '';

    let totalSynced = 0;
    let totalErrors = 0;

    updateSyncState({ status: 'syncing', progress_percent: 0 });

    const upsertParent = db.prepare(`
		INSERT INTO media_parents (jellyfin_id, library_id, title, media_type, tvdb_id, tmdb_id, imdb_id, musicbrainz_id, release_year, poster_url, overview, jellyfin_user_rating, total_released_children)
		VALUES (@jellyfinId, @libraryId, @title, @mediaType, @tvdbId, @tmdbId, @imdbId, @musicbrainzId, @releaseYear, @posterUrl, @overview, @userRating, @totalReleased)
		ON CONFLICT(jellyfin_id) DO UPDATE SET
			title = @title, tvdb_id = @tvdbId, tmdb_id = @tmdbId, imdb_id = @imdbId, musicbrainz_id = @musicbrainzId,
			release_year = @releaseYear, poster_url = @posterUrl, overview = @overview, jellyfin_user_rating = @userRating,
			total_released_children = @totalReleased
	`);

    const upsertChild = db.prepare(`
		INSERT INTO media_children (parent_id, jellyfin_id, title, season_number, item_number, is_special, is_collected, watch_status, play_count, runtime_ticks)
		VALUES (@parentId, @jellyfinId, @title, @seasonNumber, @itemNumber, @isSpecial, 1, @watchStatus, @playCount, @runtimeTicks)
		ON CONFLICT(jellyfin_id) DO UPDATE SET
			title = @title, season_number = @seasonNumber, item_number = @itemNumber,
			is_special = @isSpecial, is_collected = 1, watch_status = @watchStatus,
			play_count = @playCount, runtime_ticks = @runtimeTicks
	`);

    const getParentId = db.prepare('SELECT id FROM media_parents WHERE jellyfin_id = ?');

    const updateParentCounts = db.prepare(`
		UPDATE media_parents SET
			collected_children = (SELECT COUNT(*) FROM media_children WHERE parent_id = media_parents.id AND is_collected = 1),
			watched_children = (SELECT COUNT(*) FROM media_children WHERE parent_id = media_parents.id AND watch_status = 'watched')
		WHERE id = ?
	`);

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

            // Fetch parent items for this library
            const items = await fetchJellyfinItems(jellyfinUrl, accessToken, lib.jellyfin_id, lib.media_type);
            const parentCount = items.length;
            let libSynced = 0;
            let libErrors = 0;

            broadcast({
                type: 'library_count',
                libraryIndex: libIdx,
                libraryName: lib.name,
                parentCount,
                log: `Found ${parentCount} ${lib.media_type === 'tvshows' ? 'shows' : lib.media_type === 'movies' ? 'movies' : 'artists'} in ${lib.name}`,
                logType: 'info'
            });

            for (let i = 0; i < items.length; i++) {
                const item = items[i];
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
                        totalReleased: item.RecursiveItemCount || item.ChildCount || 0
                    });

                    libSynced++;
                    totalSynced++;
                    const parentRow = getParentId.get(item.Id);
                    const parentId = parentRow?.id;
                    let childCount = 0;

                    // Sync children
                    if (lib.media_type === 'tvshows' && parentId) {
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

                        const episodes = await fetchJellyfinEpisodes(jellyfinUrl, accessToken, item.Id);

                        for (const ep of episodes) {
                            try {
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
                                childCount++;
                                totalSynced++;
                            } catch (e) {
                                totalErrors++;
                                libErrors++;
                            }
                        }

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

                        const albums = await fetchJellyfinAlbums(jellyfinUrl, accessToken, item.Id);

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
                            } catch (e) {
                                totalErrors++;
                                libErrors++;
                            }
                        }

                        updateParentCounts.run(parentId);
                    }

                    // Per-item success broadcast — progress is parent index / parent count (reliable %)
                    const libProgress = Math.round(((i + 1) / parentCount) * 100);

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
                        log: `  ✓ ${item.Name}${childCount > 0 ? ` (${childCount} items)` : ''}`,
                        logType: 'success'
                    });

                } catch (e) {
                    totalErrors++;
                    libErrors++;
                    broadcast({
                        type: 'progress',
                        libraryIndex: libIdx,
                        libraryName: lib.name,
                        parentIndex: i + 1,
                        parentCount,
                        currentItem: item.Name,
                        errors: totalErrors,
                        totalSynced,
                        log: `  ✗ Error: ${item.Name}: ${e.message}`,
                        logType: 'error'
                    });
                }

                // Small delay to not overwhelm Jellyfin
                await sleep(50);
            }

            // Library complete
            broadcast({
                type: 'library_complete',
                libraryIndex: libIdx,
                libraryName: lib.name,
                libSynced,
                libErrors,
                totalSynced,
                totalErrors,
                log: `✅ ${lib.name} complete — ${libSynced} items synced`,
                logType: 'success'
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

        broadcast({
            type: 'complete',
            totalSynced,
            totalErrors,
            log: `🎉 Sync complete! ${totalSynced} items synced with ${totalErrors} errors.`,
            logType: 'success'
        });

    } catch (e) {
        console.error('Sync engine error:', e);
        updateSyncState({ status: 'error', current_task: e.message });
        broadcast({ type: 'error', message: e.message });
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
