import { redirect } from '@sveltejs/kit';
import db from '$lib/server/db.js';
import { logInfo, logError } from '$lib/server/logger.js';

const OPENAI_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
const OPENAI_TOKEN_URL = 'https://auth.openai.com/oauth/token';

/**
 * GET /api/llm/openai/oauth/callback
 * Receives the authorization code from OpenAI, exchanges it for tokens,
 * stores them in app_settings, and redirects to Settings with a success message.
 * @type {import('./$types').RequestHandler}
 */
export async function GET({ url, cookies }) {
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    const error = url.searchParams.get('error');

    if (error) {
        const desc = url.searchParams.get('error_description') || error;
        logError('openai-oauth', `Authorization denied: ${desc}`);
        throw redirect(302, `/settings/admin?chatgpt_error=${encodeURIComponent(desc)}`);
    }

    if (!code || !state) {
        throw redirect(302, '/settings/admin?chatgpt_error=Missing+authorization+code');
    }

    // Retrieve PKCE verifier from cookie
    const cookieVal = cookies.get('openai_oauth');
    if (!cookieVal) {
        throw redirect(302, '/settings/admin?chatgpt_error=Session+expired.+Please+try+again.');
    }

    let oauthData;
    try {
        oauthData = JSON.parse(cookieVal);
    } catch {
        throw redirect(302, '/settings/admin?chatgpt_error=Invalid+session+data');
    }

    // Verify state matches (CSRF protection)
    if (oauthData.state !== state) {
        throw redirect(302, '/settings/admin?chatgpt_error=State+mismatch.+Please+try+again.');
    }

    // Clear the cookie
    cookies.delete('openai_oauth', { path: '/' });

    // Exchange authorization code for tokens
    const redirectUri = `${url.origin}/api/llm/openai/oauth/callback`;

    try {
        const tokenRes = await fetch(OPENAI_TOKEN_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                grant_type: 'authorization_code',
                client_id: OPENAI_CLIENT_ID,
                code,
                redirect_uri: redirectUri,
                code_verifier: oauthData.codeVerifier,
            }),
            signal: AbortSignal.timeout(15000),
        });

        if (!tokenRes.ok) {
            const errText = await tokenRes.text().catch(() => '');
            logError('openai-oauth', `Token exchange failed: HTTP ${tokenRes.status} — ${errText.slice(0, 200)}`);
            throw redirect(302, `/settings/admin?chatgpt_error=${encodeURIComponent(`Token exchange failed: HTTP ${tokenRes.status}`)}`);
        }

        const tokens = await tokenRes.json();
        const accessToken = tokens.access_token;
        const refreshToken = tokens.refresh_token || null;

        if (!accessToken) {
            throw redirect(302, '/settings/admin?chatgpt_error=No+access+token+returned');
        }

        // Store tokens and set provider to OpenAI
        db.prepare(`
            UPDATE app_settings
            SET codex_access_token = ?,
                codex_refresh_token = ?,
                llm_provider = 'openai'
            WHERE id = 1
        `).run(accessToken, refreshToken);

        logInfo('openai-oauth', 'ChatGPT OAuth tokens saved successfully');
        throw redirect(302, '/settings/admin?chatgpt_success=1');
    } catch (e) {
        // Re-throw redirects
        if (e && typeof e === 'object' && 'status' in e) throw e;

        logError('openai-oauth', `Token exchange error: ${e instanceof Error ? e.message : e}`);
        throw redirect(302, `/settings/admin?chatgpt_error=${encodeURIComponent('Token exchange failed')}`);
    }
}
