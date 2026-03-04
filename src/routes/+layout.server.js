import db from '$lib/server/db.js';

/** @type {import('./$types').LayoutServerLoad} */
export function load({ locals }) {
    const settings = db.prepare('SELECT * FROM app_settings WHERE id = 1').get();
    const syncState = db.prepare('SELECT * FROM sync_state WHERE id = 1').get();
    const libraries = db.prepare('SELECT jellyfin_id, name, media_type FROM libraries WHERE is_tracked = 1').all();

    // Use authenticated user from session (set by hooks.server.js)
    const user = locals.user || null;

    return {
        theme: locals.theme || 'dark',
        isSetupComplete: locals.isSetupComplete || false,
        user: user ? { id: user.id, username: user.username, isAdmin: user.isAdmin, avatarUrl: user.avatarUrl } : null,
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
        },
        libraries
    };
}
