import db from '$lib/server/db.js';
import { getJellyfinApis, getItemsApi } from '$lib/server/jellyfin.js';
import { logInfo, logWarn, logError } from '$lib/server/logger.js';

const UNKNOWN_DATE = '1970-01-01T00:00:00.000Z';

// ─── SSE Listeners ───────────────────────────────────────────────────────────
/** @type {Set<(data: any) => void>} */
const listeners = new Set();

/** @type {{ running: boolean }} */
let engineState = { running: false };

/** @type {Array<{time: string, message: string, type: string}>} */
let recentLogs = [];

function broadcast(data) {
    if (data.log) {
        const entry = { time: new Date().toLocaleTimeString(), message: data.log, type: data.logType || 'info' };
        recentLogs.push(entry);
        if (recentLogs.length > 5000) recentLogs = recentLogs.slice(-4000);
        // Also console log with prefix
        const prefix = data.logType === 'error' ? '❌' : data.logType === 'success' ? '✅' : data.logType === 'warning' ? '⚠️' : '🔗';
        console.log(`[jellyfin-history] [${entry.time}] ${prefix} ${data.log}`);
    }
    for (const listener of listeners) {
        try {
            listener(data);
        } catch {
            listeners.delete(listener);
        }
    }
}

/** @param {(data: any) => void} callback */
export function addJellyfinHistoryListener(callback) {
    listeners.add(callback);
    return () => listeners.delete(callback);
}

export function isJellyfinHistoryRunning() {
    return engineState.running;
}

export function getJellyfinHistoryStatus() {
    return {
        running: engineState.running,
        logs: recentLogs.slice(),
    };
}

// ─── Trakt Cross-Reference ──────────────────────────────────────────────────

/**
 * @param {number} userId
 * @param {string|null} tmdbId
 * @returns {string|null}
 */
function findTraktDateForMovie(userId, tmdbId) {
    if (!tmdbId) return null;
    const row = /** @type {any} */ (db.prepare(
        "SELECT watched_at FROM trakt_history WHERE user_id = ? AND tmdb_id = ? AND type = 'movie' ORDER BY watched_at DESC LIMIT 1"
    ).get(userId, tmdbId));
    return row?.watched_at || null;
}

/**
 * @param {number} userId
 * @param {string|null} showTmdbId
 * @param {number|null} season
 * @param {number|null} episode
 * @returns {string|null}
 */
function findTraktDateForEpisode(userId, showTmdbId, season, episode) {
    if (!showTmdbId || season == null || episode == null) return null;
    const row = /** @type {any} */ (db.prepare(
        "SELECT watched_at FROM trakt_history WHERE user_id = ? AND tmdb_id = ? AND season_number = ? AND episode_number = ? ORDER BY watched_at DESC LIMIT 1"
    ).get(userId, showTmdbId, season, episode));
    return row?.watched_at || null;
}

// ─── Main Sync Function ─────────────────────────────────────────────────────

/**
 * @param {number} userId
 */
export async function syncJellyfinHistory(userId) {
    if (engineState.running) {
        broadcast({ log: 'Jellyfin history sync already running', logType: 'warning' });
        return;
    }

    engineState.running = true;
    recentLogs = [];

    const settings = /** @type {any} */ (db.prepare('SELECT * FROM app_settings WHERE id = 1').get());
    const user = /** @type {any} */ (db.prepare('SELECT * FROM users WHERE id = ?').get(userId));

    if (!settings?.jellyfin_url || !user?.jellyfin_access_token) {
        broadcast({ log: 'Jellyfin not configured', logType: 'error' });
        broadcast({ type: 'jellyfin_history_complete', error: 'Jellyfin not configured' });
        engineState.running = false;
        return;
    }

    broadcast({ type: 'jellyfin_history_start' });
    broadcast({ log: '🔗 Starting Jellyfin watch history sync...', logType: 'info' });

    const { api } = getJellyfinApis(settings.jellyfin_url, user.jellyfin_access_token);
    const itemsApi = getItemsApi(api);
    const jellyfinUserId = user.jellyfin_user_id;

    // Use upsert: insert new entries, upgrade unknown-date entries with real dates.
    // Don't delete existing history — preserve good timestamps from previous runs.
    const insertHistory = db.prepare(`
        INSERT INTO playback_history (user_id, media_id, source, timestamp, completion_pct, external_event_id)
        VALUES (@userId, @mediaId, 'jellyfin', @timestamp, 100, @externalEventId)
        ON CONFLICT(external_event_id) DO UPDATE SET
            timestamp = CASE
                WHEN excluded.timestamp IS NOT NULL
                    AND excluded.timestamp != '1970-01-01T00:00:00.000Z'
                    AND (playback_history.timestamp IS NULL
                         OR playback_history.timestamp = '1970-01-01T00:00:00.000Z')
                THEN excluded.timestamp
                ELSE playback_history.timestamp
            END
    `);

    const findChildByJellyfinId = db.prepare(
        'SELECT id FROM media_children WHERE jellyfin_id = ?'
    );

    const findChildByTmdbId = db.prepare(
        `SELECT mc.id FROM media_children mc
         JOIN media_parents mp ON mc.parent_id = mp.id
         WHERE mp.tmdb_id = ? AND mp.media_type = 'movie'
         LIMIT 1`
    );

    const findParentByChildId = db.prepare(
        'SELECT mp.tmdb_id FROM media_parents mp JOIN media_children mc ON mc.parent_id = mp.id WHERE mc.id = ?'
    );

    let synced = 0;
    let skipped = 0;
    let traktMatched = 0;
    let noDate = 0;
    let notFound = 0;
    let errors = 0;

    try {
        // ── Movies ──────────────────────────────────────────────────────────
        broadcast({ log: '🎬 Fetching played movies from Jellyfin...', logType: 'info' });
        const moviesRes = await itemsApi.getItems({
            userId: jellyfinUserId,
            includeItemTypes: ['Movie'],
            isPlayed: true,
            recursive: true,
            fields: ['ProviderIds'],
            enableUserData: true,
            limit: 10000,
        });

        const movies = moviesRes.data.Items || [];
        broadcast({ log: `🎬 Found ${movies.length} played movies`, logType: 'info' });
        logInfo('jellyfin-history', `Found ${movies.length} played movies`);

        // Batch all movie inserts in a single transaction for performance
        db.transaction(() => {
            for (let idx = 0; idx < movies.length; idx++) {
                const movie = movies[idx];
                const childJellyfinId = movie.Id + '_child';
                let child = /** @type {any} */ (findChildByJellyfinId.get(childJellyfinId));

                // Fallback: lookup by TMDB ID if child not found by jellyfin_id
                if (!child && movie.ProviderIds?.Tmdb) {
                    child = /** @type {any} */ (findChildByTmdbId.get(movie.ProviderIds.Tmdb));
                }

                if (!child) {
                    notFound++;
                    continue;
                }

                let playedDate = movie.UserData?.LastPlayedDate;

                // Jellyfin only stores most-recent play date, and sometimes none at all.
                // Always check Trakt as a potentially better source when Jellyfin has no date.
                if (!playedDate) {
                    const tmdbId = movie.ProviderIds?.Tmdb || null;
                    const traktDate = findTraktDateForMovie(userId, tmdbId);
                    if (traktDate) {
                        playedDate = traktDate;
                        traktMatched++;
                    } else {
                        // Real play, unknown date — use null so UI can show "Unknown date"
                        playedDate = null;
                        noDate++;
                    }
                }

                const eventId = `jellyfin:movie:${movie.Id}`;
                try {
                    const result = insertHistory.run({ userId, mediaId: child.id, timestamp: playedDate, externalEventId: eventId });
                    if (result.changes > 0) synced++;
                    else skipped++;
                } catch (e) {
                    errors++;
                    logError('jellyfin-history', `Error inserting movie ${movie.Name}: ${e instanceof Error ? e.message : String(e)}`);
                }
            }
        })();
        broadcast({
            type: 'jellyfin_history_progress',
            phase: 'movies',
            done: movies.length,
            total: movies.length,
            log: `🎬 Movies: ${movies.length}/${movies.length} (${synced} synced, ${notFound} not found)`,
            logType: 'info'
        });

        // ── Episodes ────────────────────────────────────────────────────────
        broadcast({ log: '📺 Fetching played episodes from Jellyfin...', logType: 'info' });
        const episodesRes = await itemsApi.getItems({
            userId: jellyfinUserId,
            includeItemTypes: ['Episode'],
            isPlayed: true,
            recursive: true,
            fields: ['ProviderIds'],
            enableUserData: true,
            limit: 50000,
        });

        const episodes = episodesRes.data.Items || [];
        broadcast({ log: `📺 Found ${episodes.length} played episodes`, logType: 'info' });
        logInfo('jellyfin-history', `Found ${episodes.length} played episodes`);

        // Batch all episode inserts in a single transaction for performance
        db.transaction(() => {
            for (let idx = 0; idx < episodes.length; idx++) {
                const ep = episodes[idx];
                const child = /** @type {any} */ (findChildByJellyfinId.get(ep.Id));
                if (!child) { notFound++; continue; }

                let playedDate = ep.UserData?.LastPlayedDate;

                if (!playedDate) {
                    const parent = /** @type {any} */ (findParentByChildId.get(child.id));
                    const showTmdbId = parent?.tmdb_id || ep.ProviderIds?.Tmdb || null;
                    const traktDate = findTraktDateForEpisode(userId, showTmdbId, ep.ParentIndexNumber ?? null, ep.IndexNumber ?? null);
                    if (traktDate) {
                        playedDate = traktDate;
                        traktMatched++;
                    } else {
                        playedDate = null;
                        noDate++;
                    }
                }

                const eventId = `jellyfin:episode:${ep.Id}`;
                try {
                    const result = insertHistory.run({ userId, mediaId: child.id, timestamp: playedDate, externalEventId: eventId });
                    if (result.changes > 0) synced++;
                    else skipped++;
                } catch (e) {
                    errors++;
                    logError('jellyfin-history', `Error inserting episode ${ep.Name}: ${e instanceof Error ? e.message : String(e)}`);
                }
            }
        })();
        broadcast({
            type: 'jellyfin_history_progress',
            phase: 'episodes',
            done: episodes.length,
            total: episodes.length,
            log: `📺 Episodes: ${episodes.length}/${episodes.length} (${synced} synced)`,
            logType: 'info'
        });

        // ── Audio ───────────────────────────────────────────────────────────
        // SKIPPED: Audio playback is tracked by the Playback Reporting DB poller
        // (pr-poller.js) which records per-play events with accurate timestamps
        // and track names. Jellyfin's API only exposes LastPlayedDate (most recent
        // play, not per-play), so importing audio here creates phantom entries for
        // every historically-played track with today's date.
        broadcast({
            type: 'jellyfin_history_progress',
            phase: 'audio',
            done: 0,
            total: 0,
            log: `🎵 Audio: skipped (handled by Playback Reporting poller)`,
            logType: 'info'
        });

        const summary = `✅ Complete: ${synced} synced, ${traktMatched} trakt-matched, ${noDate} unknown-date, ${skipped} dupes, ${notFound} not found, ${errors} errors`;
        broadcast({ log: summary, logType: 'success' });
        logInfo('jellyfin-history', summary);

        broadcast({
            type: 'jellyfin_history_complete',
            synced,
            skipped,
            traktMatched,
            noDate,
            notFound,
            errors,
            total: movies.length + episodes.length,
        });
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        broadcast({ log: `❌ Jellyfin history sync failed: ${msg}`, logType: 'error' });
        broadcast({ type: 'jellyfin_history_complete', error: msg });
        logError('jellyfin-history', `Sync failed: ${msg}`);
    } finally {
        engineState.running = false;
    }
}
