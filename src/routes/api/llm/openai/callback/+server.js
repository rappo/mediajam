import { redirect, json } from '@sveltejs/kit';
import db from '$lib/server/db.js';

/**
 * GET /api/llm/openai/callback — Handle Codex OAuth callback.
 * Exchanges authorization code + PKCE verifier for tokens.
 */

const OPENAI_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
const TOKEN_URL = 'https://auth.openai.com/oauth/token';

/** @type {import('./$types').RequestHandler} */
export async function GET({ url }) {
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');

    if (!code || !state) {
        return json({ error: 'Missing authorization code or state.' }, { status: 400 });
    }

    // Get pkceStore from shared module
    const { pkceStore } = await import('$lib/server/openai-pkce.js');

    const pkceEntry = pkceStore.get(state);
    if (!pkceEntry) {
        return json({ error: 'Invalid or expired state. Please try signing in again.' }, { status: 400 });
    }

    // Remove used entry
    pkceStore.delete(state);

    const redirectUri = `${url.origin}/api/llm/openai/callback`;

    try {
        // Exchange authorization code for tokens (PKCE — no client secret needed)
        const tokenRes = await fetch(TOKEN_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                grant_type: 'authorization_code',
                client_id: OPENAI_CLIENT_ID,
                code,
                redirect_uri: redirectUri,
                code_verifier: pkceEntry.verifier,
            }),
        });

        if (!tokenRes.ok) {
            const errorText = await tokenRes.text();
            console.error('[openai-oauth] Token exchange failed:', errorText);
            return json({ error: 'Token exchange failed. Please try again.' }, { status: 502 });
        }

        const tokenData = await tokenRes.json();
        const accessToken = tokenData.access_token;
        const refreshToken = tokenData.refresh_token || null;
        const expiresIn = tokenData.expires_in;

        if (!accessToken) {
            console.error('[openai-oauth] No access_token in response:', JSON.stringify(tokenData).slice(0, 200));
            return json({ error: 'No access token received.' }, { status: 502 });
        }

        const expiresAt = expiresIn
            ? new Date(Date.now() + expiresIn * 1000).toISOString()
            : null;

        // Store in user_identities
        db.prepare(`
            INSERT INTO user_identities (user_id, provider, provider_uid, access_token, refresh_token, token_expires_at)
            VALUES (?, 'openai', 'codex-oauth', ?, ?, ?)
            ON CONFLICT(user_id, provider) DO UPDATE SET
                provider_uid = 'codex-oauth',
                access_token = excluded.access_token,
                refresh_token = excluded.refresh_token,
                token_expires_at = excluded.token_expires_at
        `).run(pkceEntry.userId, accessToken, refreshToken, expiresAt);

        // Set the LLM provider to openai
        db.prepare("UPDATE app_settings SET llm_provider = 'openai' WHERE id = 1").run();

        console.log('[openai-oauth] Codex OAuth sign-in successful');
        throw redirect(302, '/settings/admin?llm=openai-linked');
    } catch (e) {
        if (e instanceof Response || (e && typeof e === 'object' && 'status' in e)) throw e;
        console.error('[openai-oauth] OAuth error:', e);
        return json({ error: 'OAuth flow failed.' }, { status: 500 });
    }
}
