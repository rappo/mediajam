import { redirect } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import db from '$lib/server/db.js';

/**
 * GET /api/spokes/trakt — Redirect to Trakt OAuth authorization URL.
 * @type {import('./$types').RequestHandler}
 */
export async function GET({ url }) {
    const settings = /** @type {any} */ (db.prepare(
        'SELECT trakt_client_id FROM app_settings WHERE id = 1'
    ).get());

    if (!settings?.trakt_client_id) {
        return json({ error: 'Trakt Client ID not configured in Settings.' }, { status: 400 });
    }

    const redirectUri = `${url.origin}/api/spokes/trakt/callback`;
    const authUrl = `https://trakt.tv/oauth/authorize?response_type=code&client_id=${settings.trakt_client_id}&redirect_uri=${encodeURIComponent(redirectUri)}`;

    throw redirect(302, authUrl);
}
