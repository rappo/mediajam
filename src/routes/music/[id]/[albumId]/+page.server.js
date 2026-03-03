import db from '$lib/server/db.js';
import { error } from '@sveltejs/kit';

export async function load({ params, locals, fetch }) {
    const artistId = parseInt(params.id);
    const albumId = parseInt(params.albumId);
    const settings = /** @type {any} */ (db.prepare('SELECT jellyfin_url, jellyfin_sync_check FROM app_settings WHERE id = 1').get());
    const jellyfinUrl = settings?.jellyfin_url || '';
    const syncCheckEnabled = !!(settings?.jellyfin_sync_check ?? 1);
    const userId = locals.user?.id || 0;


    // Get artist
    const artist = /** @type {any} */ (db.prepare(`
        SELECT id, title, poster_url, jellyfin_id, collection_status
        FROM media_parents WHERE id = ? AND media_type = 'artist'
    `).get(artistId));
    if (!artist) throw error(404, 'Artist not found');

    // Get album (media_child of artist)
    const album = /** @type {any} */ (db.prepare(`
        SELECT
            mc.id, mc.title, mc.jellyfin_id,
            mc.item_number as release_year,
            mc.play_count, mc.runtime_ticks
        FROM media_children mc
        WHERE mc.id = ? AND mc.parent_id = ?
    `).get(albumId, artistId));
    if (!album) throw error(404, 'Album not found');

    // Album art from Jellyfin or null
    const albumArtUrl = album.jellyfin_id
        ? `${jellyfinUrl}/Items/${album.jellyfin_id}/Images/Primary?maxHeight=400`
        : null;

    // Artist image
    const artistImageUrl = artist.jellyfin_id
        ? `${jellyfinUrl}/Items/${artist.jellyfin_id}/Images/Primary?maxHeight=100`
        : artist.poster_url;

    // Load tracks from local DB (synced from Jellyfin)
    let tracks = /** @type {any[]} */ (db.prepare(`
        SELECT
            t.jellyfin_id as Id,
            t.title as Name,
            t.track_number as IndexNumber,
            t.disc_number as ParentIndexNumber,
            t.runtime_ticks as RunTimeTicks,
            t.musicbrainz_id
        FROM tracks t
        WHERE t.album_id = ?
        ORDER BY t.disc_number ASC, t.track_number ASC
    `).all(albumId));

    // On-demand backfill: if no tracks stored locally, fetch from Jellyfin and cache
    if (tracks.length === 0 && album.jellyfin_id && jellyfinUrl) {
        try {
            const user = locals.user
                ? /** @type {any} */ (db.prepare('SELECT jellyfin_access_token FROM users WHERE id = ?').get(locals.user.id))
                : null;
            if (user?.jellyfin_access_token) {
                const { getJellyfinApis } = await import('$lib/server/jellyfin.js');
                const { items: itemsApi } = getJellyfinApis(jellyfinUrl, user.jellyfin_access_token);
                const res = await itemsApi.getItems({
                    parentId: album.jellyfin_id,
                    includeItemTypes: ['Audio'],
                    recursive: true,
                    fields: ['ProviderIds'],
                    sortBy: ['SortName'],
                    sortOrder: ['Ascending'],
                    startIndex: 0,
                    limit: 500
                });
                const jfTracks = res.data.Items || [];

                // Store in local DB
                const upsertTrack = db.prepare(`
                    INSERT INTO tracks (album_id, jellyfin_id, title, track_number, disc_number, runtime_ticks, musicbrainz_id)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(jellyfin_id) DO UPDATE SET
                        title = excluded.title, track_number = excluded.track_number,
                        disc_number = excluded.disc_number, runtime_ticks = excluded.runtime_ticks,
                        musicbrainz_id = excluded.musicbrainz_id
                `);
                for (const t of jfTracks) {
                    try {
                        upsertTrack.run(
                            albumId, t.Id, t.Name || 'Unknown Track',
                            t.IndexNumber || 0, t.ParentIndexNumber || 1,
                            t.RunTimeTicks || 0, t.ProviderIds?.MusicBrainzTrack || null
                        );
                    } catch { /* skip bad track */ }
                }

                // Re-query to get consistent format
                tracks = db.prepare(`
                    SELECT t.jellyfin_id as Id, t.title as Name,
                           t.track_number as IndexNumber, t.disc_number as ParentIndexNumber,
                           t.runtime_ticks as RunTimeTicks, t.musicbrainz_id
                    FROM tracks t WHERE t.album_id = ?
                    ORDER BY t.disc_number ASC, t.track_number ASC
                `).all(albumId);
            }
        } catch (e) {
            console.error('[album] On-demand track fetch failed:', e instanceof Error ? e.message : String(e));
        }
    }

    // Get deduplicated play history for this album, grouped by track_name
    // Plays within 5 minutes from different sources = 1 play
    const trackHistory = /** @type {any[]} */ (db.prepare(`
        SELECT
            track_name,
            COUNT(*) as play_count,
            MAX(timestamp) as last_played
        FROM (
            SELECT DISTINCT ph.track_name, ph.media_id,
                   CAST(strftime('%s', ph.timestamp) / 300 AS INTEGER) as time_bucket,
                   ph.timestamp
            FROM playback_history ph
            WHERE ph.media_id = ? AND ph.user_id = ?
        )
        GROUP BY track_name
        ORDER BY play_count DESC
    `).all(albumId, userId));

    // Build a map of track_name -> { play_count, last_played }
    /** @type {Record<string, { play_count: number, last_played: string }>} */
    const trackStatsMap = {};
    for (const row of trackHistory) {
        if (row.track_name) {
            trackStatsMap[row.track_name] = {
                play_count: row.play_count,
                last_played: row.last_played
            };
        }
    }

    // Total deduplicated plays and last played for the album
    const albumStats = /** @type {any} */ (db.prepare(`
        SELECT COUNT(*) as total_plays, MAX(timestamp) as last_played
        FROM (
            SELECT DISTINCT media_id, CAST(strftime('%s', timestamp) / 300 AS INTEGER) as time_bucket, timestamp
            FROM playback_history WHERE media_id = ? AND user_id = ?
        )
    `).get(albumId, userId));

    // Sibling albums (other albums by same artist)
    const siblingAlbums = /** @type {any[]} */ (db.prepare(`
        SELECT mc.id, mc.title, mc.jellyfin_id, mc.item_number as release_year, mc.play_count
        FROM media_children mc
        WHERE mc.parent_id = ? AND mc.id != ?
        ORDER BY mc.item_number ASC, mc.title ASC
    `).all(artistId, albumId));

    const siblingsWithArt = siblingAlbums.map(a => ({
        ...a,
        artUrl: a.jellyfin_id ? `${jellyfinUrl}/Items/${a.jellyfin_id}/Images/Primary?maxHeight=120` : null
    }));

    return {
        artist: { ...artist, imageUrl: artistImageUrl },
        album: { ...album, artUrl: albumArtUrl },
        tracks,
        trackStatsMap,
        albumStats: {
            totalPlays: albumStats?.total_plays || 0,
            lastPlayed: albumStats?.last_played || null
        },
        siblingAlbums: siblingsWithArt,
        jellyfinUrl,
        runtimeMinutes: album.runtime_ticks ? Math.round(album.runtime_ticks / 600000000) : 0,
        syncCheckEnabled
    };
}
