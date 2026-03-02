import { redirect } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import db from '$lib/server/db.js';

/**
 * GET /api/spokes/lastfm — Redirect to Last.fm authentication page.
 * Last.fm uses a simpler web auth flow (not full OAuth2).
 * @type {import('./$types').RequestHandler}
 */
export async function GET({ url }) {
    const settings = /** @type {any} */ (db.prepare(
        'SELECT lastfm_api_key FROM app_settings WHERE id = 1'
    ).get());

    if (!settings?.lastfm_api_key) {
        return json({ error: 'Last.fm API key not configured in Settings.' }, { status: 400 });
    }

    const callbackUrl = `${url.origin}/api/spokes/lastfm/callback`;
    const authUrl = `https://www.last.fm/api/auth/?api_key=${settings.lastfm_api_key}&cb=${encodeURIComponent(callbackUrl)}`;

    throw redirect(302, authUrl);
}
