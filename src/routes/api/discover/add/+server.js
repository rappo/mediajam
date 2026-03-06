import db from '$lib/server/db.js';
import { json } from '@sveltejs/kit';

/**
 * POST /api/discover/add — Create a media_parents stub from discovered TMDb data.
 * Used when adding a discovered item to *arr: we need a media_parents record first.
 * Body: { tmdb_id, media_type, title, release_year?, poster_url?, overview? }
 */
export async function POST({ request, locals }) {
    if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

    const { tmdb_id, media_type, title, release_year, poster_url, overview } = await request.json();

    if (!tmdb_id || !media_type || !title) {
        return json({ error: 'tmdb_id, media_type, and title are required' }, { status: 400 });
    }

    // Check if we already have this item in the library
    const existing = /** @type {any} */ (db.prepare(
        'SELECT id FROM media_parents WHERE tmdb_id = ? AND media_type = ? LIMIT 1'
    ).get(String(tmdb_id), media_type));

    if (existing) {
        return json({ mediaParentId: existing.id });
    }

    // For Sonarr, we need a tvdb_id. Try to look it up from TMDb.
    let tvdbId = null;
    if (media_type === 'show') {
        const settings = /** @type {any} */ (db.prepare('SELECT tmdb_api_key FROM app_settings WHERE id = 1').get());
        if (settings?.tmdb_api_key) {
            try {
                const res = await fetch(
                    `https://api.themoviedb.org/3/tv/${tmdb_id}/external_ids?api_key=${settings.tmdb_api_key}`
                );
                if (res.ok) {
                    const ids = await res.json();
                    tvdbId = ids.tvdb_id ? String(ids.tvdb_id) : null;
                }
            } catch { /* fallback: no tvdb_id */ }
        }
    }

    // Create the stub
    const result = db.prepare(`
        INSERT INTO media_parents (title, media_type, tmdb_id, tvdb_id, release_year, poster_url, overview, collection_status)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'discovered')
    `).run(title, media_type, String(tmdb_id), tvdbId, release_year || null, poster_url || null, overview || null);

    const mediaParentId = /** @type {number} */ (result.lastInsertRowid);

    // Also create a media_children entry (movies need a child row for the arr add to work)
    if (media_type === 'movie') {
        db.prepare(`
            INSERT INTO media_children (parent_id, title, is_collected, season_number, item_number)
            VALUES (?, ?, 0, NULL, NULL)
        `).run(mediaParentId, title);
    }

    // ── Enrich with TMDb cast/crew ──
    const settings = /** @type {any} */ (db.prepare('SELECT tmdb_api_key FROM app_settings WHERE id = 1').get());
    if (settings?.tmdb_api_key) {
        const tmdbType = media_type === 'movie' ? 'movie' : 'tv';
        try {
            const creditsRes = await fetch(
                `https://api.themoviedb.org/3/${tmdbType}/${tmdb_id}/credits?api_key=${settings.tmdb_api_key}`
            );
            if (creditsRes.ok) {
                const creditsData = await creditsRes.json();
                const cast = (creditsData.cast || []).slice(0, 20);
                const crew = (creditsData.crew || []).filter(
                    /** @param {any} c */(c) => ['Director', 'Writer', 'Screenplay', 'Producer', 'Original Music Composer', 'Creator'].includes(c.job || c.department)
                ).slice(0, 5);

                const findByTmdb = db.prepare('SELECT id FROM persons WHERE tmdb_person_id = ?');
                const findByName = db.prepare('SELECT id FROM persons WHERE name = ? LIMIT 1');
                const insertPerson = db.prepare('INSERT INTO persons (name, tmdb_person_id, photo_url) VALUES (?, ?, ?)');
                const updatePhoto = db.prepare('UPDATE persons SET photo_url = COALESCE(?, photo_url) WHERE id = ?');
                const upsertCredit = db.prepare(
                    'INSERT OR IGNORE INTO person_credits (person_id, media_parent_id, role_type, character_name, sort_order) VALUES (?, ?, ?, ?, ?)'
                );

                const people = [
                    ...cast.map(/** @param {any} c @param {number} i */(c, i) => ({
                        tmdb_id: String(c.id), name: c.name,
                        photo: c.profile_path ? `https://image.tmdb.org/t/p/w185${c.profile_path}` : null,
                        role: 'actor', char: c.character || null, order: i
                    })),
                    ...crew.map(/** @param {any} c @param {number} i */(c, i) => ({
                        tmdb_id: String(c.id), name: c.name,
                        photo: c.profile_path ? `https://image.tmdb.org/t/p/w185${c.profile_path}` : null,
                        role: c.job === 'Director' ? 'director' : c.job === 'Writer' || c.job === 'Screenplay' ? 'writer'
                            : c.job === 'Producer' ? 'producer' : c.job === 'Original Music Composer' ? 'composer' : 'creator',
                        char: null, order: 100 + i
                    }))
                ];

                db.transaction(() => {
                    for (const p of people) {
                        let personId;
                        const ex = /** @type {any} */ (findByTmdb.get(p.tmdb_id));
                        if (ex) {
                            personId = ex.id;
                            if (p.photo) updatePhoto.run(p.photo, personId);
                        } else {
                            const byName = /** @type {any} */ (findByName.get(p.name));
                            if (byName) {
                                personId = byName.id;
                                db.prepare('UPDATE persons SET tmdb_person_id = COALESCE(tmdb_person_id, ?) WHERE id = ?').run(p.tmdb_id, personId);
                                if (p.photo) updatePhoto.run(p.photo, personId);
                            } else {
                                personId = insertPerson.run(p.name, p.tmdb_id, p.photo).lastInsertRowid;
                            }
                        }
                        upsertCredit.run(personId, mediaParentId, p.role, p.char, p.order);
                    }
                })();
            }
        } catch (e) {
            console.warn('[discover/add] cast enrichment failed:', e instanceof Error ? e.message : e);
        }
    }

    return json({ mediaParentId });
}
