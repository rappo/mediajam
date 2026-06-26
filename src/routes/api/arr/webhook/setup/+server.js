import db from '$lib/server/db.js';
import { arrFetch } from '$lib/server/arr-client.js';
import { json } from '@sveltejs/kit';

/**
 * POST /api/arr/webhook/setup — Auto-configure webhooks in *arr services.
 * Creates a 'MediaJam' webhook notification in each configured *arr instance.
 * Skips services that already have a MediaJam webhook configured.
 * @type {import('./$types').RequestHandler}
 */
export async function POST({ request, locals, url: reqUrl }) {
    if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

    /** @type {any} */
    const settings = db.prepare('SELECT * FROM app_settings WHERE id = 1').get();
    if (!settings) return json({ error: 'App settings not configured' }, { status: 500 });

    /** @type {Record<string, { status: string, id?: number, error?: string }>} */
    const results = {};

    // Parse optional body for webhookUrl override
    /** @type {{ webhookUrl?: string }} */
    let body = {};
    try {
        body = await request.json();
    } catch {
        // No body or invalid JSON — that's fine
    }

    for (const svc of ['radarr', 'sonarr', 'lidarr']) {
        const svcUrl = settings[`${svc}_url`];
        const svcKey = settings[`${svc}_api_key`];
        if (!svcUrl || !svcKey) continue;

        try {
            // Check if a MediaJam webhook already exists
            /** @type {any[]} */
            const notifications = await arrFetch(svcUrl, svcKey, svc, 'notification');
            const existing = notifications.find((/** @type {any} */ n) => n.name === 'MediaJam');
            if (existing) {
                results[svc] = { status: 'exists', id: existing.id };
                console.log(`[arr-webhook] ✅ ${svc}: MediaJam webhook already exists (id=${existing.id})`);
                continue;
            }

            // Determine the webhook callback URL
            const baseUrl = body.webhookUrl || settings.external_url || reqUrl.origin;

            // Build the webhook notification payload
            const webhookBody = {
                name: 'MediaJam',
                implementation: 'Webhook',
                configContract: 'WebhookSettings',
                onGrab: true,
                onDownload: true,
                onImportComplete: true,
                onMovieAdded: svc === 'radarr',
                onMovieDelete: svc === 'radarr',
                onMovieFileDelete: svc === 'radarr',
                onSeriesAdd: svc === 'sonarr',
                onSeriesDelete: svc === 'sonarr',
                onEpisodeFileDelete: svc === 'sonarr',
                onAlbumDelete: svc === 'lidarr',
                onArtistDelete: svc === 'lidarr',
                onRename: true,
                onHealthIssue: true,
                includeHealthWarnings: true,
                fields: [
                    { name: 'url', value: `${baseUrl}/api/arr/webhook?service=${svc}` },
                    { name: 'method', value: 1 },
                ],
                tags: [],
            };

            /** @type {any} */
            const result = await arrFetch(svcUrl, svcKey, svc, 'notification', {
                method: 'POST',
                body: JSON.stringify(webhookBody),
            });

            results[svc] = { status: 'created', id: result.id };
            console.log(`[arr-webhook] 🔗 ${svc}: Created MediaJam webhook (id=${result.id})`);
        } catch (e) {
            const errorMsg = e instanceof Error ? e.message : String(e);
            results[svc] = { status: 'error', error: errorMsg };
            console.error(`[arr-webhook] ❌ ${svc}: Failed to setup webhook:`, errorMsg);
        }
    }

    return json({ success: true, results });
}
