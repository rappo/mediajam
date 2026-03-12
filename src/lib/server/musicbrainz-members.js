/**
 * MusicBrainz Band Member Sync
 *
 * Fetches band members, their instruments, and external IDs (IMDb, Wikidata)
 * from MusicBrainz and stores them as persons with person_credits.
 */

import db from './db.js';

const MB_BASE = 'https://musicbrainz.org/ws/2';
const MB_HEADERS = {
    'User-Agent': 'Mediajam/1.0 (https://github.com/mediajam)',
    'Accept': 'application/json',
};

/**
 * Rate-limited MusicBrainz fetch (caller must respect 1 req/sec externally).
 * @param {string} path
 * @returns {Promise<any|null>}
 */
async function mbFetch(path) {
    try {
        const url = `${MB_BASE}${path}`;
        const res = await fetch(url, { headers: MB_HEADERS });
        if (res.status === 503 || res.status === 429) {
            // Rate limited — wait and retry once
            await new Promise(r => setTimeout(r, 2000));
            const retry = await fetch(url, { headers: MB_HEADERS });
            if (!retry.ok) return null;
            return retry.json();
        }
        if (!res.ok) return null;
        return res.json();
    } catch {
        return null;
    }
}

// Prepared statements (created lazily)
let _upsertCredit = /** @type {any} */ (null);
let _upsertExtId = /** @type {any} */ (null);
let _updatePersonImdb = /** @type {any} */ (null);

function getStatements() {
    if (!_upsertCredit) {
        _upsertCredit = db.prepare(`
            INSERT INTO person_credits (person_id, media_parent_id, role_type, character_name, sort_order)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(person_id, media_parent_id, role_type, character_name) DO UPDATE SET
                sort_order = excluded.sort_order
        `);
        _upsertExtId = db.prepare(`
            INSERT INTO external_ids (person_id, source, external_id)
            VALUES (?, ?, ?)
            ON CONFLICT(person_id, source) DO UPDATE SET
                external_id = excluded.external_id
        `);
        _updatePersonImdb = db.prepare(`
            UPDATE persons SET imdb_person_id = ? WHERE id = ? AND (imdb_person_id IS NULL OR imdb_person_id = '')
        `);
    }
    return { upsertCredit: _upsertCredit, upsertExtId: _upsertExtId, updatePersonImdb: _updatePersonImdb };
}

/**
 * Find or create a person by MusicBrainz ID, with name fallback.
 * Priority: 1) match by MBID, 2) match by exact name (case-insensitive), 3) insert new.
 * When matching by name, also backfill the musicbrainz_artist_id on the existing row.
 * @param {string} name
 * @param {string} mbid
 * @returns {number} person id
 */
function findOrCreatePerson(name, mbid) {
    // 1. Try by MBID first (most reliable)
    const byMbid = /** @type {any} */ (db.prepare(
        'SELECT id FROM persons WHERE musicbrainz_artist_id = ?'
    ).get(mbid));
    if (byMbid) return byMbid.id;

    // 2. Try exact name match (case-insensitive) — links TMDB persons to MB data
    const byName = /** @type {any} */ (db.prepare(
        'SELECT id FROM persons WHERE LOWER(name) = LOWER(?)'
    ).get(name));
    if (byName) {
        // Backfill MBID on the existing person
        db.prepare('UPDATE persons SET musicbrainz_artist_id = ? WHERE id = ? AND musicbrainz_artist_id IS NULL')
            .run(mbid, byName.id);
        return byName.id;
    }

    // 3. Insert new person
    const result = db.prepare('INSERT INTO persons (name, musicbrainz_artist_id) VALUES (?, ?)').run(name, mbid);
    return /** @type {number} */ (result.lastInsertRowid);
}

/**
 * Extract IMDb ID from a URL like https://www.imdb.com/name/nm1234567/
 * @param {string} url
 * @returns {string|null}
 */
function extractImdbId(url) {
    const match = url.match(/imdb\.com\/name\/(nm\d+)/);
    return match ? match[1] : null;
}

/**
 * Extract Wikidata ID from a URL like https://www.wikidata.org/wiki/Q12345
 * @param {string} url
 * @returns {string|null}
 */
function extractWikidataId(url) {
    const match = url.match(/wikidata\.org\/wiki\/(Q\d+)/);
    return match ? match[1] : null;
}

/**
 * @typedef {Object} MemberInfo
 * @property {number} personId
 * @property {string} name
 * @property {string} mbid
 * @property {string} instruments
 * @property {boolean} isOriginal
 * @property {boolean} isCurrent
 * @property {string|null} begin
 * @property {string|null} end
 */

/**
 * Sync band members for a media_parents artist from MusicBrainz.
 *
 * @param {number} mediaParentId
 * @param {{ onProgress?: (msg: string) => void }} [opts]
 * @returns {Promise<{ members: MemberInfo[], errors: string[] }>}
 */
export async function syncBandMembers(mediaParentId, opts) {
    const onProgress = opts?.onProgress || (() => {});
    const errors = /** @type {string[]} */ ([]);

    // 1. Get artist's MusicBrainz ID
    const artist = /** @type {any} */ (db.prepare(
        'SELECT id, title, musicbrainz_id FROM media_parents WHERE id = ?'
    ).get(mediaParentId));

    if (!artist?.musicbrainz_id) {
        return { members: [], errors: ['No MusicBrainz ID for this artist'] };
    }

    // 2. Fetch artist relationships from MusicBrainz
    onProgress(`Fetching relationships for "${artist.title}"...`);
    const data = await mbFetch(`/artist/${artist.musicbrainz_id}?inc=artist-rels+url-rels&fmt=json`);
    if (!data?.relations) {
        return { members: [], errors: ['Failed to fetch from MusicBrainz'] };
    }

    // Handle solo artists (type=Person): link the artist to their person record
    if (data.type !== 'Group') {
        onProgress(`"${artist.title}" is a ${data.type || 'Person'} — linking as solo artist`);

        // Find or create the person record
        const personId = findOrCreatePerson(data.name || artist.title, artist.musicbrainz_id);
        if (!personId) return { members: [], errors: ['Failed to create person record'] };

        // Create an 'artist' credit linking the person to the media_parents artist
        const { upsertCredit, upsertExtId, updatePersonImdb } = getStatements();
        try {
            upsertCredit.run(personId, mediaParentId, 'artist', null, 0);
        } catch { /* already exists */ }

        // Fetch external IDs from URL relationships
        let fetchedExtIds = 0;
        const urlRels = (data.relations || []).filter(
            /** @param {any} r */ (r) => r['target-type'] === 'url' && r.url?.resource
        );
        for (const rel of urlRels) {
            const url = rel.url.resource;
            if (rel.type === 'IMDb') {
                const imdbId = extractImdbId(url);
                if (imdbId) { updatePersonImdb.run(imdbId, personId); fetchedExtIds++; }
            }
            if (rel.type === 'wikidata') {
                const wikidataId = extractWikidataId(url);
                if (wikidataId) { try { upsertExtId.run(personId, 'wikidata', wikidataId); fetchedExtIds++; } catch { /* */ } }
            }
            if (rel.type === 'discogs') {
                try { upsertExtId.run(personId, 'discogs', url); fetchedExtIds++; } catch { /* */ }
            }
        }

        onProgress(`Linked "${artist.title}" as solo artist (person #${personId}, ${fetchedExtIds} ext IDs)`);
        return {
            members: [{
                personId, name: data.name || artist.title, mbid: artist.musicbrainz_id,
                instruments: '', isOriginal: true, isCurrent: true, begin: null, end: null
            }],
            errors: []
        };
    }

    // 3. Extract "member of band" relationships (direction: "backward" = member belongs to this band)
    const memberRels = data.relations.filter(
        /** @param {any} r */ (r) => r.type === 'member of band' && r['target-type'] === 'artist' && r.direction === 'backward'
    );

    if (memberRels.length === 0) {
        onProgress(`No members found for "${artist.title}"`);
        return { members: [], errors: [] };
    }

    onProgress(`Found ${memberRels.length} member relationships for "${artist.title}"`);

    // 4. Deduplicate members (same person may appear multiple times for different eras)
    /** @type {Map<string, { name: string, mbid: string, instruments: Set<string>, isOriginal: boolean, isCurrent: boolean, begin: string|null, end: string|null }>} */
    const memberMap = new Map();

    for (const rel of memberRels) {
        const memberArtist = rel.artist;
        if (!memberArtist?.id || memberArtist.type !== 'Person') continue;

        const mbid = memberArtist.id;
        const existing = memberMap.get(mbid);
        const attrs = rel.attributes || [];
        const instruments = attrs.filter(/** @param {string} a */ (a) => a !== 'original');
        const isOriginal = attrs.includes('original');
        const isCurrent = !rel.ended;

        if (existing) {
            // Merge instruments from multiple eras
            for (const inst of instruments) existing.instruments.add(inst);
            if (isOriginal) existing.isOriginal = true;
            if (isCurrent) {
                existing.isCurrent = true;
                existing.end = null; // currently active
            }
            // Keep earliest begin
            if (rel.begin && (!existing.begin || rel.begin < existing.begin)) {
                existing.begin = rel.begin;
            }
        } else {
            memberMap.set(mbid, {
                name: memberArtist.name,
                mbid,
                instruments: new Set(instruments),
                isOriginal,
                isCurrent,
                begin: rel.begin || null,
                end: rel.end || null,
            });
        }
    }

    // 5. Sort: current members first, then original, then by start date
    const sortedMembers = [...memberMap.values()].sort((a, b) => {
        if (a.isCurrent !== b.isCurrent) return a.isCurrent ? -1 : 1;
        if (a.isOriginal !== b.isOriginal) return a.isOriginal ? -1 : 1;
        return (a.begin || '9999').localeCompare(b.begin || '9999');
    });

    // 6. Upsert persons and create credits
    const { upsertCredit } = getStatements();
    /** @type {MemberInfo[]} */
    const members = [];

    const insertMembers = db.transaction(() => {
        for (let i = 0; i < sortedMembers.length; i++) {
            const m = sortedMembers[i];
            try {
                // Find or create person (matches by MBID, then name, then inserts new)
                const personId = findOrCreatePerson(m.name, m.mbid);
                if (!personId) continue;

                // Build instrument string
                const instrumentStr = [...m.instruments].join(', ');
                // Include "original" designation in character_name for display
                const charName = [
                    instrumentStr,
                    m.isOriginal ? '(original)' : '',
                    !m.isCurrent && m.end ? `(until ${m.end})` : ''
                ].filter(Boolean).join(' ');

                // Create credit
                upsertCredit.run(personId, mediaParentId, 'member', charName || null, i);

                members.push({
                    personId,
                    name: m.name,
                    mbid: m.mbid,
                    instruments: instrumentStr,
                    isOriginal: m.isOriginal,
                    isCurrent: m.isCurrent,
                    begin: m.begin,
                    end: m.end,
                });
            } catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                errors.push(`Failed to upsert member ${m.name}: ${msg}`);
            }
        }
    });
    insertMembers();

    onProgress(`Stored ${members.length} members for "${artist.title}"`);

    // 7. Fetch external IDs for each member (rate-limited)
    const { upsertExtId, updatePersonImdb } = getStatements();
    let fetchedExtIds = 0;

    for (const member of members) {
        await new Promise(r => setTimeout(r, 1100)); // MusicBrainz rate limit

        onProgress(`Fetching external IDs for ${member.name}...`);
        const memberData = await mbFetch(`/artist/${member.mbid}?inc=url-rels&fmt=json`);
        if (!memberData?.relations) continue;

        for (const rel of memberData.relations) {
            if (rel['target-type'] !== 'url' || !rel.url?.resource) continue;

            const url = rel.url.resource;

            // IMDb
            if (rel.type === 'IMDb') {
                const imdbId = extractImdbId(url);
                if (imdbId) {
                    updatePersonImdb.run(imdbId, member.personId);
                    fetchedExtIds++;
                }
            }

            // Wikidata
            if (rel.type === 'wikidata') {
                const wikidataId = extractWikidataId(url);
                if (wikidataId) {
                    try {
                        upsertExtId.run(member.personId, 'wikidata', wikidataId);
                        fetchedExtIds++;
                    } catch { /* dupe */ }
                }
            }

            // Discogs
            if (rel.type === 'discogs') {
                try {
                    upsertExtId.run(member.personId, 'discogs', url);
                    fetchedExtIds++;
                } catch { /* dupe */ }
            }
        }
    }

    onProgress(`Fetched ${fetchedExtIds} external IDs across ${members.length} members`);

    return { members, errors };
}

/**
 * Get the number of bands that have MBIDs but no member credits yet.
 * @returns {number}
 */
export function getBandsWithoutMembers() {
    const row = /** @type {any} */ (db.prepare(`
        SELECT COUNT(*) as c FROM media_parents mp
        WHERE mp.media_type = 'artist'
          AND mp.musicbrainz_id IS NOT NULL
          AND NOT EXISTS (
              SELECT 1 FROM person_credits pc
              WHERE pc.media_parent_id = mp.id AND pc.role_type = 'member'
          )
    `).get());
    return row?.c || 0;
}
