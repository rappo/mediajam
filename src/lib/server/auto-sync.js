import db from '$lib/server/db.js';
import { backfillTrakt, backfillLastfm, processLastfmScrobbles } from '$lib/server/backfill-engine.js';
import { startSync } from '$lib/server/sync-engine.js';
import { startPipelineScheduler } from '$lib/server/nightly-pipeline.js';

const CHECK_INTERVAL_MS = 30 * 60 * 1000; // Check every 30 minutes
const DEFAULT_SYNC_INTERVAL_HOURS = 6;

let intervalId = null;

/**
 * Check and run auto-syncs for all users with auto_sync enabled.
 */
async function checkAndRunAutoSyncs() {
    const settings = /** @type {any} */ (db.prepare('SELECT setup_complete FROM app_settings WHERE id = 1').get());
    if (!settings?.setup_complete) return;

    // Find all user_identities with auto_sync enabled
    const identities = /** @type {any[]} */ (db.prepare(`
        SELECT ui.*, u.id as user_id_check
        FROM user_identities ui
        JOIN users u ON ui.user_id = u.id
        WHERE ui.auto_sync = 1
    `).all());

    const now = new Date();

    for (const identity of identities) {
        const lastSync = identity.last_auto_sync_at ? new Date(identity.last_auto_sync_at) : null;
        const intervalHours = DEFAULT_SYNC_INTERVAL_HOURS;
        const intervalMs = intervalHours * 60 * 60 * 1000;

        // Skip if synced recently
        if (lastSync && (now.getTime() - lastSync.getTime()) < intervalMs) {
            continue;
        }

        try {
            if (identity.provider === 'trakt') {
                console.log(`[auto-sync] Running Trakt sync for user ${identity.user_id}`);
                await backfillTrakt(identity.user_id);
            } else if (identity.provider === 'lastfm') {
                console.log(`[auto-sync] Running Last.fm sync for user ${identity.user_id}`);
                await backfillLastfm(identity.user_id);
                processLastfmScrobbles(identity.user_id);
            } else if (identity.provider === 'jellyfin') {
                console.log(`[auto-sync] Running Jellyfin sync for user ${identity.user_id}`);
                await startSync();
            }

            // Update last_auto_sync_at
            db.prepare('UPDATE user_identities SET last_auto_sync_at = ? WHERE id = ?')
                .run(now.toISOString(), identity.id);
        } catch (e) {
            console.error(`[auto-sync] Error syncing ${identity.provider} for user ${identity.user_id}:`,
                e instanceof Error ? e.message : String(e));
        }
    }
}

/**
 * Start the auto-sync scheduler. Checks every 30 minutes.
 */
export function startAutoSyncScheduler() {
    if (intervalId) return; // Already running
    console.log('[auto-sync] Scheduler started (checks every 30 minutes)');

    // Run an initial check after a short delay (let server finish booting)
    setTimeout(() => checkAndRunAutoSyncs(), 10000);

    intervalId = setInterval(checkAndRunAutoSyncs, CHECK_INTERVAL_MS);
}

/**
 * Stop the auto-sync scheduler.
 */
export function stopAutoSyncScheduler() {
    if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
        console.log('[auto-sync] Scheduler stopped');
    }
}
