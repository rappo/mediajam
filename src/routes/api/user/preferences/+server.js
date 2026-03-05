import { json } from '@sveltejs/kit';
import db from '$lib/server/db.js';

/**
 * GET /api/user/preferences — Get current user preferences
 * @type {import('./$types').RequestHandler}
 */
export async function GET({ locals }) {
    if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

    const user = /** @type {any} */ (db.prepare('SELECT preferences FROM users WHERE id = ?').get(locals.user.id));
    const prefs = user?.preferences ? JSON.parse(user.preferences) : {};
    return json(prefs);
}

/**
 * PUT /api/user/preferences — Update user preferences (merge)
 * @type {import('./$types').RequestHandler}
 */
export async function PUT({ request, locals }) {
    if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

    const updates = await request.json();
    const user = /** @type {any} */ (db.prepare('SELECT preferences FROM users WHERE id = ?').get(locals.user.id));
    const current = user?.preferences ? JSON.parse(user.preferences) : {};
    const merged = { ...current, ...updates };

    db.prepare('UPDATE users SET preferences = ? WHERE id = ?').run(JSON.stringify(merged), locals.user.id);
    return json({ success: true, preferences: merged });
}
