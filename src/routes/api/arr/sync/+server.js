import { syncArrService } from '$lib/server/arr-sync.js';
import db from '$lib/server/db.js';
import { json } from '@sveltejs/kit';
import { logError, logInfo } from '$lib/server/logger.js';
import { logActivity } from '$lib/server/activity-log.js';

/**
 * POST /api/arr/sync — trigger *arr sync on demand (SSE streaming).
 * Optional query param: ?service=radarr|sonarr|lidarr (syncs just one service)
 * Without query param: syncs all configured services.
 */
export async function POST({ locals, url }) {
    if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

    const settings = /** @type {any} */ (db.prepare(
        'SELECT radarr_url, radarr_api_key, sonarr_url, sonarr_api_key, lidarr_url, lidarr_api_key FROM app_settings WHERE id = 1'
    ).get());

    if (!settings) return json({ error: 'No settings found' }, { status: 400 });

    const allServices = [
        { service: 'radarr', url: settings.radarr_url, apiKey: settings.radarr_api_key },
        { service: 'sonarr', url: settings.sonarr_url, apiKey: settings.sonarr_api_key },
        { service: 'lidarr', url: settings.lidarr_url, apiKey: settings.lidarr_api_key },
    ].filter(s => s.url && s.apiKey);

    // Filter to single service if requested
    const requestedService = url.searchParams.get('service');
    const services = requestedService
        ? allServices.filter(s => s.service === requestedService)
        : allServices;

    if (services.length === 0) {
        const msg = requestedService
            ? `${requestedService} not configured`
            : 'No *arr services configured';
        return json({ error: msg }, { status: 400 });
    }

    const encoder = new TextEncoder();

    const stream = new ReadableStream({
        async start(controller) {
            /** @param {any} data */
            const send = (data) => {
                try {
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
                } catch { /* stream closed */ }
            };

            const time = () => new Date().toLocaleTimeString();
            const label = requestedService || 'all *arr';

            send({ log: `[${time()}] 📥 Starting ${label} sync...`, type: 'info' });
            logInfo('arr-sync', `On-demand sync started: ${services.map(s => s.service).join(', ')}`);



            for (const { service, url: svcUrl, apiKey } of services) {
                send({ log: `[${time()}] 📡 Syncing ${service}...`, type: 'info', service });

                try {
                    const result = await syncArrService(service, svcUrl, apiKey);
                    const parts = [`${result.matched} matched`];
                    if (result.created > 0) parts.push(`${result.created} created`);
                    parts.push(`${result.total} in ${service}`);
                    if (result.errors.length > 0) {
                        parts.push(`${result.errors.length} errors`);
                    }

                    send({
                        log: `[${time()}] ✅ ${service}: ${parts.join(', ')}`,
                        type: result.errors.length > 0 ? 'warning' : 'success',
                        service,
                        result,
                    });

                    if (result.errors.length > 0) {
                        for (const err of result.errors) {
                            send({ log: `[${time()}]    ⚠️ ${err}`, type: 'warning', service });
                        }
                    }
                } catch (e) {
                    const msg = e instanceof Error ? e.message : String(e);
                    send({ log: `[${time()}] ❌ ${service}: ${msg}`, type: 'error', service });
                    logError('arr-sync', `${service} failed: ${msg}`);
                }
            }

            send({ log: `[${time()}] ✅ Sync complete`, type: 'complete' });
            logInfo('arr-sync', 'On-demand sync complete');
            logActivity({ category: 'sync', action: 'arr_sync_completed', title: `*arr sync completed`, icon: '✅', status: 'success' });

            try { controller.close(); } catch { /* */ }
        }
    });

    return new Response(stream, {
        headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache, no-transform',
            'Connection': 'keep-alive',
            'X-Accel-Buffering': 'no',
            'X-Accel-Buffering': 'no'
        }
    });
}
