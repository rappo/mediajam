import { createHmac, randomBytes } from 'crypto';
import db from '$lib/server/db.js';

// ─── Session Secret ──────────────────────────────────────────────────────────
// Auto-generate a session secret and store in app_settings on first use.

/** @type {string} */
let cachedSecret;

function getSecret() {
    if (cachedSecret) return cachedSecret;

    // Ensure the column exists
    const cols = db.prepare("PRAGMA table_info(app_settings)").all();
    const hasCol = /** @type {any[]} */ (cols).some((/** @type {any} */ c) => c.name === 'session_secret');
    if (!hasCol) {
        db.exec("ALTER TABLE app_settings ADD COLUMN session_secret TEXT");
    }

    const row = /** @type {any} */ (db.prepare('SELECT session_secret FROM app_settings WHERE id = 1').get());
    if (row?.session_secret) {
        cachedSecret = row.session_secret;
    } else {
        cachedSecret = randomBytes(32).toString('hex');
        db.prepare('UPDATE app_settings SET session_secret = ? WHERE id = 1').run(cachedSecret);
    }

    return cachedSecret;
}

/**
 * Create a signed session cookie value.
 * @param {number} userId
 * @returns {string} "userId.signature"
 */
export function signSession(userId) {
    const payload = String(userId);
    const sig = createHmac('sha256', getSecret()).update(payload).digest('hex');
    return `${payload}.${sig}`;
}

/**
 * Verify a session cookie and return the user ID or null.
 * @param {string | undefined} cookie
 * @returns {number | null}
 */
export function verifySession(cookie) {
    if (!cookie) return null;

    const dotIndex = cookie.indexOf('.');
    if (dotIndex === -1) return null;

    const payload = cookie.substring(0, dotIndex);
    const sig = cookie.substring(dotIndex + 1);

    const expectedSig = createHmac('sha256', getSecret()).update(payload).digest('hex');

    // Timing-safe comparison
    if (sig.length !== expectedSig.length) return null;
    let mismatch = 0;
    for (let i = 0; i < sig.length; i++) {
        mismatch |= sig.charCodeAt(i) ^ expectedSig.charCodeAt(i);
    }
    if (mismatch !== 0) return null;

    const userId = parseInt(payload);
    return isNaN(userId) ? null : userId;
}

/** Cookie options for the session cookie */
export const SESSION_COOKIE = 'mediajam_session';
export const COOKIE_OPTIONS = {
    httpOnly: true,
    sameSite: /** @type {const} */ ('lax'),
    path: '/',
    maxAge: 60 * 60 * 24 * 30, // 30 days
    secure: false // set true in production behind HTTPS
};
