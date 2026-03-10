import db from '$lib/server/db.js';
import { error } from '@sveltejs/kit';
import { checkJellyfinFavorite } from '$lib/server/jellyfin-favorites.js';
import { resolveBackdrop } from '$lib/server/backdrop.js';

export async function load({ params, locals }) {
    const artistId = parseInt(params.id);
    const userId = locals.user?.id || 0;
    const settings = db.prepare('SELECT jellyfin_url, lidarr_url, lidarr_external_url FROM app_settings WHERE id = 1').get();
    const jellyfinUrl = settings?.jellyfin_url || '';

    const artist = db.prepare(`
        SELECT
            mp.id,
            mp.title,
            mp.poster_url,
            mp.jellyfin_id,
            mp.collected_children as album_count,
            mp.total_released_children,
            mp.musicbrainz_id,
            mp.is_favorite,
            mp.lidarr_id,
            mp.arr_slug,
            mp.arr_monitored,
            mp.arr_quality_profile,
            mp.arr_has_file,
            mp.arr_status,
            mp.collection_status,
            mp.backdrop_url,
            CASE WHEN mp.total_released_children > 0
                THEN ROUND(CAST(mp.collected_children AS REAL) / mp.total_released_children * 100, 1)
                ELSE NULL END as collection_pct
        FROM media_parents mp
        WHERE mp.id = ? AND mp.media_type = 'artist'
    `).get(artistId);

    if (!artist) throw error(404, 'Artist not found');

    // Albums are children of the artist, item_number = release year
    const albums = /** @type {any[]} */ (db.prepare(`
        SELECT
            mc.id,
            mc.title,
            mc.jellyfin_id,
            mc.item_number as release_year,
            mc.watch_status,
            mc.play_count,
            mc.runtime_ticks,
            mc.poster_url,
            mc.is_collected,
            mc.musicbrainz_id
        FROM media_children mc
        WHERE mc.parent_id = ?
        ORDER BY mc.item_number ASC, mc.title ASC
    `).all(artistId));

    // Get deduplicated play counts per album from playback_history
    // Plays within 5 minutes from different sources = 1 play
    /** @type {Record<number, number>} */
    const albumPlayCounts = {};
    const playRows = /** @type {any[]} */ (db.prepare(`
        SELECT media_id, COUNT(*) as play_count
        FROM (
            SELECT DISTINCT ph.media_id, CAST(strftime('%s', ph.timestamp) / 300 AS INTEGER) as time_bucket
            FROM playback_history ph
            WHERE ph.media_id IN (SELECT id FROM media_children WHERE parent_id = ?)
              AND ph.user_id = ?
        )
        GROUP BY media_id
    `).all(artistId, userId));
    for (const row of playRows) {
        albumPlayCounts[row.media_id] = row.play_count;
    }

    // Total deduplicated plays for this artist
    const totalPlaysRow = /** @type {any} */ (db.prepare(`
        SELECT COUNT(*) as total
        FROM (
            SELECT DISTINCT ph.media_id, CAST(strftime('%s', ph.timestamp) / 300 AS INTEGER) as time_bucket
            FROM playback_history ph
            JOIN media_children mc ON ph.media_id = mc.id
            WHERE mc.parent_id = ? AND ph.user_id = ?
        )
    `).get(artistId, userId));
    const totalPlays = totalPlaysRow?.total || 0;

    // Add image URLs, local play counts, and format runtime
    const albumsWithImages = albums.map(album => ({
        ...album,
        play_count: albumPlayCounts[album.id] || 0,
        artUrl: album.jellyfin_id
            ? `${jellyfinUrl}/Items/${album.jellyfin_id}/Images/Primary?maxHeight=200`
            : album.poster_url || null,
        runtimeMinutes: album.runtime_ticks ? Math.round(album.runtime_ticks / 600000000) : 0
    }));

    const totalRuntime = albums.reduce((sum, a) => sum + (a.runtime_ticks || 0), 0);
    const totalPlayed = albumsWithImages.filter(a => a.play_count > 0).length;

    // Artist image from Jellyfin
    const artistImageUrl = artist.jellyfin_id
        ? `${jellyfinUrl}/Items/${artist.jellyfin_id}/Images/Primary?maxHeight=300`
        : artist.poster_url;

    // External ratings per album (Discogs, MusicBrainz)
    const albumRatings = /** @type {any[]} */ (db.prepare(`
        SELECT media_child_id, source, rating_type, value, vote_count, raw_value
        FROM external_ratings 
        WHERE media_parent_id = ? AND media_child_id IS NOT NULL
        ORDER BY media_child_id, source
    `).all(artistId));

    // Group ratings by album ID
    /** @type {Record<number, any[]>} */
    const ratingsByAlbum = {};
    for (const r of albumRatings) {
        if (!ratingsByAlbum[r.media_child_id]) ratingsByAlbum[r.media_child_id] = [];
        ratingsByAlbum[r.media_child_id].push(r);
    }

    // Attach ratings to albums
    const albumsWithRatings = albumsWithImages.map(a => ({
        ...a,
        ratings: ratingsByAlbum[a.id] || []
    }));

    // Live Jellyfin favorite check
    const liveFavorite = await checkJellyfinFavorite(artist.jellyfin_id, 'media_parents', artist.id);

    // Artist backdrop: prefer Fanart.tv (cached in DB), fallback to Jellyfin poster
    const backdropUrl = artist.backdrop_url || null;
    // Lazy-fetch Fanart.tv backdrop if not yet cached
    if (!artist.backdrop_url && artist.musicbrainz_id) {
        resolveBackdrop(artistId).catch(() => {});
    }

    return {
        artist: { ...artist, is_favorite: liveFavorite ?? artist.is_favorite, total_plays: totalPlays, imageUrl: artistImageUrl, backdropUrl },
        albums: albumsWithRatings,
        jellyfinUrl,
        arrUrl: (settings?.lidarr_external_url || settings?.lidarr_url || '').replace(/\/+$/, ''),
        arrService: 'lidarr',
        totalPlayed,
        totalRuntimeMinutes: Math.round(totalRuntime / 600000000)
    };
}
