import { json } from '@sveltejs/kit';
import db from '$lib/server/db.js';
import bcrypt from 'bcryptjs';

const AUTH_HEADER = 'MediaBrowser Client="Mediajam", Device="Mediajam Web", DeviceId="mediajam-web-001", Version="1.0.0"';

async function authenticateWithJellyfin(jellyfinUrl, username, password) {
    // Try both header styles (X-Emby-Authorization for older, Authorization for newer)
    const headerVariants = [
        { 'Authorization': AUTH_HEADER },
        { 'X-Emby-Authorization': AUTH_HEADER }
    ];

    for (const authHeaders of headerVariants) {
        try {
            const res = await fetch(`${jellyfinUrl}/Users/AuthenticateByName`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...authHeaders
                },
                body: JSON.stringify({
                    Username: username,
                    Pw: password
                })
            });

            if (res.ok) {
                return { success: true, data: await res.json() };
            }

            // If we got a 401, credentials are wrong — don't try other header
            if (res.status === 401) {
                return { success: false, status: 401, error: 'Invalid username or password.' };
            }

            // For 500 errors (known Jellyfin 10.11.x bug), try a different approach
            if (res.status === 500) {
                console.error(`Jellyfin returned 500 with header variant. Trying next...`);
                continue;
            }

            return { success: false, status: res.status, error: `Jellyfin returned HTTP ${res.status}` };
        } catch (e) {
            console.error(`Auth attempt failed:`, e.message);
        }
    }

    return { success: false, status: 500, error: 'Jellyfin server error' };
}

async function tryApiKeyAuth(jellyfinUrl, username, password) {
    // Fallback: try to get users list and find a matching user
    // This is a workaround for the Jellyfin 10.11.x AuthenticateByName 500 bug
    // First authenticate again with a slight delay (concurrency issue workaround)
    await new Promise(r => setTimeout(r, 1000));

    try {
        const res = await fetch(`${jellyfinUrl}/Users/AuthenticateByName`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': AUTH_HEADER
            },
            body: JSON.stringify({
                Username: username,
                Pw: password
            })
        });

        if (res.ok) {
            return { success: true, data: await res.json() };
        }

        const errBody = await res.text().catch(() => '');
        return {
            success: false,
            status: res.status,
            error: res.status === 401
                ? 'Invalid username or password.'
                : `Jellyfin returned HTTP ${res.status}. This may be a known Jellyfin 10.11.x issue (DbUpdateConcurrencyException). Please check your Jellyfin server logs and ensure it has adequate disk space. You can try again or use a local Mediajam account instead.`
        };
    } catch (e) {
        return { success: false, status: 0, error: `Connection failed: ${e.message}` };
    }
}

/** @type {import('./$types').RequestHandler} */
export async function POST({ request }) {
    const { authType, username, password, jellyfinUrl } = await request.json();

    try {
        if (authType === 'jellyfin') {
            // Try authenticating with Jellyfin
            let result = await authenticateWithJellyfin(jellyfinUrl, username, password);

            // If 500, retry once with delay (known concurrency bug workaround)
            if (!result.success && result.status === 500) {
                console.log('Retrying Jellyfin auth after delay (concurrency workaround)...');
                result = await tryApiKeyAuth(jellyfinUrl, username, password);
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
