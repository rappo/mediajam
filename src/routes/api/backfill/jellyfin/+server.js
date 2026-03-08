import { json } from '@sveltejs/kit';
import db from '$lib/server/db.js';
import { getJellyfinApis, getItemsApi } from '$lib/server/jellyfin.js';
import { logInfo, logWarn } from '$lib/server/logger.js';

/**
 * POST /api/backfill/jellyfin — Sync watch history from Jellyfin.
 * Queries all played items (movies, episodes) and creates playback_history
 * entries for any that don't already exist with source='jellyfin'.
 *
 * First run cleans up any previous bad imports (source='jellyfin'), then
 * re-imports only items that have a valid LastPlayedDate from Jellyfin.
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

    // Clean up previous jellyfin-sourced history (in case of bad imports)
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

    let synced = 0;
    let skipped = 0;
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
            fields: [],
            enableUserData: true,
            limit: 10000,
        });

        const movies = moviesRes.data.Items || [];
        logInfo('jellyfin-sync', `Found ${movies.length} played movies in Jellyfin`);

        for (const movie of movies) {
            const playedDate = movie.UserData?.LastPlayedDate;
            if (!playedDate) { noDate++; continue; }

            const childJellyfinId = movie.Id + '_child';
            const child = /** @type {any} */ (findChildByJellyfinId.get(childJellyfinId));
            if (!child) { notFound++; continue; }

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
            fields: [],
            enableUserData: true,
            limit: 50000,
        });

        const episodes = episodesRes.data.Items || [];
        logInfo('jellyfin-sync', `Found ${episodes.length} played episodes in Jellyfin`);

        for (const ep of episodes) {
            const playedDate = ep.UserData?.LastPlayedDate;
            if (!playedDate) { noDate++; continue; }

            const child = /** @type {any} */ (findChildByJellyfinId.get(ep.Id));
            if (!child) { notFound++; continue; }

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
            const playedDate = track.UserData?.LastPlayedDate;
            if (!playedDate) { noDate++; continue; }

            let mediaId = null;
            const trackRow = /** @type {any} */ (findTrackByJellyfinId.get(track.Id));
            if (trackRow) {
                mediaId = trackRow.media_child_id;
            } else {
                const child = /** @type {any} */ (findChildByJellyfinId.get(track.Id));
                if (child) mediaId = child.id;
            }

            if (!mediaId) { notFound++; continue; }

            const eventId = `jellyfin:audio:${track.Id}`;
            try {
                const result = insertHistory.run({ userId, mediaId, timestamp: playedDate, externalEventId: eventId });
                if (result.changes > 0) synced++;
                else skipped++;
            } catch { errors++; }
        }

        logInfo('jellyfin-sync', `Jellyfin history sync complete: ${synced} new, ${skipped} dupes, ${noDate} no date, ${notFound} not in library, ${errors} errors, ${cleaned.changes} cleaned`);

        return json({
            success: true,
            synced,
            skipped,
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
