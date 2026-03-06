/**
 * People Sync Engine
 * 
 * Standalone engine for syncing person/cast/crew data from Jellyfin.
 * Follows the same SSE-based pattern as sync-engine.js with:
 *   - Dedicated listeners, state, and log accumulation
 *   - Pause/resume/stop support
 *   - Background-browsable (SyncFooter integration)
 *
 * CONVENTION (10+ SECOND RULE):
 *   Any sync or action expected to take 10+ seconds MUST use this
 *   background-browsable pattern: dedicated engine state, SSE streaming,
 *   pause/resume, and SyncFooter visibility. This ensures users can
 *   safely browse away and monitor progress from anywhere in the app.
 */

import db from '$lib/server/db.js';
import { logError, logInfo, logWarn } from '$lib/server/logger.js';
import { getJellyfinApis, getItemsApi } from '$lib/server/jellyfin.js';

/** @type {Set<(data: any) => void>} */
const listeners = new Set();

/** @type {{ running: boolean, paused: boolean, abortController: AbortController | null, progress: number, itemsSynced: number, errors: number }} */
let engineState = {
    running: false,
    paused: false,
    abortController: null,
    progress: 0,
    itemsSynced: 0,
    errors: 0
};

/** @type {Array<{time: string, message: string, type: string}>} */
let recentLogs = [];

/** @type {{ totalPersons: number, totalCredits: number } | null} */
let lastResult = null;

/** @type {number|null} */
let syncHistoryId = null;

function broadcast(data) {
    if (data.log) {
        recentLogs.push({ time: new Date().toLocaleTimeString(), message: data.log, type: data.logType || 'info' });
        if (recentLogs.length > 5000) recentLogs = recentLogs.slice(-4000);
    }
    if (data.progress !== undefined) engineState.progress = data.progress;
    if (data.itemsSynced !== undefined) engineState.itemsSynced = data.itemsSynced;
    if (data.errors !== undefined) engineState.errors = data.errors;

    for (const listener of listeners) {
        try {
            listener(data);
        } catch {
            listeners.delete(listener);
        }
    }
}

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitWhilePaused() {
    while (engineState.paused && engineState.running) {
        await sleep(500);
    }
}

/**
 * Start a full people sync — fetches People data from Jellyfin for all
 * existing media_parents and upserts persons + credits.
 */
export async function startPeopleSync() {
    if (engineState.running) return;

    engineState.running = true;
    engineState.paused = false;
    engineState.abortController = new AbortController();
    engineState.progress = 0;
    engineState.itemsSynced = 0;
    engineState.errors = 0;
    recentLogs = [];
    lastResult = null;

    // Record sync start
    const result = db.prepare(
        `INSERT INTO sync_history (sync_type, status, started_at) VALUES ('people', 'running', ?)`
    ).run(new Date().toISOString());
    syncHistoryId = Number(result.lastInsertRowid);

    const settings = /** @type {any} */ (db.prepare('SELECT * FROM app_settings WHERE id = 1').get());
    const user = /** @type {any} */ (db.prepare('SELECT * FROM users LIMIT 1').get());

    if (!settings?.jellyfin_url || !user?.jellyfin_access_token) {
        broadcast({ type: 'error', log: '❌ Missing Jellyfin configuration', logType: 'error' });
        engineState.running = false;
        return;
    }

    try {
        await runPeopleSync(settings.jellyfin_url, user.jellyfin_access_token);
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        broadcast({ type: 'error', log: `❌ People sync failed: ${msg}`, logType: 'error' });
        console.error('[people-sync] Fatal error:', msg);
        if (syncHistoryId) {
            db.prepare('UPDATE sync_history SET status = ?, finished_at = ?, summary = ? WHERE id = ?')
                .run('failed', new Date().toISOString(), msg, syncHistoryId);
        }
    } finally {
        engineState.running = false;
        engineState.paused = false;
        engineState.abortController = null;
    }
}

async function runPeopleSync(jellyfinUrl, accessToken) {
    const { api } = getJellyfinApis(jellyfinUrl, accessToken);
    const itemsApi = getItemsApi(api);

    const parents = /** @type {any[]} */ (db.prepare(`
        SELECT id, jellyfin_id, title, media_type FROM media_parents
        WHERE jellyfin_id IS NOT NULL AND media_type IN ('movie', 'show')
    `).all());

    broadcast({
        type: 'progress',
        log: `👥 Starting people sync for ${parents.length} items...`,
        logType: 'info',
        progress: 0,
        itemsSynced: 0,
        errors: 0
    });
    console.log(`[people-sync] Starting for ${parents.length} items...`);

    const findPersonByTmdb = db.prepare('SELECT id FROM persons WHERE tmdb_person_id = ?');
    const findPersonByJellyfin = db.prepare('SELECT id FROM persons WHERE jellyfin_id = ?');
    const findPersonByName = db.prepare('SELECT id FROM persons WHERE name = ? LIMIT 1');
    const insertPerson = db.prepare(`
        INSERT INTO persons (name, tmdb_person_id, imdb_person_id, jellyfin_id, photo_url)
        VALUES (@name, @tmdbPersonId, @imdbPersonId, @jellyfinId, @photoUrl)
    `);
    const updatePersonByTmdb = db.prepare(`
        UPDATE persons SET name = @name,
            imdb_person_id = COALESCE(@imdbPersonId, imdb_person_id),
            jellyfin_id = COALESCE(@jellyfinId, jellyfin_id),
            photo_url = COALESCE(@photoUrl, photo_url)
        WHERE tmdb_person_id = @tmdbPersonId
    `);
    const updatePersonByJellyfin = db.prepare(`
        UPDATE persons SET name = @name,
            photo_url = COALESCE(@photoUrl, photo_url)
        WHERE jellyfin_id = @jellyfinId
    `);
    const upsertCredit = db.prepare(`
        INSERT OR IGNORE INTO person_credits (person_id, media_parent_id, role_type, character_name, sort_order)
        VALUES (@personId, @mediaParentId, @roleType, @characterName, @sortOrder)
    `);

    const typeMap = {
        'Actor': 'actor', 'Director': 'director', 'Writer': 'writer',
        'Producer': 'producer', 'Composer': 'composer', 'GuestStar': 'guest',
        'Creator': 'creator', 'Conductor': 'conductor', 'Lyricist': 'lyricist'
    };

    let synced = 0;
    let errors = 0;
    const BATCH_SIZE = 50;
    const totalBatches = Math.ceil(parents.length / BATCH_SIZE);

    for (let i = 0; i < parents.length; i += BATCH_SIZE) {
        if (!engineState.running) return;
        await waitWhilePaused();

        const batchNum = Math.floor(i / BATCH_SIZE) + 1;
        const batch = parents.slice(i, i + BATCH_SIZE);
        const jellyfinIds = batch.map(p => p.jellyfin_id);
        const progress = Math.round((i / parents.length) * 100);

        broadcast({
            type: 'progress',
            log: `👥 Batch ${batchNum}/${totalBatches} (${jellyfinIds.length} items)...`,
            logType: 'info',
            progress,
            itemsSynced: synced,
            errors
        });

        try {
            const res = await itemsApi.getItems({
                ids: jellyfinIds,
                fields: ['People'],
                enableUserData: false
            });

            const items = res.data.Items || [];
            const itemMap = new Map(items.map(item => [item.Id, item]));

            const txn = db.transaction(() => {
                for (const parent of batch) {
                    const item = itemMap.get(parent.jellyfin_id);
                    if (!item?.People || item.People.length === 0) continue;

                    for (let idx = 0; idx < item.People.length; idx++) {
                        const person = item.People[idx];
                        if (!person.Name) continue;

                        const providerIds = person.ProviderIds || {};
                        const tmdbId = providerIds.Tmdb || null;
                        const imdbId = providerIds.Imdb || null;
                        const jellyfinPersonId = person.Id || null;
                        const photoUrl = person.PrimaryImageTag && jellyfinPersonId
                            ? `${jellyfinUrl}/Items/${jellyfinPersonId}/Images/Primary`
                            : null;
                        const roleType = typeMap[person.Type] || person.Type?.toLowerCase() || 'other';
                        const characterName = person.Role || null;

                        try {
                            let personId;
                            const params = { name: person.Name, tmdbPersonId: tmdbId, imdbPersonId: imdbId, jellyfinId: jellyfinPersonId, photoUrl };
                            if (tmdbId) {
                                const existing = /** @type {any} */ (findPersonByTmdb.get(tmdbId));
                                if (existing) {
                                    updatePersonByTmdb.run(params);
                                    personId = existing.id;
                                } else {
                                    insertPerson.run(params);
                                    personId = /** @type {any} */ (findPersonByTmdb.get(tmdbId))?.id;
                                }
                            } else if (jellyfinPersonId) {
                                const existing = /** @type {any} */ (findPersonByJellyfin.get(jellyfinPersonId));
                                if (existing) {
                                    updatePersonByJellyfin.run({ name: person.Name, jellyfinId: jellyfinPersonId, photoUrl });
                                    personId = existing.id;
                                } else {
                                    const byName = /** @type {any} */ (findPersonByName.get(person.Name));
                                    if (byName) {
                                        personId = byName.id;
                                    } else {
                                        insertPerson.run(params);
                                        personId = /** @type {any} */ (findPersonByJellyfin.get(jellyfinPersonId))?.id;
                                    }
                                }
                            }

                            if (personId) {
                                upsertCredit.run({
                                    personId,
                                    mediaParentId: parent.id,
                                    roleType,
                                    characterName,
                                    sortOrder: idx
                                });
                            }
                        } catch {
                            // ignore individual person errors
                        }
                    }
                    synced++;
                }
            });
            txn();
        } catch (e) {
            errors++;
            const msg = e instanceof Error ? e.message : String(e);
            broadcast({
                type: 'progress',
                log: `❌ Batch ${batchNum} error: ${msg}`,
                logType: 'error',
                progress,
                itemsSynced: synced,
                errors
            });
            console.error(`[people-sync] Batch error:`, msg);
        }
    }

    // ─── Phase 2: Backfill external IDs for persons missing TMDB/IMDb ─────────
    const personsNeedingIds = /** @type {any[]} */ (db.prepare(`
        SELECT id, name, jellyfin_id FROM persons
        WHERE jellyfin_id IS NOT NULL AND jellyfin_id != ''
        AND (tmdb_person_id IS NULL OR tmdb_person_id = '')
        AND (imdb_person_id IS NULL OR imdb_person_id = '')
    `).all());

    if (personsNeedingIds.length > 0) {
        broadcast({
            type: 'progress',
            log: `🔗 Backfilling external IDs for ${personsNeedingIds.length} persons...`,
            logType: 'info',
            progress: 95,
            itemsSynced: synced,
            errors
        });

        const updatePersonIds = db.prepare(`
            UPDATE persons SET
                tmdb_person_id = COALESCE(@tmdbId, tmdb_person_id),
                imdb_person_id = COALESCE(@imdbId, imdb_person_id)
            WHERE id = @personId
        `);

        let idsUpdated = 0;
        let idsErrors = 0;
        for (let i = 0; i < personsNeedingIds.length; i++) {
            if (!engineState.running) break;
            while (engineState.paused) {
                await new Promise(r => setTimeout(r, 500));
            }

            const person = personsNeedingIds[i];
            try {
                const res = await fetch(
                    `${jellyfinUrl}/Items/${person.jellyfin_id}`,
                    { headers: { 'Authorization': `MediaBrowser Token="${accessToken}"` } }
                );
                if (res.ok) {
                    const item = await res.json();
                    const providerIds = item.ProviderIds || {};
                    const tmdbId = providerIds.Tmdb || providerIds.TMDb || null;
                    const imdbId = providerIds.Imdb || providerIds.IMDb || null;
                    if (tmdbId || imdbId) {
                        updatePersonIds.run({ personId: person.id, tmdbId, imdbId });
                        idsUpdated++;
                    }
                } else {
                    idsErrors++;
                    broadcast({
                        type: 'progress',
                        log: `  ⚠ ${person.name}: HTTP ${res.status} fetching external IDs`,
                        logType: 'warning',
                        progress: 95 + Math.floor((i / personsNeedingIds.length) * 5),
                        itemsSynced: synced,
                        errors: errors + idsErrors
                    });
                }
            } catch (/** @type {any} */ err) {
                idsErrors++;
                broadcast({
                    type: 'progress',
                    log: `  ✗ ${person.name}: ${err?.message || String(err)}`,
                    logType: 'error',
                    progress: 95 + Math.floor((i / personsNeedingIds.length) * 5),
                    itemsSynced: synced,
                    errors: errors + idsErrors
                });
            }

            // Log progress every 50 persons
            if ((i + 1) % 50 === 0) {
                broadcast({
                    type: 'progress',
                    log: `🔗 ${i + 1}/${personsNeedingIds.length} checked, ${idsUpdated} updated, ${idsErrors} errors`,
                    logType: 'info',
                    progress: 95 + Math.floor((i / personsNeedingIds.length) * 5),
                    itemsSynced: synced,
                    errors: errors + idsErrors
                });
            }
            await new Promise(r => setTimeout(r, 30));
        }

        errors += idsErrors;

        broadcast({
            type: 'progress',
            log: `🔗 External IDs: ${idsUpdated} persons updated with TMDB/IMDb IDs`,
            logType: 'success',
            progress: 100,
            itemsSynced: synced,
            errors
        });
    }

    const totalPersons = /** @type {any} */ (db.prepare('SELECT COUNT(*) as c FROM persons').get())?.c || 0;
    const totalCredits = /** @type {any} */ (db.prepare('SELECT COUNT(*) as c FROM person_credits').get())?.c || 0;
    lastResult = { totalPersons, totalCredits };

    const summary = `${totalPersons} people, ${totalCredits} credits`;
    broadcast({
        type: 'complete',
        log: `✅ People sync done: ${synced} items synced, ${errors} errors, ${summary}`,
        logType: 'success',
        progress: 100,
        itemsSynced: synced,
        errors
    });
    console.log(`[people-sync] ✅ Done: ${synced} items, ${errors} errors, ${summary}`);
    if (syncHistoryId) {
        db.prepare('UPDATE sync_history SET status = ?, finished_at = ?, summary = ? WHERE id = ?')
            .run('success', new Date().toISOString(), summary, syncHistoryId);
    }
}

/**
 * Start an external-IDs-only sync — backfills TMDB/IMDb IDs for persons
 * that have a jellyfin_id but are missing provider IDs.
 * Reuses the same SSE infrastructure (broadcast, pause/stop, logs).
 */
export async function startExternalIdsSync() {
    if (engineState.running) return;

    engineState.running = true;
    engineState.paused = false;
    engineState.abortController = new AbortController();
    engineState.progress = 0;
    engineState.itemsSynced = 0;
    engineState.errors = 0;
    recentLogs = [];
    lastResult = null;

    const settings = /** @type {any} */ (db.prepare('SELECT * FROM app_settings WHERE id = 1').get());
    const user = /** @type {any} */ (db.prepare('SELECT * FROM users LIMIT 1').get());

    if (!settings?.jellyfin_url || !user?.jellyfin_access_token) {
        broadcast({ type: 'error', log: '❌ Missing Jellyfin configuration', logType: 'error' });
        engineState.running = false;
        return;
    }

    const jellyfinUrl = settings.jellyfin_url;
    const accessToken = user.jellyfin_access_token;

    try {
        const personsNeedingIds = /** @type {any[]} */ (db.prepare(`
            SELECT id, name, jellyfin_id FROM persons
            WHERE jellyfin_id IS NOT NULL AND jellyfin_id != ''
            AND (tmdb_person_id IS NULL OR tmdb_person_id = '')
            AND (imdb_person_id IS NULL OR imdb_person_id = '')
        `).all());

        if (personsNeedingIds.length === 0) {
            broadcast({ type: 'complete', log: '✅ All persons already have external IDs.', logType: 'success', progress: 100, itemsSynced: 0, errors: 0 });
            console.log('[people-sync] External IDs: nothing to backfill');
            engineState.running = false;
            return;
        }

        broadcast({
            type: 'progress',
            log: `🔗 Backfilling external IDs for ${personsNeedingIds.length} persons...`,
            logType: 'info',
            progress: 0,
            itemsSynced: 0,
            errors: 0
        });
        console.log(`[people-sync] External IDs: starting for ${personsNeedingIds.length} persons`);

        const updatePersonIds = db.prepare(`
            UPDATE persons SET
                tmdb_person_id = COALESCE(@tmdbId, tmdb_person_id),
                imdb_person_id = COALESCE(@imdbId, imdb_person_id)
            WHERE id = @personId
        `);

        let updated = 0;
        let errors = 0;

        for (let i = 0; i < personsNeedingIds.length; i++) {
            if (!engineState.running) break;
            while (engineState.paused) {
                await new Promise(r => setTimeout(r, 500));
            }

            const person = personsNeedingIds[i];
            try {
                const res = await fetch(
                    `${jellyfinUrl}/Items/${person.jellyfin_id}`,
                    { headers: { 'Authorization': `MediaBrowser Token="${accessToken}"` } }
                );
                if (res.ok) {
                    const item = await res.json();
                    const providerIds = item.ProviderIds || {};
                    const tmdbId = providerIds.Tmdb || providerIds.TMDb || null;
                    const imdbId = providerIds.Imdb || providerIds.IMDb || null;
                    if (tmdbId || imdbId) {
                        updatePersonIds.run({ personId: person.id, tmdbId, imdbId });
                        updated++;
                    }
                } else {
                    logError('people-sync', `External ID fetch failed for person '${person.name}' (jellyfin_id: ${person.jellyfin_id})`, { status: res.status });
                    errors++;
                }
            } catch (/** @type {any} */ err) {
                logError('people-sync', `External ID error for person '${person.name}' (jellyfin_id: ${person.jellyfin_id})`, { error: err?.message || String(err) });
                errors++;
            }

            // Broadcast progress every 50 persons
            if ((i + 1) % 50 === 0 || i === personsNeedingIds.length - 1) {
                const progress = Math.floor(((i + 1) / personsNeedingIds.length) * 100);
                broadcast({
                    type: 'progress',
                    log: `🔗 ${i + 1}/${personsNeedingIds.length} checked, ${updated} updated, ${errors} errors`,
                    logType: 'info',
                    progress,
                    itemsSynced: updated,
                    errors
                });
                console.log(`[people-sync] External IDs: ${i + 1}/${personsNeedingIds.length}, ${updated} updated`);
            }
            await new Promise(r => setTimeout(r, 30));
        }

        const remaining = /** @type {any} */ (db.prepare(`
            SELECT COUNT(*) as cnt FROM persons
            WHERE jellyfin_id IS NOT NULL AND jellyfin_id != ''
            AND (tmdb_person_id IS NULL OR tmdb_person_id = '')
            AND (imdb_person_id IS NULL OR imdb_person_id = '')
        `).get())?.cnt || 0;

        broadcast({
            type: 'complete',
            log: `✅ External IDs done: ${updated} updated, ${errors} errors, ${remaining} remaining`,
            logType: 'success',
            progress: 100,
            itemsSynced: updated,
            errors
        });
        console.log(`[people-sync] External IDs done: ${updated} updated, ${errors} errors, ${remaining} remaining`);
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        broadcast({ type: 'error', log: `❌ External IDs sync failed: ${msg}`, logType: 'error' });
        console.error('[people-sync] External IDs error:', msg);
    } finally {
        engineState.running = false;
        engineState.paused = false;
        engineState.abortController = null;
    }
}

export function pausePeopleSync() {
    engineState.paused = true;
    broadcast({ type: 'paused', log: '⏸️ People sync paused.', logType: 'info' });
}

export function resumePeopleSync() {
    engineState.paused = false;
    broadcast({ type: 'resumed', log: '▶️ People sync resumed.', logType: 'info' });
}

export function stopPeopleSync() {
    engineState.running = false;
    engineState.paused = false;
    broadcast({ type: 'stopped', log: '⏹️ People sync stopped.', logType: 'warning' });
    if (syncHistoryId) {
        db.prepare('UPDATE sync_history SET status = ?, finished_at = ? WHERE id = ?')
            .run('interrupted', new Date().toISOString(), syncHistoryId);
    }
}

export function addListener(callback) {
    listeners.add(callback);
    return () => listeners.delete(callback);
}

export function isPeopleRunning() {
    return engineState.running;
}

export function getPeopleStatus() {
    const totalPersons = /** @type {any} */ (db.prepare('SELECT COUNT(*) as c FROM persons').get())?.c || 0;
    const totalCredits = /** @type {any} */ (db.prepare('SELECT COUNT(*) as c FROM person_credits').get())?.c || 0;
    return {
        running: engineState.running,
        paused: engineState.paused,
        progress: engineState.progress,
        itemsSynced: engineState.itemsSynced,
        errors: engineState.errors,
        logs: recentLogs,
        totalPersons,
        totalCredits,
        lastResult
    };
}
