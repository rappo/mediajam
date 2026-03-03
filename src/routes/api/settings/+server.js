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
        setupComplete: settings?.setup_complete === 1
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
            jellyfin_sync_check: 'jellyfin_sync_check'
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
