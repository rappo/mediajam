/**
 * On-demand Lidarr album enrichment.
 * When an album page is loaded for a non-Jellyfin album under a Lidarr artist,
 * fetches album metadata and tracks from Lidarr.
 */

import db from '$lib/server/db.js';
import { arrFetch } from '$lib/server/arr-client.js';

/**
 * Get Lidarr connection settings.
 * @returns {{ url: string, apiKey: string } | null}
 */
function getLidarrSettings() {
    const settings = /** @type {any} */ (db.prepare(
        'SELECT lidarr_url, lidarr_api_key FROM app_settings WHERE id = 1'
    ).get());
    if (!settings?.lidarr_url || !settings?.lidarr_api_key) return null;
    return { url: settings.lidarr_url, apiKey: settings.lidarr_api_key };
}

/**
 * Normalize title for matching (lowercase, strip smart quotes, collapse whitespace).
 * @param {string} s
 * @returns {string}
 */
function norm(s) {
    if (!s) return '';
    return s
        .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
        .replace(/[\u201C\u201D\u201E\u201F\u2033\u2036]/g, '"')
        .replace(/[\u2010\u2011\u2012\u2013\u2014\u2015]/g, '-')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
}

/**
 * Enrich a media_children album with data from Lidarr.
 * Fetches the album list for the artist from Lidarr, finds the matching album,
 * and stores cover art, overview, release date, and tracks.
 *
 * @param {number} albumId - media_children.id
 * @param {number} artistId - media_parents.id (artist)
 * @returns {Promise<{ enriched: boolean, tracks: any[], albumData: any | null }>}
 */
export async function enrichAlbumFromLidarr(albumId, artistId) {
    const lidarr = getLidarrSettings();
    if (!lidarr) return { enriched: false, tracks: [], albumData: null };

    // Get artist's Lidarr ID and the album title
    const artist = /** @type {any} */ (db.prepare(
        'SELECT lidarr_id, musicbrainz_id FROM media_parents WHERE id = ?'
    ).get(artistId));
    if (!artist?.lidarr_id) return { enriched: false, tracks: [], albumData: null };

    const album = /** @type {any} */ (db.prepare(
        'SELECT id, title, poster_url, overview, musicbrainz_id FROM media_children WHERE id = ?'
    ).get(albumId));
    if (!album) return { enriched: false, tracks: [], albumData: null };

    // If already enriched (has poster_url), return existing data
    if (album.poster_url && album.overview) {
        const tracks = /** @type {any[]} */ (db.prepare(
            'SELECT * FROM tracks WHERE album_id = ? ORDER BY disc_number ASC, track_number ASC'
        ).all(albumId));
        return { enriched: true, tracks, albumData: album };
    }

    try {
        // Fetch all albums for this artist from Lidarr
        const lidarrAlbums = await arrFetch(lidarr.url, lidarr.apiKey, 'lidarr', `album?artistId=${artist.lidarr_id}`);
        if (!Array.isArray(lidarrAlbums)) return { enriched: false, tracks: [], albumData: null };

        // Match by MusicBrainz ID first, then by title
        const normAlbumTitle = norm(album.title);
        let match = null;

        if (album.musicbrainz_id) {
            match = lidarrAlbums.find((/** @type {any} */ a) => a.foreignAlbumId === album.musicbrainz_id);
        }
        if (!match) {
            match = lidarrAlbums.find((/** @type {any} */ a) => norm(a.title) === normAlbumTitle);
        }
        // Fuzzy: check containment
        if (!match) {
            match = lidarrAlbums.find((/** @type {any} */ a) => {
                const nt = norm(a.title);
                return nt.length >= 3 && normAlbumTitle.length >= 3 &&
                    (nt.includes(normAlbumTitle) || normAlbumTitle.includes(nt));
            });
        }

        if (!match) return { enriched: false, tracks: [], albumData: null };

        // Extract cover art
        const coverImage = (match.images || []).find((/** @type {any} */ img) =>
            img.coverType === 'cover' || img.coverType === 'poster'
        );
        const posterUrl = coverImage?.remoteUrl || coverImage?.url || null;
        const overview = match.overview || null;
        const mbid = match.foreignAlbumId || null;
        const releaseYear = match.releaseDate ? new Date(match.releaseDate).getFullYear() : null;

        // Update album metadata
        db.prepare(`
            UPDATE media_children SET
                poster_url = COALESCE(?, poster_url),
                overview = COALESCE(?, overview),
                musicbrainz_id = COALESCE(?, musicbrainz_id),
                item_number = COALESCE(item_number, ?)
            WHERE id = ?
        `).run(posterUrl, overview, mbid, releaseYear, albumId);

        // Fetch tracks from Lidarr for this album
        let trackData = [];
        try {
            const lidarrTracks = await arrFetch(lidarr.url, lidarr.apiKey, 'lidarr', `track?albumId=${match.id}`);
            if (Array.isArray(lidarrTracks) && lidarrTracks.length > 0) {
                const upsertTrack = db.prepare(`
                    INSERT INTO tracks (album_id, title, track_number, disc_number, runtime_ticks, musicbrainz_id)
                    VALUES (?, ?, ?, ?, ?, ?)
                    ON CONFLICT DO NOTHING
                `);
                db.transaction(() => {
                    for (const t of lidarrTracks) {
                        try {
                            upsertTrack.run(
                                albumId,
                                t.title || 'Unknown Track',
                                t.trackNumber || t.absoluteTrackNumber || 0,
                                t.mediumNumber || 1,
                                (t.duration || 0) * 10000000, // Lidarr duration is in ms, convert to ticks
                                t.foreignTrackId || null
                            );
                        } catch { /* skip dupes */ }
                    }
                })();
                trackData = /** @type {any[]} */ (db.prepare(
                    'SELECT * FROM tracks WHERE album_id = ? ORDER BY disc_number ASC, track_number ASC'
                ).all(albumId));
            }
        } catch (e) {
            console.warn('[lidarr-enrich] Failed to fetch tracks:', e instanceof Error ? e.message : e);
        }

        return {
            enriched: true,
            tracks: trackData,
            albumData: {
                ...album,
                poster_url: posterUrl || album.poster_url,
                overview: overview || album.overview,
                musicbrainz_id: mbid || album.musicbrainz_id
            }
        };
    } catch (e) {
        console.warn('[lidarr-enrich] Failed:', e instanceof Error ? e.message : e);
        return { enriched: false, tracks: [], albumData: null };
    }
}
