import db from '$lib/server/db.js';
import Database from 'better-sqlite3';

// ─── SSE Listeners ───────────────────────────────────────────────────────────
/** @type {Set<(data: any) => void>} */
const listeners = new Set();

/** @type {{ running: boolean, currentTier: string | null }} */
let backfillState = { running: false, currentTier: null };

function broadcast(data) {
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
    let parent = /** @type {any} */ (db.prepare(
        `SELECT id FROM media_parents WHERE title = ? AND media_type = ? AND collection_status = 'external'`
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
/**
 * Import playback history from Trakt.
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

    let totalImported = 0;
    let totalSkipped = 0;
    let totalExternal = 0;
    let page = 1;
    const limit = 100;
    let totalItems = 0;
    let totalPages = 0;

    try {
        while (backfillState.running) {
            const pageLabel = totalPages ? `page ${page}/${totalPages}` : `page ${page}`;
            broadcast({ type: 'backfill_progress', tier: 'trakt', log: `  ⏳ Fetching Trakt history ${pageLabel}...`, logType: 'info' });

            const res = await fetch(`https://api.trakt.tv/users/me/history?page=${page}&limit=${limit}`, {
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

            // Read pagination from Trakt response headers (available on every page)
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

            for (const item of items) {
                const traktId = item.id;
                const watchedAt = item.watched_at;
                const tmdbId = item.movie?.ids?.tmdb || item.episode?.ids?.tmdb || item.show?.ids?.tmdb;
                const imdbId = item.movie?.ids?.imdb || item.show?.ids?.imdb;

                // Try to map to local media via TMDB ID
                let mediaId = null;
                if (tmdbId) {
                    const match = /** @type {any} */ (db.prepare(
                        'SELECT mc.id FROM media_children mc JOIN media_parents mp ON mc.parent_id = mp.id WHERE mp.tmdb_id = ? LIMIT 1'
                    ).get(String(tmdbId)));
                    if (match) mediaId = match.id;
                }

                // If no local match, create external entry
                if (!mediaId) {
                    try {
                        if (item.type === 'movie' && item.movie) {
                            mediaId = findOrCreateExternalMedia({
                                mediaType: 'movie',
                                parentTitle: item.movie.title || 'Unknown Movie',
                                releaseYear: item.movie.year,
                                tmdbId: tmdbId ? String(tmdbId) : undefined,
                                imdbId: imdbId || undefined
                            });
                            totalExternal++;
                        } else if (item.type === 'episode' && item.show && item.episode) {
                            mediaId = findOrCreateExternalMedia({
                                mediaType: 'show',
                                parentTitle: item.show.title || 'Unknown Show',
                                childTitle: item.episode.title || `Episode ${item.episode.number}`,
                                releaseYear: item.show.year,
                                tmdbId: item.show.ids?.tmdb ? String(item.show.ids.tmdb) : undefined,
                                imdbId: item.show.ids?.imdb || undefined,
                                seasonNumber: item.episode.season,
                                itemNumber: item.episode.number
                            });
                            totalExternal++;
                        }
                    } catch (extErr) {
                        // If external creation fails, skip silently
                    }
                }

                if (!mediaId) {
                    totalSkipped++;
                    continue;
                }

                const trackTitle = item.type === 'episode'
                    ? (item.episode?.title || null)
                    : (item.movie?.title || null);

                const result = insertHistory.run({
                    userId,
                    mediaId,
                    source: 'trakt',
                    timestamp: watchedAt,
                    durationSeconds: null,
                    completionPct: 100,
                    externalEventId: `trakt:${traktId}`,
                    trackName: trackTitle
                });

                if (result.changes > 0) totalImported++;
                else totalSkipped++;
            }

            const progressPercent = totalPages > 0 ? Math.round((page / totalPages) * 100) : 0;
            broadcast({
                type: 'backfill_progress', tier: 'trakt',
                currentPage: page, totalPages, totalItems,
                progressPercent, totalImported, totalSkipped,
                log: `  📦 Page ${page}${totalPages ? '/' + totalPages : ''}: ${totalImported} imported, ${totalSkipped} skipped`,
                logType: 'info'
            });

            if (items.length < limit) break;
            page++;

            // Respect Trakt rate limits: check X-Ratelimit header, default 1.1s
            const rateLimitRemaining = parseInt(res.headers.get('X-Ratelimit-Remaining') || '1');
            const delay = rateLimitRemaining <= 1 ? 2000 : 1100;
            await new Promise(r => setTimeout(r, delay));
        }
    } catch (e) {
        broadcast({ type: 'backfill_error', tier: 'trakt', log: `❌ Error: ${e instanceof Error ? e.message : String(e)}`, logType: 'error' });
    }

    broadcast({
        type: 'backfill_complete', tier: 'trakt',
        log: `✅ Trakt import complete: ${totalImported} imported, ${totalExternal} external, ${totalSkipped} skipped`,
        logType: 'success', totalImported, totalSkipped, totalExternal
    });
    backfillState = { running: false, currentTier: null };
    return { success: true, imported: totalImported, skipped: totalSkipped };
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
