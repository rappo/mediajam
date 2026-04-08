import db from '$lib/server/db.js';

/** @type {import('./$types').PageServerLoad} */
export function load({ locals }) {
    if (!locals.user?.isAdmin) {
        return { settings: {} };
    }

    const row = /** @type {any} */ (
        db.prepare('SELECT radarr_url, sonarr_url, lidarr_url FROM app_settings WHERE id = 1').get()
    );

    return {
        settings: {
            radarrUrl: row?.radarr_url || '',
            sonarrUrl: row?.sonarr_url || '',
            lidarrUrl: row?.lidarr_url || '',
        },
    };
}
