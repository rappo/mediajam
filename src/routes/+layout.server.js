import db from '$lib/server/db.js';

/** @type {import('./$types').LayoutServerLoad} */
export function load({ locals }) {
    const settings = db.prepare('SELECT * FROM app_settings WHERE id = 1').get();
    const syncState = db.prepare('SELECT * FROM sync_state WHERE id = 1').get();

    return {
        theme: locals.theme || 'dark',
        isSetupComplete: locals.isSetupComplete || false,
        settings: {
            jellyfinUrl: settings?.jellyfin_url || '',
            theme: settings?.theme || 'dark',
            includeSpecials: settings?.include_specials === 1,
            hasTvdbKey: !!settings?.tvdb_api_key,
            hasTmdbKey: !!settings?.tmdb_api_key,
            hasMusicbrainzKey: !!settings?.musicbrainz_api_key
        },
        syncState: {
            status: syncState?.status || 'idle',
            progressPercent: syncState?.progress_percent || 0,
            lastSync: syncState?.last_sync_timestamp
        }
    };
}
