import db from '$lib/server/db.js';
import Database from 'better-sqlite3';
import { logError, logInfo, logWarn } from '$lib/server/logger.js';

// ─── SSE Listeners ───────────────────────────────────────────────────────────
/** @type {Set<(data: any) => void>} */
const listeners = new Set();

/** @type {{ running: boolean, currentTier: string | null }} */
let backfillState = { running: false, currentTier: null };

/** @type {Array<{time: string, message: string, type: string}>} */
let recentLogs = [];
let lastProgress = /** @type {any} */ (null);

function broadcast(data) {
    // Capture logs for snapshot
    if (data.log) {
        recentLogs.push({ time: new Date().toLocaleTimeString(), message: data.log, type: data.logType || 'info' });
        if (recentLogs.length > 5000) recentLogs = recentLogs.slice(-4000);
    }
    if (data.type === 'backfill_progress') lastProgress = data;
    for (const listener of listeners) {
        try {
            listener(data);
        } catch {
            listeners.delete(listener);
        }
    }
}

export function addBackfillListener(callback) {
    listeners.add(callback);
    return () => listeners.delete(callback);
}

export function isBackfillRunning() {
    return backfillState.running;
}

export function getBackfillStatus() {
    return {
        running: backfillState.running,
        currentTier: backfillState.currentTier,
        logs: recentLogs.slice(),
        lastProgress
    };
}

// ─── Prepared Statements ─────────────────────────────────────────────────────
const insertHistory = db.prepare(`
    INSERT OR IGNORE INTO playback_history (user_id, media_id, source, timestamp, duration_consumed_seconds, completion_pct, external_event_id, track_name)
    VALUES (@userId, @mediaId, @source, @timestamp, @durationSeconds, @completionPct, @externalEventId, @trackName)
`);

const findMediaByJellyfinId = db.prepare(`
    SELECT mc.id FROM media_children mc WHERE mc.jellyfin_id = ?
`);

const findWatchedWithoutHistory = db.prepare(`
    SELECT mc.id as media_id, mc.jellyfin_id, mc.runtime_ticks
    FROM media_children mc
    JOIN media_parents mp ON mc.parent_id = mp.id
    WHERE mc.watch_status = 'watched'
    AND mc.id NOT IN (SELECT media_id FROM playback_history WHERE user_id = ?)
`);

// ─── External Media Helper ───────────────────────────────────────────────────
/**
 * Find or create an external media_parent + media_child for imports where
 * the item doesn't exist in the local Jellyfin library.
 *
 * @param {{ mediaType: string, parentTitle: string, childTitle?: string, posterUrl?: string, releaseYear?: number, tmdbId?: string, musicbrainzId?: string, imdbId?: string, seasonNumber?: number, itemNumber?: number }} info
 * @returns {number} media_child.id
 */
function findOrCreateExternalMedia(info) {
    const { mediaType, parentTitle, childTitle, posterUrl, releaseYear,
        tmdbId, musicbrainzId, imdbId, seasonNumber, itemNumber } = info;

    // 1. Find or create media_parent
    // First check for ANY existing parent with this title (collected or external) to avoid duplicates
    let parent = /** @type {any} */ (db.prepare(
        `SELECT id FROM media_parents WHERE title = ? AND media_type = ? ORDER BY jellyfin_id IS NOT NULL DESC, id ASC LIMIT 1`
    ).get(parentTitle, mediaType));

    if (!parent) {
        const result = db.prepare(`
            INSERT INTO media_parents (title, media_type, collection_status, poster_url, release_year, tmdb_id, musicbrainz_id, imdb_id)
            VALUES (?, ?, 'external', ?, ?, ?, ?, ?)
        `).run(parentTitle, mediaType, posterUrl || null, releaseYear || null,
            tmdbId || null, musicbrainzId || null, imdbId || null);
        parent = { id: result.lastInsertRowid };
    }

    // 2. Find or create media_child
    const effectiveChildTitle = childTitle || parentTitle;
    let child = /** @type {any} */ (db.prepare(
        `SELECT id FROM media_children WHERE parent_id = ? AND title = ? AND COALESCE(season_number, 0) = ? AND COALESCE(item_number, 0) = ?`
    ).get(parent.id, effectiveChildTitle, seasonNumber || 0, itemNumber || 0));

    if (!child) {
        const result = db.prepare(`
            INSERT INTO media_children (parent_id, title, is_collected, season_number, item_number)
            VALUES (?, ?, 0, ?, ?)
        `).run(parent.id, effectiveChildTitle, seasonNumber || null, itemNumber || null);
        child = { id: result.lastInsertRowid };
    }

    return /** @type {number} */ (child.id);
}

// ─── Tier 1: Trakt Import ────────────────────────────────────────────────────

const upsertTraktHistory = db.prepare(`
    INSERT OR IGNORE INTO trakt_history (user_id, trakt_id, type, watched_at, title, show_title, season_number, episode_number, year, tmdb_id, imdb_id, trakt_slug)
    VALUES (@userId, @traktId, @type, @watchedAt, @title, @showTitle, @seasonNumber, @episodeNumber, @year, @tmdbId, @imdbId, @traktSlug)
`);

/**
 * Phase 1: Fetch raw history from Trakt API and store in trakt_history table.
 * Incremental: only fetches history newer than the latest stored record.
 * @param {number} userId - Mediajam user ID
 */
export async function backfillTrakt(userId) {
    backfillState = { running: true, currentTier: 'trakt' };
    broadcast({ type: 'backfill_start', tier: 'trakt', log: '🎬 Starting Trakt history import...', logType: 'info' });

    const identity = /** @type {any} */ (db.prepare(
        'SELECT access_token FROM user_identities WHERE user_id = ? AND provider = ?'
    ).get(userId, 'trakt'));

    if (!identity?.access_token) {
        broadcast({ type: 'backfill_error', tier: 'trakt', log: '❌ No Trakt account linked. Connect Trakt in Settings first.', logType: 'error' });
        backfillState = { running: false, currentTier: null };
        return { success: false, error: 'No Trakt account linked' };
    }

    const settings = /** @type {any} */ (db.prepare('SELECT trakt_client_id FROM app_settings WHERE id = 1').get());
    if (!settings?.trakt_client_id) {
        broadcast({ type: 'backfill_error', tier: 'trakt', log: '❌ Trakt Client ID not configured in Settings.', logType: 'error' });
        backfillState = { running: false, currentTier: null };
        return { success: false, error: 'Trakt Client ID not configured' };
    }

    // Incremental: only fetch history newer than what we already have
    const latestRow = /** @type {any} */ (db.prepare(
        'SELECT MAX(watched_at) as latest FROM trakt_history WHERE user_id = ?'
    ).get(userId));
    const startAt = latestRow?.latest || null;

    let totalStored = 0;
    let totalSkipped = 0;
    let page = 1;
    const limit = 100;
    let totalItems = 0;
    let totalPages = 0;

    try {
        while (backfillState.running) {
            const pageLabel = totalPages ? `page ${page}/${totalPages}` : `page ${page}`;
            broadcast({ type: 'backfill_progress', tier: 'trakt', log: `  ⏳ Fetching Trakt history ${pageLabel}...`, logType: 'info' });

            let apiUrl = `https://api.trakt.tv/users/me/history?page=${page}&limit=${limit}`;
            if (startAt) {
                apiUrl += `&start_at=${encodeURIComponent(startAt)}`;
            }

            const res = await fetch(apiUrl, {
                headers: {
                    'Content-Type': 'application/json',
                    'trakt-api-version': '2',
                    'trakt-api-key': settings.trakt_client_id,
                    'Authorization': `Bearer ${identity.access_token}`
                }
            });

            if (!res.ok) {
                const errorText = await res.text();
                broadcast({ type: 'backfill_error', tier: 'trakt', log: `❌ Trakt API error ${res.status}: ${errorText}`, logType: 'error' });
                break;
            }

            // Read pagination from Trakt response headers
            if (page === 1) {
                totalItems = parseInt(res.headers.get('X-Pagination-Item-Count') || '0');
                totalPages = parseInt(res.headers.get('X-Pagination-Page-Count') || '0');
                if (totalItems > 0) {
                    broadcast({
                        type: 'backfill_totals', tier: 'trakt',
                        totalItems, totalPages,
                        log: `  📊 Found ${totalItems.toLocaleString()} Trakt history events across ${totalPages} pages`,
                        logType: 'info'
                    });
                }
            }

            const items = await res.json();
            if (!items || items.length === 0) break;

            // Store raw data in trakt_history
            for (const item of items) {
                try {
                    const isMovie = item.type === 'movie';
                    const isEpisode = item.type === 'episode';

                    upsertTraktHistory.run({
                        userId,
                        traktId: item.id,
                        type: item.type,
                        watchedAt: item.watched_at,
                        title: isMovie ? (item.movie?.title || 'Unknown') : (item.episode?.title || 'Unknown'),
                        showTitle: isEpisode ? (item.show?.title || null) : null,
                        seasonNumber: isEpisode ? (item.episode?.season || null) : null,
                        episodeNumber: isEpisode ? (item.episode?.number || null) : null,
                        year: isMovie ? (item.movie?.year || null) : (item.show?.year || null),
                        tmdbId: String(item.movie?.ids?.tmdb || item.show?.ids?.tmdb || item.episode?.ids?.tmdb || ''),
                        imdbId: item.movie?.ids?.imdb || item.show?.ids?.imdb || '',
                        traktSlug: item.movie?.ids?.slug || item.show?.ids?.slug || ''
                    });
                    totalStored++;
                } catch {
                    totalSkipped++; // duplicate or bad data
                }
            }

            const progressPercent = totalPages > 0 ? Math.round((page / totalPages) * 100) : 0;
            broadcast({
                type: 'backfill_progress', tier: 'trakt',
                currentPage: page, totalPages, totalItems,
                progressPercent, totalImported: totalStored, totalSkipped,
                log: `  📦 Page ${page}${totalPages ? '/' + totalPages : ''}: ${totalStored} stored, ${totalSkipped} skipped`,
                logType: 'info'
            });

            if (items.length < limit) break;
            page++;

            // Respect Trakt rate limits
            const rateLimitRemaining = parseInt(res.headers.get('X-Ratelimit-Remaining') || '1');
            const delay = rateLimitRemaining <= 1 ? 2000 : 1100;
            await new Promise(r => setTimeout(r, delay));
        }
    } catch (e) {
        broadcast({ type: 'backfill_error', tier: 'trakt', log: `❌ Error: ${e instanceof Error ? e.message : String(e)}`, logType: 'error' });
    }

    broadcast({
        type: 'backfill_progress', tier: 'trakt',
        log: `  📥 Phase 1 complete: ${totalStored} raw records stored. Processing into playback history...`,
        logType: 'info'
    });

    // Phase 2: Process raw trakt_history into playback_history
    const processed = processTraktHistory(userId);

    broadcast({
        type: 'backfill_complete', tier: 'trakt',
        log: `✅ Trakt import complete: ${totalStored} fetched, ${processed.imported} imported, ${processed.consolidated || 0} consolidated, ${processed.external} external, ${processed.skipped} skipped`,
        logType: 'success', totalImported: processed.imported, totalSkipped: processed.skipped, totalExternal: processed.external, totalConsolidated: processed.consolidated || 0
    });
    backfillState = { running: false, currentTier: null };
    return { success: true, stored: totalStored, ...processed };
}

/**
 * Phase 2: Map raw trakt_history records into playback_history.
 * Only processes records that don't already have a corresponding playback_history entry.
 *
 * Session consolidation: Trakt often sends multiple scrobble events for a single
 * viewing session (e.g. 12 scrobbles across 3 hours for a 2h movie). We group
 * scrobbles of the same media item that fall within the item's runtime window
 * (or 4 hours as fallback) into a single session, only inserting the first
 * scrobble of each session.
 *
 * @param {number} userId - Mediajam user ID
 * @returns {{ imported: number, external: number, skipped: number, consolidated: number }}
 */
export function processTraktHistory(userId) {
    // Find trakt_history records not yet in playback_history
    const unprocessed = /** @type {any[]} */ (db.prepare(`
        SELECT th.* FROM trakt_history th
        WHERE th.user_id = ?
        AND NOT EXISTS (
            SELECT 1 FROM playback_history ph
            WHERE ph.user_id = th.user_id AND ph.external_event_id = 'trakt:' || th.trakt_id
        )
        ORDER BY th.watched_at ASC
    `).all(userId));

    let imported = 0;
    let external = 0;
    let skipped = 0;
    let consolidated = 0;

    // Prepare runtime lookup (cache to avoid repeated queries)
    const runtimeCache = /** @type {Map<number, number>} */ (new Map());
    const getRuntimeMs = (/** @type {number} */ mediaId) => {
        if (runtimeCache.has(mediaId)) return /** @type {number} */ (runtimeCache.get(mediaId));
        const row = /** @type {any} */ (db.prepare(
            'SELECT runtime_ticks FROM media_children WHERE id = ?'
        ).get(mediaId));
        // Convert ticks to milliseconds, fallback to 4 hours
        const ms = row?.runtime_ticks ? Math.round(row.runtime_ticks / 10000) : 4 * 60 * 60 * 1000;
        runtimeCache.set(mediaId, ms);
        return ms;
    };

    // Track last imported timestamp per media_id for session consolidation
    /** @type {Map<number, number>} */
    const lastSessionTime = new Map();

    for (const row of unprocessed) {
        let mediaId = null;

        // Try to map to local media via TMDB ID
        if (row.tmdb_id) {
            const match = /** @type {any} */ (db.prepare(
                'SELECT mc.id FROM media_children mc JOIN media_parents mp ON mc.parent_id = mp.id WHERE mp.tmdb_id = ? LIMIT 1'
            ).get(String(row.tmdb_id)));
            if (match) mediaId = match.id;
        }

        // If no local match, create external entry
        if (!mediaId) {
            try {
                if (row.type === 'movie') {
                    mediaId = findOrCreateExternalMedia({
                        mediaType: 'movie',
                        parentTitle: row.title || 'Unknown Movie',
                        releaseYear: row.year,
                        tmdbId: row.tmdb_id || undefined,
                        imdbId: row.imdb_id || undefined
                    });
                    external++;
                } else if (row.type === 'episode' && row.show_title) {
                    mediaId = findOrCreateExternalMedia({
                        mediaType: 'show',
                        parentTitle: row.show_title || 'Unknown Show',
                        childTitle: row.title || `Episode ${row.episode_number}`,
                        releaseYear: row.year,
                        tmdbId: row.tmdb_id || undefined,
                        imdbId: row.imdb_id || undefined,
                        seasonNumber: row.season_number,
                        itemNumber: row.episode_number
                    });
                    external++;
                }
            } catch {
                // If external creation fails, skip
            }
        }

        if (!mediaId) {
            skipped++;
            continue;
        }

        // Session consolidation: check if this scrobble is within the same
        // viewing session as the last imported scrobble for this media item
        const watchedAt = new Date(row.watched_at).getTime();
        const lastTime = lastSessionTime.get(mediaId);
        if (lastTime !== undefined) {
            const runtimeMs = getRuntimeMs(mediaId);
            // Use 1.5x runtime as the session window to account for pauses
            const sessionWindow = Math.max(runtimeMs * 1.5, 60 * 60 * 1000); // at least 1 hour
            if (watchedAt - lastTime < sessionWindow) {
                consolidated++;
                continue; // Same session — skip this scrobble
            }
        }

        const trackTitle = row.type === 'episode' ? row.title : row.title;

        const result = insertHistory.run({
            userId,
            mediaId,
            source: 'trakt',
            timestamp: row.watched_at,
            durationSeconds: null,
            completionPct: 100,
            externalEventId: `trakt:${row.trakt_id}`,
            trackName: trackTitle
        });

        if (result.changes > 0) {
            imported++;
            lastSessionTime.set(mediaId, watchedAt);
        } else {
            skipped++;
        }
    }

    return { imported, external, skipped, consolidated };
}

/**
 * Re-process all Trakt history: delete existing trakt playback_history entries
 * and re-map from raw trakt_history data. No API calls needed.
 * @param {number} userId - Mediajam user ID
 */
export function reprocessTrakt(userId) {
    backfillState = { running: true, currentTier: 'trakt' };
    broadcast({ type: 'backfill_start', tier: 'trakt', log: '🔄 Re-processing Trakt history with session consolidation...', logType: 'info' });

    // Delete existing Trakt playback history
    const deleted = db.prepare("DELETE FROM playback_history WHERE user_id = ? AND source = 'trakt'").run(userId);
    broadcast({ type: 'backfill_progress', tier: 'trakt', log: `  🗑️ Cleared ${deleted.changes} existing Trakt history entries`, logType: 'info' });

    // Re-process from raw data (now with session consolidation)
    const result = processTraktHistory(userId);

    // Recalculate play_count on media_children from actual playback_history rows
    const recalculated = db.prepare(`
        UPDATE media_children SET play_count = (
            SELECT COUNT(*) FROM playback_history WHERE media_id = media_children.id
        )
        WHERE id IN (
            SELECT DISTINCT media_id FROM playback_history WHERE user_id = ?
            UNION
            SELECT DISTINCT media_id FROM playback_history WHERE user_id = ? AND source = 'trakt'
        )
    `).run(userId, userId);

    broadcast({ type: 'backfill_progress', tier: 'trakt', log: `  📊 Recalculated play counts for ${recalculated.changes} items`, logType: 'info' });

    broadcast({
        type: 'backfill_complete', tier: 'trakt',
        log: `✅ Trakt reprocess complete: ${result.imported} imported, ${result.consolidated} consolidated into sessions, ${result.external} external, ${result.skipped} skipped`,
        logType: 'success', totalImported: result.imported, totalSkipped: result.skipped, totalExternal: result.external, totalConsolidated: result.consolidated
    });
    backfillState = { running: false, currentTier: null };
    return { success: true, ...result };
}

// ─── Tier 1: Last.fm Import ──────────────────────────────────────────────────

// ─── Prepared statements for raw scrobble storage ────────────────────────────
const insertScrobble = db.prepare(`
    INSERT OR IGNORE INTO lastfm_scrobbles (user_id, artist_name, track_name, album_name, timestamp_uts, timestamp, artist_mbid, track_mbid, album_mbid, image_url)
    VALUES (@userId, @artistName, @trackName, @albumName, @timestampUts, @timestamp, @artistMbid, @trackMbid, @albumMbid, @imageUrl)
`);

/**
 * Phase 1: Fetch scrobbles from Last.fm API and store in lastfm_scrobbles table.
 * Incremental: only fetches scrobbles newer than the latest stored one.
 * @param {number} userId - Mediajam user ID
 */
export async function backfillLastfm(userId) {
    backfillState = { running: true, currentTier: 'lastfm' };
    broadcast({ type: 'backfill_start', tier: 'lastfm', log: '🎵 Starting Last.fm history import...', logType: 'info' });

    const identity = /** @type {any} */ (db.prepare(
        'SELECT provider_uid FROM user_identities WHERE user_id = ? AND provider = ?'
    ).get(userId, 'lastfm'));

    if (!identity?.provider_uid) {
        broadcast({ type: 'backfill_error', tier: 'lastfm', log: '❌ No Last.fm account linked. Connect Last.fm in Settings first.', logType: 'error' });
        backfillState = { running: false, currentTier: null };
        return { success: false, error: 'No Last.fm account linked' };
    }

    const settings = /** @type {any} */ (db.prepare('SELECT lastfm_api_key FROM app_settings WHERE id = 1').get());
    if (!settings?.lastfm_api_key) {
        broadcast({ type: 'backfill_error', tier: 'lastfm', log: '❌ Last.fm API key not configured in Settings.', logType: 'error' });
        backfillState = { running: false, currentTier: null };
        return { success: false, error: 'Last.fm API key not configured' };
    }

    // Incremental: only fetch scrobbles newer than what we already have
    const latestRow = /** @type {any} */ (db.prepare(
        'SELECT MAX(timestamp_uts) as latest FROM lastfm_scrobbles WHERE user_id = ?'
    ).get(userId));
    const fromTimestamp = latestRow?.latest ? latestRow.latest + 1 : 0;

    let totalStored = 0;
    let totalSkipped = 0;
    let page = 1;
    const limit = 200;
    const username = identity.provider_uid;
    let totalItems = 0;
    let totalPages = 0;

    try {
        // Phase 1: Fetch and store raw scrobbles
        broadcast({
            type: 'backfill_progress', tier: 'lastfm', log: fromTimestamp > 0
                ? `  📦 Incremental sync — fetching scrobbles after ${new Date(fromTimestamp * 1000).toISOString().split('T')[0]}...`
                : '  📦 Full sync — fetching all scrobbles...', logType: 'info'
        });

        while (backfillState.running) {
            const pageLabel = totalPages ? `page ${page}/${totalPages}` : `page ${page}`;
            broadcast({ type: 'backfill_progress', tier: 'lastfm', log: `  ⏳ Fetching Last.fm scrobbles ${pageLabel}...`, logType: 'info' });

            let apiUrl = `https://ws.audioscrobbler.com/2.0/?method=user.getrecenttracks&user=${encodeURIComponent(username)}&api_key=${settings.lastfm_api_key}&format=json&limit=${limit}&page=${page}`;
            if (fromTimestamp > 0) {
                apiUrl += `&from=${fromTimestamp}`;
            }

            // Retry logic: up to 3 attempts with exponential backoff
            let res = null;
            for (let attempt = 1; attempt <= 3; attempt++) {
                try {
                    res = await fetch(apiUrl);
                    if (res.ok) break;
                    if (res.status === 429 || res.status >= 500) {
                        const waitSec = attempt * 5;
                        broadcast({ type: 'backfill_progress', tier: 'lastfm', log: `  ⚠️ Last.fm returned ${res.status}, retrying in ${waitSec}s (attempt ${attempt}/3)...`, logType: 'warn' });
                        await new Promise(r => setTimeout(r, waitSec * 1000));
                        res = null;
                        continue;
                    }
                    break;
                } catch (fetchErr) {
                    const waitSec = attempt * 5;
                    broadcast({ type: 'backfill_progress', tier: 'lastfm', log: `  ⚠️ Network error, retrying in ${waitSec}s (attempt ${attempt}/3)...`, logType: 'warn' });
                    await new Promise(r => setTimeout(r, waitSec * 1000));
                }
            }

            if (!res || !res.ok) {
                const status = res ? res.status : 'network error';
                broadcast({ type: 'backfill_error', tier: 'lastfm', log: `❌ Last.fm API error ${status} after 3 retries on page ${page}`, logType: 'error' });
                break;
            }

            const data = await res.json();
            const tracks = data?.recenttracks?.track || [];
            if (tracks.length === 0) break;

            if (page === 1) {
                totalItems = parseInt(data?.recenttracks?.['@attr']?.total || '0');
                totalPages = parseInt(data?.recenttracks?.['@attr']?.totalPages || '0');
                if (totalItems > 0) {
                    broadcast({
                        type: 'backfill_totals', tier: 'lastfm',
                        totalItems, totalPages,
                        log: `  📊 Found ${totalItems.toLocaleString()} Last.fm scrobbles across ${totalPages} pages`,
                        logType: 'info'
                    });
                }
            }

            for (const track of tracks) {
                if (track['@attr']?.nowplaying) continue;
                const uts = track.date?.uts;
                if (!uts) continue;

                const result = insertScrobble.run({
                    userId,
                    artistName: track.artist?.['#text'] || track.artist?.name || '',
                    trackName: track.name || '',
                    albumName: track.album?.['#text'] || '',
                    timestampUts: parseInt(uts),
                    timestamp: new Date(parseInt(uts) * 1000).toISOString(),
                    artistMbid: track.artist?.mbid || '',
                    trackMbid: track.mbid || '',
                    albumMbid: track.album?.mbid || '',
                    imageUrl: track.image?.find((/** @type {any} */ i) => i.size === 'large')?.['#text'] ||
                        track.image?.find((/** @type {any} */ i) => i.size === 'medium')?.['#text'] || null
                });

                if (result.changes > 0) totalStored++;
                else totalSkipped++;
            }

            const progressPercent = totalPages > 0 ? Math.round((page / totalPages) * 100) : 0;
            broadcast({
                type: 'backfill_progress', tier: 'lastfm',
                currentPage: page, totalPages, totalItems,
                progressPercent, totalImported: totalStored, totalSkipped,
                log: `  📦 Page ${page}${totalPages ? '/' + totalPages : ''}: ${totalStored} stored, ${totalSkipped} already existed`,
                logType: 'info'
            });

            const currentTotalPages = parseInt(data?.recenttracks?.['@attr']?.totalPages || '1');
            if (page >= currentTotalPages) break;
            page++;
            await new Promise(r => setTimeout(r, 500));
        }
    } catch (e) {
        broadcast({ type: 'backfill_error', tier: 'lastfm', log: `❌ Error on page ${page}: ${e instanceof Error ? e.message : String(e)}`, logType: 'error' });
    }

    broadcast({
        type: 'backfill_progress', tier: 'lastfm',
        log: `  ✅ Phase 1 complete: ${totalStored} new scrobbles stored. Now mapping to local library...`,
        logType: 'success'
    });

    // Phase 2: Process raw scrobbles into playback_history
    const processResult = processLastfmScrobbles(userId);

    broadcast({
        type: 'backfill_complete', tier: 'lastfm',
        log: `✅ Last.fm import complete: ${totalStored} new scrobbles fetched, ${processResult.imported} mapped to library, ${processResult.external} external, ${processResult.skipped} unmapped`,
        logType: 'success', totalImported: processResult.imported, totalSkipped: processResult.skipped, totalExternal: processResult.external
    });
    backfillState = { running: false, currentTier: null };
    return { success: true, stored: totalStored, ...processResult };
}

/**
 * Phase 2: Map raw scrobbles from lastfm_scrobbles into playback_history.
 * Only processes scrobbles that don't already have a corresponding playback_history entry.
 * @param {number} userId - Mediajam user ID
 * @returns {{ imported: number, external: number, skipped: number }}
 */
export function processLastfmScrobbles(userId) {
    let imported = 0;
    let external = 0;
    let skipped = 0;

    // Get all scrobbles that aren't yet in playback_history
    const scrobbles = /** @type {any[]} */ (db.prepare(`
        SELECT ls.* FROM lastfm_scrobbles ls
        WHERE ls.user_id = ?
        AND NOT EXISTS (
            SELECT 1 FROM playback_history ph
            WHERE ph.external_event_id = 'lastfm:' || ls.artist_name || ':' || ls.track_name || ':' || ls.timestamp_uts
        )
        ORDER BY ls.timestamp_uts ASC
    `).all(userId));

    broadcast({ type: 'backfill_progress', tier: 'lastfm', log: `  🔗 Mapping ${scrobbles.length} scrobbles to local library...`, logType: 'info' });

    for (const s of scrobbles) {
        let mediaId = null;

        // 1. Best: artist MBID + album name
        if (s.artist_mbid && s.album_name) {
            const match = /** @type {any} */ (db.prepare(
                'SELECT mc.id FROM media_children mc JOIN media_parents mp ON mc.parent_id = mp.id WHERE mp.musicbrainz_id = ? AND mc.title = ? COLLATE NOCASE LIMIT 1'
            ).get(s.artist_mbid, s.album_name));
            if (match) mediaId = match.id;
        }

        // 2. Artist name + album name
        if (!mediaId && s.artist_name && s.album_name) {
            const match = /** @type {any} */ (db.prepare(
                'SELECT mc.id FROM media_children mc JOIN media_parents mp ON mc.parent_id = mp.id WHERE mp.media_type = ? AND mp.title = ? COLLATE NOCASE AND mc.title = ? COLLATE NOCASE LIMIT 1'
            ).get('artist', s.artist_name, s.album_name));
            if (match) mediaId = match.id;
        }

        // 3. Artist MBID only — ONLY when scrobble has no album name
        //    (if album_name existed but didn't match, we don't want to pick a random album)
        if (!mediaId && s.artist_mbid && !s.album_name) {
            const match = /** @type {any} */ (db.prepare(
                'SELECT mc.id FROM media_children mc JOIN media_parents mp ON mc.parent_id = mp.id WHERE mp.musicbrainz_id = ? LIMIT 1'
            ).get(s.artist_mbid));
            if (match) mediaId = match.id;
        }

        // 4. Artist name only — ONLY when scrobble has no album name
        if (!mediaId && s.artist_name && !s.album_name) {
            const match = /** @type {any} */ (db.prepare(
                'SELECT mc.id FROM media_children mc JOIN media_parents mp ON mc.parent_id = mp.id WHERE mp.media_type = ? AND mp.title = ? COLLATE NOCASE LIMIT 1'
            ).get('artist', s.artist_name));
            if (match) mediaId = match.id;
        }

        // 5. Create external entry (album-specific when album name available)
        if (!mediaId && s.artist_name) {
            try {
                mediaId = findOrCreateExternalMedia({
                    mediaType: 'artist',
                    parentTitle: s.artist_name,
                    childTitle: s.album_name || s.track_name || s.artist_name,
                    posterUrl: s.image_url && s.image_url.length > 0 ? s.image_url : undefined,
                    musicbrainzId: s.artist_mbid || undefined
                });
                external++;
            } catch { /* skip */ }
        }

        if (!mediaId) {
            skipped++;
            continue;
        }

        const externalEventId = `lastfm:${s.artist_name}:${s.track_name}:${s.timestamp_uts}`;
        const result = insertHistory.run({
            userId,
            mediaId,
            source: 'lastfm',
            timestamp: s.timestamp,
            durationSeconds: null,
            completionPct: 100,
            externalEventId,
            trackName: s.track_name || null
        });

        if (result.changes > 0) imported++;
        else skipped++;
    }

    return { imported, external, skipped };
}

/**
 * Re-process all Last.fm scrobbles: delete existing playback_history entries
 * and re-map from raw lastfm_scrobbles data. No API calls needed.
 * @param {number} userId - Mediajam user ID
 */
export async function reprocessLastfm(userId) {
    backfillState = { running: true, currentTier: 'lastfm' };
    broadcast({ type: 'backfill_start', tier: 'lastfm', log: '🔄 Re-processing Last.fm scrobbles from local data...', logType: 'info' });

    // Delete existing lastfm entries from playback_history
    const deleted = db.prepare("DELETE FROM playback_history WHERE source = 'lastfm' AND user_id = ?").run(userId);
    broadcast({ type: 'backfill_progress', tier: 'lastfm', log: `  🗑️ Cleared ${deleted.changes} existing Last.fm play history entries`, logType: 'info' });

    // Re-process from raw scrobbles
    const result = processLastfmScrobbles(userId);

    broadcast({
        type: 'backfill_complete', tier: 'lastfm',
        log: `✅ Re-processing complete: ${result.imported} mapped, ${result.external} external, ${result.skipped} unmapped`,
        logType: 'success', totalImported: result.imported, totalSkipped: result.skipped, totalExternal: result.external
    });
    backfillState = { running: false, currentTier: null };
    return { success: true, ...result };
}

// ─── Tier 2: Jellyfin Playback Reporting ─────────────────────────────────────
/**
 * Import history from Jellyfin's Playback Reporting Plugin SQLite database.
 * @param {number} userId - Mediajam user ID
 * @param {string} dbPath - Path to playback_reporting.db
 */
export async function backfillJellyfinPR(userId, dbPath) {
    backfillState = { running: true, currentTier: 'jellyfin' };
    broadcast({ type: 'backfill_start', tier: 'jellyfin', log: '📊 Starting Jellyfin Playback Reporting import...', logType: 'info' });

    let prDb;
    try {
        prDb = new Database(dbPath, { readonly: true });
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        broadcast({
            type: 'backfill_error', tier: 'jellyfin',
            log: `❌ Cannot open playback_reporting.db: ${msg}. Alternatives:\n` +
                `  1. Skip this tier (Tier 3 will still create legacy entries)\n` +
                `  2. Ensure the file is mounted in Docker: -v /path/to/playback_reporting.db:/app/jellyfin/playback_reporting.db:ro\n` +
                `  3. Use Trakt/Last.fm imports instead (Tier 1)`,
            logType: 'error'
        });
        backfillState = { running: false, currentTier: null };
        return { success: false, error: `Cannot open DB: ${msg}` };
    }

    let totalImported = 0;
    let totalSkipped = 0;

    try {
        // Check if the PlaybackActivity table exists
        const tableCheck = prDb.prepare(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='PlaybackActivity'"
        ).get();

        if (!tableCheck) {
            broadcast({ type: 'backfill_error', tier: 'jellyfin', log: '❌ PlaybackActivity table not found in database.', logType: 'error' });
            backfillState = { running: false, currentTier: null };
            return { success: false, error: 'PlaybackActivity table not found' };
        }

        const activities = /** @type {any[]} */ (prDb.prepare(
            'SELECT rowid, ItemId, DateCreated, PlayDuration FROM PlaybackActivity ORDER BY DateCreated ASC'
        ).all());

        broadcast({ type: 'backfill_progress', tier: 'jellyfin', log: `  📊 Found ${activities.length} playback events`, logType: 'info' });

        for (let i = 0; i < activities.length; i++) {
            if (!backfillState.running) break;

            const activity = activities[i];
            const itemId = activity.ItemId;
            if (!itemId) { totalSkipped++; continue; }

            // Map to media_children
            const match = /** @type {any} */ (findMediaByJellyfinId.get(itemId));
            if (!match) { totalSkipped++; continue; }

            const durationSeconds = activity.PlayDuration ? Math.round(activity.PlayDuration) : null;
            const timestamp = activity.DateCreated || new Date().toISOString();

            const result = insertHistory.run({
                userId,
                mediaId: match.id,
                source: 'jellyfin_pr',
                timestamp,
                durationSeconds,
                completionPct: null,
                externalEventId: `jellyfin_pr:${activity.rowid}`,
                trackName: null
            });

            if (result.changes > 0) totalImported++;
            else totalSkipped++;

            // Progress broadcast every 500 items
            if ((i + 1) % 500 === 0) {
                broadcast({
                    type: 'backfill_progress', tier: 'jellyfin',
                    log: `  📦 Processed ${i + 1}/${activities.length}: ${totalImported} imported`,
                    logType: 'info'
                });
            }
        }
    } catch (e) {
        broadcast({ type: 'backfill_error', tier: 'jellyfin', log: `❌ Error: ${e instanceof Error ? e.message : String(e)}`, logType: 'error' });
    } finally {
        prDb.close();
    }

    broadcast({
        type: 'backfill_complete', tier: 'jellyfin',
        log: `✅ Jellyfin PR import complete: ${totalImported} new events, ${totalSkipped} skipped/duplicates`,
        logType: 'success', totalImported, totalSkipped
    });
    backfillState = { running: false, currentTier: null };
    return { success: true, imported: totalImported, skipped: totalSkipped };
}

// ─── Tier 3: Binary Fallback ─────────────────────────────────────────────────
/**
 * Create legacy events for items marked watched but not in playback_history.
 * @param {number} userId - Mediajam user ID
 */
export async function backfillLegacy(userId) {
    backfillState = { running: true, currentTier: 'legacy' };
    broadcast({ type: 'backfill_start', tier: 'legacy', log: '📁 Starting legacy fallback import...', logType: 'info' });

    let totalImported = 0;
    let totalSkipped = 0;

    try {
        const items = /** @type {any[]} */ (findWatchedWithoutHistory.all(userId));
        broadcast({ type: 'backfill_progress', tier: 'legacy', log: `  📁 Found ${items.length} watched items without history`, logType: 'info' });

        for (const item of items) {
            if (!backfillState.running) break;

            const durationSeconds = item.runtime_ticks ? Math.round(item.runtime_ticks / 10000000) : null;

            const result = insertHistory.run({
                userId,
                mediaId: item.media_id,
                source: 'legacy',
                timestamp: new Date().toISOString(),
                durationSeconds,
                completionPct: 100,
                externalEventId: `legacy:${item.media_id}:${userId}`,
                trackName: null
            });

            if (result.changes > 0) totalImported++;
            else totalSkipped++;
        }
    } catch (e) {
        broadcast({ type: 'backfill_error', tier: 'legacy', log: `❌ Error: ${e instanceof Error ? e.message : String(e)}`, logType: 'error' });
    }

    broadcast({
        type: 'backfill_complete', tier: 'legacy',
        log: `✅ Legacy import complete: ${totalImported} new events, ${totalSkipped} skipped/duplicates`,
        logType: 'success', totalImported, totalSkipped
    });
    backfillState = { running: false, currentTier: null };
    return { success: true, imported: totalImported, skipped: totalSkipped };
}

/**
 * Stop the current backfill operation.
 */
export function stopBackfill() {
    backfillState.running = false;
}
