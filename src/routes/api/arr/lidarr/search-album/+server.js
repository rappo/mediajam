import db from '$lib/server/db.js';
import { arrFetch } from '$lib/server/arr-client.js';
import { json } from '@sveltejs/kit';

/**
 * POST /api/arr/lidarr/search-album — Look up an album in Lidarr by MusicBrainz
 * release group ID, monitor it, and trigger a search.
 * Body: { mediaParentId: number, mbid: string, title?: string }
 *   - mediaParentId = artist's media_parents.id (must have lidarr_id)
 *   - mbid = MusicBrainz release group ID
 */
export async function POST({ request, locals }) {
    if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

    const { mediaParentId, mbid, title } = await request.json();
    if (!mediaParentId || !mbid) {
        return json({ error: 'mediaParentId and mbid required' }, { status: 400 });
    }

    const settings = /** @type {any} */ (db.prepare(
        'SELECT lidarr_url as url, lidarr_api_key as apiKey FROM app_settings WHERE id = 1'
    ).get());

    if (!settings?.url || !settings?.apiKey) {
        return json({ error: 'Lidarr not configured' }, { status: 400 });
    }

    // Get artist's Lidarr ID
    const media = /** @type {any} */ (db.prepare(
        'SELECT lidarr_id FROM media_parents WHERE id = ?'
    ).get(mediaParentId));

    if (!media?.lidarr_id) {
        return json({ error: 'Artist not in Lidarr' }, { status: 400 });
    }

    try {
        // Step 1: Get all albums for this artist from Lidarr
        const albums = await arrFetch(settings.url, settings.apiKey, 'lidarr',
            `album?artistId=${media.lidarr_id}`);

        // Step 2: Find the matching album by MusicBrainz release group ID
        const matchedAlbum = albums.find((/** @type {any} */ a) =>
            a.foreignAlbumId === mbid
        );

        if (!matchedAlbum) {
            return json({
                error: `Album "${title || mbid}" not found in Lidarr. The artist may need a metadata refresh.`
            }, { status: 404 });
        }

        // Step 3: Monitor the album if it isn't already
        if (!matchedAlbum.monitored) {
            await arrFetch(settings.url, settings.apiKey, 'lidarr', `album/${matchedAlbum.id}`, {
                method: 'PUT',
                body: JSON.stringify({ ...matchedAlbum, monitored: true }),
            });
        }

        // Step 4: Trigger AlbumSearch command
        await arrFetch(settings.url, settings.apiKey, 'lidarr', 'command', {
            method: 'POST',
            body: JSON.stringify({
                name: 'AlbumSearch',
                albumIds: [matchedAlbum.id],
            }),
        });

        return json({
            success: true,
            albumId: matchedAlbum.id,
            albumTitle: matchedAlbum.title || title,
            monitored: true,
        });
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[arr] Lidarr album search failed:', msg);
        return json({ error: msg }, { status: 500 });
    }
}
