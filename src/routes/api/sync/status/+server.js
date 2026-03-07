import { json } from '@sveltejs/kit';
import { isRunning as isSyncRunning, getStatus as getSyncStatus } from '$lib/server/sync-engine.js';
import { isPeopleRunning, getPeopleStatus } from '$lib/server/people-sync-engine.js';
import { isBackfillRunning, getBackfillStatus } from '$lib/server/backfill-engine.js';
import { isMBRunning, getMBStatus } from '$lib/server/musicbrainz-engine.js';

/**
 * Lightweight sync status endpoint — returns the running state of all sync engines.
 * SyncFooter polls this every 5s instead of holding 4 persistent SSE connections.
 * This avoids saturating the browser's 6-connection-per-domain HTTP/1.1 limit.
 */
export async function GET({ locals }) {
    if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

    const result = { jellyfin: null, people: null, backfill: null, musicbrainz: null };

    if (isSyncRunning()) {
        const s = getSyncStatus();
        result.jellyfin = {
            running: true,
            paused: s.paused,
            progress: s.progress,
            libraryName: s.libraryName || 'Jellyfin Sync',
            itemsSynced: s.itemsSynced,
            errors: s.errors,
            logs: s.logs || []
        };
    } else {
        // Even when not running, return last logs so polling can pick up final state
        const s = getSyncStatus();
        if (s.logs && s.logs.length > 0) {
            result.jellyfin = {
                running: false,
                paused: false,
                progress: s.progress,
                libraryName: s.libraryName || '',
                itemsSynced: s.itemsSynced,
                errors: s.errors,
                logs: s.logs
            };
        }
    }

    if (isPeopleRunning()) {
        const ps = getPeopleStatus();
        result.people = {
            running: true,
            progress: ps.progress,
            itemsSynced: ps.itemsSynced,
            errors: ps.errors,
            lastLog: ps.logs?.length > 0 ? ps.logs[ps.logs.length - 1]?.message : null
        };
    }

    if (isBackfillRunning()) {
        const bs = getBackfillStatus();
        result.backfill = {
            running: true,
            progress: bs.lastProgress?.progressPercent || 0,
            tier: bs.tier || 'Import',
            lastLog: bs.logs?.length > 0 ? bs.logs[bs.logs.length - 1]?.message : null
        };
    }

    if (isMBRunning()) {
        const ms = getMBStatus();
        result.musicbrainz = {
            running: true,
            progress: ms.progress,
            itemsSynced: ms.itemsSynced,
            errors: ms.errors,
            lastLog: ms.logs?.length > 0 ? ms.logs[ms.logs.length - 1]?.message : null
        };
    }

    return json(result);
}
