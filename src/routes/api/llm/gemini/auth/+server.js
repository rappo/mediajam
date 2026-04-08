import { redirect } from '@sveltejs/kit';
import db from '$lib/server/db.js';

/**
 * GET /api/llm/gemini/auth — Start Google OAuth2 flow.
 * Redirects user to Google's consent screen.
 * @type {import('./$types').RequestHandler}
 */
export async function GET({ url, locals }) {
    if (!locals.user) return new Response('Unauthorized', { status: 401 });

    const settings = /** @type {any} */ (db.prepare(
        'SELECT gemini_client_id FROM app_settings WHERE id = 1'
    ).get());

    if (!settings?.gemini_client_id) {
        return new Response('Google client ID not configured. Go to Settings → Admin to set it up.', { status: 400 });
    }

    const redirectUri = `${url.origin}/api/llm/gemini/callback`;
    const state = `${locals.user.id}:${Date.now()}`;

    const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    authUrl.searchParams.set('client_id', settings.gemini_client_id);
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('scope', 'https://www.googleapis.com/auth/generative-language');
    authUrl.searchParams.set('access_type', 'offline');
    authUrl.searchParams.set('prompt', 'consent');
    authUrl.searchParams.set('state', state);

    throw redirect(302, authUrl.toString());
}
