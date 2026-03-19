import db from '$lib/server/db.js';
import { json } from '@sveltejs/kit';

/**
 * GET /api/pages/stats — Sankey diagram data + overview stat cards.
 *
 * Returns nodes/links for a 4-column Sankey:
 *   Total Library → Media Type → Collection Status → Source
 * Plus aggregate stats for overview cards.
 */
export function GET({ locals }) {
    const userId = locals.user?.id;
    if (!userId) return json({ error: 'Not authenticated' }, { status: 401 });

    try {
        // ── Counts by media_type × collection_status ──
        const breakdown = /** @type {any[]} */ (db.prepare(`
            SELECT
                media_type,
                COALESCE(collection_status, 'collected') as collection_status,
                COUNT(*) as count
            FROM media_parents
            GROUP BY media_type, COALESCE(collection_status, 'collected')
        `).all());

        // ── Counts by media_type × source (jellyfin vs arr vs external) ──
        const sourceBreakdown = /** @type {any[]} */ (db.prepare(`
            SELECT
                media_type,
                CASE
                    WHEN jellyfin_id IS NOT NULL THEN 'jellyfin'
                    WHEN radarr_id IS NOT NULL THEN 'radarr'
                    WHEN sonarr_id IS NOT NULL THEN 'sonarr'
                    WHEN lidarr_id IS NOT NULL THEN 'lidarr'
                    ELSE 'other'
                END as source,
                COUNT(*) as count
            FROM media_parents
            GROUP BY media_type, source
        `).all());

        // ── Counts by collection_status × source ──
        const statusSourceBreakdown = /** @type {any[]} */ (db.prepare(`
            SELECT
                COALESCE(collection_status, 'collected') as collection_status,
                CASE
                    WHEN jellyfin_id IS NOT NULL THEN 'jellyfin'
                    WHEN radarr_id IS NOT NULL THEN 'radarr'
                    WHEN sonarr_id IS NOT NULL THEN 'sonarr'
                    WHEN lidarr_id IS NOT NULL THEN 'lidarr'
                    ELSE 'other'
                END as source,
                COUNT(*) as count
            FROM media_parents
            GROUP BY COALESCE(collection_status, 'collected'), source
        `).all());

        // Build Sankey nodes & links
        const totalCount = breakdown.reduce((/** @type {number} */ s, /** @type {any} */ r) => s + r.count, 0);

        // Aggregate by media_type
        /** @type {Record<string, number>} */
        const byType = {};
        for (const r of breakdown) {
            byType[r.media_type] = (byType[r.media_type] || 0) + r.count;
        }

        // Aggregate by collection_status
        /** @type {Record<string, number>} */
        const byStatus = {};
        for (const r of breakdown) {
            byStatus[r.collection_status] = (byStatus[r.collection_status] || 0) + r.count;
        }

        // Aggregate by source
        /** @type {Record<string, number>} */
        const bySource = {};
        for (const r of sourceBreakdown) {
            bySource[r.source] = (bySource[r.source] || 0) + r.count;
        }

        // Build links: Total → Type
        /** @type {Array<{source: string, target: string, value: number}>} */
        const links = [];
        for (const [type, count] of Object.entries(byType)) {
            if (count > 0) links.push({ source: 'total', target: `type_${type}`, value: count });
        }

        // Build links: Type → Status
        for (const r of breakdown) {
            if (r.count > 0) {
                links.push({ source: `type_${r.media_type}`, target: `status_${r.collection_status}`, value: r.count });
            }
        }

        // Build links: Status → Source
        for (const r of statusSourceBreakdown) {
            if (r.count > 0) {
                links.push({ source: `status_${r.collection_status}`, target: `source_${r.source}`, value: r.count });
            }
        }

        // Node definitions
        /** @type {Record<string, string>} */
        const typeLabels = { movie: 'Movies', show: 'TV Shows', artist: 'Artists' };
        /** @type {Record<string, string>} */
        const statusLabels = {
            owned: 'Owned', wanted: 'Wanted', searching: 'Searching',
            not_tracked: 'Not Tracked', collected: 'Collected',
            watched_not_owned: 'Watched (Not Owned)', external: 'External',
            discovered: 'Discovered', watching: 'Watching', watched: 'Watched',
            partially_watched: 'Partially Watched',
        };
        /** @type {Record<string, string>} */
        const sourceLabels = { jellyfin: 'Jellyfin', radarr: 'Radarr', sonarr: 'Sonarr', lidarr: 'Lidarr', other: 'Other' };

        /** @type {Array<{id: string, label: string, column: number, count: number}>} */
        const nodes = [];
        nodes.push({ id: 'total', label: 'Total Library', column: 0, count: totalCount });
        for (const [type, count] of Object.entries(byType)) {
            if (count > 0) nodes.push({ id: `type_${type}`, label: typeLabels[type] || type, column: 1, count });
        }
        for (const [status, count] of Object.entries(byStatus)) {
            if (count > 0) nodes.push({ id: `status_${status}`, label: statusLabels[status] || status, column: 2, count });
        }
        for (const [source, count] of Object.entries(bySource)) {
            if (count > 0) nodes.push({ id: `source_${source}`, label: sourceLabels[source] || source, column: 3, count });
        }

        // ── Stat cards ──
        let albumCount = 0;
        try {
            albumCount = /** @type {any} */ (db.prepare(`
                SELECT COUNT(*) as c FROM media_children mc
                JOIN media_parents mp ON mc.parent_id = mp.id
                WHERE mp.media_type = 'artist'
            `).get())?.c || 0;
        } catch (e) { /* ignore */ }

        let episodeCount = 0;
        try {
            episodeCount = /** @type {any} */ (db.prepare(`
                SELECT COUNT(*) as c FROM media_children mc
                JOIN media_parents mp ON mc.parent_id = mp.id
                WHERE mp.media_type = 'show'
            `).get())?.c || 0;
        } catch (e) { /* ignore */ }

        // Total watch time
        let totalWatchHours = 0;
        try {
            let totalWatchSeconds = /** @type {any} */ (db.prepare(`
                SELECT SUM(duration_consumed_seconds) as s FROM playback_history WHERE user_id = ?
            `).get(userId))?.s || 0;

            if (!totalWatchSeconds) {
                totalWatchSeconds = /** @type {any} */ (db.prepare(`
                    SELECT SUM(mc.runtime_ticks / 10000000) as s
                    FROM playback_history ph
                    JOIN media_children mc ON ph.media_id = mc.id
                    WHERE ph.user_id = ? AND mc.runtime_ticks > 0
                `).get(userId))?.s || 0;
            }
            totalWatchHours = Math.round(totalWatchSeconds / 3600);
        } catch (e) { /* ignore */ }

        // Items watched this month
        let thisMonth = 0;
        try {
            thisMonth = /** @type {any} */ (db.prepare(`
                SELECT COUNT(DISTINCT media_id) as c
                FROM playback_history
                WHERE user_id = ? AND timestamp >= date('now', 'start of month')
            `).get(userId))?.c || 0;
        } catch (e) { /* ignore */ }

        // Average rating
        let avgRating = null;
        try {
            avgRating = /** @type {any} */ (db.prepare(`
                SELECT ROUND(AVG(community_rating), 1) as avg FROM media_children WHERE community_rating IS NOT NULL
            `).get())?.avg || null;
        } catch (e) { /* ignore */ }

        // Library growth rate
        let growthRate = 0;
        try {
            const recentAdds = /** @type {any} */ (db.prepare(`
                SELECT COUNT(*) as c FROM media_parents WHERE created_at >= date('now', '-30 days')
            `).get())?.c || 0;
            growthRate = Math.round(recentAdds / 4.3);
        } catch (e) { /* ignore */ }

        return json({
            sankey: { nodes, links },
            cards: {
                total: totalCount,
                movies: byType['movie'] || 0,
                shows: byType['show'] || 0,
                artists: byType['artist'] || 0,
                albums: albumCount,
                episodes: episodeCount,
                watchHours: totalWatchHours,
                thisMonth,
                avgRating,
                growthRate,
            },
        });
    } catch (/** @type {any} */ e) {
        console.error('[stats] API error:', e?.message || e);
        return json({ error: e?.message || 'Internal error', detail: String(e) }, { status: 500 });
    }
}
