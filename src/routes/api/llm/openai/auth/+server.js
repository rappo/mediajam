import { redirect } from '@sveltejs/kit';
import db from '$lib/server/db.js';

/**
 * GET /api/llm/openai/auth — Start OpenAI OAuth flow.
 * Redirects user to OpenAI's authorization page.
 * @type {import('./$types').RequestHandler}
 */
export async function GET({ url, locals }) {
    if (!locals.user) return new Response('Unauthorized', { status: 401 });

    const settings = /** @type {any} */ (db.prepare(
        'SELECT openai_client_id FROM app_settings WHERE id = 1'
    ).get());

    if (!settings?.openai_client_id) {
        return new Response('OpenAI client ID not configured. Go to Settings → Admin to set it up.', { status: 400 });
    }

    const redirectUri = `${url.origin}/api/llm/openai/callback`;
    const state = `${locals.user.id}:${Date.now()}`;

    const authUrl = new URL('https://auth.openai.com/authorize');
    authUrl.searchParams.set('client_id', settings.openai_client_id);
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('scope', 'openai.organization.read openai.chat.completions.write openai.embeddings.write');
    authUrl.searchParams.set('state', state);

    throw redirect(302, authUrl.toString());
}
