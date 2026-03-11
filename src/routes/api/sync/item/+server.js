import db from '$lib/server/db.js';
import { getJellyfinApis, getItemsApi, getTvShowsApi } from '$lib/server/jellyfin.js';
import { reconcileExternalMedia } from '$lib/server/reconcile.js';
import { fetchWikipediaForMediaParent } from '$lib/server/wikipedia-backfill.js';
import { json } from '@sveltejs/kit';

/**
 * Single-item full sync: re-fetches all data for one movie/show/artist from Jellyfin.
 * POST body: { jellyfinId: string }
 */
export async function POST({ request, locals }) {
    if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

    const body = await request.json();
    const { jellyfinId, mediaParentId, tmdbId } = body;

    // ── TMDb-only enrichment path (for stubs without Jellyfin) ──
    if (!jellyfinId && mediaParentId && tmdbId) {
        return tmdbEnrich(mediaParentId, tmdbId);
    }

    if (!jellyfinId) return json({ error: 'Missing jellyfinId or mediaParentId+tmdbId' }, { status: 400 });

    const settings = /** @type {any} */ (db.prepare('SELECT * FROM app_settings WHERE id = 1').get());
    const user = /** @type {any} */ (db.prepare('SELECT * FROM users LIMIT 1').get());

    if (!settings?.jellyfin_url || !user?.jellyfin_access_token) {
        return json({ error: 'Missing Jellyfin configuration' }, { status: 400 });
    }

    const jellyfinUrl = settings.jellyfin_url;
    const { api } = getJellyfinApis(jellyfinUrl, user.jellyfin_access_token);
    const itemsApi = getItemsApi(api);

    const parent = /** @type {any} */ (db.prepare(
        'SELECT id, jellyfin_id, media_type, title FROM media_parents WHERE jellyfin_id = ?'
    ).get(jellyfinId));

    if (!parent) return json({ error: 'Item not found in database' }, { status: 404 });

    try {
        console.log(`[item-sync] Starting sync for ${parent.title} (${jellyfinId})...`);
        // Fetch fresh item data from Jellyfin
        const res = await itemsApi.getItems({
            ids: [jellyfinId],
            fields: ['ProviderIds', 'Overview', 'People'],
            enableUserData: true
        });

        const items = res.data.Items || [];
        if (items.length === 0) return json({ error: 'Item not found in Jellyfin' }, { status: 404 });

        const item = items[0];
        const providerIds = item.ProviderIds || {};

        // Update the parent record — handle UNIQUE constraint conflicts on external IDs
        const updateParentSql = `
            UPDATE media_parents SET
                title = ?, tvdb_id = ?, tmdb_id = ?, imdb_id = ?,
                musicbrainz_id = ?, release_year = ?, poster_url = ?,
                overview = ?,
                date_last_modified = ?, jellyfin_child_count = ?
            WHERE id = ?
        `;
        const updateParentParams = [
            item.Name,
            providerIds.Tvdb || null,
            providerIds.Tmdb || null,
            providerIds.Imdb || null,
            providerIds.MusicBrainzArtist || providerIds.MusicBrainzAlbum || null,
            item.ProductionYear || null,
            item.ImageTags?.Primary ? `${jellyfinUrl}/Items/${item.Id}/Images/Primary` : null,
            item.Overview || null,
            item.DateLastMediaAdded || item.DateModified || null,
            item.ChildCount || 0,
            parent.id
        ];

        try {
            db.prepare(updateParentSql).run(...updateParentParams);
        } catch (updateErr) {
            const errStr = String(updateErr);
            if (errStr.includes('UNIQUE constraint')) {
                // Another row owns one of the external IDs — resolve by clearing conflicting ID
                const conflictFields = [
                    { field: 'imdb_id', value: providerIds.Imdb, paramIndex: 3 },
                    { field: 'tmdb_id', value: providerIds.Tmdb, paramIndex: 2 },
                    { field: 'musicbrainz_id', value: providerIds.MusicBrainzArtist || providerIds.MusicBrainzAlbum, paramIndex: 4 },
                ];
                for (const { field, value, paramIndex } of conflictFields) {
                    if (value && errStr.includes(field)) {
                        // Find the conflicting row
                        const conflicting = /** @type {any} */ (db.prepare(
                            `SELECT id, jellyfin_id FROM media_parents WHERE ${field} = ? AND id != ?`
                        ).get(value, parent.id));
                        if (conflicting && !conflicting.jellyfin_id) {
                            // External-only row — merge: migrate children, delete it
                            db.prepare('UPDATE media_children SET parent_id = ? WHERE parent_id = ?')
                                .run(parent.id, conflicting.id);
                            db.prepare('UPDATE person_credits SET media_parent_id = ? WHERE media_parent_id = ?')
                                .run(parent.id, conflicting.id);
                            db.prepare('DELETE FROM media_parents WHERE id = ?').run(conflicting.id);
                            console.log(`[item-sync] 🔀 Auto-merged external ${field} duplicate (id=${conflicting.id})`);
                        } else if (conflicting) {
                            // Another Jellyfin item — clear the conflicting ID from the other row
                            db.prepare(`UPDATE media_parents SET ${field} = NULL WHERE id = ?`).run(conflicting.id);
                            console.log(`[item-sync] ⚠ Cleared ${field} from id=${conflicting.id} to resolve conflict`);
                        }
                        // Retry the update
                        try {
                            db.prepare(updateParentSql).run(...updateParentParams);
                        } catch (retryErr) {
                            // If it still fails, null out the problematic field and retry
                            updateParentParams[paramIndex] = null;
                            db.prepare(updateParentSql).run(...updateParentParams);
                            console.warn(`[item-sync] ⚠ ${item.Name}: synced without ${field} due to unresolvable conflict`);
                        }
                        break;
                    }
                }
            } else {
                throw updateErr;
            }
        }

        let childCount = 0;
        let results = { parent: item.Name, type: parent.media_type };

        // Use check-then-insert/update instead of ON CONFLICT
        const findChild = db.prepare('SELECT id FROM media_children WHERE jellyfin_id = ?');

        const insertChild = db.prepare(`
            INSERT INTO media_children (parent_id, jellyfin_id, title, season_number, item_number, is_special, is_collected, watch_status, play_count, runtime_ticks, premiere_date)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        const updateChild = db.prepare(`
            UPDATE media_children SET
                title = ?, season_number = ?, item_number = ?,
                is_special = ?, is_collected = ?, watch_status = ?,
                play_count = ?, runtime_ticks = ?, premiere_date = ?
            WHERE jellyfin_id = ?
        `);

        function upsertChild(parentId, jId, title, seasonNum, itemNum, isSpecial, isCollected, watchStatus, playCount, runtimeTicks, premiereDate) {
            const existing = findChild.get(jId);
            if (existing) {
                updateChild.run(title, seasonNum, itemNum, isSpecial, isCollected, watchStatus, playCount, runtimeTicks, premiereDate, jId);
            } else {
                insertChild.run(parentId, jId, title, seasonNum, itemNum, isSpecial, isCollected, watchStatus, playCount, runtimeTicks, premiereDate);
            }
        }

        function getWatchStatus(userData) {
            if (!userData) return 'unwatched';
            if (userData.Played) return 'watched';
            if (userData.PlaybackPositionTicks > 0) return 'in_progress';
            return 'unwatched';
        }

        if (parent.media_type === 'show') {
            const tvApi = getTvShowsApi(api);
            const epRes = await tvApi.getEpisodes({
                seriesId: jellyfinId,
                userId: user.jellyfin_user_id,
                fields: ['ProviderIds'],
                enableUserData: true,
                startIndex: 0,
                limit: 10000
            });

            const episodes = epRes.data.Items || [];

            db.transaction(() => {
                for (const ep of episodes) {
                    const isOnDisk = ep.LocationType !== 'Virtual';
                    upsertChild(
                        parent.id, ep.Id,
                        ep.Name || `Episode ${ep.IndexNumber || '?'}`,
                        ep.ParentIndexNumber || 0, ep.IndexNumber || 0,
                        (ep.ParentIndexNumber === 0) ? 1 : 0,
                        isOnDisk ? 1 : 0,
                        isOnDisk ? getWatchStatus(ep.UserData) : 'unwatched',
                        isOnDisk ? (ep.UserData?.PlayCount || 0) : 0,
                        isOnDisk ? (ep.RunTimeTicks || 0) : 0,
                        ep.PremiereDate || null
                    );
                    childCount++;
                }

                // Update counts
                const collected = episodes.filter(ep => ep.LocationType !== 'Virtual' && (ep.ParentIndexNumber || 0) !== 0).length;
                const missing = episodes.filter(ep => ep.LocationType === 'Virtual' && (ep.ParentIndexNumber || 0) !== 0).length;
                db.prepare('UPDATE media_parents SET total_released_children = ? WHERE id = ?').run(collected + missing, parent.id);
                db.prepare(`
                    UPDATE media_parents SET
                        collected_children = (SELECT COUNT(*) FROM media_children WHERE parent_id = ? AND is_collected = 1),
                        watched_children = (SELECT COUNT(*) FROM media_children WHERE parent_id = ? AND watch_status = 'watched')
                    WHERE id = ?
                `).run(parent.id, parent.id, parent.id);
            })();

            results.episodes = childCount;

        } else if (parent.media_type === 'movie') {
            upsertChild(
                parent.id, item.Id + '_child',
                item.Name, null, 1, 0, 1,
                getWatchStatus(item.UserData),
                item.UserData?.PlayCount || 0,
                item.RunTimeTicks || 0,
                item.PremiereDate || null
            );
            childCount = 1;

            // Upgrade watch status from playback history (Trakt/Last.fm may know about watches Jellyfin doesn't)
            const childRow = /** @type {any} */ (findChild.get(item.Id + '_child'));
            if (childRow) {
                const historyCount = /** @type {any} */ (db.prepare(
                    'SELECT COUNT(*) as c FROM playback_history WHERE media_id = ?'
                ).get(childRow.id))?.c || 0;
                if (historyCount > 0) {
                    db.prepare(
                        "UPDATE media_children SET watch_status = 'watched', play_count = MAX(play_count, ?) WHERE id = ?"
                    ).run(historyCount, childRow.id);
                }
            }

            db.prepare(`
                UPDATE media_parents SET
                    collected_children = (SELECT COUNT(*) FROM media_children WHERE parent_id = ? AND is_collected = 1),
                    watched_children = (SELECT COUNT(*) FROM media_children WHERE parent_id = ? AND watch_status = 'watched')
                WHERE id = ?
            `).run(parent.id, parent.id, parent.id);

        } else if (parent.media_type === 'artist') {
            const albumRes = await itemsApi.getItems({
                artistIds: [jellyfinId],
                includeItemTypes: ['MusicAlbum'],
                recursive: true,
                fields: ['ProviderIds'],
                enableUserData: true,
                startIndex: 0,
                limit: 10000
            });

            const albums = albumRes.data.Items || [];
            db.transaction(() => {
                for (const album of albums) {
                    upsertChild(
                        parent.id, album.Id,
                        album.Name, null,
                        album.ProductionYear || 0, 0, 1,
                        getWatchStatus(album.UserData),
                        album.UserData?.PlayCount || 0,
                        album.RunTimeTicks || 0,
                        null
                    );
                    childCount++;
                }
                db.prepare(`
                    UPDATE media_parents SET
                        collected_children = (SELECT COUNT(*) FROM media_children WHERE parent_id = ? AND is_collected = 1),
                        watched_children = (SELECT COUNT(*) FROM media_children WHERE parent_id = ? AND watch_status = 'watched')
                    WHERE id = ?
                `).run(parent.id, parent.id, parent.id);
            })();

            results.albums = childCount;
        }

        // Sync people for this item
        if (item.People && item.People.length > 0) {
            const typeMap = {
                'Actor': 'actor', 'Director': 'director', 'Writer': 'writer',
                'Producer': 'producer', 'Composer': 'composer', 'GuestStar': 'guest',
                'Creator': 'creator', 'Conductor': 'conductor', 'Lyricist': 'lyricist'
            };

            const findPersonByTmdb = db.prepare('SELECT id FROM persons WHERE tmdb_person_id = ?');
            const findPersonByJellyfin = db.prepare('SELECT id FROM persons WHERE jellyfin_id = ?');
            const findPersonByName = db.prepare('SELECT id FROM persons WHERE name = ? LIMIT 1');

            let peopleSynced = 0;
            db.transaction(() => {
                for (let idx = 0; idx < item.People.length; idx++) {
                    const person = item.People[idx];
                    if (!person.Name) continue;

                    const pIds = person.ProviderIds || {};
                    const tmdbId = pIds.Tmdb || null;
                    const imdbId = pIds.Imdb || null;
                    const jellyfinPersonId = person.Id || null;
                    const photoUrl = person.PrimaryImageTag && jellyfinPersonId
                        ? `${jellyfinUrl}/Items/${jellyfinPersonId}/Images/Primary`
                        : null;
                    const roleType = typeMap[person.Type] || person.Type?.toLowerCase() || 'other';

                    try {
                        let personId;
                        if (tmdbId) {
                            // Try find by TMDB ID
                            const existing = /** @type {any} */ (findPersonByTmdb.get(tmdbId));
                            if (existing) {
                                personId = existing.id;
                                db.prepare('UPDATE persons SET name = ?, photo_url = COALESCE(?, photo_url) WHERE id = ?')
                                    .run(person.Name, photoUrl, personId);
                            } else {
                                const info = db.prepare('INSERT INTO persons (name, tmdb_person_id, imdb_person_id, jellyfin_id, photo_url) VALUES (?, ?, ?, ?, ?)')
                                    .run(person.Name, tmdbId, imdbId, jellyfinPersonId, photoUrl);
                                personId = info.lastInsertRowid;
                            }
                        } else if (jellyfinPersonId) {
                            const existing = /** @type {any} */ (findPersonByJellyfin.get(jellyfinPersonId));
                            if (existing) {
                                personId = existing.id;
                            } else {
                                const byName = /** @type {any} */ (findPersonByName.get(person.Name));
                                if (byName) {
                                    personId = byName.id;
                                } else {
                                    const info = db.prepare('INSERT INTO persons (name, jellyfin_id, photo_url) VALUES (?, ?, ?)')
                                        .run(person.Name, jellyfinPersonId, photoUrl);
                                    personId = info.lastInsertRowid;
                                }
                            }
                        }

                        if (personId) {
                            // Check if credit exists
                            const existingCredit = db.prepare(
                                'SELECT id FROM person_credits WHERE person_id = ? AND media_parent_id = ? AND role_type = ?'
                            ).get(personId, parent.id, roleType);
                            if (!existingCredit) {
                                db.prepare(
                                    'INSERT OR IGNORE INTO person_credits (person_id, media_parent_id, role_type, character_name, sort_order) VALUES (?, ?, ?, ?, ?)'
                                ).run(personId, parent.id, roleType, person.Role || null, idx);
                            }
                            peopleSynced++;
                        }
                    } catch {
                        // ignore individual person errors
                    }
                }
            })();
            results.people = peopleSynced;
        }

        // Reconcile any orphaned external media_children
        const reconciled = reconcileExternalMedia();
        if (reconciled.merged > 0) results.reconciled = reconciled;

        // Fetch Wikipedia data if not already fetched
        const freshParent = /** @type {any} */ (db.prepare(
            'SELECT id, media_type, tmdb_id, musicbrainz_id, wikipedia_fetched_at FROM media_parents WHERE id = ?'
        ).get(parent.id));
        if (freshParent && !freshParent.wikipedia_fetched_at) {
            try {
                const wiki = await fetchWikipediaForMediaParent(
                    freshParent.id, freshParent.media_type,
                    { tmdb_id: freshParent.tmdb_id, musicbrainz_id: freshParent.musicbrainz_id },
                    settings.tmdb_api_key || null
                );
                if (wiki) {
                    results.wikipedia = wiki.url;
                    console.log(`[item-sync] 📚 Wikipedia found: ${wiki.url}`);
                }
            } catch (e) {
                console.warn(`[item-sync] Wikipedia fetch failed:`, e instanceof Error ? e.message : String(e));
            }
        }

        console.log(`[item-sync] ✅ ${parent.title}: ${childCount} children synced`, results);
        return json({ success: true, childCount, ...results });
    } catch (e) {
        console.error(`[item-sync] Error syncing ${parent.title}:`, e instanceof Error ? e.message : String(e));
        return json({ error: 'Sync failed', details: e instanceof Error ? e.message : String(e) }, { status: 500 });
    }
}

/**
 * TMDb-only enrichment for stubs without a Jellyfin ID.
 * Fetches details + credits from TMDb and updates the local record.
 * @param {number} mediaParentId
 * @param {string} tmdbId
 */
async function tmdbEnrich(mediaParentId, tmdbId) {
    const parent = /** @type {any} */ (db.prepare(
        'SELECT id, title, media_type FROM media_parents WHERE id = ?'
    ).get(mediaParentId));
    if (!parent) return json({ error: 'Item not found in database' }, { status: 404 });

    const { getTmdbKey, tmdbFetch } = await import('$lib/server/tmdb.js');
    if (!getTmdbKey()) {
        return json({ error: 'TMDb API key not configured' }, { status: 400 });
    }
    const tmdbType = parent.media_type === 'movie' ? 'movie' : 'tv';

    try {
        console.log(`[item-sync] TMDb enrichment for ${parent.title} (tmdb:${tmdbId})...`);

        // Fetch full details
        const detailRes = await tmdbFetch(`/${tmdbType}/${tmdbId}`, { append_to_response: 'external_ids' });
        if (!detailRes.ok) return json({ error: `TMDb details fetch failed: ${detailRes.status}` }, { status: 502 });
        const detail = await detailRes.json();

        // Update parent record with full metadata
        db.prepare(`
            UPDATE media_parents SET
                title = COALESCE(?, title),
                release_year = COALESCE(?, release_year),
                poster_url = COALESCE(?, poster_url),
                overview = COALESCE(?, overview),
                tmdb_id = COALESCE(?, tmdb_id),
                imdb_id = COALESCE(?, imdb_id),
                tvdb_id = COALESCE(?, tvdb_id)
            WHERE id = ?
        `).run(
            detail.title || detail.name || null,
            (detail.release_date || detail.first_air_date || '').slice(0, 4) || null,
            detail.poster_path ? `https://image.tmdb.org/t/p/w500${detail.poster_path}` : null,
            detail.overview || null,
            String(tmdbId),
            detail.imdb_id || detail.external_ids?.imdb_id || null,
            detail.external_ids?.tvdb_id ? String(detail.external_ids.tvdb_id) : null,
            mediaParentId
        );

        // Fetch credits
        const creditsRes = await tmdbFetch(`/${tmdbType}/${tmdbId}/credits`);
        let peopleCount = 0;
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

            // Clear existing credits and re-insert (in case of data changes)
            db.transaction(() => {
                db.prepare('DELETE FROM person_credits WHERE media_parent_id = ?').run(mediaParentId);
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
                    peopleCount++;
                }
            })();
        }

        console.log(`[item-sync] ✅ TMDb enrichment complete: ${parent.title}, ${peopleCount} people`);
        return json({ success: true, parent: detail.title || detail.name, people: peopleCount, source: 'tmdb' });
    } catch (e) {
        console.error(`[item-sync] TMDb enrichment error for ${parent.title}:`, e instanceof Error ? e.message : String(e));
        return json({ error: 'TMDb enrichment failed', details: e instanceof Error ? e.message : String(e) }, { status: 500 });
    }
}
