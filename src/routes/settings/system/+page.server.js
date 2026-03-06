import db from '$lib/server/db.js';

/** @type {import('./$types').PageServerLoad} */
export function load() {
    const settings = /** @type {any} */ (db.prepare('SELECT * FROM app_settings WHERE id = 1').get());
    const syncState = /** @type {any} */ (db.prepare('SELECT * FROM sync_state WHERE id = 1').get());
    const libraries = /** @type {any[]} */ (db.prepare('SELECT jellyfin_id, name, media_type FROM libraries WHERE is_tracked = 1').all());

    // Get latest sync history per type
    const syncHistory = /** @type {any[]} */ (db.prepare(`
        SELECT sh.* FROM sync_history sh
        INNER JOIN (SELECT sync_type, MAX(id) as max_id FROM sync_history GROUP BY sync_type) latest
        ON sh.id = latest.max_id
        ORDER BY sh.sync_type
    `).all());

    /** @type {Record<string, any>} */
    const historyByType = {};
    for (const h of syncHistory) {
        historyByType[h.sync_type] = {
            status: h.status,
            startedAt: h.started_at,
            finishedAt: h.finished_at,
            summary: h.summary
        };
    }

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
            jellyfinSyncCheck: settings?.jellyfin_sync_check ?? 1,
            ollamaUrl: settings?.ollama_url || '',
            ollamaEmbedModel: settings?.ollama_embed_model || 'nomic-embed-text',
            ollamaChatModel: settings?.ollama_chat_model || 'llama3.2:3b',
            // *arr integration
            radarrUrl: settings?.radarr_url || '',
            radarrApiKey: settings?.radarr_api_key ? '••••••••' : '',
            sonarrUrl: settings?.sonarr_url || '',
            sonarrApiKey: settings?.sonarr_api_key ? '••••••••' : '',
            lidarrUrl: settings?.lidarr_url || '',
            lidarrApiKey: settings?.lidarr_api_key ? '••••••••' : '',
        },
        syncState: {
            status: syncState?.status || 'idle',
            lastSync: syncState?.last_sync_timestamp
        },
        libraries,
        syncHistory: historyByType
    };
}
