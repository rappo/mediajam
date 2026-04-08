import { redirect } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import db from '$lib/server/db.js';
import { createHash } from 'crypto';

/**
 * GET /api/spokes/lastfm/callback — Handle Last.fm auth callback.
 * Exchanges token for session key using auth.getSession.
 * @type {import('./$types').RequestHandler}
 */
export async function GET({ url, locals }) {
    const token = url.searchParams.get('token');
    if (!token) {
        return json({ error: 'Missing token from Last.fm.' }, { status: 400 });
    }

    const settings = /** @type {any} */ (db.prepare(
        'SELECT lastfm_api_key, lastfm_shared_secret FROM app_settings WHERE id = 1'
    ).get());

    if (!settings?.lastfm_api_key || !settings?.lastfm_shared_secret) {
        return json({ error: 'Last.fm API credentials not configured.' }, { status: 400 });
    }

    try {
        // Last.fm API signature: md5(api_keyXXXmethodauth.getSessiontokenXXXSECRET)
        const sigString = `api_key${settings.lastfm_api_key}methodauth.getSessiontoken${token}${settings.lastfm_shared_secret}`;
        const apiSig = createHash('md5').update(sigString).digest('hex');

        const sessionUrl = `https://ws.audioscrobbler.com/2.0/?method=auth.getSession&api_key=${settings.lastfm_api_key}&token=${token}&api_sig=${apiSig}&format=json`;
        const res = await fetch(sessionUrl);

        if (!res.ok) {
            const errorText = await res.text();
            console.error('[lastfm] Session key exchange failed:', errorText);
            return json({ error: 'Last.fm session exchange failed.' }, { status: 502 });
        }

        const data = await res.json();
        const sessionKey = data?.session?.key;
        const username = data?.session?.name;

        if (!sessionKey || !username) {
            return json({ error: 'Invalid session response from Last.fm.' }, { status: 502 });
        }

        // Store in user_identities
        const user = locals.user;
        if (!user) {
            return json({ error: 'Not authenticated.' }, { status: 401 });
        }

        db.prepare(`
            INSERT INTO user_identities (user_id, provider, provider_uid, access_token)
            VALUES (?, 'lastfm', ?, ?)
            ON CONFLICT(user_id, provider) DO UPDATE SET
                provider_uid = excluded.provider_uid,
                access_token = excluded.access_token
        `).run(user.id, username, sessionKey);

        // Redirect back to settings with success
        throw redirect(302, '/settings?lastfm=linked');
    } catch (e) {
        if (e instanceof Response || (e && typeof e === 'object' && 'status' in e)) throw e;
        console.error('[lastfm] Auth error:', e);
        return json({ error: 'Last.fm auth flow failed.' }, { status: 500 });
    }
}
