import db from '$lib/server/db.js';
import { json, error } from '@sveltejs/kit';

/** @type {import('./$types').RequestHandler} */
export async function DELETE({ params, locals }) {
    if (!locals.user) throw error(401, 'Unauthorized');

    const keyId = parseInt(params.id);
    if (!keyId) throw error(400, 'Invalid ID');

    // Admins can delete any key, regular users only their own
    const key = /** @type {any} */ (db.prepare(
        'SELECT id, user_id FROM api_keys WHERE id = ?'
    ).get(keyId));

    if (!key) throw error(404, 'API key not found');
    if (!locals.user.isAdmin && key.user_id !== locals.user.id) {
        throw error(403, 'Not authorized to delete this key');
    }

    db.prepare('DELETE FROM api_keys WHERE id = ?').run(keyId);

    return json({ success: true });
}
