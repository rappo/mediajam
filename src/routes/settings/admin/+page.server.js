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

    // Compute pending/unsynced counts per sync type
    const lastJellyfinSync = historyByType.jellyfin?.finishedAt || syncState?.last_sync_timestamp || null;
    const jellyfinPending = lastJellyfinSync
        ? /** @type {any} */ (db.prepare(`SELECT COUNT(*) as cnt FROM media_parents WHERE date_last_modified > ?`).get(lastJellyfinSync))?.cnt || 0
        : /** @type {any} */ (db.prepare(`SELECT COUNT(*) as cnt FROM media_parents WHERE jellyfin_id IS NULL`).get())?.cnt || 0;

    const peoplePending = /** @type {any} */ (db.prepare(`
        SELECT COUNT(*) as cnt FROM persons
        WHERE tmdb_person_id IS NOT NULL AND tmdb_person_id != ''
        AND tmdb_enriched_at IS NULL
    `).get())?.cnt || 0;

    // MusicBrainz enrichment: artists with MBID + collected albums that haven't been enriched yet
    const mbPending = /** @type {any} */ (db.prepare(`
        SELECT COUNT(*) as cnt FROM media_parents mp
        WHERE mp.media_type = 'artist'
          AND mp.musicbrainz_id IS NOT NULL AND mp.musicbrainz_id != ''
          AND mp.collected_children > 0
          AND mp.mb_enriched_at IS NULL
    `).get())?.cnt || 0;

    const wikiMediaPending = /** @type {any} */ (db.prepare(`
        SELECT COUNT(*) as cnt FROM media_parents
        WHERE media_type IN ('movie','show','artist')
        AND (
            (media_type IN ('movie','show') AND tmdb_id IS NOT NULL)
            OR (media_type = 'artist' AND musicbrainz_id IS NOT NULL)
        )
        AND wikipedia_fetched_at IS NULL
    `).get())?.cnt || 0;
    const wikiPersonPending = /** @type {any} */ (db.prepare(`
        SELECT COUNT(*) as cnt FROM persons
        WHERE tmdb_person_id IS NOT NULL AND wikipedia_fetched_at IS NULL
    `).get())?.cnt || 0;
    const wikiPending = wikiMediaPending + wikiPersonPending;

    // Load API keys
    const apiKeys = /** @type {any[]} */ (db.prepare(`
        SELECT ak.id, ak.name, ak.key_prefix, ak.permissions, ak.last_used_at,
               ak.created_at, ak.expires_at, u.username as owner
        FROM api_keys ak
        JOIN users u ON ak.user_id = u.id
        ORDER BY ak.created_at DESC
    `).all()).map(k => ({
        ...k,
        permissions: JSON.parse(k.permissions || '[]')
    }));

    const backdropsPending = /** @type {any} */ (db.prepare(`
        SELECT COUNT(*) as cnt FROM media_parents
        WHERE backdrop_fetched_at IS NULL
        AND (
            (media_type IN ('movie', 'show') AND tmdb_id IS NOT NULL)
            OR (media_type = 'artist' AND musicbrainz_id IS NOT NULL)
        )
    `).get())?.cnt || 0;

    return {
        syncPending: {
            jellyfin: jellyfinPending,
            people: peoplePending,
            musicbrainz: mbPending,
            wikipedia: wikiPending,
            backdrops: backdropsPending
        },
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
            // LLM provider
            llmProvider: settings?.llm_provider || 'ollama',
            llmApiKey: settings?.llm_api_key ? '••••••••' : '',
            llmApiUrl: settings?.llm_api_url || '',
            llmChatModel: settings?.llm_chat_model || '',
            llmEmbedProvider: settings?.llm_embed_provider || 'ollama',
            llmEmbedModel: settings?.llm_embed_model || '',
            hasOpenaiClientId: !!settings?.openai_client_id,
            hasGeminiClientId: !!settings?.gemini_client_id,
            hasCodexAuth: !!settings?.codex_access_token,
            // *arr integration
            radarrUrl: settings?.radarr_url || '',
            radarrApiKey: settings?.radarr_api_key ? '••••••••' : '',
            radarrExternalUrl: settings?.radarr_external_url || '',
            sonarrUrl: settings?.sonarr_url || '',
            sonarrApiKey: settings?.sonarr_api_key ? '••••••••' : '',
            sonarrExternalUrl: settings?.sonarr_external_url || '',
            lidarrUrl: settings?.lidarr_url || '',
            lidarrApiKey: settings?.lidarr_api_key ? '••••••••' : '',
            lidarrExternalUrl: settings?.lidarr_external_url || '',
            // External ratings
            omdbApiKey: settings?.omdb_api_key ? '••••••••' : '',
            discogsToken: settings?.discogs_token ? '••••••••' : '',
            // Fanart.tv
            fanartApiKey: settings?.fanart_api_key ? '••••••••' : '',
            // Database backups
            dbBackupCount: settings?.db_backup_count ?? 2,
        },
        syncState: {
            status: syncState?.status || 'idle',
            lastSync: syncState?.last_sync_timestamp
        },
        libraries,
        syncHistory: historyByType,
        apiKeys
    };
}
