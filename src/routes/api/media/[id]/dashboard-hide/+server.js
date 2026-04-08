import db from '$lib/server/db.js';
import { json } from '@sveltejs/kit';

/**
 * PATCH /api/media/[id]/dashboard-hide — Toggle is_dashboard_hidden on a media_parent.
 * Body: { hidden: boolean }
 */
export async function PATCH({ params, request, locals }) {
    if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

    const mediaId = parseInt(params.id);
    if (isNaN(mediaId)) return json({ error: 'Invalid ID' }, { status: 400 });

    const { hidden } = await request.json();
    if (typeof hidden !== 'boolean') {
        return json({ error: 'hidden must be a boolean' }, { status: 400 });
    }

    const item = /** @type {any} */ (db.prepare('SELECT id, title FROM media_parents WHERE id = ?').get(mediaId));
    if (!item) return json({ error: 'Not found' }, { status: 404 });

    db.prepare('UPDATE media_parents SET is_dashboard_hidden = ? WHERE id = ?').run(hidden ? 1 : 0, mediaId);
    console.log(`[media] ${hidden ? 'Hid' : 'Unhid'} "${item.title}" (id=${mediaId}) from dashboard`);

    return json({ success: true, hidden, title: item.title });
}
