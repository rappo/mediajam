import { json } from '@sveltejs/kit';
import db from '$lib/server/db.js';
import bcrypt from 'bcryptjs';
import { signSession, SESSION_COOKIE, COOKIE_OPTIONS } from '$lib/server/session.js';
import { createJellyfinApi, getUserApi } from '$lib/server/jellyfin.js';

/** @type {import('./$types').RequestHandler} */
export async function POST({ request, cookies }) {
    const { username, password } = await request.json();

    if (!username || !password) {
        return json({ success: false, error: 'Username and password are required.' }, { status: 400 });
    }

    const user = /** @type {any} */ (db.prepare('SELECT id, username, password_hash, is_admin, jellyfin_user_id FROM users WHERE username = ?').get(username));

    if (!user) {
        return json({ success: false, error: 'Invalid username or password.' }, { status: 401 });
    }

    // Jellyfin-linked account (no local password) — authenticate against Jellyfin server
    if (!user.password_hash && user.jellyfin_user_id) {
        const settings = /** @type {any} */ (db.prepare('SELECT jellyfin_url FROM app_settings WHERE id = 1').get());
        if (!settings?.jellyfin_url) {
            return json({ success: false, error: 'Jellyfin server URL not configured.' }, { status: 500 });
        }

        try {
            const api = createJellyfinApi(settings.jellyfin_url);
            const result = await getUserApi(api).authenticateUserByName({
                authenticateUserByName: { Username: username, Pw: password }
            });

            // Update stored access token on successful login
            const accessToken = result.data?.AccessToken;
            if (accessToken) {
                db.prepare('UPDATE users SET jellyfin_access_token = ? WHERE id = ?').run(accessToken, user.id);
            }

            cookies.set(SESSION_COOKIE, signSession(user.id), COOKIE_OPTIONS);
            return json({
                success: true,
                user: { id: user.id, username: user.username, isAdmin: user.is_admin === 1 }
            });
        } catch (/** @type {any} */ e) {
            const status = e?.response?.status;
            if (status === 401) {
                return json({ success: false, error: 'Invalid username or password.' }, { status: 401 });
            }
            console.error('Jellyfin auth error:', e);
            return json({ success: false, error: 'Could not reach Jellyfin server.' }, { status: 502 });
        }
    }

    if (!user.password_hash) {
        return json({ success: false, error: 'This account has no password set. Contact an admin.' }, { status: 401 });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
        return json({ success: false, error: 'Invalid username or password.' }, { status: 401 });
    }

    // Set session cookie
    cookies.set(SESSION_COOKIE, signSession(user.id), COOKIE_OPTIONS);

    return json({
        success: true,
        user: { id: user.id, username: user.username, isAdmin: user.is_admin === 1 }
    });
}
