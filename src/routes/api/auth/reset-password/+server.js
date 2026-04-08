import { json } from '@sveltejs/kit';
import db from '$lib/server/db.js';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';

// In-memory token store (survives until server restart)
// Format: token -> { userId, expiresAt }
/** @type {Map<string, { userId: number, expiresAt: number }>} */
const resetTokens = new Map();

/**
 * POST /api/auth/reset-password — Generate a reset token for a user.
 * Body: { username } (admin-only in the future, open for now)
 */
export async function POST({ request }) {
    const body = await request.json();

    // If a token + newPassword is provided, this is the actual reset
    if (body.token && body.newPassword) {
        const entry = resetTokens.get(body.token);
        if (!entry || Date.now() > entry.expiresAt) {
            resetTokens.delete(body.token);
            return json({ success: false, error: 'Invalid or expired reset token.' }, { status: 400 });
        }

        const passwordHash = await bcrypt.hash(body.newPassword, 10);
        db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(passwordHash, entry.userId);
        resetTokens.delete(body.token);

        return json({ success: true, message: 'Password updated successfully.' });
    }

    // Otherwise, generate a new token
    const { username } = body;
    if (!username) {
        return json({ success: false, error: 'Username is required.' }, { status: 400 });
    }

    const user = /** @type {any} */ (db.prepare('SELECT id FROM users WHERE username = ?').get(username));
    if (!user) {
        return json({ success: false, error: 'User not found.' }, { status: 404 });
    }

    const token = randomBytes(32).toString('hex');
    resetTokens.set(token, {
        userId: user.id,
        expiresAt: Date.now() + (60 * 60 * 1000) // 1 hour
    });

    return json({
        success: true,
        token,
        message: `Reset link: /reset-password?token=${token}`
    });
}
