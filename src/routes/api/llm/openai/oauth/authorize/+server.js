import { redirect } from '@sveltejs/kit';
import { randomBytes, createHash } from 'crypto';
import db from '$lib/server/db.js';

/**
 * OpenAI OAuth constants — uses the Codex CLI's public client_id.
 * This allows ChatGPT subscription holders to use their plan for API access.
 */
const OPENAI_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
const OPENAI_AUTH_URL = 'https://auth.openai.com/oauth/authorize';
const OPENAI_SCOPES = 'openid profile email offline_access model.request api.responses.write';

/**
 * GET /api/llm/openai/oauth/authorize
 * Generates PKCE challenge and redirects to OpenAI's consent page.
 * @type {import('./$types').RequestHandler}
 */
export async function GET({ locals, url, cookies }) {
    if (!locals.user) return new Response('Unauthorized', { status: 401 });

    // Generate PKCE code_verifier (43-128 chars, URL-safe)
    const codeVerifier = randomBytes(32).toString('base64url');
    // S256 challenge = BASE64URL(SHA256(code_verifier))
    const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');
    // Random state for CSRF protection
    const state = randomBytes(16).toString('hex');

    // Store verifier + state in a secure httpOnly cookie (needed for callback)
    cookies.set('openai_oauth', JSON.stringify({ codeVerifier, state }), {
        path: '/',
        httpOnly: true,
        sameSite: 'lax',
        secure: false, // local-only deployment
        maxAge: 600,   // 10 minutes
    });

    // Build the redirect URI from the current request origin
    const redirectUri = `${url.origin}/api/llm/openai/oauth/callback`;

    // Build authorization URL
    const authUrl = new URL(OPENAI_AUTH_URL);
    authUrl.searchParams.set('client_id', OPENAI_CLIENT_ID);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('scope', OPENAI_SCOPES);
    authUrl.searchParams.set('code_challenge', codeChallenge);
    authUrl.searchParams.set('code_challenge_method', 'S256');
    authUrl.searchParams.set('state', state);

    throw redirect(302, authUrl.toString());
}
