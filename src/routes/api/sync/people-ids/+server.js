import { json } from '@sveltejs/kit';
import db from '$lib/server/db.js';

/**
 * POST /api/sync/people-ids — Backfill external IDs for persons from Jellyfin.
 * 
 * Fetches each person item from Jellyfin to get ProviderIds (TMDB, IMDb, TVDB).
 * Processes in batches to avoid overwhelming the Jellyfin server.
 *
 * @type {import('./$types').RequestHandler}
 */
export async function POST({ locals }) {
    if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

    const settings = /** @type {any} */ (db.prepare('SELECT * FROM app_settings WHERE id = 1').get());
    const identity = /** @type {any} */ (db.prepare(
        "SELECT access_token FROM user_identities WHERE user_id = ? AND provider = 'jellyfin'"
    ).get(locals.user.id));

    if (!settings?.jellyfin_url || !identity?.access_token) {
        return json({ error: 'Jellyfin not configured' }, { status: 400 });
    }

    const jellyfinUrl = settings.jellyfin_url;
    const token = identity.access_token;

    // Get persons that have jellyfin_id but are missing TMDB/IMDb IDs
    const persons = /** @type {any[]} */ (db.prepare(`
        SELECT id, name, jellyfin_id FROM persons
        WHERE jellyfin_id IS NOT NULL AND jellyfin_id != ''
        AND (tmdb_person_id IS NULL OR tmdb_person_id = '')
        AND (imdb_person_id IS NULL OR imdb_person_id = '')
        LIMIT 500
    `).all());

    if (persons.length === 0) {
        return json({ message: 'All persons already have external IDs', updated: 0, remaining: 0 });
    }

    const updateStmt = db.prepare(`
        UPDATE persons SET
            tmdb_person_id = COALESCE(@tmdbId, tmdb_person_id),
            imdb_person_id = COALESCE(@imdbId, imdb_person_id)
        WHERE id = @personId
    `);

    let updated = 0;
    let errors = 0;

    for (const person of persons) {
        try {
            const res = await fetch(
                `${jellyfinUrl}/Items/${person.jellyfin_id}`,
                { headers: { 'Authorization': `MediaBrowser Token="${token}"` } }
            );
            if (!res.ok) { errors++; continue; }

            const item = await res.json();
            const providerIds = item.ProviderIds || {};
            const tmdbId = providerIds.Tmdb || providerIds.TMDb || null;
            const imdbId = providerIds.Imdb || providerIds.IMDb || null;

            if (tmdbId || imdbId) {
                updateStmt.run({ personId: person.id, tmdbId, imdbId });
                updated++;
            }
        } catch {
            errors++;
        }
        // Small delay to be nice to the Jellyfin server
        await new Promise(r => setTimeout(r, 50));
    }

    const remaining = /** @type {any} */ (db.prepare(`
        SELECT COUNT(*) as cnt FROM persons
        WHERE jellyfin_id IS NOT NULL AND jellyfin_id != ''
        AND (tmdb_person_id IS NULL OR tmdb_person_id = '')
        AND (imdb_person_id IS NULL OR imdb_person_id = '')
    `).get())?.cnt || 0;

    return json({
        message: `Updated ${updated} persons (${errors} errors)`,
        updated,
        errors,
        remaining,
        batch: persons.length
    });
}
