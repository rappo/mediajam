import db from '$lib/server/db.js';

/** @type {import('./$types').PageServerLoad} */
export function load({ locals }) {
    const settings = /** @type {any} */ (db.prepare('SELECT * FROM app_settings WHERE id = 1').get());

    // Check sync_history to see if people/musicbrainz enrichment has ever run
    let peopleHistory = null;
    let mbHistory = null;
    try {
        peopleHistory = db.prepare("SELECT id FROM sync_history WHERE sync_type = 'people' LIMIT 1").get();
        mbHistory = db.prepare("SELECT id FROM sync_history WHERE sync_type = 'musicbrainz' LIMIT 1").get();
    } catch { /* table may not exist yet */ }

    // Connected services (Trakt/Last.fm OAuth)
    const userId = locals.user?.id;
    let connectedServices = { trakt: null, lastfm: null };
    let autoSync = { trakt: false, lastfm: false };
    if (userId) {
        try {
            const traktConn = /** @type {any} */ (
                db.prepare("SELECT * FROM connected_services WHERE user_id = ? AND provider = 'trakt'").get(userId)
            );
            const lastfmConn = /** @type {any} */ (
                db.prepare("SELECT * FROM connected_services WHERE user_id = ? AND provider = 'lastfm'").get(userId)
            );
            connectedServices = { trakt: traktConn || null, lastfm: lastfmConn || null };
        } catch { /* table may not exist yet */ }

        try {
            const traktIdentity = /** @type {any} */ (
                db.prepare("SELECT auto_sync FROM user_identities WHERE user_id = ? AND provider = 'trakt'").get(userId)
            );
            const lastfmIdentity = /** @type {any} */ (
                db.prepare("SELECT auto_sync FROM user_identities WHERE user_id = ? AND provider = 'lastfm'").get(userId)
            );
            autoSync = {
                trakt: !!(traktIdentity?.auto_sync),
                lastfm: !!(lastfmIdentity?.auto_sync),
            };
        } catch { /* table may not exist yet */ }
    }

    // Import stats
    let importStats = { trakt: null, lastfm: null };
    if (userId) {
        try {
            const traktStats = /** @type {any} */ (db.prepare(`
                SELECT COUNT(*) as playCount,
                       MIN(timestamp) as earliest,
                       MAX(timestamp) as latest
                FROM playback_history WHERE source = 'trakt' AND user_id = ?
            `).get(userId));
            if (traktStats?.playCount > 0) {
                importStats.trakt = traktStats;
            }
            const lastfmStats = /** @type {any} */ (db.prepare(`
                SELECT COUNT(*) as playCount,
                       MIN(timestamp) as earliest,
                       MAX(timestamp) as latest
                FROM playback_history WHERE source = 'lastfm' AND user_id = ?
            `).get(userId));
            if (lastfmStats?.playCount > 0) {
                importStats.lastfm = lastfmStats;
            }
        } catch { /* table may not exist on fresh install */ }
    }

    return {
        settings: {
            tvdbApiKey: settings?.tvdb_api_key || '',
            tmdbApiKey: settings?.tmdb_api_key || '',
            musicbrainzApiKey: settings?.musicbrainz_api_key || '',
            omdbApiKey: settings?.omdb_api_key || '',
            discogsToken: settings?.discogs_token || '',
            traktClientId: settings?.trakt_client_id || '',
            traktClientSecret: settings?.trakt_client_secret || '',
            lastfmApiKey: settings?.lastfm_api_key || '',
            lastfmSharedSecret: settings?.lastfm_shared_secret || '',
            ollamaUrl: settings?.ollama_url || '',
            ollamaEmbedModel: settings?.ollama_embed_model || 'nomic-embed-text',
            ollamaChatModel: settings?.ollama_chat_model || 'llama3.2:3b',
            radarrUrl: settings?.radarr_url || '',
            radarrApiKey: settings?.radarr_api_key || '',
            radarrExternalUrl: settings?.radarr_external_url || '',
            sonarrUrl: settings?.sonarr_url || '',
            sonarrApiKey: settings?.sonarr_api_key || '',
            sonarrExternalUrl: settings?.sonarr_external_url || '',
            lidarrUrl: settings?.lidarr_url || '',
            lidarrApiKey: settings?.lidarr_api_key || '',
            lidarrExternalUrl: settings?.lidarr_external_url || '',
        },
        hasPeopleSync: !!peopleHistory,
        hasMusicBrainzSync: !!mbHistory,
        connectedServices,
        autoSync,
        appCredentials: {
            hasTraktCreds: !!(settings?.trakt_client_id && settings?.trakt_client_secret),
            hasLastfmCreds: !!(settings?.lastfm_api_key && settings?.lastfm_shared_secret),
        },
        importStats,
    };
}
