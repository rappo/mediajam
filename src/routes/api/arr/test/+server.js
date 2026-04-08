import { json } from '@sveltejs/kit';
import { testConnection } from '$lib/server/arr-client.js';

/**
 * POST /api/arr/test — Test connection to an *arr instance.
 * Body: { service: "radarr"|"sonarr"|"lidarr", url: string, apiKey: string }
 * @type {import('./$types').RequestHandler}
 */
export async function POST({ request, locals }) {
    if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

    const { service, url, apiKey } = await request.json();
    if (!service || !url || !apiKey) {
        return json({ error: 'Missing service, url, or apiKey' }, { status: 400 });
    }

    const result = await testConnection(url, apiKey, service);
    return json(result);
}
