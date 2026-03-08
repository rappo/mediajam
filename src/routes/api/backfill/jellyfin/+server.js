import { json } from '@sveltejs/kit';
import db from '$lib/server/db.js';
import { getJellyfinApis, getItemsApi } from '$lib/server/jellyfin.js';
import { logInfo, logWarn } from '$lib/server/logger.js';

/**
 * POST /api/backfill/jellyfin — Sync watch history from Jellyfin.
 * Queries all played items (movies, episodes) and creates playback_history
 * entries for any that don't already exist with source='jellyfin'.
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

    const insertHistory = db.prepare(`
        INSERT OR IGNORE INTO playback_history (user_id, media_id, source, timestamp, completion_pct, external_event_id)
        VALUES (@userId, @mediaId, 'jellyfin', @timestamp, 100, @externalEventId)
    `);

    const findChildByJellyfinId = db.prepare(
        'SELECT id FROM media_children WHERE jellyfin_id = ?'
    );

    let synced = 0;
    let skipped = 0;
    let notFound = 0;
    let errors = 0;

    try {
        // Fetch all played movies
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
            const childJellyfinId = movie.Id + '_child';
            const child = /** @type {any} */ (findChildByJellyfinId.get(childJellyfinId));
            if (!child) {
                notFound++;
                continue;
            }

            const playedDate = movie.UserData?.LastPlayedDate || new Date().toISOString();
            const eventId = `jellyfin:movie:${movie.Id}:${playedDate}`;

            try {
                const result = insertHistory.run({
                    userId,
                    mediaId: child.id,
                    timestamp: playedDate,
                    externalEventId: eventId,
                });
                if (result.changes > 0) synced++;
                else skipped++;
            } catch {
                errors++;
            }
        }

        // Fetch all played episodes
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
            const child = /** @type {any} */ (findChildByJellyfinId.get(ep.Id));
            if (!child) {
                notFound++;
                continue;
            }

            const playedDate = ep.UserData?.LastPlayedDate || new Date().toISOString();
            const eventId = `jellyfin:episode:${ep.Id}:${playedDate}`;

            try {
                const result = insertHistory.run({
                    userId,
                    mediaId: child.id,
                    timestamp: playedDate,
                    externalEventId: eventId,
                });
                if (result.changes > 0) synced++;
                else skipped++;
            } catch {
                errors++;
            }
        }

        // Fetch all played audio tracks
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

        // For audio, try to find via tracks table first, then media_children
        const findTrackByJellyfinId = db.prepare(
            'SELECT mc.id as media_child_id FROM tracks t JOIN media_children mc ON mc.id = t.album_id WHERE t.jellyfin_id = ?'
        );

        for (const track of tracks) {
            // Try tracks table first
            let mediaId = null;
            const trackRow = /** @type {any} */ (findTrackByJellyfinId.get(track.Id));
            if (trackRow) {
                mediaId = trackRow.media_child_id;
            } else {
                // Fall back to media_children directly
                const child = /** @type {any} */ (findChildByJellyfinId.get(track.Id));
                if (child) mediaId = child.id;
            }

            if (!mediaId) {
                notFound++;
                continue;
            }

            const playedDate = track.UserData?.LastPlayedDate || new Date().toISOString();
            const eventId = `jellyfin:audio:${track.Id}:${playedDate}`;

            try {
                const result = insertHistory.run({
                    userId,
                    mediaId,
                    timestamp: playedDate,
                    externalEventId: eventId,
                });
                if (result.changes > 0) synced++;
                else skipped++;
            } catch {
                errors++;
            }
        }

        logInfo('jellyfin-sync', `Jellyfin history sync complete: ${synced} new, ${skipped} already existed, ${notFound} not in library, ${errors} errors`);

        return json({
            success: true,
            synced,
            skipped,
            notFound,
            errors,
            total: movies.length + episodes.length + tracks.length,
        });
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        logWarn('jellyfin-sync', `Jellyfin history sync failed: ${msg}`);
        return json({ error: msg }, { status: 500 });
    }
}
