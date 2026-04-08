import { redirect, json } from '@sveltejs/kit';
import db from '$lib/server/db.js';

/**
 * GET /api/llm/gemini/callback — Handle Google OAuth2 callback.
 * Exchanges authorization code for tokens, stores in user_identities.
 * @type {import('./$types').RequestHandler}
 */
export async function GET({ url, locals }) {
    const code = url.searchParams.get('code');
    if (!code) {
        return json({ error: 'Missing authorization code.' }, { status: 400 });
    }

    const settings = /** @type {any} */ (db.prepare(
        'SELECT gemini_client_id, gemini_client_secret FROM app_settings WHERE id = 1'
    ).get());

    if (!settings?.gemini_client_id || !settings?.gemini_client_secret) {
        return json({ error: 'Google client credentials not configured.' }, { status: 400 });
    }

    const redirectUri = `${url.origin}/api/llm/gemini/callback`;

    try {
        const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                code,
                client_id: settings.gemini_client_id,
                client_secret: settings.gemini_client_secret,
                redirect_uri: redirectUri,
                grant_type: 'authorization_code',
            }),
        });

        if (!tokenRes.ok) {
            const errorText = await tokenRes.text();
            console.error('[gemini-oauth] Token exchange failed:', errorText);
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
            VALUES (?, 'gemini', 'oauth', ?, ?, ?)
            ON CONFLICT(user_id, provider) DO UPDATE SET
                access_token = excluded.access_token,
                refresh_token = excluded.refresh_token,
                token_expires_at = excluded.token_expires_at
        `).run(user.id, accessToken, refreshToken, expiresAt);

        // Set the LLM provider to gemini
        db.prepare("UPDATE app_settings SET llm_provider = 'gemini' WHERE id = 1").run();

        throw redirect(302, '/settings/admin?llm=gemini-linked');
    } catch (e) {
        if (e instanceof Response || (e && typeof e === 'object' && 'status' in e)) throw e;
        console.error('[gemini-oauth] OAuth error:', e);
        return json({ error: 'OAuth flow failed.' }, { status: 500 });
    }
}
