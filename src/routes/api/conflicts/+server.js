import db from '$lib/server/db.js';
import { json } from '@sveltejs/kit';
import { isRunning as isSyncRunning } from '$lib/server/sync-engine.js';
import { isMBRunning } from '$lib/server/musicbrainz-engine.js';
import { markConflictsRead } from '$lib/server/activity-log.js';
import { migrateRatings } from '$lib/server/ratings-engine.js';

/**
 * GET /api/conflicts — list pending sync conflicts with media details.
 */
export async function GET({ locals }) {
    if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

    const settings = /** @type {any} */ (db.prepare('SELECT jellyfin_url FROM app_settings WHERE id = 1').get());
    const jellyfinUrl = settings?.jellyfin_url || '';

    // Don't surface conflicts while syncs are running — data is still incomplete
    if (isSyncRunning() || isMBRunning()) {
        return json({ conflicts: [], syncRunning: true });
    }

    const conflicts = db.prepare(`
        SELECT 
            sc.id, sc.conflict_type, sc.external_id, sc.status, sc.created_at,
            sc.primary_id, sc.secondary_id,
            p.title AS primary_title, p.poster_url AS primary_poster,
            p.jellyfin_id AS primary_jellyfin_id, p.musicbrainz_id AS primary_mbid,
            p.tmdb_id AS primary_tmdb, p.imdb_id AS primary_imdb,
            p.media_type AS primary_media_type, p.release_year AS primary_year,
            p.collection_status AS primary_status, p.library_id AS primary_library,
            s.title AS secondary_title, s.poster_url AS secondary_poster,
            s.jellyfin_id AS secondary_jellyfin_id, s.musicbrainz_id AS secondary_mbid,
            s.tmdb_id AS secondary_tmdb, s.imdb_id AS secondary_imdb,
            s.media_type AS secondary_media_type, s.release_year AS secondary_year,
            s.collection_status AS secondary_status, s.library_id AS secondary_library,
            (SELECT COUNT(*) FROM media_children WHERE parent_id = p.id) AS primary_album_count,
            (SELECT COUNT(*) FROM media_children WHERE parent_id = s.id) AS secondary_album_count
        FROM sync_conflicts sc
        LEFT JOIN media_parents p ON p.id = sc.primary_id
        LEFT JOIN media_parents s ON s.id = sc.secondary_id
        WHERE sc.status = 'pending'
        ORDER BY sc.created_at DESC
    `).all();

    // Enrich with Jellyfin links and type-specific data
    for (const c of /** @type {any[]} */ (conflicts)) {
        c.primary_jellyfin_url = c.primary_jellyfin_id ? `${jellyfinUrl}/web/index.html#!/details?id=${c.primary_jellyfin_id}` : null;
        c.secondary_jellyfin_url = c.secondary_jellyfin_id ? `${jellyfinUrl}/web/index.html#!/details?id=${c.secondary_jellyfin_id}` : null;

        // For MusicBrainz conflicts, include album details
        if (c.conflict_type === 'shared_musicbrainz_id') {
            const getAlbums = db.prepare('SELECT title, jellyfin_id FROM media_children WHERE parent_id = ? ORDER BY title');
            c.primary_albums = getAlbums.all(c.primary_id).map((/** @type {any} */ a) => ({ title: a.title, hasJellyfin: !!a.jellyfin_id }));
            c.secondary_albums = getAlbums.all(c.secondary_id).map((/** @type {any} */ a) => ({ title: a.title, hasJellyfin: !!a.jellyfin_id }));
        }

        // Human-readable conflict type label
        const typeLabels = {
            'shared_musicbrainz_id': 'Shared MusicBrainz ID',
            'shared_tmdb_id': 'Shared TMDb ID',
            'shared_imdb_id': 'Shared IMDb ID'
        };
        c.conflict_label = typeLabels[c.conflict_type] || c.conflict_type;

        // External link to the shared ID
        if (c.conflict_type === 'shared_tmdb_id' && c.external_id) {
            const mediaPath = c.primary_media_type === 'movie' ? 'movie' : 'tv';
            c.external_url = `https://www.themoviedb.org/${mediaPath}/${c.external_id}`;
        } else if (c.conflict_type === 'shared_imdb_id' && c.external_id) {
            c.external_url = `https://www.imdb.com/title/${c.external_id}`;
        } else if (c.conflict_type === 'shared_musicbrainz_id' && c.external_id) {
            c.external_url = `https://musicbrainz.org/artist/${c.external_id}`;
        }
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

        // Migrate ratings and delete the secondary media_parent
        migrateRatings(secondaryId, primaryId);
        db.prepare('DELETE FROM media_parents WHERE id = ?').run(secondaryId);

        // Mark conflict as resolved
        db.prepare(`UPDATE sync_conflicts SET status = 'resolved', resolution = 'merge', resolved_at = datetime('now') WHERE id = ?`)
            .run(conflictId);

        // Also resolve any other pending conflicts with the same external_id
        db.prepare(`UPDATE sync_conflicts SET status = 'resolved', resolution = 'merge', resolved_at = datetime('now') WHERE external_id = ? AND status = 'pending'`)
            .run(conflict.external_id);

        // Mark related activity notifications as read
        if (conflict.external_id) markConflictsRead(conflict.external_id);

        return json({ success: true, merged: moved.changes, deletedId: secondaryId });
    }

    if (resolution === 'dismissed') {
        db.prepare(`UPDATE sync_conflicts SET status = 'resolved', resolution = 'dismissed', resolved_at = datetime('now') WHERE id = ?`)
            .run(conflictId);
        if (conflict.external_id) markConflictsRead(conflict.external_id);
        return json({ success: true });
    }

    return json({ error: 'Unknown resolution type' }, { status: 400 });
}
