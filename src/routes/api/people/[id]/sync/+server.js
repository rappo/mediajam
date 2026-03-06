import db from '$lib/server/db.js';
import { json, error } from '@sveltejs/kit';

/** @type {import('./$types').RequestHandler} */
export async function POST({ params, locals }) {
    if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
    const personId = parseInt(params.id);
    const person = /** @type {any} */ (db.prepare('SELECT * FROM persons WHERE id = ?').get(personId));
    if (!person) throw error(404, 'Person not found');

    const settings = /** @type {any} */ (db.prepare('SELECT jellyfin_url FROM app_settings WHERE id = 1').get());
    const user = /** @type {any} */ (db.prepare('SELECT jellyfin_access_token FROM users WHERE id = ?').get(locals.user.id));
    if (!settings?.jellyfin_url || !user?.jellyfin_access_token) {
        return json({ error: 'Jellyfin not configured' }, { status: 400 });
    }

    const jellyfinUrl = settings.jellyfin_url;
    const accessToken = user.jellyfin_access_token;
    const results = { updated: /** @type {string[]} */ ([]), errors: /** @type {string[]} */ ([]) };

    // Step 1: Fetch external IDs from Jellyfin if we have a jellyfin_id
    if (person.jellyfin_id) {
        try {
            const res = await fetch(`${jellyfinUrl}/Items/${person.jellyfin_id}`, {
                headers: { 'Authorization': `MediaBrowser Token="${accessToken}"` }
            });
            if (res.ok) {
                const item = await res.json();
                const providerIds = item.ProviderIds || {};
                const tmdbId = providerIds.Tmdb || providerIds.TMDb || null;
                const imdbId = providerIds.Imdb || providerIds.IMDb || null;
                const photoUrl = item.ImageTags?.Primary
                    ? `${jellyfinUrl}/Items/${person.jellyfin_id}/Images/Primary`
                    : null;
                const bio = item.Overview || null;
                const birthDate = item.PremiereDate ? item.PremiereDate.substring(0, 10) : null;

                const updates = [];
                if (tmdbId && !person.tmdb_person_id) updates.push('tmdb_person_id');
                if (imdbId && !person.imdb_person_id) updates.push('imdb_person_id');
                if (photoUrl && !person.photo_url) updates.push('photo_url');
                if (bio && !person.bio) updates.push('bio');
                if (birthDate && !person.birth_date) updates.push('birth_date');

                db.prepare(`
                    UPDATE persons SET
                        tmdb_person_id = COALESCE(?, tmdb_person_id),
                        imdb_person_id = COALESCE(?, imdb_person_id),
                        photo_url = COALESCE(?, photo_url),
                        bio = COALESCE(?, bio),
                        birth_date = COALESCE(?, birth_date)
                    WHERE id = ?
                `).run(tmdbId, imdbId, photoUrl, bio, birthDate, personId);

                if (updates.length > 0) {
                    results.updated.push(`Jellyfin: updated ${updates.join(', ')}`);
                } else {
                    results.updated.push('Jellyfin: no new data');
                }
            } else {
                results.errors.push(`Jellyfin: HTTP ${res.status}`);
            }
        } catch (/** @type {any} */ e) {
            results.errors.push(`Jellyfin: ${e?.message || String(e)}`);
        }
    }

    // Step 2: Fetch from TMDB if we have a TMDB ID
    const updatedPerson = /** @type {any} */ (db.prepare('SELECT * FROM persons WHERE id = ?').get(personId));
    if (updatedPerson.tmdb_person_id) {
        try {
            const tmdbSettings = /** @type {any} */ (db.prepare('SELECT tmdb_api_key FROM app_settings WHERE id = 1').get());
            const tmdbKey = tmdbSettings?.tmdb_api_key;
            if (tmdbKey) {
                const tmdbRes = await fetch(
                    `https://api.themoviedb.org/3/person/${updatedPerson.tmdb_person_id}?api_key=${tmdbKey}&append_to_response=external_ids`
                );
                if (tmdbRes.ok) {
                    const tmdbData = await tmdbRes.json();
                    const tmdbUpdates = [];

                    const imdbId = tmdbData.imdb_id || tmdbData.external_ids?.imdb_id || null;
                    const bio = tmdbData.biography || null;
                    const birthDate = tmdbData.birthday || null;
                    const deathDate = tmdbData.deathday || null;
                    const photoUrl = tmdbData.profile_path
                        ? `https://image.tmdb.org/t/p/w300${tmdbData.profile_path}`
                        : null;
                    const birthPlace = tmdbData.place_of_birth || null;

                    if (imdbId && !updatedPerson.imdb_person_id) tmdbUpdates.push('imdb_person_id');
                    if (bio && !updatedPerson.bio) tmdbUpdates.push('bio');
                    if (birthDate && !updatedPerson.birth_date) tmdbUpdates.push('birth_date');
                    if (deathDate && !updatedPerson.death_date) tmdbUpdates.push('death_date');
                    if (photoUrl && !updatedPerson.photo_url) tmdbUpdates.push('photo_url (TMDB)');
                    if (birthPlace && !updatedPerson.birth_place) tmdbUpdates.push('birth_place');

                    db.prepare(`
                        UPDATE persons SET
                            imdb_person_id = COALESCE(?, imdb_person_id),
                            bio = COALESCE(?, bio),
                            birth_date = COALESCE(?, birth_date),
                            death_date = COALESCE(?, death_date),
                            photo_url = COALESCE(?, photo_url),
                            birth_place = COALESCE(?, birth_place)
                        WHERE id = ?
                    `).run(imdbId, bio, birthDate, deathDate, photoUrl, birthPlace, personId);

                    if (tmdbUpdates.length > 0) {
                        results.updated.push(`TMDB: updated ${tmdbUpdates.join(', ')}`);
                    } else {
                        results.updated.push('TMDB: no new data');
                    }
                } else {
                    results.errors.push(`TMDB: HTTP ${tmdbRes.status}`);
                }
            } else {
                results.updated.push('TMDB: no API key configured');
            }
        } catch (/** @type {any} */ e) {
            results.errors.push(`TMDB: ${e?.message || String(e)}`);
        }
    }

    // Step 3: Fetch from MusicBrainz if we have a musicbrainz_artist_id
    if (updatedPerson.musicbrainz_artist_id) {
        try {
            const mbRes = await fetch(
                `https://musicbrainz.org/ws/2/artist/${updatedPerson.musicbrainz_artist_id}?inc=url-rels&fmt=json`,
                { headers: { 'User-Agent': 'Mediajam/1.0 (https://github.com/mediajam)' } }
            );
            if (mbRes.ok) {
                const mbData = await mbRes.json();
                const upsertExtId = db.prepare(`
                    INSERT OR IGNORE INTO external_ids (person_id, source, external_id)
                    VALUES (?, ?, ?)
                `);
                let relCount = 0;
                for (const rel of (mbData.relations || [])) {
                    if (rel.type === 'wikidata' && rel.url?.resource) {
                        const wdId = rel.url.resource.split('/').pop();
                        upsertExtId.run(personId, 'wikidata', wdId);
                        relCount++;
                    } else if (rel.type === 'discogs' && rel.url?.resource) {
                        const dgId = rel.url.resource.split('/artist/').pop();
                        if (dgId) { upsertExtId.run(personId, 'discogs', dgId); relCount++; }
                    } else if (rel.type === 'allmusic' && rel.url?.resource) {
                        const amId = rel.url.resource.split('/artist/').pop()?.replace(/\/$/, '');
                        if (amId) { upsertExtId.run(personId, 'allmusic', amId); relCount++; }
                    } else if (rel.type === 'last.fm' && rel.url?.resource) {
                        const lfmId = decodeURIComponent(rel.url.resource.split('/music/').pop() || '');
                        if (lfmId) { upsertExtId.run(personId, 'lastfm', lfmId); relCount++; }
                    } else if (rel.type === 'IMDb' && rel.url?.resource) {
                        const imdbId = rel.url.resource.match(/nm\d+/)?.[0];
                        if (imdbId && !updatedPerson.imdb_person_id) {
                            db.prepare('UPDATE persons SET imdb_person_id = ? WHERE id = ?').run(imdbId, personId);
                        }
                        relCount++;
                    }
                }
                if (relCount > 0) {
                    results.updated.push(`MusicBrainz: synced ${relCount} external links`);
                } else {
                    results.updated.push('MusicBrainz: no new links found');
                }
            }
        } catch (/** @type {any} */ e) {
            results.errors.push(`MusicBrainz: ${e?.message || String(e)}`);
        }
    }

    // Return final person data
    const finalPerson = /** @type {any} */ (db.prepare('SELECT * FROM persons WHERE id = ?').get(personId));
    return json({
        success: true,
        results,
        person: {
            tmdb_person_id: finalPerson.tmdb_person_id,
            imdb_person_id: finalPerson.imdb_person_id,
            photo_url: finalPerson.photo_url,
            bio: finalPerson.bio,
            birth_date: finalPerson.birth_date,
            death_date: finalPerson.death_date,
            birth_place: finalPerson.birth_place,
            musicbrainz_artist_id: finalPerson.musicbrainz_artist_id,
        }
    });
}
