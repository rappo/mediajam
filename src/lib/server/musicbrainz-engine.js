/**
 * MusicBrainz Enrichment Engine
 * 
 * Extracts band members from MusicBrainz, stores external IDs,
 * and cross-links persons with existing Jellyfin-sourced people via IMDb ID.
 * 
 * Follows the SSE-driven background sync pattern (10+ SECOND RULE):
 *   - Dedicated listeners, state, and log accumulation
 *   - Pause/resume/stop support
 *   - SyncFooter integration for browsing away
 * 
 * Rate limited to 1 request/second per MusicBrainz API policy.
 */
import db from '$lib/server/db.js';

const MB_API = 'https://musicbrainz.org/ws/2';
const MB_USER_AGENT = 'MediaJam/1.0 (https://github.com/mediajam)';
const MB_RATE_MS = 1100; // slightly over 1s to stay safe

/** @type {{ running: boolean, paused: boolean, abortController: AbortController | null }} */
let engineState = { running: false, paused: false, abortController: null };

/** @type {number} */
let progress = 0;
/** @type {number} */
let itemsSynced = 0;
/** @type {number} */
let errorCount = 0;

/** @type {Array<{time: string, message: string, type: string}>} */
let recentLogs = [];

/** @type {{ totalPersons: number, totalCredits: number, totalExternalIds: number, mergedPersons: number } | null} */
let lastResult = null;

/** @type {number|null} */
let syncHistoryId = null;

/** @type {Set<(data: any) => void>} */
const listeners = new Set();

/**
 * @param {Record<string, any>} data 
 */
function broadcast(data) {
    const time = new Date().toLocaleTimeString('en-US', { hour12: true, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    if (data.log) {
        recentLogs.push({ time, message: data.log, type: data.logType || 'info' });
        if (recentLogs.length > 200) recentLogs = recentLogs.slice(-150);
    }
    const snapshot = {
        status: engineState.running ? (engineState.paused ? 'paused' : 'syncing') : 'idle',
        progress,
        itemsSynced,
        errors: errorCount,
        logs: recentLogs,
        result: lastResult,
        ...data
    };
    for (const cb of listeners) {
        try { cb(snapshot); } catch { /* listener error */ }
    }
}

/** @param {number} ms */
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function waitWhilePaused() {
    while (engineState.paused && engineState.running) {
        await sleep(300);
    }
}

/**
 * Fetch from MusicBrainz API with rate limiting and error handling.
 * @param {string} path 
 * @returns {Promise<any|null>}
 */
async function mbFetch(path) {
    await waitWhilePaused();
    if (!engineState.running) return null;

    try {
        const res = await fetch(`${MB_API}${path}`, {
            headers: {
                'User-Agent': MB_USER_AGENT,
                'Accept': 'application/json'
            },
            signal: AbortSignal.timeout(15000)
        });
        if (!res.ok) {
            if (res.status === 503 || res.status === 429) {
                // Rate limited — wait and retry once
                broadcast({ log: `Rate limited (${res.status}), waiting 2s...`, logType: 'warning' });
                await sleep(2000);
                const retry = await fetch(`${MB_API}${path}`, {
                    headers: { 'User-Agent': MB_USER_AGENT, 'Accept': 'application/json' },
                    signal: AbortSignal.timeout(15000)
                });
                if (retry.ok) return await retry.json();
            }
            return null;
        }
        return await res.json();
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('timeout') || msg.includes('abort')) {
            broadcast({ log: `  ⚠ Request timed out`, logType: 'warning' });
        }
        return null;
    } finally {
        // Always respect rate limit
        await sleep(MB_RATE_MS);
    }
}

/**
 * Map MusicBrainz URL relationship type to a source key.
 * @param {string} type
 * @param {string} url
 * @returns {string|null}
 */
function urlRelToSource(type, url) {
    /** @type {Record<string, string|null>} */
    const map = {
        'IMDb': 'imdb',
        'allmusic': 'allmusic',
        'discogs': 'discogs',
        'wikidata': 'wikidata',
        'last.fm': 'lastfm',
        'bandcamp': 'bandcamp',
        'soundcloud': 'soundcloud',
        'songkick': 'songkick',
        'setlistfm': 'setlistfm',
        'vgmdb': 'vgmdb',
        'secondhandsongs': 'secondhandsongs',
        'BBC Music page': 'bbc_music',
        'image': null, // skip images for external_ids
        'social network': null,
        'streaming': null,
        'free streaming': null,
        'purchase for download': null,
        'purchase for mail-order': null,
        'lyrics': null,
        'other databases': null
    };
    if (type in map) return map[type];
    // For "other databases", try to detect by URL
    if (type === 'other databases') {
        if (url.includes('mobygames.com')) return 'mobygames';
        if (url.includes('rateyourmusic.com')) return 'rateyourmusic';
        if (url.includes('metal-archives.com')) return 'metal_archives';
    }
    // For streaming, detect specific interesting ones
    if (type === 'free streaming' || type === 'streaming') {
        if (url.includes('spotify.com')) return 'spotify';
        if (url.includes('deezer.com')) return 'deezer';
        if (url.includes('tidal.com')) return 'tidal';
    }
    if (type === 'social network') {
        if (url.includes('instagram.com')) return 'instagram';
        if (url.includes('facebook.com')) return 'facebook';
    }
    return null;
}

/**
 * Extract IMDb person ID from a URL like https://www.imdb.com/name/nm0722153/
 * @param {string} url
 * @returns {string|null}
 */
function extractImdbId(url) {
    const match = url.match(/imdb\.com\/name\/(nm\d+)/);
    return match ? match[1] : null;
}

export async function startMusicBrainzEnrich() {
    if (engineState.running) {
        broadcast({ log: 'MusicBrainz enrichment already running.', logType: 'warning' });
        return;
    }

    engineState = { running: true, paused: false, abortController: new AbortController() };
    progress = 0;
    itemsSynced = 0;
    errorCount = 0;
    recentLogs = [];
    lastResult = null;

    broadcast({ log: '🎵 Starting MusicBrainz enrichment...', logType: 'info' });

    // Record sync start
    const histResult = db.prepare(
        `INSERT INTO sync_history (sync_type, status, started_at) VALUES ('musicbrainz', 'running', ?)`
    ).run(new Date().toISOString());
    syncHistoryId = Number(histResult.lastInsertRowid);

    try {
        await runEnrichment();
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        broadcast({ log: `Fatal error: ${msg}`, logType: 'error' });
        errorCount++;
        if (syncHistoryId) {
            db.prepare('UPDATE sync_history SET status = ?, finished_at = ?, summary = ? WHERE id = ?')
                .run('failed', new Date().toISOString(), msg, syncHistoryId);
        }
    } finally {
        engineState.running = false;
        engineState.paused = false;
        const summary = lastResult
            ? `${lastResult.totalPersons} persons, ${lastResult.totalCredits} credits, ${lastResult.totalExternalIds} external IDs, ${lastResult.mergedPersons} cross-linked`
            : '0 results';
        broadcast({
            log: `✓ MusicBrainz enrichment complete. ${summary}`,
            logType: 'success',
            status: 'complete'
        });
        // Update history if not already updated by error handler
        if (syncHistoryId && lastResult) {
            db.prepare('UPDATE sync_history SET status = ?, finished_at = ?, summary = ? WHERE id = ?')
                .run('success', new Date().toISOString(), summary, syncHistoryId);
        }
    }
}

async function runEnrichment() {
    // Prepared statements
    const findPersonByMbid = db.prepare(`
        SELECT id FROM persons WHERE musicbrainz_artist_id = @mbid LIMIT 1
    `);

    const insertPerson = db.prepare(`
        INSERT INTO persons (name, musicbrainz_artist_id) VALUES (@name, @mbid)
    `);

    const findPersonByName = db.prepare(`
        SELECT id FROM persons WHERE LOWER(name) = LOWER(@name) LIMIT 1
    `);

    const upsertCredit = db.prepare(`
        INSERT OR IGNORE INTO person_credits (person_id, media_parent_id, role_type, character_name, sort_order)
        VALUES (@personId, @mediaParentId, @roleType, @characterName, @sortOrder)
    `);

    const upsertExternalId = db.prepare(`
        INSERT OR REPLACE INTO external_ids (person_id, source, external_id)
        VALUES (@personId, @source, @externalId)
    `);

    const updatePersonImdb = db.prepare(`
        UPDATE persons SET imdb_person_id = @imdbId WHERE id = @personId AND imdb_person_id IS NULL
    `);

    // One-time cleanup: remove persons/credits from zero-album artists that were previously enriched
    const zeroAlbumArtists = /** @type {Array<{id: number}>} */ (
        db.prepare(`
            SELECT mp.id FROM media_parents mp
            WHERE mp.media_type = 'artist'
              AND (mp.collected_children IS NULL OR mp.collected_children < 1)
              AND mp.id IN (SELECT DISTINCT media_parent_id FROM person_credits)
        `).all()
    );
    if (zeroAlbumArtists.length > 0) {
        broadcast({ log: `🧹 Cleaning up ${zeroAlbumArtists.length} zero-album artists with stale credits...`, logType: 'info' });
        const cleanupTx = db.transaction(() => {
            for (const a of zeroAlbumArtists) {
                // Get persons only credited for this zero-album artist
                const orphanPersons = /** @type {Array<{person_id: number}>} */ (
                    db.prepare(`
                        SELECT pc.person_id FROM person_credits pc
                        WHERE pc.media_parent_id = ?
                        AND pc.person_id NOT IN (
                            SELECT person_id FROM person_credits WHERE media_parent_id != ?
                        )
                    `).all(a.id, a.id)
                );
                // Delete credits for this artist
                db.prepare('DELETE FROM person_credits WHERE media_parent_id = ?').run(a.id);
                // Delete orphaned persons + their external_ids
                for (const p of orphanPersons) {
                    db.prepare('DELETE FROM external_ids WHERE person_id = ?').run(p.person_id);
                    db.prepare('DELETE FROM persons WHERE id = ?').run(p.person_id);
                }
            }
        });
        cleanupTx();
        broadcast({ log: `  ✓ Cleaned up credits from ${zeroAlbumArtists.length} zero-album artists`, logType: 'success' });
    }

    // Get artists with MusicBrainz IDs that have collected albums
    const artists = /** @type {Array<{id: number, title: string, musicbrainz_id: string}>} */ (
        db.prepare(`
            SELECT id, title, musicbrainz_id 
            FROM media_parents 
            WHERE media_type = 'artist' 
              AND musicbrainz_id IS NOT NULL AND musicbrainz_id != ''
              AND collected_children > 0
        `).all()
    );

    if (artists.length === 0) {
        broadcast({ log: 'No artists with MusicBrainz IDs and collected albums found. Run a Jellyfin sync first.', logType: 'warning' });
        lastResult = { totalPersons: 0, totalCredits: 0, totalExternalIds: 0, mergedPersons: 0 };
        return;
    }

    broadcast({ log: `Found ${artists.length} artists with MusicBrainz IDs and collected albums`, logType: 'info' });

    let totalPersons = 0;
    let totalCredits = 0;
    let totalExternalIds = 0;
    let skippedArtists = 0;
    let skippedMembers = 0;
    /** @type {Set<string>} */
    const processedMemberMbids = new Set();

    // Check which artists already have MusicBrainz-sourced credits (for intelligent resume)
    const hasCreditsForArtist = db.prepare(`
        SELECT 1 FROM person_credits pc
        JOIN persons p ON pc.person_id = p.id
        WHERE pc.media_parent_id = ? AND p.musicbrainz_artist_id IS NOT NULL
        LIMIT 1
    `);

    // Phase 1: Extract members for each artist
    for (let i = 0; i < artists.length; i++) {
        if (!engineState.running) break;
        await waitWhilePaused();

        const artist = artists[i];
        progress = Math.round(((i + 1) / artists.length) * 80);

        // Intelligent resume: skip if this artist already has MB-sourced member credits
        const existing = /** @type {any} */ (hasCreditsForArtist.get(artist.id));
        if (existing) {
            skippedArtists++;
            // Still collect member MBIDs for Phase 2
            const existingMembers = /** @type {Array<{musicbrainz_artist_id: string}>} */ (
                db.prepare(`
                    SELECT DISTINCT p.musicbrainz_artist_id FROM persons p
                    JOIN person_credits pc ON pc.person_id = p.id
                    WHERE pc.media_parent_id = ? AND p.musicbrainz_artist_id IS NOT NULL
                `).all(artist.id)
            );
            for (const m of existingMembers) processedMemberMbids.add(m.musicbrainz_artist_id);
            itemsSynced = i + 1;
            continue;
        }

        broadcast({ log: `[${i + 1}/${artists.length}] Fetching members for: ${artist.title}`, logType: 'info' });

        const data = await mbFetch(`/artist/${artist.musicbrainz_id}?inc=artist-rels&fmt=json`);
        if (!data || !data.relations) {
            broadcast({ log: `  ⚠ No data for ${artist.title}`, logType: 'warning' });
            errorCount++;
            continue;
        }

        // Filter to "member of band" relationships where the member is a Person
        const memberRels = data.relations.filter(
            /** @param {any} r */(r) =>
                r.type === 'member of band' &&
                r.direction === 'backward' &&
                r.artist?.type === 'Person'
        );

        // Deduplicate by member MBID — combine instruments
        /** @type {Map<string, {name: string, mbid: string, instruments: Set<string>, isOriginal: boolean, begin: string|null, end: string|null, ended: boolean}>} */
        const memberMap = new Map();
        for (const rel of memberRels) {
            const mbid = rel.artist.id;
            if (!memberMap.has(mbid)) {
                memberMap.set(mbid, {
                    name: rel.artist.name,
                    mbid,
                    instruments: new Set(),
                    isOriginal: false,
                    begin: rel.begin,
                    end: rel.end,
                    ended: rel.ended
                });
            }
            const member = /** @type {any} */ (memberMap.get(mbid));
            for (const attr of (rel.attributes || [])) {
                if (attr === 'original') member.isOriginal = true;
                else if (attr !== 'additional') member.instruments.add(attr);
            }
        }

        // Upsert each member
        const insertMembers = db.transaction(() => {
            for (const [mbid, member] of memberMap) {
                let personId;
                // Find by MBID first, then by name, then insert
                const byMbid = /** @type {any} */ (findPersonByMbid.get({ mbid }));
                if (byMbid) {
                    personId = byMbid.id;
                } else {
                    const byName = /** @type {any} */ (findPersonByName.get({ name: member.name }));
                    if (byName) {
                        personId = byName.id;
                        // Set MBID on existing person
                        db.prepare('UPDATE persons SET musicbrainz_artist_id = ? WHERE id = ? AND musicbrainz_artist_id IS NULL')
                            .run(mbid, personId);
                    } else {
                        const result = insertPerson.run({ name: member.name, mbid });
                        personId = result.lastInsertRowid;
                    }
                }

                if (!personId) continue;

                // Build role description from instruments
                const instruments = [...member.instruments];
                const roleType = instruments.length > 0
                    ? instruments.join(', ')
                    : 'member';
                const characterName = member.isOriginal ? 'original member' : (member.ended ? 'former member' : 'member');

                upsertCredit.run({
                    personId,
                    mediaParentId: artist.id,
                    roleType,
                    characterName,
                    sortOrder: member.isOriginal ? 0 : 1
                });

                totalCredits++;
                processedMemberMbids.add(mbid);
            }
            totalPersons += memberMap.size;
        });

        insertMembers();
        itemsSynced = i + 1;
        broadcast({});
    }

    broadcast({ log: `Phase 1 complete: ${totalPersons} members, ${totalCredits} credits (${skippedArtists} artists already enriched, skipped)`, logType: 'success' });

    // Phase 2: Fetch URL relationships for each unique member
    const memberMbids = [...processedMemberMbids];
    broadcast({ log: `Phase 2: Fetching external links for ${memberMbids.length} unique members...`, logType: 'info' });

    // Check which members already have external_ids (for intelligent resume)
    const hasExternalIds = db.prepare(`
        SELECT 1 FROM external_ids WHERE person_id = (
            SELECT id FROM persons WHERE musicbrainz_artist_id = ? LIMIT 1
        ) LIMIT 1
    `);

    for (let i = 0; i < memberMbids.length; i++) {
        if (!engineState.running) break;
        await waitWhilePaused();

        const mbid = memberMbids[i];
        progress = 80 + Math.round(((i + 1) / memberMbids.length) * 15);

        // Intelligent resume: skip if this member already has external_ids
        const alreadyEnriched = /** @type {any} */ (hasExternalIds.get(mbid));
        if (alreadyEnriched) {
            skippedMembers++;
            continue;
        }

        // Look up person ID
        const person = /** @type {any} */ (db.prepare(
            'SELECT id, name FROM persons WHERE musicbrainz_artist_id = ?'
        ).get(mbid));
        if (!person) continue;

        if ((i - skippedMembers) % 10 === 0 || i === memberMbids.length - 1) {
            broadcast({ log: `  [${i + 1}/${memberMbids.length}] External links for: ${person.name}`, logType: 'info' });
        }

        const data = await mbFetch(`/artist/${mbid}?inc=url-rels&fmt=json`);
        if (!data || !data.relations) continue;

        const insertExternalIds = db.transaction(() => {
            for (const rel of data.relations) {
                if (!rel.url?.resource) continue;
                const url = rel.url.resource;
                const source = urlRelToSource(rel.type, url);
                if (!source) continue;

                // For IMDb, extract the person ID and set it on the person record
                if (source === 'imdb') {
                    const imdbId = extractImdbId(url);
                    if (imdbId) {
                        updatePersonImdb.run({ imdbId, personId: person.id });
                        upsertExternalId.run({ personId: person.id, source: 'imdb', externalId: imdbId });
                        totalExternalIds++;
                        continue;
                    }
                }

                upsertExternalId.run({ personId: person.id, source, externalId: url });
                totalExternalIds++;
            }
        });

        insertExternalIds();
    }

    broadcast({ log: `Phase 2 complete: ${totalExternalIds} external IDs stored (${skippedMembers} members already enriched, skipped)`, logType: 'success' });

    // Phase 3: Cross-link — merge persons sharing the same imdb_person_id
    broadcast({ log: 'Phase 3: Cross-linking persons by IMDb ID...', logType: 'info' });
    progress = 96;

    let mergedPersons = 0;

    const duplicates = /** @type {Array<{imdb_person_id: string, cnt: number}>} */ (
        db.prepare(`
            SELECT imdb_person_id, COUNT(*) as cnt
            FROM persons
            WHERE imdb_person_id IS NOT NULL AND imdb_person_id != ''
            GROUP BY imdb_person_id
            HAVING cnt > 1
        `).all()
    );

    if (duplicates.length > 0) {
        broadcast({ log: `  Found ${duplicates.length} IMDb IDs with multiple person records`, logType: 'info' });

        const mergeTransaction = db.transaction(() => {
            for (const dup of duplicates) {
                // Get all persons with this IMDb ID, prefer the one with more data
                const persons = /** @type {Array<{id: number, name: string, photo_url: string|null, bio: string|null, musicbrainz_artist_id: string|null, jellyfin_id: string|null}>} */ (
                    db.prepare(`
                        SELECT id, name, photo_url, bio, musicbrainz_artist_id, jellyfin_id
                        FROM persons WHERE imdb_person_id = ?
                        ORDER BY
                            (CASE WHEN photo_url IS NOT NULL THEN 1 ELSE 0 END) +
                            (CASE WHEN bio IS NOT NULL THEN 1 ELSE 0 END) +
                            (CASE WHEN jellyfin_id IS NOT NULL THEN 1 ELSE 0 END)
                            DESC
                    `).all(dup.imdb_person_id)
                );

                if (persons.length < 2) continue;

                const survivor = persons[0]; // the richest record
                const others = persons.slice(1);

                for (const other of others) {
                    // Merge musicbrainz_artist_id if survivor doesn't have one
                    if (!survivor.musicbrainz_artist_id && other.musicbrainz_artist_id) {
                        db.prepare('UPDATE persons SET musicbrainz_artist_id = ? WHERE id = ?')
                            .run(other.musicbrainz_artist_id, survivor.id);
                    }
                    // Merge photo if survivor doesn't have one
                    if (!survivor.photo_url && other.photo_url) {
                        db.prepare('UPDATE persons SET photo_url = ? WHERE id = ?')
                            .run(other.photo_url, survivor.id);
                    }

                    // Re-point all credits from other → survivor
                    db.prepare(`
                        UPDATE OR IGNORE person_credits SET person_id = ? WHERE person_id = ?
                    `).run(survivor.id, other.id);

                    // Re-point external_ids
                    db.prepare(`
                        UPDATE OR IGNORE external_ids SET person_id = ? WHERE person_id = ?
                    `).run(survivor.id, other.id);

                    // Delete the duplicate
                    db.prepare('DELETE FROM person_credits WHERE person_id = ?').run(other.id);
                    db.prepare('DELETE FROM external_ids WHERE person_id = ?').run(other.id);
                    db.prepare('DELETE FROM persons WHERE id = ?').run(other.id);

                    mergedPersons++;
                    broadcast({ log: `  ✓ Merged "${other.name}" → "${survivor.name}" (IMDb: ${dup.imdb_person_id})`, logType: 'success' });
                }
            }
        });

        mergeTransaction();
    } else {
        broadcast({ log: '  No duplicate IMDb IDs found — nothing to merge', logType: 'info' });
    }

    progress = 100;
    lastResult = { totalPersons, totalCredits, totalExternalIds, mergedPersons };
}

export function pauseMusicBrainzEnrich() {
    engineState.paused = true;
    broadcast({ log: 'Paused.', logType: 'info' });
}

export function resumeMusicBrainzEnrich() {
    engineState.paused = false;
    broadcast({ log: 'Resumed.', logType: 'info' });
}

export function stopMusicBrainzEnrich() {
    engineState.running = false;
    engineState.paused = false;
    broadcast({ log: 'Stopped.', logType: 'warning', status: 'idle' });
    if (syncHistoryId) {
        db.prepare('UPDATE sync_history SET status = ?, finished_at = ? WHERE id = ?')
            .run('interrupted', new Date().toISOString(), syncHistoryId);
    }
}

/** @param {(data: any) => void} callback */
export function addListener(callback) {
    listeners.add(callback);
    return () => listeners.delete(callback);
}

export function isMBRunning() {
    return engineState.running;
}

export function getMBStatus() {
    return {
        status: engineState.running ? (engineState.paused ? 'paused' : 'syncing') : (lastResult ? 'complete' : 'idle'),
        progress,
        itemsSynced,
        errors: errorCount,
        logs: recentLogs,
        result: lastResult
    };
}
