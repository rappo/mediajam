/**
 * POST /api/llm/openai/oauth/authorize
 * 
 * Starts the ChatGPT device code auth flow.
 * Returns { user_code, verification_url } for the UI to display.
 * Stores the device_auth_id in a server-side map for later polling.
 */
import { json } from '@sveltejs/kit';
import { logInfo, logError } from '$lib/server/logger.js';

const OPENAI_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
const OPENAI_ISSUER = 'https://auth.openai.com';

// Server-side store for active device auth sessions (keyed by user_code)
/** @type {Map<string, {device_auth_id: string, user_code: string, interval: number, started: number}>} */
const activeSessions = new Map();

// Clean up stale sessions older than 20 minutes
function cleanupStaleSessions() {
    const now = Date.now();
    for (const [key, session] of activeSessions) {
        if (now - session.started > 20 * 60 * 1000) {
            activeSessions.delete(key);
        }
    }
}

/** @type {import('./$types').RequestHandler} */
export async function GET() {
    cleanupStaleSessions();

    try {
        // Step 1: Request a user code from OpenAI
        const resp = await fetch(`${OPENAI_ISSUER}/api/accounts/deviceauth/usercode`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ client_id: OPENAI_CLIENT_ID }),
        });

        if (!resp.ok) {
            const text = await resp.text();
            logError('chatgpt-oauth', `Device code request failed: ${resp.status} ${text}`);
            return json({ error: `OpenAI returned ${resp.status}: ${text}` }, { status: 502 });
        }

        const data = await resp.json();
        const { device_auth_id, user_code, interval } = data;

        if (!device_auth_id || !user_code) {
            logError('chatgpt-oauth', `Invalid device code response: ${JSON.stringify(data)}`);
            return json({ error: 'Invalid response from OpenAI' }, { status: 502 });
        }

        // Store session for polling
        activeSessions.set(user_code, {
            device_auth_id,
            user_code,
            interval: parseInt(interval) || 5,
            started: Date.now(),
        });

        const verification_url = `${OPENAI_ISSUER}/codex/device`;

        logInfo('chatgpt-oauth', `Device code issued: ${user_code}, poll interval: ${interval}s`);

        return json({
            user_code,
            verification_url,
            interval: parseInt(interval) || 5,
            expires_in: 900, // 15 minutes
        });
    } catch (err) {
        logError('chatgpt-oauth', `Device code request error: ${err}`);
        return json({ error: String(err) }, { status: 500 });
    }
}

// Export for the poll endpoint
export { activeSessions, OPENAI_CLIENT_ID, OPENAI_ISSUER };
