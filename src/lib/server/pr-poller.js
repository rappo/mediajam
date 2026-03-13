import db from '$lib/server/db.js';
import Database from 'better-sqlite3';
import { logInfo, logError } from '$lib/server/logger.js';
import { getJellyfinApis, getItemsApi } from '$lib/server/jellyfin.js';

const POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const DEFAULT_PR_PATH = '/app/jellyfin/playback_reporting.db';

let intervalId = null;
let lastPollRowid = 0;

/**
 * Get the PR database path from app_settings, or fall back to the default.
 * @returns {string|null}
 */
function getPrDbPath() {
    const settings = /** @type {any} */ (
        db.prepare('SELECT jellyfin_pr_db_path FROM app_settings WHERE id = 1').get()
    );
    return settings?.jellyfin_pr_db_path || DEFAULT_PR_PATH;
}

/**
 * Initialize lastPollRowid from the highest rowid we've already imported.
 * This prevents re-importing old events on first boot.
 */
function initLastRowid() {
    const row = /** @type {any} */ (db.prepare(
        "SELECT MAX(CAST(REPLACE(external_event_id, 'jellyfin_pr:', '') AS INTEGER)) as maxRowid FROM playback_history WHERE external_event_id LIKE 'jellyfin_pr:%'"
    ).get());
    lastPollRowid = row?.maxRowid || 0;
}

/**
 * Poll the Playback Reporting DB for new playback events since the last check.
 * Maps each new event to a media_child and inserts a playback_history entry.
 */
function pollForNewPlays() {
    const dbPath = getPrDbPath();
    if (!dbPath) return;

    let prDb;
    try {
        prDb = new Database(dbPath, { readonly: true });
    } catch {
        // PR DB not available — silently skip (it's optional)
        return;
    }

    try {
        // Check table exists
        const tableCheck = prDb.prepare(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='PlaybackActivity'"
        ).get();
        if (!tableCheck) return;

        // Fetch only new rows since last poll
        const newEvents = /** @type {any[]} */ (prDb.prepare(
            'SELECT rowid, ItemId, DateCreated, PlayDuration FROM PlaybackActivity WHERE rowid > ? ORDER BY rowid ASC'
        ).all(lastPollRowid));

        if (newEvents.length === 0) return;

        // Get the default user (for single-user setups)
        const user = /** @type {any} */ (db.prepare('SELECT id FROM users LIMIT 1').get());
        if (!user) return;

        // Minimum play duration to record a history entry (filters out brief previews)
        const MIN_PLAY_SECONDS = 300; // 5 minutes
        // Minimum completion percentage to mark as "watched"
        const WATCHED_THRESHOLD_PCT = 80;

        const findChild = db.prepare('SELECT id FROM media_children WHERE jellyfin_id = ?');
        const findTrack = db.prepare('SELECT t.album_id, t.title as track_title FROM tracks t WHERE t.jellyfin_id = ?');
        const findChildRuntime = db.prepare(
            'SELECT mc.runtime_ticks, mp.media_type FROM media_children mc JOIN media_parents mp ON mc.parent_id = mp.id WHERE mc.id = ?'
        );
        const insertHistory = db.prepare(`
            INSERT OR IGNORE INTO playback_history
                (user_id, media_id, source, timestamp, duration_consumed_seconds, completion_pct, external_event_id, track_name)
            VALUES (@userId, @mediaId, 'jellyfin_pr', @timestamp, @durationSeconds, @completionPct, @externalEventId, @trackName)
        `);
        const updateWatchStatus = db.prepare(
            "UPDATE media_children SET watch_status = 'watched', play_count = play_count + 1 WHERE id = ? AND watch_status != 'watched'"
        );
        const bumpPlayCount = db.prepare(
            "UPDATE media_children SET play_count = play_count + 1 WHERE id = ? AND watch_status = 'watched'"
        );
        const updateParentCounts = db.prepare(`
            UPDATE media_parents SET
                watched_children = (SELECT COUNT(*) FROM media_children WHERE parent_id = media_parents.id AND watch_status = 'watched' AND is_special = 0)
            WHERE id = (SELECT parent_id FROM media_children WHERE id = ?)
        `);

        let imported = 0;
        let skipped = 0;
        let maxRowid = lastPollRowid;
        let lastItemId = null; // Track previous PR entry for adjacency dedup

        const txn = db.transaction(() => {
            for (const event of newEvents) {
                if (event.rowid > maxRowid) maxRowid = event.rowid;

                const itemId = event.ItemId;
                if (!itemId) { skipped++; continue; }

                // Try direct jellyfin_id match, then with _child suffix (movies), then tracks table (music)
                let child = /** @type {any} */ (findChild.get(itemId));
                if (!child) child = /** @type {any} */ (findChild.get(itemId + '_child'));
                let trackName = null;
                if (!child) {
                    // Music: track IDs are stored in the tracks table, not media_children
                    const track = /** @type {any} */ (findTrack.get(itemId));
                    if (track) {
                        child = { id: track.album_id };
                        trackName = track.track_title;
                    }
                }
                if (!child) { skipped++; continue; }

                const durationSeconds = event.PlayDuration ? Math.round(event.PlayDuration) : null;

                // Skip brief previews — use shorter threshold for music tracks
                const isTrack = !!trackName;
                const minPlaySeconds = isTrack ? 30 : MIN_PLAY_SECONDS;
                if (!durationSeconds || durationSeconds < minPlaySeconds) {
                    skipped++;
                    if (event.rowid > maxRowid) maxRowid = event.rowid; // still advance cursor
                    continue;
                }

                // Adjacent duplicate: same track played back-to-back with valid duration = pause/resume
                // Checked AFTER duration filter so 0-duration entries don't poison lastItemId
                if (itemId === lastItemId) {
                    skipped++;
                    continue;
                }
                lastItemId = itemId;

                // Calculate actual completion percentage from play duration vs runtime
                const childInfo = /** @type {any} */ (findChildRuntime.get(child.id));
                const runtimeSeconds = childInfo?.runtime_ticks ? Math.round(childInfo.runtime_ticks / 10000000) : 0;
                let completionPct = 100;
                if (runtimeSeconds > 0) {
                    completionPct = Math.min(100, Math.round((durationSeconds / runtimeSeconds) * 100));
                }

                const timestamp = event.DateCreated || new Date().toISOString();
                const eventId = `jellyfin_pr:${event.rowid}`;

                const result = insertHistory.run({
                    userId: user.id,
                    mediaId: child.id,
                    timestamp,
                    durationSeconds,
                    completionPct,
                    externalEventId: eventId,
                    trackName
                });

                if (result.changes > 0) {
                    imported++;
                    const isMusic = childInfo?.media_type === 'artist';
                    if (isMusic) {
                        // Music: just bump play_count, don't set watch_status
                        bumpPlayCount.run(child.id);
                    } else if (completionPct >= WATCHED_THRESHOLD_PCT) {
                        // Video: mark as watched if completion threshold met
                        const statusResult = updateWatchStatus.run(child.id);
                        if (statusResult.changes === 0) {
                            bumpPlayCount.run(child.id);
                        }
                        updateParentCounts.run(child.id);
                    }
                } else {
                    skipped++;
                }
            }
        });
        txn();

        lastPollRowid = maxRowid;

        if (imported > 0) {
            console.log(`[pr-poller] Imported ${imported} new playback events (${skipped} skipped)`);
            logInfo('pr-poller', `Imported ${imported} new playback events`);
        }
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`[pr-poller] Error polling PR DB:`, msg);
        logError('pr-poller', `Poll error: ${msg}`);
    } finally {
        prDb.close();
    }
}

/**
 * Supplemental poll: query Jellyfin API for the 5 most recently played audio tracks.
 * Fills gaps where the Playback Reporting plugin doesn't record plays during
 * continuous album playback.
 */
async function pollRecentAudio() {
    try {
        const settings = /** @type {any} */ (
            db.prepare('SELECT jellyfin_url FROM app_settings WHERE id = 1').get()
        );
        const user = /** @type {any} */ (
            db.prepare('SELECT id, jellyfin_access_token, jellyfin_user_id FROM users LIMIT 1').get()
        );
        if (!settings?.jellyfin_url || !user?.jellyfin_access_token || !user?.jellyfin_user_id) return;

        const { api } = getJellyfinApis(settings.jellyfin_url, user.jellyfin_access_token);
        const itemsApi = getItemsApi(api);

        const res = await itemsApi.getItems({
            userId: user.jellyfin_user_id,
            includeItemTypes: ['Audio'],
            isPlayed: true,
            sortBy: ['DatePlayed'],
            sortOrder: ['Descending'],
            enableUserData: true,
            limit: 50,
            fields: [],
            recursive: true,
        });

        const tracks = res.data.Items || [];
        if (tracks.length === 0) return;

        const findTrack = db.prepare(
            'SELECT mc.id as media_child_id, t.title as track_title FROM tracks t JOIN media_children mc ON mc.id = t.album_id WHERE t.jellyfin_id = ?'
        );
        const insertHistory = db.prepare(`
            INSERT OR IGNORE INTO playback_history
                (user_id, media_id, source, timestamp, completion_pct, external_event_id, track_name)
            VALUES (@userId, @mediaId, 'jellyfin_pr', @timestamp, 100, @externalEventId, @trackName)
        `);

        let imported = 0;
        for (const track of tracks) {
            const match = /** @type {any} */ (findTrack.get(track.Id));
            if (!match) continue;

            const playedDate = track.UserData?.LastPlayedDate;
            if (!playedDate) continue;

            const eventId = `jellyfin_audio:${track.Id}:${playedDate}`;
            const result = insertHistory.run({
                userId: user.id,
                mediaId: match.media_child_id,
                timestamp: playedDate,
                externalEventId: eventId,
                trackName: match.track_title,
            });
            if (result.changes > 0) imported++;
        }

        if (imported > 0) {
            console.log(`[pr-poller] Supplemental audio: ${imported} new plays from Jellyfin API`);
            logInfo('pr-poller', `Supplemental audio: ${imported} new plays`);
        }
    } catch (e) {
        // Non-fatal — PR DB poll is the primary source
        const msg = e instanceof Error ? e.message : String(e);
        console.warn(`[pr-poller] Supplemental audio poll failed:`, msg);
    }
}

/**
 * Start the PR DB poller. Runs an initial poll, then every 5 minutes.
 */
export function startPrPoller() {
    if (intervalId) return; // Already running

    // Check if setup is complete
    const settings = /** @type {any} */ (
        db.prepare('SELECT setup_complete FROM app_settings WHERE id = 1').get()
    );
    if (!settings?.setup_complete) return;

    initLastRowid();
    console.log(`[pr-poller] Starting (interval: ${POLL_INTERVAL_MS / 1000}s, resuming from rowid ${lastPollRowid})`);

    // Initial poll after short delay (let server finish booting)
    setTimeout(() => {
        pollForNewPlays();
        pollRecentAudio();
    }, 5000);

    intervalId = setInterval(() => {
        pollForNewPlays();
        pollRecentAudio();
    }, POLL_INTERVAL_MS);
}

/**
 * Stop the PR DB poller.
 */
export function stopPrPoller() {
    if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
        console.log('[pr-poller] Stopped');
    }
}
