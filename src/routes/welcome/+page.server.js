import db from '$lib/server/db.js';

/** @type {import('./$types').PageServerLoad} */
export function load() {
    const settings = /** @type {any} */ (db.prepare('SELECT * FROM app_settings WHERE id = 1').get());

    // Check sync_history to see if people/musicbrainz enrichment has ever run
    const peopleHistory = /** @type {any} */ (
        db.prepare("SELECT id FROM sync_history WHERE sync_type = 'people' LIMIT 1").get()
    );
    const mbHistory = /** @type {any} */ (
        db.prepare("SELECT id FROM sync_history WHERE sync_type = 'musicbrainz' LIMIT 1").get()
    );

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
            sonarrUrl: settings?.sonarr_url || '',
            sonarrApiKey: settings?.sonarr_api_key || '',
            lidarrUrl: settings?.lidarr_url || '',
            lidarrApiKey: settings?.lidarr_api_key || '',
        },
        hasPeopleSync: !!peopleHistory,
        hasMusicBrainzSync: !!mbHistory,
    };
}
