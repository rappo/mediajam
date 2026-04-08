import db from '$lib/server/db.js';
import { arrFetch } from '$lib/server/arr-client.js';
import { json } from '@sveltejs/kit';

/**
 * POST /api/arr/sonarr/episode-search — trigger a Sonarr EpisodeSearch for a single episode.
 * Body: { mediaParentId: number, seasonNumber: number, episodeNumber: number }
 */
export async function POST({ request, locals }) {
    if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

    const { mediaParentId, seasonNumber, episodeNumber } = await request.json();
    if (!mediaParentId || seasonNumber == null || episodeNumber == null) {
        return json({ error: 'mediaParentId, seasonNumber, and episodeNumber required' }, { status: 400 });
    }

    const settings = /** @type {any} */ (db.prepare(
        'SELECT sonarr_url as url, sonarr_api_key as apiKey FROM app_settings WHERE id = 1'
    ).get());

    if (!settings?.url || !settings?.apiKey) {
        return json({ error: 'Sonarr not configured' }, { status: 400 });
    }

    const media = /** @type {any} */ (db.prepare(
        'SELECT sonarr_id as arr_id, title FROM media_parents WHERE id = ?'
    ).get(mediaParentId));

    if (!media?.arr_id) return json({ error: 'Not in Sonarr' }, { status: 400 });

    try {
        // Look up the Sonarr episode ID
        const sonarrEpisodes = await arrFetch(settings.url, settings.apiKey, 'sonarr',
            `episode?seriesId=${media.arr_id}&seasonNumber=${seasonNumber}`,
            { signal: AbortSignal.timeout(15000) });

        const sonarrEp = (Array.isArray(sonarrEpisodes) ? sonarrEpisodes : []).find(
            (/** @type {any} */ e) => e.episodeNumber === episodeNumber
        );

        if (!sonarrEp) {
            return json({ error: `Episode S${seasonNumber}E${episodeNumber} not found in Sonarr` }, { status: 404 });
        }

        // Trigger EpisodeSearch command
        await arrFetch(settings.url, settings.apiKey, 'sonarr', 'command', {
            method: 'POST',
            body: JSON.stringify({
                name: 'EpisodeSearch',
                episodeIds: [sonarrEp.id],
            }),
        });

        return json({ success: true, sonarrEpisodeId: sonarrEp.id });
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return json({ error: msg }, { status: 500 });
    }
}
