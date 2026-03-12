import db from '$lib/server/db.js';
import Database from 'better-sqlite3';
import { logInfo, logError } from '$lib/server/logger.js';

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

        const findChild = db.prepare('SELECT id FROM media_children WHERE jellyfin_id = ?');
        const insertHistory = db.prepare(`
            INSERT OR IGNORE INTO playback_history
                (user_id, media_id, source, timestamp, duration_consumed_seconds, completion_pct, external_event_id)
            VALUES (@userId, @mediaId, 'jellyfin_pr', @timestamp, @durationSeconds, 100, @externalEventId)
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

        const txn = db.transaction(() => {
            for (const event of newEvents) {
                if (event.rowid > maxRowid) maxRowid = event.rowid;

                const itemId = event.ItemId;
                if (!itemId) { skipped++; continue; }

                // Try direct jellyfin_id match, then with _child suffix (movies)
                let child = /** @type {any} */ (findChild.get(itemId));
                if (!child) child = /** @type {any} */ (findChild.get(itemId + '_child'));
                if (!child) { skipped++; continue; }

                const durationSeconds = event.PlayDuration ? Math.round(event.PlayDuration) : null;
                const timestamp = event.DateCreated || new Date().toISOString();
                const eventId = `jellyfin_pr:${event.rowid}`;

                const result = insertHistory.run({
                    userId: user.id,
                    mediaId: child.id,
                    timestamp,
                    durationSeconds,
                    externalEventId: eventId
                });

                if (result.changes > 0) {
                    imported++;
                    // Mark as watched + update parent counts
                    const statusResult = updateWatchStatus.run(child.id);
                    if (statusResult.changes === 0) {
                        // Already watched — just bump play_count
                        bumpPlayCount.run(child.id);
                    }
                    updateParentCounts.run(child.id);
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
    setTimeout(() => pollForNewPlays(), 5000);

    intervalId = setInterval(pollForNewPlays, POLL_INTERVAL_MS);
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
