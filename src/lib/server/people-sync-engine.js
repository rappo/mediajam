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

    if (!settings?.jellyfin_url || !user?.jellyfin_access_token || !user?.jellyfin_user_id) {
        broadcast({ type: 'error', log: '❌ Missing Jellyfin configuration', logType: 'error' });
        engineState.running = false;
        return;
    }

    try {
        await runPeopleSync(settings.jellyfin_url, user.jellyfin_access_token, user.jellyfin_user_id);
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

async function runPeopleSync(jellyfinUrl, accessToken, userId) {
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
    // NOTE: findPersonByName removed — name-only matching causes collisions (e.g. two different "Emma Watson" actors)
    const insertPerson = db.prepare(`
        INSERT OR IGNORE INTO persons (name, tmdb_person_id, imdb_person_id, jellyfin_id, photo_url)
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
                                    try {
                                        insertPerson.run(params);
                                        personId = /** @type {any} */ (findPersonByTmdb.get(tmdbId))?.id;
                                    } catch {
                                        // UNIQUE constraint — another row got this tmdb_person_id first
                                        const retry = /** @type {any} */ (findPersonByTmdb.get(tmdbId));
                                        if (retry) {
                                            updatePersonByTmdb.run(params);
                                            personId = retry.id;
                                        }
                                    }
                                }
                            } else if (jellyfinPersonId) {
                                const existing = /** @type {any} */ (findPersonByJellyfin.get(jellyfinPersonId));
                                if (existing) {
                                    updatePersonByJellyfin.run({ name: person.Name, jellyfinId: jellyfinPersonId, photoUrl });
                                    personId = existing.id;
                                } else {
                                    // No Jellyfin match either — create new person
                                    // (Don't fall back to name matching: different people can share a name)
                                    try {
                                        insertPerson.run(params);
                                        personId = /** @type {any} */ (findPersonByJellyfin.get(jellyfinPersonId))?.id;
                                    } catch {
                                        // constraint error — skip
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
        const ID_BATCH_SIZE = 50;
        const totalBatches = Math.ceil(personsNeedingIds.length / ID_BATCH_SIZE);

        for (let b = 0; b < personsNeedingIds.length; b += ID_BATCH_SIZE) {
            if (!engineState.running) break;
            while (engineState.paused) {
                await new Promise(r => setTimeout(r, 500));
            }

            const batch = personsNeedingIds.slice(b, b + ID_BATCH_SIZE);
            const jellyfinIds = batch.map(p => p.jellyfin_id);
            const batchNum = Math.floor(b / ID_BATCH_SIZE) + 1;

            try {
                const res = await itemsApi.getItems({
                    ids: jellyfinIds,
                    fields: ['ProviderIds'],
                    enableUserData: false
                });

                const items = res.data.Items || [];
                const itemMap = new Map(items.map(item => [item.Id, item]));

                // Batch DB updates in a transaction
                db.transaction(() => {
                    for (const person of batch) {
                        const item = itemMap.get(person.jellyfin_id);
                        if (!item) continue;

                        const providerIds = item.ProviderIds || {};
                        const tmdbId = providerIds.Tmdb || providerIds.TMDb || null;
                        const imdbId = providerIds.Imdb || providerIds.IMDb || null;
                        if (tmdbId || imdbId) {
                            // Guard: skip if another person already has this tmdb_person_id
                            if (tmdbId) {
                                const clash = /** @type {any} */ (db.prepare(
                                    'SELECT id FROM persons WHERE tmdb_person_id = ? AND id != ?'
                                ).get(tmdbId, person.id));
                                if (clash) continue; // another person owns this TMDB ID
                            }
                            try {
                                updatePersonIds.run({ personId: person.id, tmdbId, imdbId });
                                idsUpdated++;
                            } catch {
                                // UNIQUE constraint — skip
                            }
                        }
                    }
                })();
            } catch (/** @type {any} */ err) {
                idsErrors++;
                broadcast({
                    type: 'progress',
                    log: `  ✗ Batch ${batchNum}/${totalBatches} error: ${err?.message || String(err)}`,
                    logType: 'error',
                    progress: 95 + Math.floor((b / personsNeedingIds.length) * 5),
                    itemsSynced: synced,
                    errors: errors + idsErrors
                });
            }

            // Log progress every batch
            broadcast({
                type: 'progress',
                log: `🔗 Batch ${batchNum}/${totalBatches}: ${idsUpdated} updated, ${idsErrors} errors`,
                logType: 'info',
                progress: 95 + Math.floor(((b + batch.length) / personsNeedingIds.length) * 5),
                itemsSynced: synced,
                errors: errors + idsErrors
            });
        }

        errors += idsErrors;

        broadcast({
            type: 'progress',
            log: `🔗 External IDs: ${idsUpdated} persons updated with TMDB/IMDb IDs`,
            logType: 'success',
            progress: 90,
            itemsSynced: synced,
            errors
        });
    }

    // ─── Phase 3: TMDB Crew Backfill ─────────────────────────────────────────
    // Find movies/shows with TMDB IDs that are missing director or writer credits.
    // Fetch crew from TMDB and upsert the missing credits.
    try {
        const { tmdbFetch, getTmdbKey } = await import('$lib/server/tmdb.js');

        if (getTmdbKey()) {
            // Find items missing director credits (most critical gap)
            const missingCrew = /** @type {any[]} */ (db.prepare(`
                SELECT mp.id, mp.tmdb_id, mp.media_type, mp.title
                FROM media_parents mp
                WHERE mp.tmdb_id IS NOT NULL AND mp.tmdb_id != ''
                  AND mp.media_type IN ('movie', 'show')
                  AND NOT EXISTS (
                      SELECT 1 FROM person_credits pc
                      WHERE pc.media_parent_id = mp.id
                        AND pc.role_type IN ('director', 'writer')
                  )
                ORDER BY mp.title
            `).all());

            if (missingCrew.length > 0) {
                broadcast({
                    type: 'progress',
                    log: `🎬 Phase 3: Backfilling crew from TMDB for ${missingCrew.length} items missing director/writer...`,
                    logType: 'info',
                    progress: 92,
                    itemsSynced: synced,
                    errors
                });
                console.log(`[people-sync] TMDB crew backfill: ${missingCrew.length} items`);

                let crewAdded = 0;
                let crewErrors = 0;

                // Map TMDB crew jobs to our role types
                const crewJobMap = {
                    'Director': 'director',
                    'Screenplay': 'writer',
                    'Writer': 'writer',
                    'Story': 'writer',
                    'Novel': 'writer',
                    'Characters': 'writer',
                    'Original Story': 'writer',
                    'Author': 'writer',
                    'Comic Book': 'writer',
                    'Teleplay': 'writer',
                };

                const findPersonByTmdbCrew = db.prepare('SELECT id FROM persons WHERE tmdb_person_id = ?');

                for (let i = 0; i < missingCrew.length; i++) {
                    if (!engineState.running) break;
                    await waitWhilePaused();

                    const item = missingCrew[i];
                    const tmdbType = item.media_type === 'show' ? 'tv' : 'movie';

                    try {
                        const res = await tmdbFetch(`/${tmdbType}/${item.tmdb_id}/credits`);
                        if (!res.ok) {
                            if (res.status === 429) {
                                broadcast({ type: 'progress', log: `⏳ TMDB rate limit, waiting 2s...`, logType: 'warning' });
                                await sleep(2000);
                                i--; // retry
                                continue;
                            }
                            crewErrors++;
                            continue;
                        }

                        const data = await res.json();
                        const crew = data.crew || [];

                        // Filter to directors and writers only
                        const relevantCrew = crew.filter((/** @type {any} */ c) =>
                            crewJobMap[c.job] || c.department === 'Directing'
                        );

                        if (relevantCrew.length > 0) {
                            db.transaction(() => {
                                for (let idx = 0; idx < relevantCrew.length; idx++) {
                                    const member = relevantCrew[idx];
                                    const tmdbPersonId = String(member.id);
                                    const name = member.name;
                                    if (!name) continue;

                                    const roleType = member.department === 'Directing' ? 'director'
                                        : crewJobMap[member.job] || 'writer';
                                    const characterName = member.job || null;

                                    // Upsert person
                                    let personId;
                                    const existing = /** @type {any} */ (findPersonByTmdbCrew.get(tmdbPersonId));
                                    if (existing) {
                                        personId = existing.id;
                                    } else {
                                        const photoUrl = member.profile_path
                                            ? `https://image.tmdb.org/t/p/w300${member.profile_path}`
                                            : null;
                                        try {
                                            insertPerson.run({
                                                name,
                                                tmdbPersonId: tmdbPersonId,
                                                imdbPersonId: null,
                                                jellyfinId: null,
                                                photoUrl
                                            });
                                            personId = /** @type {any} */ (findPersonByTmdbCrew.get(tmdbPersonId))?.id;
                                        } catch {
                                            // UNIQUE constraint — already exists
                                            const retry = /** @type {any} */ (findPersonByTmdbCrew.get(tmdbPersonId));
                                            if (retry) personId = retry.id;
                                        }
                                    }

                                    if (personId) {
                                        upsertCredit.run({
                                            personId,
                                            mediaParentId: item.id,
                                            roleType,
                                            characterName: roleType === 'director' ? null : characterName,
                                            sortOrder: 1000 + idx  // sort after Jellyfin actors
                                        });
                                        crewAdded++;
                                    }
                                }
                            })();
                        }
                    } catch (/** @type {any} */ err) {
                        crewErrors++;
                        if ((crewErrors % 10) === 1) {
                            logWarn('people-sync', `TMDB crew fetch error for ${item.title}: ${err?.message || String(err)}`);
                        }
                    }

                    // Progress and rate limiting
                    if ((i + 1) % 25 === 0 || i === missingCrew.length - 1) {
                        const progress = 92 + Math.floor(((i + 1) / missingCrew.length) * 8);
                        broadcast({
                            type: 'progress',
                            log: `🎬 ${i + 1}/${missingCrew.length} — ${crewAdded} crew credits added, ${crewErrors} errors`,
                            logType: 'info',
                            progress,
                            itemsSynced: synced,
                            errors: errors + crewErrors
                        });
                    }
                    await sleep(250); // TMDB rate limit: ~40 req/10s
                }

                errors += crewErrors;
                broadcast({
                    type: 'progress',
                    log: `🎬 TMDB crew backfill: ${crewAdded} director/writer credits added across ${missingCrew.length} items`,
                    logType: 'success',
                    progress: 100,
                    itemsSynced: synced,
                    errors
                });
                console.log(`[people-sync] TMDB crew backfill done: ${crewAdded} credits added, ${crewErrors} errors`);
            }
        }
    } catch (/** @type {any} */ e) {
        const msg = e?.message || String(e);
        logWarn('people-sync', `TMDB crew backfill skipped: ${msg}`);
        broadcast({
            type: 'progress',
            log: `⚠️ TMDB crew backfill skipped: ${msg}`,
            logType: 'warning',
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
 * Enrich Sync — fetch full TMDB profile data for all persons that have a tmdb_person_id.
 * Updates bio, birth/death dates, photo_url, birth_place, imdb_id.
 * Middle ground between "External IDs only" and "Full Jellyfin re-sync".
 */
export async function startPeopleEnrichSync() {
    if (engineState.running) return;

    engineState.running = true;
    engineState.paused = false;
    engineState.abortController = new AbortController();
    engineState.progress = 0;
    engineState.itemsSynced = 0;
    engineState.errors = 0;
    recentLogs = [];
    lastResult = null;

    const { tmdbFetch, getTmdbKey } = await import('$lib/server/tmdb.js');

    if (!getTmdbKey()) {
        broadcast({ type: 'error', log: '❌ No TMDB API key configured', logType: 'error' });
        engineState.running = false;
        return;
    }

    try {
        const persons = /** @type {any[]} */ (db.prepare(`
            SELECT id, name, tmdb_person_id, bio, bio_tmdb, birth_date, death_date, photo_url, imdb_person_id, birth_place
            FROM persons
            WHERE tmdb_person_id IS NOT NULL AND tmdb_person_id != ''
              AND tmdb_enriched_at IS NULL
        `).all());

        if (persons.length === 0) {
            broadcast({ type: 'complete', log: '✅ No persons with TMDB IDs to enrich.', logType: 'success', progress: 100, itemsSynced: 0, errors: 0 });
            engineState.running = false;
            return;
        }

        broadcast({
            type: 'progress',
            log: `📝 Enriching ${persons.length} persons from TMDB...`,
            logType: 'info',
            progress: 0, itemsSynced: 0, errors: 0
        });
        console.log(`[people-sync] Enrich: starting for ${persons.length} persons`);

        const updatePerson = db.prepare(`
            UPDATE persons SET
                imdb_person_id = COALESCE(@imdbId, imdb_person_id),
                bio_tmdb = COALESCE(@bio, bio_tmdb),
                birth_date = COALESCE(@birthDate, birth_date),
                death_date = COALESCE(@deathDate, death_date),
                photo_url = COALESCE(@photoUrl, photo_url),
                birth_place = COALESCE(@birthPlace, birth_place),
                tmdb_enriched_at = datetime('now')
            WHERE id = @personId
        `);

        let enriched = 0;
        let skipped = 0;
        let errors = 0;

        const ENRICH_CONCURRENCY = 4; // TMDB allows ~40 req/10s
        for (let i = 0; i < persons.length; i += ENRICH_CONCURRENCY) {
            if (!engineState.running) break;
            await waitWhilePaused();

            const batch = persons.slice(i, i + ENRICH_CONCURRENCY);

            await Promise.allSettled(batch.map(async (person) => {
                try {
                    const tmdbRes = await tmdbFetch(
                        `/person/${person.tmdb_person_id}`, { append_to_response: 'external_ids' }
                    );
                    if (tmdbRes.ok) {
                        const d = await tmdbRes.json();
                        const imdbId = d.imdb_id || d.external_ids?.imdb_id || null;
                        const bio = d.biography || null;
                        const birthDate = d.birthday || null;
                        const deathDate = d.deathday || null;
                        const photoUrl = d.profile_path ? `https://image.tmdb.org/t/p/w300${d.profile_path}` : null;
                        const birthPlace = d.place_of_birth || null;

                        const hasNew = (imdbId && !person.imdb_person_id) ||
                            (bio && !person.bio_tmdb) ||
                            (birthDate && !person.birth_date) ||
                            (deathDate && !person.death_date) ||
                            (photoUrl && !person.photo_url) ||
                            (birthPlace && !person.birth_place);

                        if (hasNew) {
                            updatePerson.run({
                                personId: person.id,
                                imdbId, bio, birthDate, deathDate, photoUrl, birthPlace
                            });
                            enriched++;
                        } else {
                            db.prepare(`UPDATE persons SET tmdb_enriched_at = datetime('now') WHERE id = ?`).run(person.id);
                            skipped++;
                        }
                    } else if (tmdbRes.status === 429) {
                        // Rate limited — will be retried on next run
                        errors++;
                    } else {
                        errors++;
                    }
                } catch (/** @type {any} */ err) {
                    logError('people-sync', `Enrich error for '${person.name}'`, { error: err?.message || String(err) });
                    errors++;
                }
            }));

            if ((i + ENRICH_CONCURRENCY) % 100 < ENRICH_CONCURRENCY || i + ENRICH_CONCURRENCY >= persons.length) {
                const progress = Math.floor(((i + batch.length) / persons.length) * 100);
                broadcast({
                    type: 'progress',
                    log: `📝 ${Math.min(i + ENRICH_CONCURRENCY, persons.length)}/${persons.length} — ${enriched} enriched, ${skipped} up-to-date, ${errors} errors`,
                    logType: 'info',
                    progress, itemsSynced: enriched, errors
                });
            }
            // Delay between batches — TMDB rate limit: ~40 req/10s
            await sleep(300);
        }

        broadcast({
            type: 'complete',
            log: `✅ Enrich done: ${enriched} updated, ${skipped} already up-to-date, ${errors} errors`,
            logType: 'success',
            progress: 100, itemsSynced: enriched, errors
        });
        console.log(`[people-sync] Enrich done: ${enriched} updated, ${skipped} skipped, ${errors} errors`);
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        broadcast({ type: 'error', log: `❌ Enrich sync failed: ${msg}`, logType: 'error' });
        console.error('[people-sync] Enrich error:', msg);
    } finally {
        engineState.running = false;
        engineState.paused = false;
        engineState.abortController = null;
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

    if (!settings?.jellyfin_url || !user?.jellyfin_access_token || !user?.jellyfin_user_id) {
        broadcast({ type: 'error', log: '❌ Missing Jellyfin configuration', logType: 'error' });
        engineState.running = false;
        return;
    }

    const jellyfinUrl = settings.jellyfin_url;
    const accessToken = user.jellyfin_access_token;
    const userId = user.jellyfin_user_id;

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
                    `${jellyfinUrl}/Users/${userId}/Items/${person.jellyfin_id}`,
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
