import db from '$lib/server/db.js';
import { error, redirect } from '@sveltejs/kit';
import { checkJellyfinFavorite } from '$lib/server/jellyfin-favorites.js';
import { resolveBackdrop, resolvePoster } from '$lib/server/backdrop.js';
import { slugify, ensureUniqueSlug } from '$lib/server/slugify.js';

export async function load({ params, locals }) {
    const paramSlug = params.slug;
    const userId = locals.user?.id || 0;
    const settings = db.prepare('SELECT jellyfin_url, lidarr_url, lidarr_external_url FROM app_settings WHERE id = 1').get();
    const jellyfinUrl = settings?.jellyfin_url || '';

    // Slug lookup with numeric ID fallback
    let artistId;
    if (/^\d+$/.test(paramSlug)) {
        const row = /** @type {any} */ (db.prepare('SELECT id, slug FROM media_parents WHERE id = ? AND media_type = \'artist\'').get(parseInt(paramSlug)));
        if (!row) throw error(404, 'Artist not found');
        if (row.slug) throw redirect(301, `/music/${row.slug}`);
        const mp = /** @type {any} */ (db.prepare('SELECT title FROM media_parents WHERE id = ?').get(row.id));
        const base = slugify(mp.title || 'untitled');
        const slug = ensureUniqueSlug(db, 'media_parents', base, row.id);
        db.prepare('UPDATE media_parents SET slug = ? WHERE id = ?').run(slug, row.id);
        throw redirect(301, `/music/${slug}`);
    } else {
        const row = /** @type {any} */ (db.prepare('SELECT id FROM media_parents WHERE slug = ? AND media_type = \'artist\'').get(paramSlug));
        if (!row) throw error(404, 'Artist not found');
        artistId = row.id;
    }

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
            mc.musicbrainz_id,
            mc.is_hidden
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
    let backdropUrl = artist.backdrop_url || null;
    // Fetch Fanart.tv backdrop if not yet cached (await so it shows on first visit)
    if (!artist.backdrop_url && artist.musicbrainz_id) {
        try {
            const resolved = await resolveBackdrop(artistId);
            if (resolved) backdropUrl = resolved;
        } catch { /* non-fatal */ }
    }
    // Fetch Fanart.tv poster if no poster_url and no usable Jellyfin primary
    let resolvedPosterUrl = artist.poster_url || null;
    if (!artist.poster_url && artist.musicbrainz_id) {
        try {
            const fetched = await resolvePoster(artistId);
            if (fetched) resolvedPosterUrl = fetched;
        } catch { /* non-fatal */ }
    }

    // Artist image: prefer external poster (TheAudioDB/Fanart.tv) which is reliable,
    // fallback to Jellyfin primary image, then backdrop if nothing else works
    const artistImageUrl = resolvedPosterUrl
        || (artist.jellyfin_id ? `${jellyfinUrl}/Items/${artist.jellyfin_id}/Images/Primary?maxHeight=300` : null)
        || backdropUrl;

    // Band members / credits — show musicians (members, supporting, instrument-named roles) and crew separately
    const CREW_ROLES = `('director', 'writer', 'producer', 'creator', 'guest', 'conductor', 'lyricist', 'composer')`;
    const members = /** @type {any[]} */ (db.prepare(`
        SELECT p.id, p.name, p.photo_url, p.tmdb_person_id, p.musicbrainz_artist_id,
               pc.role_type, pc.character_name, pc.sort_order
        FROM person_credits pc
        JOIN persons p ON pc.person_id = p.id
        WHERE pc.media_parent_id = ? AND pc.role_type NOT IN ${CREW_ROLES}
        ORDER BY pc.sort_order ASC
    `).all(artistId));

    const crew = /** @type {any[]} */ (db.prepare(`
        SELECT p.id, p.name, p.photo_url, p.tmdb_person_id, p.musicbrainz_artist_id,
               pc.role_type, pc.character_name, pc.sort_order
        FROM person_credits pc
        JOIN persons p ON pc.person_id = p.id
        WHERE pc.media_parent_id = ? AND pc.role_type IN ${CREW_ROLES}
        ORDER BY pc.sort_order ASC
    `).all(artistId));

    // Listening history — recent plays across all albums by this artist
    const listeningHistory = /** @type {any[]} */ (db.prepare(`
        SELECT
            ph.track_name,
            ph.timestamp,
            mc.id as album_id,
            mc.title as album_title,
            mc.jellyfin_id as album_jellyfin_id,
            mc.poster_url as album_poster
        FROM playback_history ph
        JOIN media_children mc ON ph.media_id = mc.id
        WHERE mc.parent_id = ? AND ph.user_id = ?
        GROUP BY ph.track_name, CAST(strftime('%s', ph.timestamp) / 300 AS INTEGER)
        ORDER BY ph.timestamp DESC
        LIMIT 50
    `).all(artistId, userId));

    // Add album art URLs to history
    for (const entry of listeningHistory) {
        entry.album_art = entry.album_jellyfin_id
            ? `${jellyfinUrl}/Items/${entry.album_jellyfin_id}/Images/Primary?maxHeight=60`
            : entry.album_poster || null;
    }

    // ── Lidarr album enrichment ──
    // Fetch albums from Lidarr that aren't in the local DB yet
    /** @type {any[]} */
    let lidarrAlbums = [];
    if (artist.lidarr_id) {
        try {
            const { arrFetch } = await import('$lib/server/arr-client.js');
            const lidarrSettings = /** @type {any} */ (db.prepare(
                'SELECT lidarr_url, lidarr_api_key FROM app_settings WHERE id = 1'
            ).get());
            if (lidarrSettings?.lidarr_url && lidarrSettings?.lidarr_api_key) {
                const allLidarrAlbums = await arrFetch(
                    lidarrSettings.lidarr_url,
                    lidarrSettings.lidarr_api_key,
                    'lidarr',
                    `album?artistId=${artist.lidarr_id}`
                );
                if (Array.isArray(allLidarrAlbums)) {
                    // Find local album MusicBrainz IDs and titles for dedup
                    const localMbids = new Set(albums.map(a => a.musicbrainz_id).filter(Boolean));
                    const localTitles = new Set(albums.map(a => (a.title || '').toLowerCase().trim()));

                    for (const la of allLidarrAlbums) {
                        const mbid = la.foreignAlbumId;
                        const title = la.title || '';
                        // Skip if already in local DB
                        if (mbid && localMbids.has(mbid)) continue;
                        if (localTitles.has(title.toLowerCase().trim())) continue;

                        // Extract cover image
                        const coverImg = (la.images || []).find((/** @type {any} */ img) =>
                            img.coverType === 'cover' || img.coverType === 'poster'
                        );
                        const posterUrl = coverImg?.remoteUrl || coverImg?.url || null;
                        const releaseYear = la.releaseDate ? new Date(la.releaseDate).getFullYear() : null;

                        lidarrAlbums.push({
                            id: `lidarr_${la.id}`,
                            lidarr_album_id: la.id,
                            title,
                            jellyfin_id: null,
                            release_year: releaseYear,
                            watch_status: null,
                            play_count: 0,
                            runtime_ticks: 0,
                            poster_url: posterUrl,
                            is_collected: false,
                            musicbrainz_id: mbid,
                            is_hidden: false,
                            artUrl: posterUrl,
                            runtimeMinutes: 0,
                            ratings: [],
                            lidarr_only: true,
                            lidarr_monitored: la.monitored || false,
                            lidarr_has_file: la.statistics?.percentOfTracks > 0 || false,
                            lidarr_percent: la.statistics?.percentOfTracks || 0,
                            lidarr_track_count: la.statistics?.totalTrackCount || 0,
                        });
                    }
                }
            }
        } catch (e) {
            console.warn('[music page] Failed to fetch Lidarr albums:', e instanceof Error ? e.message : e);
        }
    }

    // Merge local and Lidarr-only albums, sorted by year
    const allAlbums = [...albumsWithRatings.map(a => ({ ...a, lidarr_only: false })), ...lidarrAlbums]
        .sort((a, b) => (a.release_year || 9999) - (b.release_year || 9999));

    return {
        artist: { ...artist, is_favorite: liveFavorite ?? artist.is_favorite, total_plays: totalPlays, imageUrl: artistImageUrl, backdropUrl },
        albums: allAlbums,
        jellyfinUrl,
        arrUrl: (settings?.lidarr_external_url || settings?.lidarr_url || '').replace(/\/+$/, ''),
        arrService: 'lidarr',
        totalPlayed,
        totalRuntimeMinutes: Math.round(totalRuntime / 600000000),
        members,
        crew,
        listeningHistory,
    };
}
