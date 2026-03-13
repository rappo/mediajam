/**
 * Nightly Pipeline — dependency-aware sync/enrich/dedup orchestrator.
 *
 * Phases run sequentially. Each phase can be toggled individually.
 * Uses shared lock to coordinate with backup scheduler.
 *
 * Nightly: Phases 1-7
 * Weekly:  Phases 8-11 (after nightly completes)
 */

import db from '$lib/server/db.js';
import { acquireLock, releaseLock, createBackup } from '$lib/server/backup-engine.js';
import { takeSnapshot } from '$lib/server/data-audit.js';

// ── Phase Imports ───────────────────────────────────────────────────────────

import { startSync } from '$lib/server/sync-engine.js';
import { syncJellyfinHistory } from '$lib/server/jellyfin-history-engine.js';
import { backfillTrakt, backfillLastfm, processLastfmScrobbles } from '$lib/server/backfill-engine.js';
import { syncAllArr } from '$lib/server/arr-sync.js';
import {
    deduplicateParents, deduplicateParentsByTitle, deduplicateChildren,
    deduplicatePlaybackHistory, mergeOrphanArtistsIntoAlbums, deduplicateExternalAlbums,
} from '$lib/server/reconcile.js';
import { warmCache } from '$lib/server/image-cache.js';
import { startPeopleSync, startExternalIdsSync, startPeopleEnrichSync } from '$lib/server/people-sync-engine.js';
import { startMusicBrainzEnrich } from '$lib/server/musicbrainz-engine.js';
import { autoMergeMediumPlus, enrichUnmatchedAlbums } from '$lib/server/album-matcher.js';
import { fetchAllRatings } from '$lib/server/ratings-engine.js';
import { backfillWikipedia } from '$lib/server/wikipedia-backfill.js';

// ── State ───────────────────────────────────────────────────────────────────

let running = false;
let currentPhase = '';
let pipelineAbort = false;

/** @type {Array<(event: PipelineEvent) => void>} */
let listeners = [];

/**
 * @typedef {{
 *   type: 'phase_start' | 'phase_end' | 'phase_skip' | 'phase_error' | 'pipeline_start' | 'pipeline_end',
 *   phase?: string,
 *   phaseIndex?: number,
 *   totalPhases?: number,
 *   message?: string,
 *   error?: string,
 *   duration?: number,
 *   mode?: 'nightly' | 'weekly',
 * }} PipelineEvent
 */

function emit(/** @type {PipelineEvent} */ event) {
    for (const fn of listeners) {
        try { fn(event); } catch { /* ignore listener errors */ }
    }
}

export function addPipelineListener(/** @type {(e: PipelineEvent) => void} */ fn) {
    listeners.push(fn);
    return () => { listeners = listeners.filter(l => l !== fn); };
}

export function isPipelineRunning() { return running; }
export function getPipelineStatus() { return { running, currentPhase }; }
export function stopPipeline() { pipelineAbort = true; }

// ── Settings ────────────────────────────────────────────────────────────────

/**
 * Read pipeline settings.
 */
export function getPipelineSettings() {
    const row = /** @type {any} */ (db.prepare(`
        SELECT pipeline_enabled, nightly_pipeline_time, weekly_pipeline_day,
               weekly_pipeline_time, pipeline_phase_flags
        FROM app_settings WHERE id = 1
    `).get());
    let phaseFlags = {};
    try { phaseFlags = JSON.parse(row?.pipeline_phase_flags || '{}'); } catch { /* */ }
    return {
        pipelineEnabled: (row?.pipeline_enabled ?? 0) !== 0,
        nightlyTime: row?.nightly_pipeline_time || '02:00',
        weeklyDay: row?.weekly_pipeline_day || 'sunday',
        weeklyTime: row?.weekly_pipeline_time || '03:00',
        phaseFlags,
    };
}

/**
 * Update pipeline settings.
 */
export function updatePipelineSettings(settings) {
    const cols = [];
    const vals = [];
    if (settings.pipelineEnabled !== undefined) { cols.push('pipeline_enabled = ?'); vals.push(settings.pipelineEnabled ? 1 : 0); }
    if (settings.nightlyTime !== undefined) { cols.push('nightly_pipeline_time = ?'); vals.push(settings.nightlyTime); }
    if (settings.weeklyDay !== undefined) { cols.push('weekly_pipeline_day = ?'); vals.push(settings.weeklyDay); }
    if (settings.weeklyTime !== undefined) { cols.push('weekly_pipeline_time = ?'); vals.push(settings.weeklyTime); }
    if (settings.phaseFlags !== undefined) { cols.push('pipeline_phase_flags = ?'); vals.push(JSON.stringify(settings.phaseFlags)); }
    if (cols.length === 0) return;
    db.prepare(`UPDATE app_settings SET ${cols.join(', ')} WHERE id = 1`).run(...vals);
}

// ── Phase Definitions ───────────────────────────────────────────────────────

/**
 * @typedef {{
 *   id: string,
 *   label: string,
 *   schedule: 'nightly' | 'weekly',
 *   run: () => Promise<string>,
 *   shouldSkip?: () => boolean,
 * }} PhaseDefinition
 */

/**
 * Get the user ID for pipeline operations (first admin user).
 */
function getPipelineUserId() {
    const user = /** @type {any} */ (db.prepare('SELECT id FROM users WHERE is_admin = 1 LIMIT 1').get());
    return user?.id || 1;
}

/**
 * Check whether Trakt auto-sync is enabled for any user.
 */
function isTraktAutoSyncEnabled() {
    const row = /** @type {any} */ (db.prepare("SELECT COUNT(*) as cnt FROM user_identities WHERE provider = 'trakt' AND auto_sync = 1").get());
    return (row?.cnt ?? 0) > 0;
}

/**
 * Check whether Last.fm auto-sync is enabled for any user.
 */
function isLastfmAutoSyncEnabled() {
    const row = /** @type {any} */ (db.prepare("SELECT COUNT(*) as cnt FROM user_identities WHERE provider = 'lastfm' AND auto_sync = 1").get());
    return (row?.cnt ?? 0) > 0;
}

/**
 * Check whether *arr services are configured.
 */
function isArrConfigured() {
    const row = /** @type {any} */ (db.prepare(`
        SELECT radarr_url, sonarr_url, lidarr_url FROM app_settings WHERE id = 1
    `).get());
    return !!(row?.radarr_url || row?.sonarr_url || row?.lidarr_url);
}

/** @type {PhaseDefinition[]} */
const PHASES = [
    // ── Nightly ──
    {
        id: 'jellyfin-sync',
        label: 'Jellyfin Library Sync',
        schedule: 'nightly',
        async run() {
            await startSync();
            return 'Jellyfin library sync complete';
        },
    },
    {
        id: 'jellyfin-history',
        label: 'Jellyfin Watch History',
        schedule: 'nightly',
        async run() {
            const userId = getPipelineUserId();
            await syncJellyfinHistory(userId);
            return 'Jellyfin watch history synced';
        },
    },
    {
        id: 'trakt-import',
        label: 'Trakt History Import',
        schedule: 'nightly',
        shouldSkip: () => !isTraktAutoSyncEnabled(),
        async run() {
            const userId = getPipelineUserId();
            await backfillTrakt(userId);
            return 'Trakt history imported';
        },
    },
    {
        id: 'lastfm-import',
        label: 'Last.fm Scrobble Import',
        schedule: 'nightly',
        shouldSkip: () => !isLastfmAutoSyncEnabled(),
        async run() {
            const userId = getPipelineUserId();
            await backfillLastfm(userId);
            processLastfmScrobbles(userId);
            return 'Last.fm scrobbles imported and processed';
        },
    },
    {
        id: 'arr-sync',
        label: '*arr Sync',
        schedule: 'nightly',
        shouldSkip: () => !isArrConfigured(),
        async run() {
            await syncAllArr();
            return '*arr sync complete';
        },
    },
    {
        id: 'dedup-cleanup',
        label: 'Quick Cleanup (Dedup)',
        schedule: 'nightly',
        async run() {
            const results = [];
            const p = deduplicateParents();
            results.push(`Parents (extID): ${p.deduped} merged`);
            const pt = deduplicateParentsByTitle();
            results.push(`Parents (title): ${pt.deduped} merged`);
            const c = deduplicateChildren();
            results.push(`Children: ${c.deduped} merged`);
            const ph = deduplicatePlaybackHistory();
            results.push(`Playback history: ${ph.removed} dupes removed`);
            const oa = mergeOrphanArtistsIntoAlbums();
            results.push(`Orphan artists→albums: ${oa.merged} merged`);
            const ea = deduplicateExternalAlbums();
            results.push(`External albums: ${ea.deduped} merged`);
            return results.join('; ');
        },
    },
    {
        id: 'image-warm',
        label: 'Image Cache Warm',
        schedule: 'nightly',
        async run() {
            // Gather URLs from media_parents that have poster/backdrop URLs
            const rows = /** @type {any[]} */ (db.prepare(`
                SELECT poster_url, backdrop_url FROM media_parents
                WHERE poster_url IS NOT NULL OR backdrop_url IS NOT NULL
            `).all());
            const urls = rows.flatMap(r => [r.poster_url, r.backdrop_url].filter(Boolean));
            if (urls.length === 0) return 'No images to warm';
            await warmCache(urls, 5);
            return `Warmed ${urls.length} images`;
        },
    },

    // ── Weekly ──
    {
        id: 'people-sync',
        label: 'People & Credits',
        schedule: 'weekly',
        async run() {
            await startPeopleSync();
            await startExternalIdsSync();
            await startPeopleEnrichSync();
            return 'People sync → ext IDs → TMDB enrich complete';
        },
    },
    {
        id: 'music-enrich',
        label: 'Music Enrichment',
        schedule: 'weekly',
        async run() {
            await startMusicBrainzEnrich();
            const merged = autoMergeMediumPlus();
            await enrichUnmatchedAlbums();
            return `MB enrich done, ${merged?.merged ?? 0} albums auto-merged, unmatched enriched`;
        },
    },
    {
        id: 'ratings-refresh',
        label: 'Ratings Refresh',
        schedule: 'weekly',
        async run() {
            const result = await fetchAllRatings({ force: false });
            return `Ratings refreshed: ${result?.fetched ?? 0} fetched, ${result?.skipped ?? 0} skipped`;
        },
    },
    {
        id: 'wikipedia-backfill',
        label: 'Wikipedia Backfill',
        schedule: 'weekly',
        async run() {
            await backfillWikipedia();
            return 'Wikipedia backfill complete';
        },
    },
];

// ── Pipeline Runner ─────────────────────────────────────────────────────────

/**
 * Run the pipeline.
 * @param {'nightly' | 'weekly'} mode — 'nightly' runs only nightly phases, 'weekly' runs all
 * @param {{ audit?: boolean }} options — if audit=true, takes before/after snapshots
 * @returns {Promise<{ success: boolean, results: Array<{ phase: string, status: string, message: string, durationMs: number }>, error?: string }>}
 */
export async function runPipeline(mode = 'nightly', { audit = false } = {}) {
    if (running) {
        return { success: false, results: [], error: 'Pipeline is already running' };
    }

    running = true;
    pipelineAbort = false;
    const settings = getPipelineSettings();
    const phases = PHASES.filter(p => mode === 'weekly' || p.schedule === 'nightly');

    // Persist run start
    const runRow = db.prepare(
        'INSERT INTO pipeline_runs (mode, status, started_at) VALUES (?, ?, ?)'
    ).run(mode, 'running', new Date().toISOString());
    const runId = runRow.lastInsertRowid;

    emit({ type: 'pipeline_start', mode, totalPhases: phases.length });
    console.log(`[pipeline] Starting ${mode} pipeline (${phases.length} phases)`);

    // Acquire lock (waits for backup to finish if running)
    await acquireLock('pipeline');

    // Pre-pipeline backup
    try {
        createBackup('auto');
        console.log('[pipeline] Pre-pipeline backup created');
    } catch (e) {
        console.warn('[pipeline] Pre-pipeline backup failed:', e instanceof Error ? e.message : e);
    }

    // Audit snapshot (before)
    if (audit) {
        try { takeSnapshot(`pre-${mode}`); } catch (e) {
            console.warn('[pipeline] Pre-audit snapshot failed:', e instanceof Error ? e.message : e);
        }
    }

    /** @type {Array<{ phase: string, status: string, message: string, durationMs: number }>} */
    const results = [];

    for (let i = 0; i < phases.length; i++) {
        if (pipelineAbort) {
            console.log('[pipeline] Aborted by user');
            break;
        }

        const phase = phases[i];
        const phaseFlag = settings.phaseFlags[phase.id];

        // Check if phase is disabled via settings
        if (phaseFlag === false) {
            emit({ type: 'phase_skip', phase: phase.id, phaseIndex: i, totalPhases: phases.length, message: 'Disabled in settings' });
            results.push({ phase: phase.id, status: 'skipped', message: 'Disabled in settings', durationMs: 0 });
            continue;
        }

        // Check if phase should be skipped (e.g. no Trakt configured)
        if (phase.shouldSkip?.()) {
            emit({ type: 'phase_skip', phase: phase.id, phaseIndex: i, totalPhases: phases.length, message: 'Not configured' });
            results.push({ phase: phase.id, status: 'skipped', message: 'Not configured', durationMs: 0 });
            continue;
        }

        currentPhase = phase.label;
        emit({ type: 'phase_start', phase: phase.id, phaseIndex: i, totalPhases: phases.length, message: phase.label });
        console.log(`[pipeline] Phase ${i + 1}/${phases.length}: ${phase.label}`);

        const start = Date.now();
        try {
            const message = await phase.run();
            const durationMs = Date.now() - start;
            emit({ type: 'phase_end', phase: phase.id, phaseIndex: i, totalPhases: phases.length, message, duration: durationMs });
            results.push({ phase: phase.id, status: 'done', message, durationMs });
            console.log(`[pipeline] ✓ ${phase.label} (${(durationMs / 1000).toFixed(1)}s) — ${message}`);
        } catch (e) {
            const durationMs = Date.now() - start;
            const errMsg = e instanceof Error ? e.message : String(e);
            emit({ type: 'phase_error', phase: phase.id, phaseIndex: i, totalPhases: phases.length, error: errMsg, duration: durationMs });
            results.push({ phase: phase.id, status: 'error', message: errMsg, durationMs });
            console.error(`[pipeline] ✗ ${phase.label} (${(durationMs / 1000).toFixed(1)}s) — ${errMsg}`);
            // Continue to next phase (don't abort on single failure)
        }
    }

    // Audit snapshot (after)
    if (audit) {
        try { takeSnapshot(`post-${mode}`); } catch (e) {
            console.warn('[pipeline] Post-audit snapshot failed:', e instanceof Error ? e.message : e);
        }
    }

    releaseLock('pipeline');
    running = false;
    currentPhase = '';

    const totalMs = results.reduce((sum, r) => sum + r.durationMs, 0);
    const hasError = results.some(r => r.status === 'error');
    const summary = buildSummary(results);

    // Persist run results
    try {
        db.prepare(`
            UPDATE pipeline_runs
            SET status = ?, finished_at = ?, duration_ms = ?, phase_results = ?, summary = ?
            WHERE id = ?
        `).run(
            hasError ? 'completed_with_errors' : 'completed',
            new Date().toISOString(),
            totalMs,
            JSON.stringify(results),
            summary,
            runId
        );
    } catch (e) {
        console.warn('[pipeline] Failed to persist run results:', e instanceof Error ? e.message : e);
    }

    emit({ type: 'pipeline_end', mode, message: `Completed in ${(totalMs / 1000).toFixed(0)}s` });
    console.log(`[pipeline] ${mode} pipeline complete (${(totalMs / 1000).toFixed(0)}s total)`);

    return { success: true, results };
}

// ── Scheduler ───────────────────────────────────────────────────────────────

let nightlyTimeout = /** @type {ReturnType<typeof setTimeout>|null} */ (null);
let weeklyTimeout = /** @type {ReturnType<typeof setTimeout>|null} */ (null);

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

/**
 * Calculate delay until the next occurrence of a specific time.
 * @param {string} timeStr — 'HH:MM'
 * @returns {number} milliseconds
 */
function msUntilTime(timeStr) {
    const [h, m] = timeStr.split(':').map(Number);
    const now = new Date();
    const target = new Date(now);
    target.setHours(h, m, 0, 0);
    if (target <= now) target.setDate(target.getDate() + 1);
    return target.getTime() - now.getTime();
}

/**
 * Calculate delay until the next occurrence of a specific day+time.
 * @param {string} day — 'sunday', 'monday', etc.
 * @param {string} timeStr — 'HH:MM'
 * @returns {number} milliseconds
 */
function msUntilDayTime(day, timeStr) {
    const [h, m] = timeStr.split(':').map(Number);
    const dayIndex = WEEKDAYS.indexOf(day.toLowerCase());
    if (dayIndex === -1) return msUntilTime(timeStr); // fallback

    const now = new Date();
    const target = new Date(now);
    target.setHours(h, m, 0, 0);

    // Find next occurrence of the target day
    const currentDay = now.getDay();
    let daysAhead = dayIndex - currentDay;
    if (daysAhead < 0) daysAhead += 7;
    if (daysAhead === 0 && target <= now) daysAhead = 7;
    target.setDate(target.getDate() + daysAhead);

    return target.getTime() - now.getTime();
}

async function runNightly() {
    const settings = getPipelineSettings();
    if (!settings.pipelineEnabled) return;

    try {
        await runPipeline('nightly');
    } catch (e) {
        console.error('[pipeline] Nightly run failed:', e instanceof Error ? e.message : e);
    }

    // Schedule next nightly
    scheduleNightly();
}

async function runWeekly() {
    const settings = getPipelineSettings();
    if (!settings.pipelineEnabled) return;

    try {
        await runPipeline('weekly');
    } catch (e) {
        console.error('[pipeline] Weekly run failed:', e instanceof Error ? e.message : e);
    }

    // Schedule next weekly
    scheduleWeekly();
}

function scheduleNightly() {
    if (nightlyTimeout) { clearTimeout(nightlyTimeout); nightlyTimeout = null; }
    const settings = getPipelineSettings();
    if (!settings.pipelineEnabled) return;

    const delayMs = msUntilTime(settings.nightlyTime);
    console.log(`[pipeline] Next nightly in ${Math.round(delayMs / 60000)}min`);
    nightlyTimeout = setTimeout(runNightly, delayMs);
}

function scheduleWeekly() {
    if (weeklyTimeout) { clearTimeout(weeklyTimeout); weeklyTimeout = null; }
    const settings = getPipelineSettings();
    if (!settings.pipelineEnabled) return;

    const delayMs = msUntilDayTime(settings.weeklyDay, settings.weeklyTime);
    console.log(`[pipeline] Next weekly in ${Math.round(delayMs / 60000)}min`);
    weeklyTimeout = setTimeout(runWeekly, delayMs);
}

/**
 * Start the pipeline scheduler. Call on server boot.
 */
let pipelineSchedulerStarted = false;
export function startPipelineScheduler() {
    if (pipelineSchedulerStarted) return;
    pipelineSchedulerStarted = true;
    const settings = getPipelineSettings();
    if (!settings.pipelineEnabled) {
        console.log('[pipeline] Pipeline scheduler disabled');
        return;
    }
    scheduleNightly();
    scheduleWeekly();
}

/**
 * Restart the scheduler (after settings change).
 */
export function restartPipelineScheduler() {
    pipelineSchedulerStarted = false;
    if (nightlyTimeout) { clearTimeout(nightlyTimeout); nightlyTimeout = null; }
    if (weeklyTimeout) { clearTimeout(weeklyTimeout); weeklyTimeout = null; }
    startPipelineScheduler();
}

/**
 * Stop the scheduler.
 */
export function stopPipelineScheduler() {
    if (nightlyTimeout) { clearTimeout(nightlyTimeout); nightlyTimeout = null; }
    if (weeklyTimeout) { clearTimeout(weeklyTimeout); weeklyTimeout = null; }
    console.log('[pipeline] Scheduler stopped');
}

/** Export PHASES for UI display */
export { PHASES };

// ── Run History ─────────────────────────────────────────────────────────────

/**
 * Build a human-readable summary from phase results.
 * @param {Array<{phase: string, status: string, message: string, durationMs: number}>} results
 * @returns {string}
 */
function buildSummary(results) {
    const done = results.filter(r => r.status === 'done').length;
    const errors = results.filter(r => r.status === 'error').length;
    const skipped = results.filter(r => r.status === 'skipped').length;
    const parts = [`${done} completed`];
    if (errors > 0) parts.push(`${errors} failed`);
    if (skipped > 0) parts.push(`${skipped} skipped`);
    return parts.join(', ');
}

/**
 * Get recent pipeline run history.
 * @param {number} limit
 * @returns {Array<{id: number, mode: string, status: string, started_at: string, finished_at: string|null, duration_ms: number|null, summary: string|null}>}
 */
export function getRunHistory(limit = 20) {
    return /** @type {any[]} */ (db.prepare(
        'SELECT id, mode, status, started_at, finished_at, duration_ms, summary FROM pipeline_runs ORDER BY started_at DESC LIMIT ?'
    ).all(limit));
}

/**
 * Get full details for a single pipeline run (including phase_results JSON).
 * @param {number} id
 * @returns {any|null}
 */
export function getRunDetail(id) {
    const row = /** @type {any} */ (db.prepare(
        'SELECT * FROM pipeline_runs WHERE id = ?'
    ).get(id));
    if (!row) return null;
    try { row.phase_results = JSON.parse(row.phase_results); } catch { /* keep as string */ }
    return row;
}
