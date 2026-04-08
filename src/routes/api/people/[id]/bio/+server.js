import { json } from '@sveltejs/kit';
import db from '$lib/server/db.js';

/**
 * GET /api/people/[id]/bio
 * Returns the best available bio, fetching from TMDB/Wikipedia on demand if needed.
 */
export async function GET({ params, locals }) {
    if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
    const personId = parseInt(params.id);
    const person = /** @type {any} */ (db.prepare('SELECT * FROM persons WHERE id = ?').get(personId));
    if (!person) return json({ error: 'Not found' }, { status: 404 });

    // Check existing bios first
    let displayBio = person.wikipedia_summary || person.bio_tmdb || person.bio_jellyfin || person.bio || null;
    let bioSource = person.wikipedia_summary ? 'wikipedia'
        : person.bio_tmdb ? 'tmdb'
        : person.bio_jellyfin ? 'jellyfin'
        : person.bio ? 'legacy'
        : null;

    if (displayBio) {
        return json({ bio: displayBio, source: bioSource });
    }

    // No bio — try to fetch from TMDB
    if (person.tmdb_person_id) {
        try {
            const { tmdbFetch } = await import('$lib/server/tmdb.js');
            const tmdbRes = await tmdbFetch(
                `/person/${person.tmdb_person_id}`, { append_to_response: 'external_ids' }
            );
            if (tmdbRes.ok) {
                const d = await tmdbRes.json();
                const bio = d.biography || null;
                const imdbId = d.imdb_id || d.external_ids?.imdb_id || null;
                const birthDate = d.birthday || null;
                const deathDate = d.deathday || null;
                const photoUrl = d.profile_path ? `https://image.tmdb.org/t/p/w300${d.profile_path}` : null;
                const birthPlace = d.place_of_birth || null;

                db.prepare(`
                    UPDATE persons SET
                        bio_tmdb = COALESCE(?, bio_tmdb),
                        imdb_person_id = COALESCE(?, imdb_person_id),
                        birth_date = COALESCE(?, birth_date),
                        death_date = COALESCE(?, death_date),
                        photo_url = COALESCE(?, photo_url),
                        birth_place = COALESCE(?, birth_place)
                    WHERE id = ?
                `).run(bio, imdbId, birthDate, deathDate, photoUrl, birthPlace, personId);

                if (bio) {
                    return json({ bio, source: 'tmdb', enriched: true });
                }
            }
        } catch (e) {
            console.error(`[bio] TMDB fetch error for person ${personId}:`, e instanceof Error ? e.message : String(e));
        }
    }

    // Try Wikipedia if we have a TMDB ID (wikipedia-backfill uses it to find the article)
    if (person.tmdb_person_id && !person.wikipedia_fetched_at) {
        try {
            const settings = /** @type {any} */ (db.prepare('SELECT tmdb_api_key FROM app_settings WHERE id = 1').get());
            const { fetchWikipediaForPerson } = await import('$lib/server/wikipedia-backfill.js');
            const wiki = await fetchWikipediaForPerson(personId, person.tmdb_person_id, settings?.tmdb_api_key || null);
            if (wiki) {
                // Re-read to get the updated wikipedia_summary
                const updated = /** @type {any} */ (db.prepare('SELECT wikipedia_summary FROM persons WHERE id = ?').get(personId));
                if (updated?.wikipedia_summary) {
                    return json({ bio: updated.wikipedia_summary, source: 'wikipedia', enriched: true });
                }
            }
        } catch (e) {
            console.error(`[bio] Wikipedia fetch error for person ${personId}:`, e instanceof Error ? e.message : String(e));
        }
    }

    return json({ bio: null, source: null });
}
