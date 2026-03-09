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

    // Clean up previous jellyfin-sourced history
    const cleaned = db.prepare(
        "DELETE FROM playback_history WHERE source = 'jellyfin' AND user_id = ?"
    ).run(userId);
    broadcast({ log: `🗑️ Cleaned ${cleaned.changes} previous jellyfin history entries`, logType: 'info' });
    logInfo('jellyfin-history', `Cleaned ${cleaned.changes} previous entries`);

    const insertHistory = db.prepare(`
        INSERT OR IGNORE INTO playback_history (user_id, media_id, source, timestamp, completion_pct, external_event_id)
        VALUES (@userId, @mediaId, 'jellyfin', @timestamp, 100, @externalEventId)
    `);

    const findChildByJellyfinId = db.prepare(
        'SELECT id FROM media_children WHERE jellyfin_id = ?'
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

        for (let idx = 0; idx < movies.length; idx++) {
            const movie = movies[idx];
            const childJellyfinId = movie.Id + '_child';
            const child = /** @type {any} */ (findChildByJellyfinId.get(childJellyfinId));
            if (!child) { notFound++; continue; }

            let playedDate = movie.UserData?.LastPlayedDate;
            let dateSource = 'jellyfin';

            if (!playedDate) {
                const tmdbId = movie.ProviderIds?.Tmdb || null;
                const traktDate = findTraktDateForMovie(userId, tmdbId);
                if (traktDate) {
                    playedDate = traktDate;
                    dateSource = 'trakt';
                    traktMatched++;
                } else {
                    playedDate = UNKNOWN_DATE;
                    dateSource = 'unknown';
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

            if ((idx + 1) % 50 === 0 || idx === movies.length - 1) {
                broadcast({
                    type: 'jellyfin_history_progress',
                    phase: 'movies',
                    done: idx + 1,
                    total: movies.length,
                    log: `🎬 Movies: ${idx + 1}/${movies.length} (${synced} synced)`,
                    logType: 'info'
                });
            }
        }

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
                    playedDate = UNKNOWN_DATE;
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

            if ((idx + 1) % 100 === 0 || idx === episodes.length - 1) {
                broadcast({
                    type: 'jellyfin_history_progress',
                    phase: 'episodes',
                    done: idx + 1,
                    total: episodes.length,
                    log: `📺 Episodes: ${idx + 1}/${episodes.length} (${synced} synced)`,
                    logType: 'info'
                });
            }
        }

        // ── Audio ───────────────────────────────────────────────────────────
        broadcast({ log: '🎵 Fetching played audio from Jellyfin...', logType: 'info' });
        const audioRes = await itemsApi.getItems({
            userId: jellyfinUserId,
            includeItemTypes: ['Audio'],
            isPlayed: true,
            recursive: true,
            fields: [],
            enableUserData: true,
            limit: 50000,
        });

        const tracks = audioRes.data.Items || [];
        broadcast({ log: `🎵 Found ${tracks.length} played audio tracks`, logType: 'info' });
        logInfo('jellyfin-history', `Found ${tracks.length} played audio tracks`);

        const findTrackByJellyfinId = db.prepare(
            'SELECT mc.id as media_child_id FROM tracks t JOIN media_children mc ON mc.id = t.album_id WHERE t.jellyfin_id = ?'
        );

        for (let idx = 0; idx < tracks.length; idx++) {
            const track = tracks[idx];
            let mediaId = null;
            const trackRow = /** @type {any} */ (findTrackByJellyfinId.get(track.Id));
            if (trackRow) {
                mediaId = trackRow.media_child_id;
            } else {
                const child = /** @type {any} */ (findChildByJellyfinId.get(track.Id));
                if (child) mediaId = child.id;
            }

            if (!mediaId) { notFound++; continue; }

            const playedDate = track.UserData?.LastPlayedDate || UNKNOWN_DATE;
            if (!track.UserData?.LastPlayedDate) noDate++;

            const eventId = `jellyfin:audio:${track.Id}`;
            try {
                const result = insertHistory.run({ userId, mediaId, timestamp: playedDate, externalEventId: eventId });
                if (result.changes > 0) synced++;
                else skipped++;
            } catch (e) {
                errors++;
                logError('jellyfin-history', `Error inserting track ${track.Name}: ${e instanceof Error ? e.message : String(e)}`);
            }

            if ((idx + 1) % 200 === 0 || idx === tracks.length - 1) {
                broadcast({
                    type: 'jellyfin_history_progress',
                    phase: 'audio',
                    done: idx + 1,
                    total: tracks.length,
                    log: `🎵 Audio: ${idx + 1}/${tracks.length} (${synced} synced)`,
                    logType: 'info'
                });
            }
        }

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
            cleaned: cleaned.changes,
            total: movies.length + episodes.length + tracks.length,
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
