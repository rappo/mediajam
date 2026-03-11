import { redirect, json } from '@sveltejs/kit';
import db from '$lib/server/db.js';

/**
 * GET /api/llm/openai/callback — Handle OpenAI OAuth callback.
 * Exchanges authorization code for tokens, stores in user_identities.
 * @type {import('./$types').RequestHandler}
 */
export async function GET({ url, locals }) {
    const code = url.searchParams.get('code');
    if (!code) {
        return json({ error: 'Missing authorization code.' }, { status: 400 });
    }

    const settings = /** @type {any} */ (db.prepare(
        'SELECT openai_client_id, openai_client_secret FROM app_settings WHERE id = 1'
    ).get());

    if (!settings?.openai_client_id || !settings?.openai_client_secret) {
        return json({ error: 'OpenAI client credentials not configured.' }, { status: 400 });
    }

    const redirectUri = `${url.origin}/api/llm/openai/callback`;

    try {
        const tokenRes = await fetch('https://auth.openai.com/oauth/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                code,
                client_id: settings.openai_client_id,
                client_secret: settings.openai_client_secret,
                redirect_uri: redirectUri,
                grant_type: 'authorization_code',
            }),
        });

        if (!tokenRes.ok) {
            const errorText = await tokenRes.text();
            console.error('[openai-oauth] Token exchange failed:', errorText);
            return json({ error: 'Token exchange failed.' }, { status: 502 });
        }

        const tokenData = await tokenRes.json();
        const accessToken = tokenData.access_token;
        const refreshToken = tokenData.refresh_token || null;
        const expiresIn = tokenData.expires_in;

        const user = locals.user;
        if (!user) {
            return json({ error: 'Not authenticated.' }, { status: 401 });
        }

        const expiresAt = expiresIn
            ? new Date(Date.now() + expiresIn * 1000).toISOString()
            : null;

        db.prepare(`
            INSERT INTO user_identities (user_id, provider, provider_uid, access_token, refresh_token, token_expires_at)
            VALUES (?, 'openai', 'oauth', ?, ?, ?)
            ON CONFLICT(user_id, provider) DO UPDATE SET
                access_token = excluded.access_token,
                refresh_token = excluded.refresh_token,
                token_expires_at = excluded.token_expires_at
        `).run(user.id, accessToken, refreshToken, expiresAt);

        // Set the LLM provider to openai
        db.prepare("UPDATE app_settings SET llm_provider = 'openai' WHERE id = 1").run();

        throw redirect(302, '/settings/admin?llm=openai-linked');
    } catch (e) {
        if (e instanceof Response || (e && typeof e === 'object' && 'status' in e)) throw e;
        console.error('[openai-oauth] OAuth error:', e);
        return json({ error: 'OAuth flow failed.' }, { status: 500 });
    }
}
