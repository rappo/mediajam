import db from '$lib/server/db.js';

/** @type {import('./$types').PageServerLoad} */
export function load() {
    const settings = /** @type {any} */ (db.prepare('SELECT * FROM app_settings WHERE id = 1').get());
    const syncState = /** @type {any} */ (db.prepare('SELECT * FROM sync_state WHERE id = 1').get());
    const libraries = /** @type {any[]} */ (db.prepare('SELECT jellyfin_id, name, media_type FROM libraries WHERE is_tracked = 1').all());

    return {
        settings: {
            jellyfinUrl: settings?.jellyfin_url || '',
            hasTvdbKey: !!settings?.tvdb_api_key,
            hasTmdbKey: !!settings?.tmdb_api_key,
            hasMusicbrainzKey: !!settings?.musicbrainz_api_key,
            hasTraktClientId: !!settings?.trakt_client_id,
            hasTraktClientSecret: !!settings?.trakt_client_secret,
            hasLastfmApiKey: !!settings?.lastfm_api_key,
            hasLastfmSharedSecret: !!settings?.lastfm_shared_secret,
            jellyfinPrDbPath: settings?.jellyfin_pr_db_path || '',
            jellyfinSyncCheck: settings?.jellyfin_sync_check ?? 1
        },
        syncState: {
            status: syncState?.status || 'idle',
            lastSync: syncState?.last_sync_timestamp
        },
        libraries
    };
}
