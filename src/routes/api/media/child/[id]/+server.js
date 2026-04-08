import db from '$lib/server/db.js';
import { json } from '@sveltejs/kit';

/**
 * DELETE /api/media/child/[id] — Delete a single media_child (album/episode).
 * Optionally migrate playback_history to a target child.
 * Query param: ?mergeHistoryTo=<childId>
 */
export async function DELETE({ params, url, locals }) {
    if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

    const childId = parseInt(params.id);
    if (isNaN(childId)) return json({ error: 'Invalid ID' }, { status: 400 });

    const child = /** @type {any} */ (db.prepare('SELECT * FROM media_children WHERE id = ?').get(childId));
    if (!child) return json({ error: 'Not found' }, { status: 404 });

    const mergeHistoryTo = url.searchParams.get('mergeHistoryTo');

    try {
        db.transaction(() => {
            if (mergeHistoryTo) {
                const targetId = parseInt(mergeHistoryTo);
                if (!isNaN(targetId)) {
                    db.prepare('UPDATE playback_history SET media_id = ? WHERE media_id = ?').run(targetId, childId);
                }
            }
            // Delete tracks associated with this child
            db.prepare('DELETE FROM tracks WHERE album_id = ?').run(childId);
            // Delete the child
            db.prepare('DELETE FROM media_children WHERE id = ?').run(childId);
        })();
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`[media/child] Failed to delete child ${childId}:`, msg);
        return json({ error: msg }, { status: 500 });
    }

    console.log(`[media/child] Deleted child ${childId}: "${child.title}"${mergeHistoryTo ? ` (history → ${mergeHistoryTo})` : ''}`);
    return json({ success: true, title: child.title });
}

/**
 * PATCH /api/media/child/[id] — Merge a child into another sibling.
 * Body: { mergeInto: number }
 * Migrates playback_history and tracks from this child to the target, then deletes this child.
 */
export async function PATCH({ params, request, locals }) {
    if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

    const childId = parseInt(params.id);
    if (isNaN(childId)) return json({ error: 'Invalid ID' }, { status: 400 });

    const { mergeInto } = await request.json();
    if (!mergeInto || typeof mergeInto !== 'number') {
        return json({ error: 'mergeInto (child ID) is required' }, { status: 400 });
    }

    const source = /** @type {any} */ (db.prepare('SELECT * FROM media_children WHERE id = ?').get(childId));
    if (!source) return json({ error: 'Source not found' }, { status: 404 });

    const target = /** @type {any} */ (db.prepare('SELECT * FROM media_children WHERE id = ?').get(mergeInto));
    if (!target) return json({ error: 'Target not found' }, { status: 404 });

    if (source.parent_id !== target.parent_id) {
        return json({ error: 'Source and target must belong to the same parent' }, { status: 400 });
    }

    let historyMoved = 0;

    try {
        db.transaction(() => {
            // Migrate playback_history
            const histResult = db.prepare('UPDATE playback_history SET media_id = ? WHERE media_id = ?').run(mergeInto, childId);
            historyMoved = histResult.changes;

            // Migrate tracks
            db.prepare('UPDATE OR IGNORE tracks SET album_id = ? WHERE album_id = ?').run(mergeInto, childId);
            db.prepare('DELETE FROM tracks WHERE album_id = ?').run(childId); // cleanup dupes

            // Copy useful fields from source if target is missing them
            if (source.poster_url && !target.poster_url) {
                db.prepare('UPDATE media_children SET poster_url = ? WHERE id = ?').run(source.poster_url, mergeInto);
            }
            if (source.musicbrainz_id && !target.musicbrainz_id) {
                db.prepare('UPDATE media_children SET musicbrainz_id = ? WHERE id = ?').run(source.musicbrainz_id, mergeInto);
            }
            if (source.play_count > target.play_count) {
                db.prepare('UPDATE media_children SET play_count = ? WHERE id = ?').run(source.play_count, mergeInto);
            }

            // Delete source
            db.prepare('DELETE FROM media_children WHERE id = ?').run(childId);
        })();
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`[media/child] Failed to merge child ${childId} → ${mergeInto}:`, msg);
        return json({ error: msg }, { status: 500 });
    }

    console.log(`[media/child] Merged "${source.title}" (${childId}) → "${target.title}" (${mergeInto}), ${historyMoved} history entries moved`);
    return json({ success: true, historyMoved, sourceTitle: source.title, targetTitle: target.title });
}
