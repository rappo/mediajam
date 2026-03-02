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
    INSERT OR IGNORE INTO playback_history (user_id, media_id, source, timestamp, duration_consumed_seconds, completion_pct, external_event_id)
    VALUES (@userId, @mediaId, @source, @timestamp, @durationSeconds, @completionPct, @externalEventId)
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
    let page = 1;
    const limit = 100;

    try {
        while (backfillState.running) {
            broadcast({ type: 'backfill_progress', tier: 'trakt', log: `  ⏳ Fetching Trakt history page ${page}...`, logType: 'info' });

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

            const items = await res.json();
            if (!items || items.length === 0) break;

            for (const item of items) {
                const traktId = item.id;
                const watchedAt = item.watched_at;
                const tmdbId = item.movie?.ids?.tmdb || item.episode?.ids?.tmdb || item.show?.ids?.tmdb;

                // Try to map to local media via TMDB ID
                let mediaId = null;
                if (tmdbId) {
                    const match = /** @type {any} */ (db.prepare(
                        'SELECT mc.id FROM media_children mc JOIN media_parents mp ON mc.parent_id = mp.id WHERE mp.tmdb_id = ? LIMIT 1'
                    ).get(String(tmdbId)));
                    if (match) mediaId = match.id;
                }

                if (!mediaId) {
                    totalSkipped++;
                    continue;
                }

                const result = insertHistory.run({
                    userId,
                    mediaId,
                    source: 'trakt',
                    timestamp: watchedAt,
                    durationSeconds: null,
                    completionPct: 100,
                    externalEventId: `trakt:${traktId}`
                });

                if (result.changes > 0) totalImported++;
                else totalSkipped++;
            }

            broadcast({
                type: 'backfill_progress', tier: 'trakt',
                log: `  📦 Page ${page}: ${totalImported} imported, ${totalSkipped} skipped`,
                logType: 'info'
            });

            if (items.length < limit) break;
            page++;
            await new Promise(r => setTimeout(r, 1100)); // Trakt rate limit: 1 req/sec
        }
    } catch (e) {
        broadcast({ type: 'backfill_error', tier: 'trakt', log: `❌ Error: ${e instanceof Error ? e.message : String(e)}`, logType: 'error' });
    }

    broadcast({
        type: 'backfill_complete', tier: 'trakt',
        log: `✅ Trakt import complete: ${totalImported} new events, ${totalSkipped} skipped/duplicates`,
        logType: 'success', totalImported, totalSkipped
    });
    backfillState = { running: false, currentTier: null };
    return { success: true, imported: totalImported, skipped: totalSkipped };
}

// ─── Tier 1: Last.fm Import ──────────────────────────────────────────────────
/**
 * Import listening history from Last.fm.
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

    let totalImported = 0;
    let totalSkipped = 0;
    let page = 1;
    const limit = 200;
    const username = identity.provider_uid;

    try {
        while (backfillState.running) {
            broadcast({ type: 'backfill_progress', tier: 'lastfm', log: `  ⏳ Fetching Last.fm scrobbles page ${page}...`, logType: 'info' });

            const apiUrl = `https://ws.audioscrobbler.com/2.0/?method=user.getrecenttracks&user=${encodeURIComponent(username)}&api_key=${settings.lastfm_api_key}&format=json&limit=${limit}&page=${page}`;
            const res = await fetch(apiUrl);

            if (!res.ok) {
                broadcast({ type: 'backfill_error', tier: 'lastfm', log: `❌ Last.fm API error ${res.status}`, logType: 'error' });
                break;
            }

            const data = await res.json();
            const tracks = data?.recenttracks?.track || [];
            if (tracks.length === 0) break;

            for (const track of tracks) {
                // Skip currently playing tracks (no timestamp)
                if (track['@attr']?.nowplaying) continue;

                const uts = track.date?.uts;
                if (!uts) continue;

                const artist = track.artist?.['#text'] || track.artist?.name || '';
                const trackName = track.name || '';
                const mbid = track.mbid;
                const timestamp = new Date(parseInt(uts) * 1000).toISOString();

                // Try to map by MusicBrainz ID or by artist name match
                let mediaId = null;
                if (mbid) {
                    const match = /** @type {any} */ (db.prepare(
                        'SELECT mc.id FROM media_children mc JOIN media_parents mp ON mc.parent_id = mp.id WHERE mp.musicbrainz_id = ? LIMIT 1'
                    ).get(mbid));
                    if (match) mediaId = match.id;
                }

                if (!mediaId && artist) {
                    // Fuzzy: try matching parent artist name
                    const match = /** @type {any} */ (db.prepare(
                        'SELECT mc.id FROM media_children mc JOIN media_parents mp ON mc.parent_id = mp.id WHERE mp.media_type = ? AND mp.title = ? LIMIT 1'
                    ).get('artist', artist));
                    if (match) mediaId = match.id;
                }

                if (!mediaId) {
                    totalSkipped++;
                    continue;
                }

                const externalEventId = `lastfm:${artist}:${trackName}:${uts}`;

                const result = insertHistory.run({
                    userId,
                    mediaId,
                    source: 'lastfm',
                    timestamp,
                    durationSeconds: null,
                    completionPct: 100,
                    externalEventId
                });

                if (result.changes > 0) totalImported++;
                else totalSkipped++;
            }

            broadcast({
                type: 'backfill_progress', tier: 'lastfm',
                log: `  📦 Page ${page}: ${totalImported} imported, ${totalSkipped} skipped`,
                logType: 'info'
            });

            // Check if we've reached the last page
            const totalPages = parseInt(data?.recenttracks?.['@attr']?.totalPages || '1');
            if (page >= totalPages) break;
            page++;
            await new Promise(r => setTimeout(r, 250)); // Last.fm rate limit is generous
        }
    } catch (e) {
        broadcast({ type: 'backfill_error', tier: 'lastfm', log: `❌ Error: ${e instanceof Error ? e.message : String(e)}`, logType: 'error' });
    }

    broadcast({
        type: 'backfill_complete', tier: 'lastfm',
        log: `✅ Last.fm import complete: ${totalImported} new scrobbles, ${totalSkipped} skipped/duplicates`,
        logType: 'success', totalImported, totalSkipped
    });
    backfillState = { running: false, currentTier: null };
    return { success: true, imported: totalImported, skipped: totalSkipped };
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
                externalEventId: `jellyfin_pr:${activity.rowid}`
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
                timestamp: new Date().toISOString(), // Fallback — no historical timestamp available
                durationSeconds,
                completionPct: 100,
                externalEventId: `legacy:${item.media_id}:${userId}`
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
