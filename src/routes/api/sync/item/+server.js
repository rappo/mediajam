import db from '$lib/server/db.js';
import { getJellyfinApis, getItemsApi, getTvShowsApi } from '$lib/server/jellyfin.js';
import { reconcileExternalMedia } from '$lib/server/reconcile.js';
import { json } from '@sveltejs/kit';

/**
 * Single-item full sync: re-fetches all data for one movie/show/artist from Jellyfin.
 * POST body: { jellyfinId: string }
 */
export async function POST({ request, locals }) {
    if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

    const { jellyfinId } = await request.json();
    if (!jellyfinId) return json({ error: 'Missing jellyfinId' }, { status: 400 });

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

        // Update the parent record
        db.prepare(`
            UPDATE media_parents SET
                title = ?, tvdb_id = ?, tmdb_id = ?, imdb_id = ?,
                musicbrainz_id = ?, release_year = ?, poster_url = ?,
                overview = ?,
                date_last_modified = ?, jellyfin_child_count = ?
            WHERE id = ?
        `).run(
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
        );

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
                                    'INSERT INTO person_credits (person_id, media_parent_id, role_type, character_name, sort_order) VALUES (?, ?, ?, ?, ?)'
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

        console.log(`[item-sync] ✅ ${parent.title}: ${childCount} children synced`, results);
        return json({ success: true, childCount, ...results });
    } catch (e) {
        console.error(`[item-sync] Error syncing ${parent.title}:`, e instanceof Error ? e.message : String(e));
        return json({ error: 'Sync failed', details: e instanceof Error ? e.message : String(e) }, { status: 500 });
    }
}
