import db from '$lib/server/db.js';
import { json } from '@sveltejs/kit';

/**
 * PATCH /api/albums/[id]/hide — Toggle is_hidden on a media_child (album).
 * Body: { hidden: boolean }
 */
export async function PATCH({ params, request, locals }) {
    if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

    const albumId = parseInt(params.id);
    if (isNaN(albumId)) return json({ error: 'Invalid ID' }, { status: 400 });

    const { hidden } = await request.json();
    if (typeof hidden !== 'boolean') {
        return json({ error: 'hidden must be a boolean' }, { status: 400 });
    }

    const album = /** @type {any} */ (db.prepare('SELECT id, title, parent_id FROM media_children WHERE id = ?').get(albumId));
    if (!album) return json({ error: 'Album not found' }, { status: 404 });

    db.prepare('UPDATE media_children SET is_hidden = ? WHERE id = ?').run(hidden ? 1 : 0, albumId);
    console.log(`[albums] ${hidden ? 'Hid' : 'Unhid'} album ${albumId}: "${album.title}"`);

    return json({ success: true, hidden, title: album.title });
}
