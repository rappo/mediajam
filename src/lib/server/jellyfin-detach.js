/**
 * Detach a media_parent from Jellyfin after the item was removed there.
 *
 * The row is kept (watch history, ratings, credits, watchlist are real user
 * data) but it is no longer considered downloaded: children lose is_collected
 * and their dangling jellyfin_ids, counts are recomputed, and the status
 * becomes 'watched_not_owned' (if there is any watch evidence) or 'external'.
 * *arr fields are left alone — arr-sync owns those and clears them on its own
 * when the item is gone from the *arr service.
 */
import db from '$lib/server/db.js';
import { tmdbFetch, getTmdbKey } from './tmdb.js';
import { resolvePoster } from './backdrop.js';

/**
 * @param {number} parentId
 * @param {{ refreshArtwork?: boolean }} [opts]
 * @returns {Promise<{ id: number, title: string, status: string } | null>}
 */
export async function detachFromJellyfin(parentId, { refreshArtwork = true } = {}) {
    const parent = /** @type {any} */ (db.prepare(
        'SELECT id, title, media_type, tmdb_id FROM media_parents WHERE id = ?'
    ).get(parentId));
    if (!parent) return null;

    const status = db.transaction(() => {
        // Children: no longer on disk; clear dangling Jellyfin ids but keep
        // watch_status/play_count — the watching happened regardless.
        db.prepare(
            'UPDATE media_children SET is_collected = 0, jellyfin_id = NULL WHERE parent_id = ?'
        ).run(parentId);

        // Any evidence this was watched? (child watch state or playback history)
        const watchedCount = /** @type {any} */ (db.prepare(
            "SELECT COUNT(*) AS c FROM media_children WHERE parent_id = ? AND watch_status = 'watched'"
        ).get(parentId))?.c || 0;
        const historyCount = /** @type {any} */ (db.prepare(`
            SELECT COUNT(*) AS c FROM playback_history
            WHERE media_id IN (SELECT id FROM media_children WHERE parent_id = ?)
        `).get(parentId))?.c || 0;

        const newStatus = (watchedCount > 0 || historyCount > 0) ? 'watched_not_owned' : 'external';

        // Parent: unlink Jellyfin, zero collection counts, drop Jellyfin-hosted
        // artwork (those URLs 404 once the item is gone; TMDB URLs are kept).
        db.prepare(`
            UPDATE media_parents SET
                jellyfin_id = NULL,
                library_id = NULL,
                jellyfin_child_count = 0,
                unplayed_count = NULL,
                collection_status = ?,
                collected_children = 0,
                watched_children = ?,
                poster_url = CASE WHEN poster_url LIKE '%/Items/%' THEN NULL ELSE poster_url END,
                backdrop_url = CASE WHEN backdrop_url LIKE '%/Items/%' THEN NULL ELSE backdrop_url END
            WHERE id = ?
        `).run(newStatus, watchedCount, parentId);

        return newStatus;
    })();

    // Best-effort artwork refresh for whatever was just nulled.
    if (refreshArtwork) {
        try {
            const fresh = /** @type {any} */ (db.prepare(
                'SELECT poster_url, backdrop_url FROM media_parents WHERE id = ?'
            ).get(parentId));
            if ((!fresh?.poster_url || !fresh?.backdrop_url)) {
                if ((parent.media_type === 'movie' || parent.media_type === 'show') && parent.tmdb_id && getTmdbKey()) {
                    const tmdbType = parent.media_type === 'movie' ? 'movie' : 'tv';
                    const res = await tmdbFetch(`/${tmdbType}/${parent.tmdb_id}`);
                    if (res.ok) {
                        const detail = await res.json();
                        db.prepare(`
                            UPDATE media_parents SET
                                poster_url = COALESCE(poster_url, ?),
                                backdrop_url = COALESCE(backdrop_url, ?)
                            WHERE id = ?
                        `).run(
                            detail.poster_path ? `https://image.tmdb.org/t/p/w300${detail.poster_path}` : null,
                            detail.backdrop_path ? `https://image.tmdb.org/t/p/w1280${detail.backdrop_path}` : null,
                            parentId
                        );
                    }
                } else if (parent.media_type === 'artist') {
                    await resolvePoster(parentId); // fanart.tv via musicbrainz_id
                }
            }
        } catch (e) {
            console.warn(`[detach] Artwork refresh failed for ${parent.title}:`, e instanceof Error ? e.message : e);
        }
    }

    return { id: parentId, title: parent.title, status };
}
