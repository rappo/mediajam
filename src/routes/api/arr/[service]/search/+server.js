import db from '$lib/server/db.js';
import { arrFetch } from '$lib/server/arr-client.js';
import { json } from '@sveltejs/kit';

/**
 * POST /api/arr/[service]/search — trigger a search in *arr for a specific item.
 * Body: { mediaParentId: number }
 */
export async function POST({ params, request, locals }) {
    if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

    const service = params.service;
    if (!['radarr', 'sonarr', 'lidarr'].includes(service)) {
        return json({ error: 'Invalid service' }, { status: 400 });
    }

    const { mediaParentId } = await request.json();
    if (!mediaParentId) return json({ error: 'mediaParentId required' }, { status: 400 });

    const settings = /** @type {any} */ (db.prepare(
        `SELECT ${service}_url as url, ${service}_api_key as apiKey FROM app_settings WHERE id = 1`
    ).get());

    if (!settings?.url || !settings?.apiKey) {
        return json({ error: `${service} not configured` }, { status: 400 });
    }

    const idColumn = service === 'radarr' ? 'radarr_id' : service === 'sonarr' ? 'sonarr_id' : 'lidarr_id';
    const media = /** @type {any} */ (db.prepare(
        `SELECT ${idColumn} as arr_id FROM media_parents WHERE id = ?`
    ).get(mediaParentId));

    if (!media?.arr_id) return json({ error: `Not in ${service}` }, { status: 400 });

    try {
        const commandName = service === 'radarr' ? 'MoviesSearch'
            : service === 'sonarr' ? 'SeriesSearch'
                : 'ArtistSearch';

        const idField = service === 'radarr' ? 'movieIds'
            : service === 'sonarr' ? 'seriesId'
                : 'artistId';

        const body = {
            name: commandName,
            [idField]: service === 'radarr' ? [media.arr_id] : media.arr_id,
        };

        await arrFetch(settings.url, settings.apiKey, service, 'command', {
            method: 'POST',
            body: JSON.stringify(body),
        });

        return json({ success: true });
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return json({ error: msg }, { status: 500 });
    }
}
