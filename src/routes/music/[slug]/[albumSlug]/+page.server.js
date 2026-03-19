import db from '$lib/server/db.js';
import { error, redirect } from '@sveltejs/kit';
import { enrichAlbumFromLidarr } from '$lib/server/lidarr-enrich.js';
import { slugify, ensureUniqueSlug } from '$lib/server/slugify.js';

export async function load({ params, locals, fetch }) {
    const settings = /** @type {any} */ (db.prepare('SELECT jellyfin_url, jellyfin_sync_check, lidarr_url, lidarr_external_url FROM app_settings WHERE id = 1').get());
    const jellyfinUrl = settings?.jellyfin_url || '';
    const syncCheckEnabled = !!(settings?.jellyfin_sync_check ?? 1);
    const userId = locals.user?.id || 0;

    // Resolve artist via slug or numeric ID
    let artistId;
    const artistParam = params.slug;
    if (/^\d+$/.test(artistParam)) {
        const row = /** @type {any} */ (db.prepare('SELECT id, slug FROM media_parents WHERE id = ? AND media_type = \'artist\'').get(parseInt(artistParam)));
        if (!row) throw error(404, 'Artist not found');
        // We'll redirect after resolving albumSlug too
        artistId = row.id;
    } else {
        const row = /** @type {any} */ (db.prepare('SELECT id FROM media_parents WHERE slug = ? AND media_type = \'artist\'').get(artistParam));
        if (!row) throw error(404, 'Artist not found');
        artistId = row.id;
    }

    // Resolve album via slug or numeric ID
    let albumId;
    const albumParam = params.albumSlug;
    if (/^\d+$/.test(albumParam)) {
        const row = /** @type {any} */ (db.prepare('SELECT id, slug FROM media_children WHERE id = ? AND parent_id = ?').get(parseInt(albumParam), artistId));
        if (!row) throw error(404, 'Album not found');
        // Redirect to slug URL
        const artistRow = /** @type {any} */ (db.prepare('SELECT slug FROM media_parents WHERE id = ?').get(artistId));
        const artistSlug = artistRow?.slug || artistId;
        if (row.slug) throw redirect(301, `/music/${artistSlug}/${row.slug}`);
        const base = slugify(row.title || 'untitled');
        const slug = ensureUniqueSlug(db, 'media_children', base, row.id);
        db.prepare('UPDATE media_children SET slug = ? WHERE id = ?').run(slug, row.id);
        throw redirect(301, `/music/${artistSlug}/${slug}`);
    } else {
        const row = /** @type {any} */ (db.prepare('SELECT id FROM media_children WHERE slug = ? AND parent_id = ?').get(albumParam, artistId));
        if (!row) throw error(404, 'Album not found');
        albumId = row.id;
    }

    // Also redirect if artist param was numeric
    if (/^\d+$/.test(artistParam)) {
        const artistRow = /** @type {any} */ (db.prepare('SELECT slug FROM media_parents WHERE id = ?').get(artistId));
        const albumRow = /** @type {any} */ (db.prepare('SELECT slug FROM media_children WHERE id = ?').get(albumId));
        if (artistRow?.slug && albumRow?.slug) throw redirect(301, `/music/${artistRow.slug}/${albumRow.slug}`);
    }

    // Get artist
    const artist = /** @type {any} */ (db.prepare(`
        SELECT id, title, poster_url, jellyfin_id, collection_status, lidarr_id, arr_slug
        FROM media_parents WHERE id = ? AND media_type = 'artist'
    `).get(artistId));
    if (!artist) throw error(404, 'Artist not found');

    // Get album (media_child of artist)
    let album = /** @type {any} */ (db.prepare(`
        SELECT
            mc.id, mc.title, mc.jellyfin_id,
            mc.item_number as release_year,
            mc.play_count, mc.runtime_ticks,
            mc.poster_url, mc.overview, mc.musicbrainz_id,
            mc.is_hidden
        FROM media_children mc
        WHERE mc.id = ? AND mc.parent_id = ?
    `).get(albumId, artistId));
    if (!album) throw error(404, 'Album not found');

    // On-demand Lidarr enrichment for non-Jellyfin albums under Lidarr artists
    let lidarrEnriched = false;
    if (!album.jellyfin_id && artist.lidarr_id) {
        try {
            const enrichResult = await enrichAlbumFromLidarr(albumId, artistId);
            if (enrichResult.enriched && enrichResult.albumData) {
                album = { ...album, ...enrichResult.albumData };
                lidarrEnriched = true;
            }
        } catch (e) {
            console.warn('[album] Lidarr enrichment failed:', e instanceof Error ? e.message : e);
        }
    }

    // Album art: Jellyfin > Lidarr poster_url > null
    const albumArtUrl = album.jellyfin_id
        ? `${jellyfinUrl}/Items/${album.jellyfin_id}/Images/Primary?maxHeight=400`
        : album.poster_url || null;

    // Artist image
    const artistImageUrl = artist.jellyfin_id
        ? `${jellyfinUrl}/Items/${artist.jellyfin_id}/Images/Primary?maxHeight=100`
        : artist.poster_url;

    // Load tracks from local DB (synced from Jellyfin)
    let tracks = /** @type {any[]} */ (db.prepare(`
        SELECT
            MAX(t.jellyfin_id) as Id,
            t.title as Name,
            t.track_number as IndexNumber,
            t.disc_number as ParentIndexNumber,
            MAX(t.runtime_ticks) as RunTimeTicks,
            MAX(t.musicbrainz_id) as musicbrainz_id
        FROM tracks t
        WHERE t.album_id = ?
        GROUP BY t.disc_number, t.track_number, t.title
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

    // Normalize track name for fuzzy matching (lowercase, strip [Explicit], collapse ws)
    /** @param {string} s */
    function normTrack(s) {
        if (!s) return '';
        return s
            .toLowerCase()
            .replace(/\[explicit\]/gi, '')
            .replace(/\(([^)]*)\bremix\b([^)]*)\)/gi, (_, a, b) => `(${a}remix${b})`)
            .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
            .replace(/[\u201C\u201D]/g, '"')
            .replace(/[\u2013\u2014]/g, '-')
            .replace(/\s+/g, ' ')
            .trim();
    }

    // Build a map of track_name -> { play_count, last_played }
    // Keyed by BOTH original name AND normalized name for fuzzy lookups
    /** @type {Record<string, { play_count: number, last_played: string }>} */
    const trackStatsMap = {};
    for (const row of trackHistory) {
        if (row.track_name) {
            const stats = { play_count: row.play_count, last_played: row.last_played };
            trackStatsMap[row.track_name] = stats;
            // Also key by normalized name for fuzzy matching
            const normKey = normTrack(row.track_name);
            if (normKey && !trackStatsMap[normKey]) {
                trackStatsMap[normKey] = stats;
            }
        }
    }

    // Pre-match: for each actual track, find its stats via normalized name
    // and add an entry under the track's exact Name for direct template lookups
    for (const track of tracks) {
        const name = track.Name || track.title;
        if (!name || trackStatsMap[name]) continue;
        const normName = normTrack(name);
        if (normName && trackStatsMap[normName]) {
            trackStatsMap[name] = trackStatsMap[normName];
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

    // Determine if this is an unmatched album (no Jellyfin ID, imported from external source)
    const isUnmatched = !album.jellyfin_id;

    // If no local tracks but we have play history, build virtual tracks from history
    let unmatchedTracks = [];
    if (tracks.length === 0 && trackHistory.length > 0) {
        unmatchedTracks = trackHistory.map((th, i) => ({
            Name: th.track_name || 'Unknown Track',
            IndexNumber: i + 1,
            ParentIndexNumber: 1,
            RunTimeTicks: 0,
            Id: null,
            musicbrainz_id: null
        }));
    }

    return {
        artist: { ...artist, imageUrl: artistImageUrl },
        album: { ...album, artUrl: albumArtUrl },
        tracks,
        unmatchedTracks,
        trackStatsMap,
        albumStats: {
            totalPlays: albumStats?.total_plays || 0,
            lastPlayed: albumStats?.last_played || null
        },
        siblingAlbums: siblingsWithArt,
        jellyfinUrl,
        runtimeMinutes: album.runtime_ticks ? Math.round(album.runtime_ticks / 600000000) : 0,
        syncCheckEnabled,
        isUnmatched,
        isInLidarr: !!artist.lidarr_id,
        lidarrEnriched,
        arrUrl: (settings?.lidarr_external_url || settings?.lidarr_url || '').replace(/\/+$/, ''),
        arrSlug: artist.arr_slug || null
    };
}
