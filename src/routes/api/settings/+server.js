import { json } from '@sveltejs/kit';
import db from '$lib/server/db.js';

/** @type {import('./$types').RequestHandler} */
export async function GET() {
    const settings = db.prepare('SELECT * FROM app_settings WHERE id = 1').get();
    return json({
        jellyfinUrl: settings?.jellyfin_url || '',
        theme: settings?.theme || 'dark',
        includeSpecials: settings?.include_specials === 1,
        tvdbApiKey: settings?.tvdb_api_key ? '••••••••' : null,
        tmdbApiKey: settings?.tmdb_api_key ? '••••••••' : null,
        musicbrainzApiKey: settings?.musicbrainz_api_key ? '••••••••' : null,
        setupComplete: settings?.setup_complete === 1,
        jellyfinTimezone: settings?.jellyfin_timezone || '',
        heartBorderMovies: settings?.heart_border_movies !== 0,
        heartBorderShows: settings?.heart_border_shows !== 0,
        heartBorderMusic: settings?.heart_border_music !== 0,
        heartBorderPeople: settings?.heart_border_people !== 0,
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
        // LLM provider
        llmProvider: settings?.llm_provider || 'ollama',
        llmApiKey: settings?.llm_api_key ? '••••••••' : '',
        llmApiUrl: settings?.llm_api_url || '',
        llmChatModel: settings?.llm_chat_model || '',
        llmEmbedProvider: settings?.llm_embed_provider || 'ollama',
        llmEmbedModel: settings?.llm_embed_model || '',
        // Per-provider key indicators
        hasOpenaiKey: !!settings?.openai_api_key,
        hasGeminiKey: !!settings?.gemini_api_key,
        hasClaudeKey: !!settings?.claude_api_key,
        hasKimiKey: !!settings?.kimi_api_key,
    });
}

/** @type {import('./$types').RequestHandler} */
export async function PUT({ request }) {
    const data = await request.json();

    try {
        const fields = [];
        const values = [];

        const allowedFields = {
            jellyfin_url: 'jellyfin_url',
            theme: 'theme',
            tvdb_api_key: 'tvdb_api_key',
            tmdb_api_key: 'tmdb_api_key',
            musicbrainz_api_key: 'musicbrainz_api_key',
            include_specials: 'include_specials',
            setup_complete: 'setup_complete',
            trakt_client_id: 'trakt_client_id',
            trakt_client_secret: 'trakt_client_secret',
            lastfm_api_key: 'lastfm_api_key',
            lastfm_shared_secret: 'lastfm_shared_secret',
            jellyfin_pr_db_path: 'jellyfin_pr_db_path',
            jellyfin_timezone: 'jellyfin_timezone',
            jellyfin_sync_check: 'jellyfin_sync_check',
            heart_border_movies: 'heart_border_movies',
            heart_border_shows: 'heart_border_shows',
            heart_border_music: 'heart_border_music',
            heart_border_people: 'heart_border_people',
            ollama_url: 'ollama_url',
            ollama_embed_model: 'ollama_embed_model',
            ollama_chat_model: 'ollama_chat_model',
            // *arr integration
            radarr_url: 'radarr_url',
            radarr_api_key: 'radarr_api_key',
            radarr_external_url: 'radarr_external_url',
            sonarr_url: 'sonarr_url',
            sonarr_api_key: 'sonarr_api_key',
            sonarr_external_url: 'sonarr_external_url',
            lidarr_url: 'lidarr_url',
            lidarr_api_key: 'lidarr_api_key',
            lidarr_external_url: 'lidarr_external_url',
            // External ratings
            omdb_api_key: 'omdb_api_key',
            discogs_token: 'discogs_token',
            // Fanart.tv
            fanart_api_key: 'fanart_api_key',
            // Database backups
            db_backup_count: 'db_backup_count',
            // Welcome flow
            welcome_complete: 'welcome_complete',
            // LLM provider
            llm_provider: 'llm_provider',
            llm_api_key: 'llm_api_key',
            llm_api_url: 'llm_api_url',
            llm_chat_model: 'llm_chat_model',
            llm_embed_provider: 'llm_embed_provider',
            llm_embed_model: 'llm_embed_model',
            // Per-provider API keys
            openai_api_key: 'openai_api_key',
            gemini_api_key: 'gemini_api_key',
            claude_api_key: 'claude_api_key',
            kimi_api_key: 'kimi_api_key',
            // OAuth client IDs
            openai_client_id: 'openai_client_id',
            openai_client_secret: 'openai_client_secret',
            gemini_client_id: 'gemini_client_id',
            gemini_client_secret: 'gemini_client_secret',
        };

        for (const [key, column] of Object.entries(allowedFields)) {
            if (key in data) {
                fields.push(`${column} = ?`);
                values.push(data[key]);
            }
        }

        if (fields.length === 0) {
            return json({ success: false, error: 'No valid fields to update.' });
        }

        values.push(1); // WHERE id = 1
        db.prepare(`UPDATE app_settings SET ${fields.join(', ')} WHERE id = ?`).run(...values);

        return json({ success: true });
    } catch (e) {
        console.error('Settings update error:', e);
        return json({ success: false, error: 'Failed to update settings.' });
    }
}
