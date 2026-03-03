import { json } from '@sveltejs/kit';
import db from '$lib/server/db.js';
import bcrypt from 'bcryptjs';
import { signSession, SESSION_COOKIE, COOKIE_OPTIONS } from '$lib/server/session.js';

/** @type {import('./$types').RequestHandler} */
export async function POST({ request, cookies }) {
    const { username, password } = await request.json();

    if (!username || !password) {
        return json({ success: false, error: 'Username and password are required.' }, { status: 400 });
    }

    const user = /** @type {any} */ (db.prepare('SELECT id, username, password_hash, is_admin FROM users WHERE username = ?').get(username));

    if (!user) {
        return json({ success: false, error: 'Invalid username or password.' }, { status: 401 });
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
