import db from '$lib/server/db.js';
import { error } from '@sveltejs/kit';

export function load({ params }) {
    const artistId = parseInt(params.id);
    const settings = db.prepare('SELECT jellyfin_url FROM app_settings WHERE id = 1').get();
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
            COALESCE((SELECT SUM(mc.play_count) FROM media_children mc WHERE mc.parent_id = mp.id), 0) as total_plays,
            CASE WHEN mp.total_released_children > 0
                THEN ROUND(CAST(mp.collected_children AS REAL) / mp.total_released_children * 100, 1)
                ELSE NULL END as collection_pct
        FROM media_parents mp
        WHERE mp.id = ? AND mp.media_type = 'artist'
    `).get(artistId);

    if (!artist) throw error(404, 'Artist not found');

    // Albums are children of the artist, item_number = release year
    const albums = db.prepare(`
        SELECT
            mc.id,
            mc.title,
            mc.jellyfin_id,
            mc.item_number as release_year,
            mc.watch_status,
            mc.play_count,
            mc.runtime_ticks
        FROM media_children mc
        WHERE mc.parent_id = ?
        ORDER BY mc.item_number ASC, mc.title ASC
    `).all(artistId);

    // Add image URLs and format runtime
    const albumsWithImages = albums.map(album => ({
        ...album,
        artUrl: album.jellyfin_id ? `${jellyfinUrl}/Items/${album.jellyfin_id}/Images/Primary?maxHeight=200` : null,
        runtimeMinutes: album.runtime_ticks ? Math.round(album.runtime_ticks / 600000000) : 0
    }));

    const totalRuntime = albums.reduce((sum, a) => sum + (a.runtime_ticks || 0), 0);
    const totalPlayed = albums.filter(a => a.play_count > 0).length;

    // Artist image from Jellyfin
    const artistImageUrl = artist.jellyfin_id
        ? `${jellyfinUrl}/Items/${artist.jellyfin_id}/Images/Primary?maxHeight=300`
        : artist.poster_url;

    return {
        artist: { ...artist, imageUrl: artistImageUrl },
        albums: albumsWithImages,
        jellyfinUrl,
        totalPlayed,
        totalRuntimeMinutes: Math.round(totalRuntime / 600000000)
    };
}
