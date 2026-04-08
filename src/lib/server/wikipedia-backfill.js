import db from '$lib/server/db.js';

/** @type {((data: any) => void)[]} */
let listeners = [];
let running = false;
let status = { total: 0, done: 0, found: 0, errors: 0 };

export function isWikipediaBackfillRunning() { return running; }
export function getWikipediaBackfillStatus() { return { running, ...status }; }

/** @param {(data: any) => void} fn */
export function addWikipediaListener(fn) {
    listeners.push(fn);
    return () => { listeners = listeners.filter(l => l !== fn); };
}

/** @param {any} data */
function broadcast(data) {
    for (const fn of listeners) {
        try { fn(data); } catch { /* */ }
    }
}

/**
 * Resolve TMDb external IDs → Wikidata ID
 * @param {'movie'|'tv'|'person'} tmdbType
 * @param {string} tmdbId
 * @param {string} _apiKey
 * @returns {Promise<string|null>}
 */
async function getWikidataIdFromTMDb(tmdbType, tmdbId, _apiKey) {
    const { tmdbFetch } = await import('$lib/server/tmdb.js');
    const res = await tmdbFetch(`/${tmdbType}/${tmdbId}/external_ids`);
    if (!res.ok) return null;
    const data = await res.json();
    return data.wikidata_id || null;
}

/**
 * Resolve Wikidata ID → English Wikipedia article title
 * @param {string} wikidataId
 * @returns {Promise<string|null>}
 */
async function getWikipediaTitleFromWikidata(wikidataId) {
    const url = `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${wikidataId}&props=sitelinks&sitefilter=enwiki&format=json`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    return data.entities?.[wikidataId]?.sitelinks?.enwiki?.title || null;
}

/**
 * Fetch Wikipedia summary + URL from article title
 * @param {string} title
 * @returns {Promise<{summary: string, url: string}|null>}
 */
async function getWikipediaSummary(title) {
    const encoded = encodeURIComponent(title);
    const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encoded}`;
    const res = await fetch(url, {
        headers: { 'User-Agent': 'Mediajam/0.1 (https://github.com/mediajam)' }
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (data.type === 'disambiguation') return null;
    return {
        summary: data.extract || '',
        url: data.content_urls?.desktop?.page || `https://en.wikipedia.org/wiki/${encoded}`
    };
}

/**
 * Get Wikipedia URL from MusicBrainz URL relations
 * @param {string} mbId
 * @returns {Promise<string|null>}
 */
async function getWikipediaFromMusicBrainz(mbId) {
    const url = `https://musicbrainz.org/ws/2/artist/${mbId}?inc=url-rels&fmt=json`;
    const res = await fetch(url, {
        headers: { 'User-Agent': 'Mediajam/0.1 (https://github.com/mediajam)' }
    });
    if (!res.ok) return null;
    const data = await res.json();
    const rels = data.relations || [];
    const wikiRel = rels.find((/** @type {any} */ r) => r.type === 'wikipedia');
    return wikiRel?.url?.resource || null;
}

/**
 * Extract Wikipedia article title from URL
 * @param {string} url
 * @returns {string|null}
 */
function extractTitleFromUrl(url) {
    try {
        const match = url.match(/\/wiki\/(.+?)(?:#|$)/);
        return match ? decodeURIComponent(match[1]) : null;
    } catch { return null; }
}

/** @param {number} ms */
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const updateMediaParent = db.prepare(`
    UPDATE media_parents SET wikipedia_url = ?, wikipedia_summary = ?, wikipedia_fetched_at = datetime('now')
    WHERE id = ?
`);

const updatePerson = db.prepare(`
    UPDATE persons SET wikipedia_url = ?, wikipedia_summary = ?, wikipedia_fetched_at = datetime('now')
    WHERE id = ?
`);

const markMediaParentFetched = db.prepare(`
    UPDATE media_parents SET wikipedia_fetched_at = datetime('now') WHERE id = ?
`);

const markPersonFetched = db.prepare(`
    UPDATE persons SET wikipedia_fetched_at = datetime('now') WHERE id = ?
`);

/**
 * Fetch Wikipedia data for a single media_parent (movie, show, or artist).
 * Called from individual sync endpoints.
 * @param {number} mediaParentId
 * @param {'movie'|'show'|'artist'} mediaType
 * @param {{tmdb_id?: string|null, musicbrainz_id?: string|null}} ids
 * @param {string|null} tmdbApiKey
 * @returns {Promise<{url: string, summary: string}|null>}
 */
export async function fetchWikipediaForMediaParent(mediaParentId, mediaType, ids, tmdbApiKey) {
    try {
        let wiki = null;
        if (mediaType === 'artist' && ids.musicbrainz_id) {
            // MusicBrainz → Wikipedia
            const wikiUrl = await getWikipediaFromMusicBrainz(ids.musicbrainz_id);
            if (wikiUrl) {
                const title = extractTitleFromUrl(wikiUrl);
                if (title) wiki = await getWikipediaSummary(title);
            }
        } else if (tmdbApiKey && ids.tmdb_id) {
            // TMDb → Wikidata → Wikipedia
            const tmdbType = mediaType === 'movie' ? 'movie' : 'tv';
            const wikidataId = await getWikidataIdFromTMDb(tmdbType, ids.tmdb_id, tmdbApiKey);
            if (wikidataId) {
                const title = await getWikipediaTitleFromWikidata(wikidataId);
                if (title) wiki = await getWikipediaSummary(title);
            }
        }
        if (wiki) {
            updateMediaParent.run(wiki.url, wiki.summary, mediaParentId);
            return wiki;
        } else {
            markMediaParentFetched.run(mediaParentId);
            return null;
        }
    } catch (e) {
        console.error(`[wikipedia] Error fetching for media_parent ${mediaParentId}:`, e instanceof Error ? e.message : String(e));
        markMediaParentFetched.run(mediaParentId);
        return null;
    }
}

/**
 * Fetch Wikipedia data for a single person.
 * Called from person sync endpoints.
 * @param {number} personId
 * @param {string|null} tmdbPersonId
 * @param {string|null} tmdbApiKey
 * @returns {Promise<{url: string, summary: string}|null>}
 */
export async function fetchWikipediaForPerson(personId, tmdbPersonId, tmdbApiKey) {
    try {
        if (!tmdbApiKey || !tmdbPersonId) return null;
        const wikidataId = await getWikidataIdFromTMDb('person', tmdbPersonId, tmdbApiKey);
        if (!wikidataId) { markPersonFetched.run(personId); return null; }
        const title = await getWikipediaTitleFromWikidata(wikidataId);
        if (!title) { markPersonFetched.run(personId); return null; }
        const wiki = await getWikipediaSummary(title);
        if (wiki) {
            updatePerson.run(wiki.url, wiki.summary, personId);
            return wiki;
        }
        markPersonFetched.run(personId);
        return null;
    } catch (e) {
        console.error(`[wikipedia] Error fetching for person ${personId}:`, e instanceof Error ? e.message : String(e));
        markPersonFetched.run(personId);
        return null;
    }
}

export async function backfillWikipedia() {
    if (running) return;
    running = true;
    status = { total: 0, done: 0, found: 0, errors: 0 };

    const settings = /** @type {any} */ (db.prepare('SELECT tmdb_api_key FROM app_settings WHERE id = 1').get());
    const tmdbKey = settings?.tmdb_api_key;

    if (!tmdbKey) {
        broadcast({ type: 'error', log: 'TMDb API key not configured — cannot fetch Wikipedia data for movies/TV/people', logType: 'error' });
    }

    try {
        // 1. Movies (need TMDb key)
        if (tmdbKey) {
            const movies = /** @type {any[]} */ (db.prepare(`
                SELECT id, title, tmdb_id FROM media_parents
                WHERE media_type = 'movie' AND tmdb_id IS NOT NULL AND wikipedia_fetched_at IS NULL
            `).all());

            broadcast({ type: 'progress', log: `📽️ Processing ${movies.length} movies...`, logType: 'info', phase: 'movies', total: movies.length, done: 0 });
            status.total += movies.length;

            for (let i = 0; i < movies.length; i++) {
                if (!running) break;
                const movie = movies[i];
                try {
                    const wikidataId = await getWikidataIdFromTMDb('movie', movie.tmdb_id, tmdbKey);
                    if (wikidataId) {
                        const title = await getWikipediaTitleFromWikidata(wikidataId);
                        if (title) {
                            const wiki = await getWikipediaSummary(title);
                            if (wiki) {
                                updateMediaParent.run(wiki.url, wiki.summary, movie.id);
                                status.found++;
                                if ((i + 1) % 25 === 0) broadcast({ type: 'progress', log: `✓ [${i + 1}/${movies.length}] ${movie.title} — found`, logType: 'success', phase: 'movies', done: i + 1, total: movies.length, found: status.found });
                            } else {
                                markMediaParentFetched.run(movie.id);
                            }
                        } else {
                            markMediaParentFetched.run(movie.id);
                        }
                    } else {
                        markMediaParentFetched.run(movie.id);
                    }
                } catch (e) {
                    markMediaParentFetched.run(movie.id);
                    status.errors++;
                }
                status.done++;
                if (i % 50 === 0 && i > 0) broadcast({ type: 'progress', phase: 'movies', done: i, total: movies.length, found: status.found });
                await sleep(100); // TMDb rate limit: ~40/s
            }
            broadcast({ type: 'progress', log: `📽️ Movies done: ${movies.length} processed`, logType: 'info', phase: 'movies', done: movies.length, total: movies.length });
        }

        // 2. TV Shows (need TMDb key)
        if (tmdbKey) {
            const shows = /** @type {any[]} */ (db.prepare(`
                SELECT id, title, tmdb_id FROM media_parents
                WHERE media_type = 'show' AND tmdb_id IS NOT NULL AND wikipedia_fetched_at IS NULL
            `).all());

            broadcast({ type: 'progress', log: `📺 Processing ${shows.length} TV shows...`, logType: 'info', phase: 'tv', total: shows.length, done: 0 });
            status.total += shows.length;

            for (let i = 0; i < shows.length; i++) {
                if (!running) break;
                const show = shows[i];
                try {
                    const wikidataId = await getWikidataIdFromTMDb('tv', show.tmdb_id, tmdbKey);
                    if (wikidataId) {
                        const title = await getWikipediaTitleFromWikidata(wikidataId);
                        if (title) {
                            const wiki = await getWikipediaSummary(title);
                            if (wiki) {
                                updateMediaParent.run(wiki.url, wiki.summary, show.id);
                                status.found++;
                                if ((i + 1) % 25 === 0) broadcast({ type: 'progress', log: `✓ [${i + 1}/${shows.length}] ${show.title} — found`, logType: 'success', phase: 'tv', done: i + 1, total: shows.length, found: status.found });
                            } else {
                                markMediaParentFetched.run(show.id);
                            }
                        } else {
                            markMediaParentFetched.run(show.id);
                        }
                    } else {
                        markMediaParentFetched.run(show.id);
                    }
                } catch {
                    markMediaParentFetched.run(show.id);
                    status.errors++;
                }
                status.done++;
                if (i % 50 === 0 && i > 0) broadcast({ type: 'progress', phase: 'tv', done: i, total: shows.length, found: status.found });
                await sleep(100);
            }
            broadcast({ type: 'progress', log: `📺 TV shows done: ${shows.length} processed`, logType: 'info', phase: 'tv', done: shows.length, total: shows.length });
        }

        // 3. Music Artists (MusicBrainz — no key needed)
        const artists = /** @type {any[]} */ (db.prepare(`
            SELECT id, title, musicbrainz_id FROM media_parents
            WHERE media_type = 'artist' AND musicbrainz_id IS NOT NULL AND wikipedia_fetched_at IS NULL
        `).all());

        broadcast({ type: 'progress', log: `🎵 Processing ${artists.length} music artists...`, logType: 'info', phase: 'music', total: artists.length, done: 0 });
        status.total += artists.length;

        for (let i = 0; i < artists.length; i++) {
            if (!running) break;
            const artist = artists[i];
            try {
                const wikiUrl = await getWikipediaFromMusicBrainz(artist.musicbrainz_id);
                if (wikiUrl) {
                    const wikiTitle = extractTitleFromUrl(wikiUrl);
                    if (wikiTitle) {
                        const wiki = await getWikipediaSummary(wikiTitle);
                        if (wiki) {
                            updateMediaParent.run(wiki.url, wiki.summary, artist.id);
                            status.found++;
                            if ((i + 1) % 25 === 0) broadcast({ type: 'progress', log: `✓ [${i + 1}/${artists.length}] ${artist.title} — found`, logType: 'success', phase: 'music', done: i + 1, total: artists.length, found: status.found });
                        } else {
                            markMediaParentFetched.run(artist.id);
                        }
                    } else {
                        markMediaParentFetched.run(artist.id);
                    }
                } else {
                    markMediaParentFetched.run(artist.id);
                }
            } catch {
                markMediaParentFetched.run(artist.id);
                status.errors++;
            }
            status.done++;
            if (i % 50 === 0 && i > 0) broadcast({ type: 'progress', phase: 'music', done: i, total: artists.length, found: status.found });
            await sleep(1100); // MusicBrainz: 1 req/s
        }
        broadcast({ type: 'progress', log: `🎵 Music artists done: ${artists.length} processed`, logType: 'info', phase: 'music', done: artists.length, total: artists.length });

        // 4. People (need TMDb key)
        if (tmdbKey) {
            const people = /** @type {any[]} */ (db.prepare(`
                SELECT id, name, tmdb_person_id FROM persons
                WHERE tmdb_person_id IS NOT NULL AND wikipedia_fetched_at IS NULL
            `).all());

            broadcast({ type: 'progress', log: `👤 Processing ${people.length} people...`, logType: 'info', phase: 'people', total: people.length, done: 0 });
            status.total += people.length;

            for (let i = 0; i < people.length; i++) {
                if (!running) break;
                const person = people[i];
                try {
                    const wikidataId = await getWikidataIdFromTMDb('person', person.tmdb_person_id, tmdbKey);
                    if (wikidataId) {
                        const title = await getWikipediaTitleFromWikidata(wikidataId);
                        if (title) {
                            const wiki = await getWikipediaSummary(title);
                            if (wiki) {
                                updatePerson.run(wiki.url, wiki.summary, person.id);
                                status.found++;
                                if ((i + 1) % 25 === 0) broadcast({ type: 'progress', log: `✓ [${i + 1}/${people.length}] ${person.name} — found`, logType: 'success', phase: 'people', done: i + 1, total: people.length, found: status.found });
                            } else {
                                markPersonFetched.run(person.id);
                            }
                        } else {
                            markPersonFetched.run(person.id);
                        }
                    } else {
                        markPersonFetched.run(person.id);
                    }
                } catch {
                    markPersonFetched.run(person.id);
                    status.errors++;
                }
                status.done++;
                if (i % 50 === 0 && i > 0) broadcast({ type: 'progress', phase: 'people', done: i, total: people.length, found: status.found });
                await sleep(100);
            }
            broadcast({ type: 'progress', log: `👤 People done: ${people.length} processed`, logType: 'info', phase: 'people', done: people.length, total: people.length });
        }

        broadcast({
            type: 'complete',
            log: `✅ Wikipedia backfill complete — ${status.found} articles found out of ${status.done} items (${status.errors} errors)`,
            logType: 'success',
            ...status
        });
    } catch (e) {
        broadcast({ type: 'error', log: `❌ Backfill error: ${e instanceof Error ? e.message : String(e)}`, logType: 'error' });
    } finally {
        running = false;
    }
}

export function stopWikipediaBackfill() {
    running = false;
    broadcast({ type: 'stopped', log: '⏹ Wikipedia backfill stopped', logType: 'warning' });
}
