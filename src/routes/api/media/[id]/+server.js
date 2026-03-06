import db from '$lib/server/db.js';
import { json } from '@sveltejs/kit';
import crypto from 'crypto';

// ── In-memory undo buffer (expires after 30 seconds) ──
/** @type {Map<string, { snapshot: any, expiresAt: number }>} */
const undoBuffer = new Map();
const UNDO_TTL_MS = 30_000;

function cleanExpired() {
    const now = Date.now();
    for (const [key, v] of undoBuffer) {
        if (v.expiresAt < now) undoBuffer.delete(key);
    }
}

/**
 * DELETE /api/media/[id] — Remove a media_parent and all related data.
 * Snapshots the item for undo before deleting.
 */
export async function DELETE({ params, locals }) {
    if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

    const mediaId = parseInt(params.id);
    if (isNaN(mediaId)) return json({ error: 'Invalid ID' }, { status: 400 });

    const item = /** @type {any} */ (db.prepare('SELECT * FROM media_parents WHERE id = ?').get(mediaId));
    if (!item) return json({ error: 'Not found' }, { status: 404 });

    // Snapshot related data for undo
    const children = /** @type {any[]} */ (db.prepare('SELECT * FROM media_children WHERE parent_id = ?').all(mediaId));
    const credits = /** @type {any[]} */ (db.prepare('SELECT * FROM person_credits WHERE media_parent_id = ?').all(mediaId));
    const ratings = /** @type {any[]} */ (db.prepare('SELECT * FROM external_ratings WHERE media_parent_id = ?').all(mediaId));
    const tags = /** @type {any[]} */ (db.prepare('SELECT * FROM media_tags WHERE media_parent_id = ?').all(mediaId));
    // Playback history keyed by child ID
    const childIds = children.map(c => c.id);
    const history = childIds.length > 0
        ? /** @type {any[]} */ (db.prepare(
            `SELECT * FROM playback_history WHERE media_id IN (${childIds.map(() => '?').join(',')})`
        ).all(...childIds))
        : [];

    const undoToken = crypto.randomBytes(16).toString('hex');

    try {
        db.pragma('foreign_keys = OFF');
        db.transaction(() => {
            db.prepare('DELETE FROM person_credits WHERE media_parent_id = ?').run(mediaId);
            db.prepare('DELETE FROM playback_history WHERE media_id IN (SELECT id FROM media_children WHERE parent_id = ?)').run(mediaId);
            db.prepare('DELETE FROM media_children WHERE parent_id = ?').run(mediaId);
            db.prepare('DELETE FROM external_ratings WHERE media_parent_id = ?').run(mediaId);
            db.prepare('DELETE FROM media_tags WHERE media_parent_id = ?').run(mediaId);
            db.prepare('DELETE FROM media_parents WHERE id = ?').run(mediaId);
        })();
        db.pragma('foreign_keys = ON');
    } catch (e) {
        db.pragma('foreign_keys = ON');
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`[media] Failed to delete ${mediaId}:`, msg);
        return json({ error: msg }, { status: 500 });
    }

    // Store snapshot for undo
    cleanExpired();
    undoBuffer.set(undoToken, {
        snapshot: { item, children, credits, ratings, tags, history },
        expiresAt: Date.now() + UNDO_TTL_MS
    });

    // Map media_type to route prefix
    const routeMap = { movie: 'movies', show: 'tv', artist: 'music' };
    const route = routeMap[item.media_type] || 'movies';

    console.log(`[media] Deleted media_parent ${mediaId}: "${item.title}" (undo available for ${UNDO_TTL_MS / 1000}s)`);
    return json({ success: true, title: item.title, mediaType: item.media_type, route, undoToken });
}

/**
 * POST /api/media/[id] — Undo a deletion (restore from snapshot).
 * Body: { undoToken: string }
 */
export async function POST({ request, locals }) {
    if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

    const { undoToken } = await request.json();
    if (!undoToken) return json({ error: 'Missing undoToken' }, { status: 400 });

    cleanExpired();
    const entry = undoBuffer.get(undoToken);
    if (!entry) return json({ error: 'Undo expired or invalid' }, { status: 410 });

    const { item, children, credits, ratings, tags, history } = entry.snapshot;

    try {
        db.pragma('foreign_keys = OFF');
        db.transaction(() => {
            // Restore media_parent — use explicit columns to avoid issues
            const cols = Object.keys(item);
            const placeholders = cols.map(() => '?').join(', ');
            db.prepare(`INSERT OR REPLACE INTO media_parents (${cols.join(', ')}) VALUES (${placeholders})`).run(...cols.map(c => item[c]));

            // Restore children
            if (children.length > 0) {
                const childCols = Object.keys(children[0]);
                const childPh = childCols.map(() => '?').join(', ');
                const insertChild = db.prepare(`INSERT OR REPLACE INTO media_children (${childCols.join(', ')}) VALUES (${childPh})`);
                for (const child of children) {
                    insertChild.run(...childCols.map(c => child[c]));
                }
            }

            // Restore credits
            if (credits.length > 0) {
                const creditCols = Object.keys(credits[0]);
                const creditPh = creditCols.map(() => '?').join(', ');
                const insertCredit = db.prepare(`INSERT OR IGNORE INTO person_credits (${creditCols.join(', ')}) VALUES (${creditPh})`);
                for (const credit of credits) {
                    insertCredit.run(...creditCols.map(c => credit[c]));
                }
            }

            // Restore ratings
            if (ratings.length > 0) {
                const ratingCols = Object.keys(ratings[0]);
                const ratingPh = ratingCols.map(() => '?').join(', ');
                const insertRating = db.prepare(`INSERT OR REPLACE INTO external_ratings (${ratingCols.join(', ')}) VALUES (${ratingPh})`);
                for (const rating of ratings) {
                    insertRating.run(...ratingCols.map(c => rating[c]));
                }
            }

            // Restore tags
            if (tags.length > 0) {
                const tagCols = Object.keys(tags[0]);
                const tagPh = tagCols.map(() => '?').join(', ');
                const insertTag = db.prepare(`INSERT OR REPLACE INTO media_tags (${tagCols.join(', ')}) VALUES (${tagPh})`);
                for (const tag of tags) {
                    insertTag.run(...tagCols.map(c => tag[c]));
                }
            }

            // Restore playback history
            if (history.length > 0) {
                const histCols = Object.keys(history[0]);
                const histPh = histCols.map(() => '?').join(', ');
                const insertHist = db.prepare(`INSERT OR IGNORE INTO playback_history (${histCols.join(', ')}) VALUES (${histPh})`);
                for (const h of history) {
                    insertHist.run(...histCols.map(c => h[c]));
                }
            }
        })();
        db.pragma('foreign_keys = ON');
    } catch (e) {
        db.pragma('foreign_keys = ON');
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`[media] Undo failed:`, msg);
        return json({ error: msg }, { status: 500 });
    }

    undoBuffer.delete(undoToken);
    console.log(`[media] Restored media_parent ${item.id}: "${item.title}"`);

    // Map media_type to route
    const routeMap = { movie: 'movies', show: 'tv', artist: 'music' };
    const route = routeMap[item.media_type] || 'movies';

    return json({ success: true, id: item.id, title: item.title, route });
}
