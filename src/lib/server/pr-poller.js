import db from '$lib/server/db.js';
import Database from 'better-sqlite3';
import { logInfo, logError, logWarn } from '$lib/server/logger.js';
import { invalidatePrecomputed } from '$lib/server/section-cache.js';

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
 * Get the configured Jellyfin timezone (IANA format), falling back to server TZ.
 * @returns {string}
 */
function getJellyfinTimezone() {
    const settings = /** @type {any} */ (
        db.prepare('SELECT jellyfin_timezone FROM app_settings WHERE id = 1').get()
    );
    return settings?.jellyfin_timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/**
 * Calculate the UTC offset in milliseconds for a given date in a given timezone.
 * Returns a NEGATIVE value (e.g. -18000000 for UTC-5) so that:
 *   new Date(dateAsUTC.getTime() + offsetMs) = correct UTC time
 *
 * @param {Date} date - The date to check (interpreted as UTC)
 * @param {string} tz - IANA timezone string
 * @returns {number}
 */
function getTimezoneOffsetMs(date, tz) {
    // Format the date in the target timezone to extract the offset
    const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        hour12: false
    });
    const parts = formatter.formatToParts(date);
    const get = (/** @type {string} */ type) => parseInt(parts.find(p => p.type === type)?.value || '0');
    const localInTz = new Date(Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second')));
    // offsetMs = localInTz - date; if local is behind UTC, offset is negative
    // We want: trueUTC = dateAsUTC - offset  →  offset = -(localInTz - date)
    return -(localInTz.getTime() - date.getTime());
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
    } catch (e) {
        // Log instead of silently swallowing — this is the sole source of music play events
        const msg = e instanceof Error ? e.message : String(e);
        console.warn(`[pr-poller] Cannot open PR DB at ${dbPath}: ${msg}`);
        logWarn('pr-poller', `Cannot open PR DB: ${msg}`);
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

        // Detect rowid cursor desync: if our cursor is ahead of the PR DB's max rowid,
        // the DB was likely vacuumed/recreated. Reset cursor and re-poll.
        if (newEvents.length === 0 && lastPollRowid > 0) {
            const maxRow = /** @type {any} */ (prDb.prepare('SELECT MAX(rowid) as maxRowid FROM PlaybackActivity').get());
            const dbMaxRowid = maxRow?.maxRowid || 0;
            if (dbMaxRowid > 0 && lastPollRowid > dbMaxRowid) {
                console.warn(`[pr-poller] Rowid cursor desync detected: cursor=${lastPollRowid}, PR DB max=${dbMaxRowid}. Resetting to 0.`);
                logWarn('pr-poller', `Rowid cursor desync: cursor=${lastPollRowid}, DB max=${dbMaxRowid}. Resetting to re-import.`);
                lastPollRowid = 0;
                // Close and retry on next poll cycle with the reset cursor
                prDb.close();
                return;
            }
        }

        if (newEvents.length === 0) return;

        // Get the default user (for single-user setups)
        const user = /** @type {any} */ (db.prepare('SELECT id FROM users LIMIT 1').get());
        if (!user) return;

        // Minimum play duration to record a history entry (filters out brief previews)
        const MIN_PLAY_SECONDS = 300; // 5 minutes
        // Minimum completion percentage to mark as "watched"
        const WATCHED_THRESHOLD_PCT = 80;

        const findChild = db.prepare('SELECT id FROM media_children WHERE jellyfin_id = ?');
        const findTrack = db.prepare('SELECT t.id as track_id, t.album_id, t.title as track_title, t.runtime_ticks as track_runtime_ticks FROM tracks t WHERE t.jellyfin_id = ?');
        const findChildRuntime = db.prepare(
            'SELECT mc.runtime_ticks, mp.media_type FROM media_children mc JOIN media_parents mp ON mc.parent_id = mp.id WHERE mc.id = ?'
        );
        const insertHistory = db.prepare(`
            INSERT OR IGNORE INTO playback_history
                (user_id, media_id, source, timestamp, duration_consumed_seconds, completion_pct, external_event_id, track_name, track_id)
            VALUES (@userId, @mediaId, 'jellyfin_pr', @timestamp, @durationSeconds, @completionPct, @externalEventId, @trackName, @trackId)
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
                // Don't unconditionally advance cursor — unmatched events should be retried

                const itemId = event.ItemId;
                if (!itemId) { skipped++; continue; }

                // Try direct jellyfin_id match, then with _child suffix (movies), then tracks table (music)
                let child = /** @type {any} */ (findChild.get(itemId));
                if (!child) child = /** @type {any} */ (findChild.get(itemId + '_child'));
                let trackName = null;
                let trackRuntimeTicks = null;
                let trackId = null;
                if (!child) {
                    // Music: track IDs are stored in the tracks table, not media_children
                    const track = /** @type {any} */ (findTrack.get(itemId));
                    if (track) {
                        child = { id: track.album_id };
                        trackName = track.track_title;
                        trackRuntimeTicks = track.track_runtime_ticks || null;
                        trackId = track.track_id || null;
                    }
                }
                if (!child) { skipped++; continue; } // Don't advance cursor — retry next cycle

                // Event matched — advance cursor past it
                if (event.rowid > maxRowid) maxRowid = event.rowid;

                const durationSeconds = event.PlayDuration ? Math.round(event.PlayDuration) : null;

                // Skip brief previews — use shorter threshold for music tracks
                const isTrack = !!trackName;
                const minPlaySeconds = isTrack ? 30 : MIN_PLAY_SECONDS;
                if (!durationSeconds || durationSeconds < minPlaySeconds) {
                    skipped++;
                    if (event.rowid > maxRowid) maxRowid = event.rowid; // legitimately skipped, advance cursor
                    continue;
                }

                // Adjacent duplicate: same track played back-to-back with valid duration = pause/resume
                // Checked AFTER duration filter so 0-duration entries don't poison lastItemId
                if (itemId === lastItemId) {
                    skipped++;
                    if (event.rowid > maxRowid) maxRowid = event.rowid; // dedup skip, advance cursor
                    continue;
                }
                lastItemId = itemId;

                // Calculate actual completion percentage from play duration vs runtime
                // For music tracks, use the individual track runtime (not the album)
                const childInfo = /** @type {any} */ (findChildRuntime.get(child.id));
                let runtimeSeconds = 0;
                if (isTrack && trackRuntimeTicks) {
                    // Individual track runtime from tracks table
                    runtimeSeconds = Math.round(trackRuntimeTicks / 10000000);
                } else if (childInfo?.runtime_ticks) {
                    // Album or video runtime from media_children
                    runtimeSeconds = Math.round(childInfo.runtime_ticks / 10000000);
                }
                let completionPct = 100;
                if (runtimeSeconds > 0) {
                    completionPct = Math.min(100, Math.round((durationSeconds / runtimeSeconds) * 100));
                }

                // For music: skip tracks with low completion (likely skipped/browsed)
                // Require either 50% of the track OR 240 seconds (for very long tracks)
                if (isTrack && runtimeSeconds > 0 && completionPct < 50 && durationSeconds < 240) {
                    skipped++;
                    if (event.rowid > maxRowid) maxRowid = event.rowid; // completion skip, advance cursor
                    continue;
                }

                // DateCreated from Jellyfin PR plugin is in Jellyfin server's
                // LOCAL timezone (not UTC). Parse as local and convert to UTC.
                let rawTs = event.DateCreated || '';
                let timestamp;
                if (rawTs) {
                    const isoStr = rawTs.replace(' ', 'T');
                    // Parse as UTC first to get the numeric component
                    const hasZone = isoStr.endsWith('Z') || isoStr.includes('+') || isoStr.includes('-', 10);
                    const parseStr = hasZone ? isoStr : isoStr + 'Z';
                    const asUtc = new Date(parseStr);
                    if (isNaN(asUtc.getTime())) {
                        timestamp = new Date().toISOString();
                    } else if (hasZone) {
                        // Already has timezone info — use as-is
                        timestamp = asUtc.toISOString();
                    } else {
                        // Bare timestamp = Jellyfin local time. Convert to UTC.
                        const jellyfinTz = getJellyfinTimezone();
                        const offsetMs = getTimezoneOffsetMs(asUtc, jellyfinTz);
                        const correctedUtc = new Date(asUtc.getTime() + offsetMs);
                        timestamp = correctedUtc.toISOString();
                    }
                } else {
                    timestamp = new Date().toISOString();
                }
                const eventId = `jellyfin_pr:${event.rowid}`;

                const result = insertHistory.run({
                    userId: user.id,
                    mediaId: child.id,
                    timestamp,
                    durationSeconds,
                    completionPct,
                    externalEventId: eventId,
                    trackName,
                    trackId
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

            // Invalidate music page cache so recent listening updates promptly
            try { invalidatePrecomputed('music-smart'); } catch { /* non-fatal */ }
        }
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`[pr-poller] Error polling PR DB:`, msg);
        logError('pr-poller', `Poll error: ${msg}`);
    } finally {
        prDb.close();
    }
}

// pollRecentAudio removed — Jellyfin LastPlayedDate is not a reliable per-play
// event source. It creates phantom entries when metadata is refreshed. The PR
// DB poll above is the sole authoritative source for music play events.

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
    }, 5000);

    intervalId = setInterval(() => {
        pollForNewPlays();
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

/**
 * Re-scan the entire PR database from rowid 0, filling in any previously
 * missed plays (e.g., tracks that weren't synced at import time).
 * Safe to run repeatedly — uses INSERT OR IGNORE so dupes are skipped.
 * @returns {{ imported: number, skipped: number }}
 */
export function rescanAll() {
    console.log('[pr-poller] Full rescan requested — resetting cursor to 0');
    logInfo('pr-poller', 'Full rescan started');
    const savedRowid = lastPollRowid;
    lastPollRowid = 0;
    pollForNewPlays();
    const result = { imported: 0, skipped: 0, newCursor: lastPollRowid };
    console.log(`[pr-poller] Rescan complete (cursor: ${savedRowid} → ${lastPollRowid})`);
    logInfo('pr-poller', `Rescan complete (cursor: ${savedRowid} → ${lastPollRowid})`);
    return result;
}
