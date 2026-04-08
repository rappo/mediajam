import { redirect } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import db from '$lib/server/db.js';

/**
 * GET /api/spokes/trakt/callback — Handle Trakt OAuth callback.
 * Exchanges authorization code for access + refresh tokens, stores in user_identities.
 * @type {import('./$types').RequestHandler}
 */
export async function GET({ url, locals }) {
    const code = url.searchParams.get('code');
    if (!code) {
        return json({ error: 'Missing authorization code.' }, { status: 400 });
    }

    const settings = /** @type {any} */ (db.prepare(
        'SELECT trakt_client_id, trakt_client_secret FROM app_settings WHERE id = 1'
    ).get());

    if (!settings?.trakt_client_id || !settings?.trakt_client_secret) {
        return json({ error: 'Trakt client credentials not configured.' }, { status: 400 });
    }

    const redirectUri = `${url.origin}/api/spokes/trakt/callback`;

    try {
        // Exchange code for token
        const tokenRes = await fetch('https://api.trakt.tv/oauth/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                code,
                client_id: settings.trakt_client_id,
                client_secret: settings.trakt_client_secret,
                redirect_uri: redirectUri,
                grant_type: 'authorization_code'
            })
        });

        if (!tokenRes.ok) {
            const errorText = await tokenRes.text();
            console.error('[trakt] Token exchange failed:', errorText);
            return json({ error: 'Token exchange failed.' }, { status: 502 });
        }

        const tokenData = await tokenRes.json();
        const accessToken = tokenData.access_token;
        const refreshToken = tokenData.refresh_token;
        const expiresIn = tokenData.expires_in; // seconds

        // Get Trakt user profile
        const profileRes = await fetch('https://api.trakt.tv/users/me', {
            headers: {
                'Content-Type': 'application/json',
                'trakt-api-version': '2',
                'trakt-api-key': settings.trakt_client_id,
                'Authorization': `Bearer ${accessToken}`
            }
        });

        let traktUsername = 'unknown';
        if (profileRes.ok) {
            const profile = await profileRes.json();
            traktUsername = profile.user?.username || profile.username || 'unknown';
        }

        // Store in user_identities
        const user = locals.user;
        if (!user) {
            return json({ error: 'Not authenticated.' }, { status: 401 });
        }

        const expiresAt = expiresIn
            ? new Date(Date.now() + expiresIn * 1000).toISOString()
            : null;

        db.prepare(`
            INSERT INTO user_identities (user_id, provider, provider_uid, access_token, refresh_token, token_expires_at)
            VALUES (?, 'trakt', ?, ?, ?, ?)
            ON CONFLICT(user_id, provider) DO UPDATE SET
                provider_uid = excluded.provider_uid,
                access_token = excluded.access_token,
                refresh_token = excluded.refresh_token,
                token_expires_at = excluded.token_expires_at
        `).run(user.id, traktUsername, accessToken, refreshToken, expiresAt);

        // Redirect back to settings with success
        throw redirect(302, '/settings/account?trakt=linked');
    } catch (e) {
        if (e instanceof Response || (e && typeof e === 'object' && 'status' in e)) throw e; // Re-throw redirects
        console.error('[trakt] OAuth error:', e);
        return json({ error: 'OAuth flow failed.' }, { status: 500 });
    }
}
