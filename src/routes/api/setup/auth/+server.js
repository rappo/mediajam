import { json } from '@sveltejs/kit';
import db from '$lib/server/db.js';
import bcrypt from 'bcryptjs';
import { createJellyfinApi, getUserApi } from '$lib/server/jellyfin.js';
import { signSession, SESSION_COOKIE, COOKIE_OPTIONS } from '$lib/server/session.js';

async function authenticateWithJellyfin(jellyfinUrl, username, password) {
    const api = createJellyfinApi(jellyfinUrl);

    try {
        const result = await getUserApi(api).authenticateUserByName({
            authenticateUserByName: {
                Username: username,
                Pw: password
            }
        });

        return { success: true, data: result.data };
    } catch (e) {
        if (e.response) {
            const status = e.response.status;
            if (status === 401) {
                return { success: false, status: 401, error: 'Invalid username or password.' };
            }
            if (status === 500) {
                return { success: false, status: 500, error: `Jellyfin returned HTTP 500. This may be a known Jellyfin 10.11.x issue. Please check your Jellyfin server logs.` };
            }
            return { success: false, status, error: `Jellyfin returned HTTP ${status}` };
        }
        const msg = e instanceof Error ? e.message : String(e);
        return { success: false, status: 0, error: `Connection failed: ${msg}` };
    }
}

/** @type {import('./$types').RequestHandler} */
export async function POST({ request, cookies }) {
    const { authType, username, password, jellyfinUrl } = await request.json();

    try {
        if (authType === 'jellyfin') {
            let result = await authenticateWithJellyfin(jellyfinUrl, username, password);

            // If 500, retry once with delay (known concurrency bug workaround)
            if (!result.success && result.status === 500) {
                console.log('Retrying Jellyfin auth after delay (concurrency workaround)...');
                await new Promise(r => setTimeout(r, 1000));
                result = await authenticateWithJellyfin(jellyfinUrl, username, password);
            }

            if (!result.success) {
                return json({ success: false, error: result.error });
            }

            const data = result.data;
            const userId = data.User?.Id;
            const accessToken = data.AccessToken;

            // Save to database
            db.prepare(`
				INSERT OR REPLACE INTO users (username, jellyfin_user_id, jellyfin_access_token, is_admin)
				VALUES (?, ?, ?, 1)
			`).run(username, userId, accessToken);

            // Save Jellyfin URL
            db.prepare('UPDATE app_settings SET jellyfin_url = ? WHERE id = 1').run(jellyfinUrl);

            // Set session cookie so user is logged in for the rest of setup
            const dbUser = /** @type {any} */ (db.prepare('SELECT id FROM users WHERE jellyfin_user_id = ?').get(userId));
            if (dbUser) cookies.set(SESSION_COOKIE, signSession(dbUser.id), COOKIE_OPTIONS);

            return json({
                success: true,
                userId,
                accessToken
            });
        } else {
            // Create local account
            const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
            if (existing) {
                return json({ success: false, error: 'Username already exists.' });
            }

            const passwordHash = await bcrypt.hash(password, 10);

            const result = db.prepare(`
				INSERT INTO users (username, password_hash, is_admin)
				VALUES (?, ?, 1)
			`).run(username, passwordHash);

            // Save Jellyfin URL
            db.prepare('UPDATE app_settings SET jellyfin_url = ? WHERE id = 1').run(jellyfinUrl);

            // Set session cookie so user is logged in for the rest of setup
            cookies.set(SESSION_COOKIE, signSession(Number(result.lastInsertRowid)), COOKIE_OPTIONS);

            return json({
                success: true,
                userId: String(result.lastInsertRowid)
            });
        }
    } catch (e) {
        console.error('Auth error:', e);
        return json({ success: false, error: 'Authentication failed. Please try again.' });
    }
}
