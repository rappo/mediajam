import db from '$lib/server/db.js';
import { json } from '@sveltejs/kit';

/**
 * POST /api/media/merge-parents — Merge one media_parent into another.
 * Moves all children, credits, ratings, tags, and playback history from
 * sourceId to targetId, then deletes the source.
 *
 * Body: { sourceId: number, targetId: number }
 */
export async function POST({ request, locals }) {
    if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

    const { sourceId, targetId } = await request.json();
    if (!sourceId || !targetId) return json({ error: 'sourceId and targetId required' }, { status: 400 });
    if (sourceId === targetId) return json({ error: 'Cannot merge into self' }, { status: 400 });

    const source = /** @type {any} */ (db.prepare('SELECT * FROM media_parents WHERE id = ?').get(sourceId));
    const target = /** @type {any} */ (db.prepare('SELECT * FROM media_parents WHERE id = ?').get(targetId));

    if (!source) return json({ error: 'Source not found' }, { status: 404 });
    if (!target) return json({ error: 'Target not found' }, { status: 404 });

    let childrenMoved = 0;
    let creditsMoved = 0;
    let historyMoved = 0;

    try {
        db.pragma('foreign_keys = OFF');
        db.transaction(() => {
            // Move children
            const childResult = db.prepare('UPDATE media_children SET parent_id = ? WHERE parent_id = ?').run(targetId, sourceId);
            childrenMoved = childResult.changes;

            // Move credits (ignore duplicates)
            const creditResult = db.prepare('UPDATE OR IGNORE person_credits SET media_parent_id = ? WHERE media_parent_id = ?').run(targetId, sourceId);
            creditsMoved = creditResult.changes;
            db.prepare('DELETE FROM person_credits WHERE media_parent_id = ?').run(sourceId);

            // Move ratings
            db.prepare('UPDATE OR IGNORE external_ratings SET media_parent_id = ? WHERE media_parent_id = ?').run(targetId, sourceId);
            db.prepare('DELETE FROM external_ratings WHERE media_parent_id = ?').run(sourceId);

            // Move tags
            db.prepare('UPDATE OR IGNORE media_tags SET media_parent_id = ? WHERE media_parent_id = ?').run(targetId, sourceId);
            db.prepare('DELETE FROM media_tags WHERE media_parent_id = ?').run(sourceId);

            // Merge useful fields from source into target (only if target is empty)
            const mergeFields = ['poster_url', 'backdrop_url', 'overview', 'sonarr_id', 'radarr_id', 'lidarr_id',
                'arr_monitored', 'arr_quality_profile', 'arr_has_file', 'arr_status', 'arr_slug',
                'wikipedia_url', 'wikipedia_summary', 'runtime_minutes'];
            for (const f of mergeFields) {
                if (source[f] && !target[f]) {
                    db.prepare(`UPDATE media_parents SET ${f} = ? WHERE id = ?`).run(source[f], targetId);
                }
            }

            // Update child counts on target
            db.prepare(`
                UPDATE media_parents SET
                    collected_children = (SELECT COUNT(*) FROM media_children WHERE parent_id = ? AND is_collected = 1),
                    watched_children = (SELECT COUNT(*) FROM media_children WHERE parent_id = ? AND watch_status = 'watched')
                WHERE id = ?
            `).run(targetId, targetId, targetId);

            // Delete source
            db.prepare('DELETE FROM media_parents WHERE id = ?').run(sourceId);
        })();
        db.pragma('foreign_keys = ON');
    } catch (e) {
        db.pragma('foreign_keys = ON');
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`[merge] Failed: ${sourceId} → ${targetId}:`, msg);
        return json({ error: msg }, { status: 500 });
    }

    console.log(`[merge] Merged "${source.title}" (${sourceId}) → "${target.title}" (${targetId}): ${childrenMoved} children, ${creditsMoved} credits moved`);
    return json({
        success: true,
        slug: target.slug,
        targetId,
        childrenMoved,
        creditsMoved,
    });
}
