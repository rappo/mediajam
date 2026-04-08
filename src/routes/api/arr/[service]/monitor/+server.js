import db from '$lib/server/db.js';
import { arrFetch } from '$lib/server/arr-client.js';
import { json } from '@sveltejs/kit';

/**
 * PUT /api/arr/[service]/monitor — toggle monitored status in *arr.
 * Body: { mediaParentId: number, monitored: boolean }
 */
export async function PUT({ params, request, locals }) {
    if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

    const service = params.service;
    if (!['radarr', 'sonarr', 'lidarr'].includes(service)) {
        return json({ error: 'Invalid service' }, { status: 400 });
    }

    const { mediaParentId, monitored } = await request.json();
    if (!mediaParentId || monitored === undefined) {
        return json({ error: 'mediaParentId and monitored required' }, { status: 400 });
    }

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
        const endpoint = service === 'radarr' ? 'movie'
            : service === 'sonarr' ? 'series'
                : 'artist';

        // Fetch current item from *arr to get full body (required for PUT)
        const item = await arrFetch(settings.url, settings.apiKey, service, `${endpoint}/${media.arr_id}`);
        item.monitored = monitored;

        await arrFetch(settings.url, settings.apiKey, service, `${endpoint}/${media.arr_id}`, {
            method: 'PUT',
            body: JSON.stringify(item),
        });

        // Update local DB
        db.prepare('UPDATE media_parents SET arr_monitored = ? WHERE id = ?')
            .run(monitored ? 1 : 0, mediaParentId);

        return json({ success: true, monitored });
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return json({ error: msg }, { status: 500 });
    }
}
