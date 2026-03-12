/**
 * POST /api/llm/openai/oauth/callback
 * 
 * Polls for device code completion. Called by the Settings UI on an interval.
 * Body: { user_code }
 * 
 * Returns:
 *   { status: 'pending' }  — user hasn't entered the code yet
 *   { status: 'complete' } — tokens saved, provider switched to openai
 *   { status: 'error', error: '...' } — something went wrong
 */
import { json } from '@sveltejs/kit';
import { logInfo, logError } from '$lib/server/logger.js';
import db from '$lib/server/db.js';
import { activeSessions, OPENAI_CLIENT_ID, OPENAI_ISSUER } from '../authorize/+server.js';

/** @type {import('./$types').RequestHandler} */
export async function POST({ request }) {
    const { user_code } = await request.json();
    if (!user_code) {
        return json({ status: 'error', error: 'Missing user_code' }, { status: 400 });
    }

    const session = activeSessions.get(user_code);
    if (!session) {
        return json({ status: 'error', error: 'Session expired or not found. Please start over.' }, { status: 404 });
    }

    try {
        // Poll OpenAI's device auth token endpoint
        const resp = await fetch(`${OPENAI_ISSUER}/api/accounts/deviceauth/token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                device_auth_id: session.device_auth_id,
                user_code: session.user_code,
            }),
        });

        // 403/404 = user hasn't authorized yet
        if (resp.status === 403 || resp.status === 404) {
            // Check timeout (15 minutes)
            if (Date.now() - session.started > 15 * 60 * 1000) {
                activeSessions.delete(user_code);
                return json({ status: 'error', error: 'Device code expired. Please start over.' });
            }
            return json({ status: 'pending' });
        }

        if (!resp.ok) {
            const text = await resp.text();
            logError('chatgpt-oauth', `Device token poll failed: ${resp.status} ${text}`);
            activeSessions.delete(user_code);
            return json({ status: 'error', error: `OpenAI returned ${resp.status}` });
        }

        // Success — we get an authorization_code + PKCE codes
        const data = await resp.json();
        const { authorization_code, code_challenge, code_verifier } = data;

        if (!authorization_code) {
            logError('chatgpt-oauth', `No authorization_code in response: ${JSON.stringify(data)}`);
            activeSessions.delete(user_code);
            return json({ status: 'error', error: 'No authorization_code returned' });
        }

        logInfo('chatgpt-oauth', 'Device code authorized, exchanging for tokens...');

        // Step 2: Exchange authorization code for tokens
        const redirect_uri = `${OPENAI_ISSUER}/deviceauth/callback`;
        const tokenResp = await fetch(`${OPENAI_ISSUER}/api/accounts/oauth/token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                grant_type: 'authorization_code',
                client_id: OPENAI_CLIENT_ID,
                code: authorization_code,
                redirect_uri,
                code_verifier: code_verifier || '',
            }),
        });

        if (!tokenResp.ok) {
            const text = await tokenResp.text();
            logError('chatgpt-oauth', `Token exchange failed: ${tokenResp.status} ${text}`);
            activeSessions.delete(user_code);
            return json({ status: 'error', error: `Token exchange failed: ${tokenResp.status}` });
        }

        const tokens = await tokenResp.json();
        const { access_token, refresh_token } = tokens;

        if (!access_token) {
            logError('chatgpt-oauth', `No access_token in response: ${JSON.stringify(Object.keys(tokens))}`);
            activeSessions.delete(user_code);
            return json({ status: 'error', error: 'No access_token returned' });
        }

        // Step 3: Save to database
        db.prepare('UPDATE app_settings SET codex_access_token = ?, codex_refresh_token = ?, llm_provider = ? WHERE id = 1')
            .run(access_token, refresh_token || '', 'openai');

        logInfo('chatgpt-oauth', 'ChatGPT tokens saved successfully, provider set to openai');
        activeSessions.delete(user_code);

        return json({ status: 'complete' });

    } catch (err) {
        logError('chatgpt-oauth', `Poll error: ${err}`);
        activeSessions.delete(user_code);
        return json({ status: 'error', error: String(err) });
    }
}
