import db from '$lib/server/db.js';
import { json } from '@sveltejs/kit';

/**
 * GET /api/conflicts — list pending sync conflicts with artist details.
 */
export async function GET({ locals }) {
    if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

    const conflicts = db.prepare(`
        SELECT 
            sc.id, sc.conflict_type, sc.external_id, sc.status, sc.created_at,
            sc.primary_id, sc.secondary_id,
            p.title AS primary_title, p.poster_url AS primary_poster,
            p.jellyfin_id AS primary_jellyfin_id, p.musicbrainz_id AS primary_mbid,
            p.collection_status AS primary_status, p.library_id AS primary_library,
            s.title AS secondary_title, s.poster_url AS secondary_poster,
            s.jellyfin_id AS secondary_jellyfin_id, s.musicbrainz_id AS secondary_mbid,
            s.collection_status AS secondary_status, s.library_id AS secondary_library,
            (SELECT COUNT(*) FROM media_children WHERE parent_id = p.id) AS primary_album_count,
            (SELECT COUNT(*) FROM media_children WHERE parent_id = s.id) AS secondary_album_count
        FROM sync_conflicts sc
        LEFT JOIN media_parents p ON p.id = sc.primary_id
        LEFT JOIN media_parents s ON s.id = sc.secondary_id
        WHERE sc.status = 'pending'
        ORDER BY sc.created_at DESC
    `).all();

    // Fetch album titles for each conflict side
    const getAlbums = db.prepare('SELECT title, jellyfin_id FROM media_children WHERE parent_id = ? ORDER BY title');
    for (const c of conflicts) {
        /** @type {any} */ (c).primary_albums = getAlbums.all(c.primary_id).map((/** @type {any} */ a) => ({ title: a.title, hasJellyfin: !!a.jellyfin_id }));
        /** @type {any} */ (c).secondary_albums = getAlbums.all(c.secondary_id).map((/** @type {any} */ a) => ({ title: a.title, hasJellyfin: !!a.jellyfin_id }));
        /** @type {any} */ (c).primary_source = c.primary_jellyfin_id ? 'Jellyfin' : c.primary_mbid ? 'MusicBrainz/Last.fm' : 'Unknown';
        /** @type {any} */ (c).secondary_source = c.secondary_jellyfin_id ? 'Jellyfin' : c.secondary_mbid ? 'MusicBrainz/Last.fm' : 'Unknown';
    }

    return json({ conflicts });
}

/**
 * POST /api/conflicts — resolve a conflict.
 * Body: { conflictId: number, resolution: 'merge', primaryId: number }
 */
export async function POST({ request, locals }) {
    if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

    const { conflictId, resolution, primaryId } = await request.json();
    if (!conflictId || !resolution) return json({ error: 'Missing conflictId or resolution' }, { status: 400 });

    const conflict = /** @type {any} */ (db.prepare('SELECT * FROM sync_conflicts WHERE id = ?').get(conflictId));
    if (!conflict) return json({ error: 'Conflict not found' }, { status: 404 });

    if (resolution === 'merge') {
        if (!primaryId) return json({ error: 'primaryId required for merge' }, { status: 400 });

        const secondaryId = primaryId === conflict.primary_id ? conflict.secondary_id : conflict.primary_id;

        // Move all children from secondary to primary
        const moved = db.prepare('UPDATE media_children SET parent_id = ? WHERE parent_id = ?')
            .run(primaryId, secondaryId);

        // Move tracks that reference children of the secondary (already moved above)
        // Tracks reference media_children.id which didn't change, so no action needed

        // Delete the secondary media_parent
        db.prepare('DELETE FROM media_parents WHERE id = ?').run(secondaryId);

        // Mark conflict as resolved
        db.prepare(`UPDATE sync_conflicts SET status = 'resolved', resolution = 'merge', resolved_at = datetime('now') WHERE id = ?`)
            .run(conflictId);

        // Also resolve any other pending conflicts with the same external_id
        db.prepare(`UPDATE sync_conflicts SET status = 'resolved', resolution = 'merge', resolved_at = datetime('now') WHERE external_id = ? AND status = 'pending'`)
            .run(conflict.external_id);

        return json({ success: true, merged: moved.changes, deletedId: secondaryId });
    }

    return json({ error: 'Unknown resolution type' }, { status: 400 });
}
