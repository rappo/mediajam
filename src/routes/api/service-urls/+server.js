import db from '$lib/server/db.js';
import { json } from '@sveltejs/kit';

/**
 * GET /api/service-urls — Return external URLs for configured services (for sidebar links).
 */
export async function GET({ locals }) {
    if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

    const settings = /** @type {any} */ (db.prepare(`
        SELECT jellyfin_url, jellyfin_external_url,
               radarr_url, radarr_external_url,
               sonarr_url, sonarr_external_url,
               lidarr_url, lidarr_external_url
        FROM app_settings WHERE id = 1
    `).get());

    return json({
        jellyfin: settings?.jellyfin_external_url || settings?.jellyfin_url || null,
        sonarr: settings?.sonarr_external_url || settings?.sonarr_url || null,
        radarr: settings?.radarr_external_url || settings?.radarr_url || null,
        lidarr: settings?.lidarr_external_url || settings?.lidarr_url || null,
    });
}
