import { redirect } from '@sveltejs/kit';
import crypto from 'crypto';
import { pkceStore, cleanupPkceStore } from '$lib/server/openai-pkce.js';

/**
 * OpenAI Codex OAuth — PKCE-based "Sign in with ChatGPT" flow.
 * Uses the same public client ID as the Codex CLI.
 * No client_id/secret configuration needed.
 */

const OPENAI_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
const AUTH_URL = 'https://auth.openai.com/oauth/authorize';
const SCOPES = 'openid profile email offline_access';

/**
 * GET /api/llm/openai/auth — Start Codex OAuth flow.
 * Generates PKCE challenge and redirects to OpenAI's auth page.
 * @type {import('./$types').RequestHandler}
 */
export async function GET({ url, locals }) {
    if (!locals.user) return new Response('Unauthorized', { status: 401 });

    cleanupPkceStore();

    // Generate PKCE code_verifier and code_challenge
    const verifier = crypto.randomBytes(32).toString('base64url');
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');

    // Generate state to prevent CSRF
    const state = crypto.randomBytes(16).toString('hex');

    // Store verifier for the callback
    pkceStore.set(state, {
        verifier,
        userId: locals.user.id,
        createdAt: Date.now(),
    });

    const redirectUri = `${url.origin}/api/llm/openai/callback`;

    const authUrl = new URL(AUTH_URL);
    authUrl.searchParams.set('client_id', OPENAI_CLIENT_ID);
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('scope', SCOPES);
    authUrl.searchParams.set('state', state);
    authUrl.searchParams.set('code_challenge', challenge);
    authUrl.searchParams.set('code_challenge_method', 'S256');

    throw redirect(302, authUrl.toString());
}
