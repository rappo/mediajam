import db from '$lib/server/db.js';
import { getJellyfinApis, getItemsApi } from '$lib/server/jellyfin.js';
import { json } from '@sveltejs/kit';
import { broadcast } from '$lib/server/sync-engine.js';

/** @type {boolean} */
let peopleSyncRunning = false;

/**
 * Targeted people-only sync: fetches People data from Jellyfin for all existing
 * media_parents. Runs fire-and-forget server-side — safe to navigate away.
 * Streams progress via SSE broadcast.
 */
export async function POST({ locals }) {
    if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
    if (peopleSyncRunning) return json({ error: 'People sync already running' }, { status: 409 });

    const settings = /** @type {any} */ (db.prepare('SELECT * FROM app_settings WHERE id = 1').get());
    const user = /** @type {any} */ (db.prepare('SELECT * FROM users LIMIT 1').get());

    if (!settings?.jellyfin_url || !user?.jellyfin_access_token) {
        return json({ error: 'Missing Jellyfin configuration' }, { status: 400 });
    }

    // Fire-and-forget: start the sync in the background
    peopleSyncRunning = true;
    runPeopleSync(settings.jellyfin_url, user.jellyfin_access_token).finally(() => {
        peopleSyncRunning = false;
    });

    return json({ success: true, started: true });
}

/**
 * Background people sync — streams progress via broadcast()
 */
async function runPeopleSync(jellyfinUrl, accessToken) {
    const { api } = getJellyfinApis(jellyfinUrl, accessToken);
    const itemsApi = getItemsApi(api);

    const parents = /** @type {any[]} */ (db.prepare(`
        SELECT id, jellyfin_id, title, media_type FROM media_parents
        WHERE jellyfin_id IS NOT NULL AND media_type IN ('movie', 'show')
    `).all());

    broadcast({ log: `[People] Starting sync for ${parents.length} items...`, logType: 'info' });
    console.log(`[people-sync] Starting people sync for ${parents.length} items...`);

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
        const batchNum = Math.floor(i / BATCH_SIZE) + 1;
        const batch = parents.slice(i, i + BATCH_SIZE);
        const jellyfinIds = batch.map(p => p.jellyfin_id);

        broadcast({
            log: `[People] Batch ${batchNum}/${totalBatches} (${jellyfinIds.length} items)...`,
            logType: 'info',
            libProgress: Math.round((i / parents.length) * 100)
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
            broadcast({ log: `[People] Batch ${batchNum} error: ${msg}`, logType: 'error' });
            console.error(`[people-sync] Batch error:`, msg);
        }
    }

    const totalPersons = /** @type {any} */ (db.prepare('SELECT COUNT(*) as c FROM persons').get())?.c || 0;
    const totalCredits = /** @type {any} */ (db.prepare('SELECT COUNT(*) as c FROM person_credits').get())?.c || 0;

    broadcast({
        log: `[People] ✅ Done: ${synced} items synced, ${errors} errors, ${totalPersons} people, ${totalCredits} credits`,
        logType: 'info',
        libProgress: 100
    });
    console.log(`[people-sync] ✅ Done: ${synced} items synced, ${errors} errors, ${totalPersons} people, ${totalCredits} credits`);
}

/** GET: return person stats and sync status */
export async function GET() {
    const totalPersons = /** @type {any} */ (db.prepare('SELECT COUNT(*) as c FROM persons').get())?.c || 0;
    const totalCredits = /** @type {any} */ (db.prepare('SELECT COUNT(*) as c FROM person_credits').get())?.c || 0;
    const roleBreakdown = /** @type {any[]} */ (db.prepare(`
        SELECT role_type, COUNT(*) as count FROM person_credits GROUP BY role_type ORDER BY count DESC
    `).all());

    return json({ totalPersons, totalCredits, roleBreakdown, running: peopleSyncRunning });
}
