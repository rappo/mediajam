import db from '$lib/server/db.js';
import { arrFetch } from '$lib/server/arr-client.js';
import { json } from '@sveltejs/kit';

/**
 * GET /api/arr/[service]/defaults — Get download defaults for a service.
 * Returns quality profiles, root folders, and saved defaults from settings.
 */
export async function GET({ params, locals }) {
    if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
    const service = params.service;
    if (!['radarr', 'sonarr', 'lidarr'].includes(service)) {
        return json({ error: 'Invalid service' }, { status: 400 });
    }

    const settings = /** @type {any} */ (db.prepare(`
        SELECT ${service}_url as url, ${service}_api_key as apiKey,
               ${service}_quality_profile_id as defaultQualityProfileId,
               ${service}_root_folder as defaultRootFolder,
               ${service}_default_monitor as defaultMonitor,
               ${service}_skip_add_dialog as skipDialog
        FROM app_settings WHERE id = 1
    `).get());

    if (!settings?.url || !settings?.apiKey) {
        return json({ error: `${service} not configured` }, { status: 400 });
    }

    // Fetch profiles and root folders from the service
    let profiles = [];
    let rootFolders = [];
    try {
        profiles = await arrFetch(settings.url, settings.apiKey, service, 'qualityprofile');
        rootFolders = await arrFetch(settings.url, settings.apiKey, service, 'rootfolder');
    } catch (e) {
        return json({ error: e instanceof Error ? e.message : 'Failed to connect' }, { status: 500 });
    }

    return json({
        profiles: profiles.map(/** @param {any} p */ (p) => ({ id: p.id, name: p.name })),
        rootFolders: rootFolders.map(/** @param {any} r */ (r) => ({ path: r.path, freeSpace: r.freeSpace })),
        defaultQualityProfileId: settings.defaultQualityProfileId || profiles[0]?.id || null,
        defaultRootFolder: settings.defaultRootFolder || rootFolders[0]?.path || null,
        defaultMonitor: settings.defaultMonitor || (service === 'radarr' ? 'movieOnly' : 'all'),
        skipDialog: !!settings.skipDialog,
    });
}
