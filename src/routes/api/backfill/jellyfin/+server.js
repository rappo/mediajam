import { json } from '@sveltejs/kit';
import db from '$lib/server/db.js';
import { getJellyfinApis, getItemsApi } from '$lib/server/jellyfin.js';
import { logInfo, logWarn } from '$lib/server/logger.js';

const UNKNOWN_DATE = '1970-01-01T00:00:00.000Z';

/**
 * Try to find a watched_at date from trakt_history for a movie by TMDB ID.
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
 * Try to find a watched_at date from trakt_history for an episode.
 * @param {number} userId
 * @param {string|null} showTmdbId
 * @param {number|null} season
 * @param {number|null} episode
 * @returns {string|null}
 */
function findTraktDateForEpisode(userId, showTmdbId, season, episode) {
    if (!showTmdbId || season == null || episode == null) return null;
    const row = /** @type {any} */ (db.prepare(
        "SELECT watched_at FROM trakt_history WHERE user_id = ? AND tmdb_id = ? AND season = ? AND episode = ? ORDER BY watched_at DESC LIMIT 1"
    ).get(userId, showTmdbId, season, episode));
    return row?.watched_at || null;
}

/**
 * POST /api/backfill/jellyfin — Sync watch history from Jellyfin.
 * For each played item:
 * 1. Use Jellyfin's LastPlayedDate if available
 * 2. Else try to match a date from Trakt history
 * 3. Else use a sentinel date (1970-01-01) to mark "watched, date unknown"
 */
export async function POST({ locals }) {
    if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
    if (!locals.user.isAdmin) return json({ error: 'Admin required' }, { status: 403 });

    const userId = locals.user.id;
    const settings = /** @type {any} */ (db.prepare('SELECT * FROM app_settings WHERE id = 1').get());
    const user = /** @type {any} */ (db.prepare('SELECT * FROM users WHERE id = ?').get(userId));

    if (!settings?.jellyfin_url || !user?.jellyfin_access_token) {
        return json({ error: 'Jellyfin not configured' }, { status: 400 });
    }

    const { api } = getJellyfinApis(settings.jellyfin_url, user.jellyfin_access_token);
    const itemsApi = getItemsApi(api);
    const jellyfinUserId = user.jellyfin_user_id;

    // Clean up previous jellyfin-sourced history
    const cleaned = db.prepare(
        "DELETE FROM playback_history WHERE source = 'jellyfin' AND user_id = ?"
    ).run(userId);
    logInfo('jellyfin-sync', `Cleaned ${cleaned.changes} previous jellyfin history entries`);

    const insertHistory = db.prepare(`
        INSERT OR IGNORE INTO playback_history (user_id, media_id, source, timestamp, completion_pct, external_event_id)
        VALUES (@userId, @mediaId, 'jellyfin', @timestamp, 100, @externalEventId)
    `);

    const findChildByJellyfinId = db.prepare(
        'SELECT id FROM media_children WHERE jellyfin_id = ?'
    );

    // For cross-referencing with media_parents (to get TMDB IDs for Trakt lookup)
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
        logInfo('jellyfin-sync', `Found ${movies.length} played movies in Jellyfin`);

        for (const movie of movies) {
            const childJellyfinId = movie.Id + '_child';
            const child = /** @type {any} */ (findChildByJellyfinId.get(childJellyfinId));
            if (!child) { notFound++; continue; }

            let playedDate = movie.UserData?.LastPlayedDate;

            if (!playedDate) {
                // Try Trakt
                const tmdbId = movie.ProviderIds?.Tmdb || null;
                const traktDate = findTraktDateForMovie(userId, tmdbId);
                if (traktDate) {
                    playedDate = traktDate;
                    traktMatched++;
                } else {
                    playedDate = UNKNOWN_DATE;
                    noDate++;
                }
            }

            const eventId = `jellyfin:movie:${movie.Id}`;
            try {
                const result = insertHistory.run({ userId, mediaId: child.id, timestamp: playedDate, externalEventId: eventId });
                if (result.changes > 0) synced++;
                else skipped++;
            } catch { errors++; }
        }

        // ── Episodes ────────────────────────────────────────────────────────
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
        logInfo('jellyfin-sync', `Found ${episodes.length} played episodes in Jellyfin`);

        for (const ep of episodes) {
            const child = /** @type {any} */ (findChildByJellyfinId.get(ep.Id));
            if (!child) { notFound++; continue; }

            let playedDate = ep.UserData?.LastPlayedDate;

            if (!playedDate) {
                // Try Trakt — need show's TMDB ID + season/episode numbers
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
            } catch { errors++; }
        }

        // ── Audio ───────────────────────────────────────────────────────────
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
        logInfo('jellyfin-sync', `Found ${tracks.length} played audio tracks in Jellyfin`);

        const findTrackByJellyfinId = db.prepare(
            'SELECT mc.id as media_child_id FROM tracks t JOIN media_children mc ON mc.id = t.album_id WHERE t.jellyfin_id = ?'
        );

        for (const track of tracks) {
            let mediaId = null;
            const trackRow = /** @type {any} */ (findTrackByJellyfinId.get(track.Id));
            if (trackRow) {
                mediaId = trackRow.media_child_id;
            } else {
                const child = /** @type {any} */ (findChildByJellyfinId.get(track.Id));
                if (child) mediaId = child.id;
            }

            if (!mediaId) { notFound++; continue; }

            // For audio, LastPlayedDate or unknown sentinel (no Trakt for music)
            const playedDate = track.UserData?.LastPlayedDate || UNKNOWN_DATE;
            if (!track.UserData?.LastPlayedDate) noDate++;

            const eventId = `jellyfin:audio:${track.Id}`;
            try {
                const result = insertHistory.run({ userId, mediaId, timestamp: playedDate, externalEventId: eventId });
                if (result.changes > 0) synced++;
                else skipped++;
            } catch { errors++; }
        }

        logInfo('jellyfin-sync', `Complete: ${synced} synced, ${traktMatched} trakt-matched, ${noDate} unknown-date, ${skipped} dupes, ${notFound} not found, ${errors} errors, ${cleaned.changes} cleaned`);

        return json({
            success: true,
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
        logWarn('jellyfin-sync', `Jellyfin history sync failed: ${msg}`);
        return json({ error: msg }, { status: 500 });
    }
}
