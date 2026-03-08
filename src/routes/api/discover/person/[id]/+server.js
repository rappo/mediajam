import db from '$lib/server/db.js';
import { json } from '@sveltejs/kit';

const TMDB_BASE = 'https://api.themoviedb.org/3';
const TMDB_IMG = 'https://image.tmdb.org/t/p/w185';

/**
 * GET /api/discover/person/[id] — fetch filmography from TMDb, cross-reference with library.
 * Returns items not in the user's library (or marks which ones are owned).
 */
export async function GET({ params, locals }) {
    if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

    try {
        const personId = parseInt(params.id);
        const person = /** @type {any} */ (db.prepare('SELECT * FROM persons WHERE id = ?').get(personId));
        if (!person) return json({ error: 'Person not found' }, { status: 404 });

        const settings = /** @type {any} */ (db.prepare('SELECT tmdb_api_key FROM app_settings WHERE id = 1').get());
        if (!settings?.tmdb_api_key) {
            return json({ error: 'TMDb API key not configured. Add it in Settings → System.' }, { status: 400 });
        }
        const apiKey = settings.tmdb_api_key;

        // Step 1: Get or find TMDb person ID
        let tmdbPersonId = person.tmdb_person_id || null;
        if (!tmdbPersonId) {
            // Search TMDb by name
            const searchUrl = `${TMDB_BASE}/search/person?api_key=${apiKey}&query=${encodeURIComponent(person.name)}&page=1`;
            const searchRes = await fetch(searchUrl);
            if (!searchRes.ok) {
                const errBody = await searchRes.text().catch(() => '');
                console.error(`[discover/person] TMDb search failed: ${searchRes.status}`, errBody);
                return json({ error: `TMDb search failed: ${searchRes.status} — ${errBody}` }, { status: 502 });
            }
            const searchData = await searchRes.json();
            const match = searchData.results?.[0];
            if (!match) return json({ error: `No TMDb match found for "${person.name}"` }, { status: 404 });

            tmdbPersonId = String(match.id);
            // Save for future lookups
            db.prepare('UPDATE persons SET tmdb_person_id = ? WHERE id = ?').run(tmdbPersonId, personId);
        }

        // Step 2: Fetch combined credits from TMDb
        const creditsUrl = `${TMDB_BASE}/person/${tmdbPersonId}/combined_credits?api_key=${apiKey}`;
        const creditsRes = await fetch(creditsUrl);
        if (!creditsRes.ok) {
            const errBody = await creditsRes.text().catch(() => '');
            console.error(`[discover/person] TMDb credits failed: ${creditsRes.status}`, errBody);
            return json({ error: `TMDb credits failed: ${creditsRes.status} — ${errBody}` }, { status: 502 });
        }
        const creditsData = await creditsRes.json();

        // Combine cast + crew, deduplicate by TMDb ID
        /** @type {Map<string, any>} */
        const seen = new Map();
        for (const item of [...(creditsData.cast || []), ...(creditsData.crew || [])]) {
            const tmdbId = String(item.id);
            const mediaType = item.media_type === 'movie' ? 'movie' : 'show';
            const key = `${mediaType}:${tmdbId}`;

            if (!seen.has(key)) {
                seen.set(key, {
                    tmdb_id: tmdbId,
                    media_type: mediaType,
                    title: item.title || item.name || 'Unknown',
                    release_year: (item.release_date || item.first_air_date || '').split('-')[0] || null,
                    poster_url: item.poster_path ? `${TMDB_IMG}${item.poster_path}` : null,
                    overview: item.overview || '',
                    popularity: item.popularity || 0,
                    vote_average: item.vote_average || 0,
                    roles: [],
                    in_library: false,
                    library_id: null
                });
            }

            const entry = seen.get(key);
            const role = item.character || item.job || item.department || 'Unknown';
            if (!entry.roles.includes(role)) entry.roles.push(role);
        }

        // Step 3: Cross-reference with existing library
        const checkLibrary = db.prepare('SELECT id FROM media_parents WHERE tmdb_id = ? AND media_type = ? LIMIT 1');
        const results = [...seen.values()];
        for (const item of results) {
            const existing = /** @type {any} */ (checkLibrary.get(item.tmdb_id, item.media_type));
            if (existing) {
                item.in_library = true;
                item.library_id = existing.id;
            }
        }

        // Step 4: Cache in discovered_media
        const upsertDiscovered = db.prepare(`
            INSERT INTO discovered_media (media_type, title, tmdb_id, release_year, poster_url, overview, popularity, vote_average, source)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'tmdb')
            ON CONFLICT(media_type, tmdb_id) DO UPDATE SET
                title = excluded.title, poster_url = excluded.poster_url,
                popularity = excluded.popularity, vote_average = excluded.vote_average,
                fetched_at = datetime('now')
        `);
        const upsertCredit = db.prepare(`
            INSERT OR IGNORE INTO discovered_credits (person_id, discovered_media_id, role_type, character_name)
            VALUES (?, ?, ?, ?)
        `);

        for (const item of results) {
            if (item.in_library) continue; // Don't cache items already in library
            try {
                const result = upsertDiscovered.run(
                    item.media_type, item.title, item.tmdb_id,
                    item.release_year ? parseInt(item.release_year) : null,
                    item.poster_url, item.overview, item.popularity, item.vote_average
                );
                const discoveredId = result.lastInsertRowid ||
                    /** @type {any} */ (db.prepare('SELECT id FROM discovered_media WHERE tmdb_id = ? AND media_type = ?').get(item.tmdb_id, item.media_type))?.id;
                if (discoveredId) {
                    for (const role of item.roles) {
                        upsertCredit.run(personId, discoveredId, 'cast', role);
                    }
                }
            } catch { /* ignore cache errors */ }
        }

        // Sort by popularity descending, split into in_library and not_in_library
        results.sort((a, b) => b.popularity - a.popularity);
        const notInLibrary = results.filter(r => !r.in_library);
        const inLibrary = results.filter(r => r.in_library);

        return json({
            person: { id: person.id, name: person.name, tmdb_person_id: tmdbPersonId },
            filmography: notInLibrary,
            inLibrary,
            totalCredits: results.length
        });
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`[discover/person] Error:`, msg);
        return json({ error: `Discovery failed: ${msg}` }, { status: 500 });
    }
}
