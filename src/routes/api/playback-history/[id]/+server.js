import db from '$lib/server/db.js';
import { json, error } from '@sveltejs/kit';

/** @type {import('./$types').RequestHandler} */
export async function DELETE({ params, locals }) {
    if (!locals.user) throw error(401, 'Unauthorized');

    const historyId = parseInt(params.id);
    if (!historyId) throw error(400, 'Invalid ID');

    // Verify the entry belongs to this user
    const entry = /** @type {any} */ (db.prepare(
        'SELECT id, media_id FROM playback_history WHERE id = ? AND user_id = ?'
    ).get(historyId, locals.user.id));

    if (!entry) throw error(404, 'History entry not found');

    // Delete the entry
    db.prepare('DELETE FROM playback_history WHERE id = ?').run(historyId);

    // Recalculate play_count on the media_child
    db.prepare(`
        UPDATE media_children SET play_count = (
            SELECT COUNT(*) FROM playback_history WHERE media_id = media_children.id
        ) WHERE id = ?
    `).run(entry.media_id);

    return json({ success: true });
}
