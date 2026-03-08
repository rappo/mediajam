import db, { getBootWarnings } from '$lib/server/db.js';
import { getUnreadCount } from '$lib/server/activity-log.js';

/** @type {import('./$types').LayoutServerLoad} */
export function load({ locals }) {
    const settings = db.prepare('SELECT * FROM app_settings WHERE id = 1').get();
    const syncState = db.prepare('SELECT * FROM sync_state WHERE id = 1').get();
    const libraries = db.prepare('SELECT jellyfin_id, name, media_type FROM libraries WHERE is_tracked = 1').all();

    // Use authenticated user from session (set by hooks.server.js)
    const user = locals.user || null;

    // Load user preferences
    let userPreferences = {};
    if (user) {
        const userRow = /** @type {any} */ (db.prepare('SELECT preferences FROM users WHERE id = ?').get(user.id));
        try { userPreferences = userRow?.preferences ? JSON.parse(userRow.preferences) : {}; } catch { /* empty */ }
    }

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
            hasMusicbrainzKey: !!settings?.musicbrainz_api_key,
            heartBorderMovies: settings?.heart_border_movies !== 0,
            heartBorderShows: settings?.heart_border_shows !== 0,
            heartBorderMusic: settings?.heart_border_music !== 0,
            heartBorderPeople: settings?.heart_border_people !== 0
        },
        syncState: {
            status: syncState?.status || 'idle',
            progressPercent: syncState?.progress_percent || 0,
            lastSync: syncState?.last_sync_timestamp
        },
        libraries,
        remoteControlEnabled: !!userPreferences.remoteControlEnabled,
        userPreferences,
        bootWarnings: getBootWarnings(),
        pendingConflicts: /** @type {any} */ (db.prepare('SELECT COUNT(*) as count FROM sync_conflicts WHERE status = ?').get('pending'))?.count || 0,
        showWelcome: (settings?.setup_complete === 1 && !settings?.welcome_complete),
        jellyfinAuthInvalid: settings?.jellyfin_auth_status === 'invalid',
        activityUnread: getUnreadCount()
    };
}
