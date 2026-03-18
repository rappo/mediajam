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

    // ── Counts by media_type × collection_status ──
    const breakdown = /** @type {any[]} */ (db.prepare(`
        SELECT
            media_type,
            collection_status,
            COUNT(*) as count
        FROM media_parents
        GROUP BY media_type, collection_status
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
            collection_status,
            CASE
                WHEN jellyfin_id IS NOT NULL THEN 'jellyfin'
                WHEN radarr_id IS NOT NULL THEN 'radarr'
                WHEN sonarr_id IS NOT NULL THEN 'sonarr'
                WHEN lidarr_id IS NOT NULL THEN 'lidarr'
                ELSE 'other'
            END as source,
            COUNT(*) as count
        FROM media_parents
        GROUP BY collection_status, source
    `).all());

    // Build Sankey nodes & links
    // Column 0: Total Library
    // Column 1: Media types (movie, show, artist)
    // Column 2: Collection statuses (owned, wanted, searching, not_tracked, etc.)
    // Column 3: Sources (jellyfin, radarr, sonarr, lidarr, other)

    const totalCount = breakdown.reduce((s, r) => s + r.count, 0);

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
        const status = r.collection_status || 'not_tracked';
        byStatus[status] = (byStatus[status] || 0) + r.count;
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
            const status = r.collection_status || 'not_tracked';
            links.push({ source: `type_${r.media_type}`, target: `status_${status}`, value: r.count });
        }
    }

    // Build links: Status → Source
    for (const r of statusSourceBreakdown) {
        if (r.count > 0) {
            const status = r.collection_status || 'not_tracked';
            links.push({ source: `status_${status}`, target: `source_${r.source}`, value: r.count });
        }
    }

    // Node definitions
    const typeLabels = { movie: 'Movies', show: 'TV Shows', artist: 'Artists' };
    const statusLabels = { owned: 'Owned', wanted: 'Wanted', searching: 'Searching', not_tracked: 'Not Tracked', collected: 'Collected' };
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
    const albumCount = /** @type {any} */ (db.prepare(`
        SELECT COUNT(*) as c FROM media_children mc
        JOIN media_parents mp ON mc.parent_id = mp.id
        WHERE mp.media_type = 'artist'
    `).get())?.c || 0;

    const episodeCount = /** @type {any} */ (db.prepare(`
        SELECT COUNT(*) as c FROM media_children mc
        JOIN media_parents mp ON mc.parent_id = mp.id
        WHERE mp.media_type = 'show'
    `).get())?.c || 0;

    // Total watch time (from playback_history duration or estimated from runtime)
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
    const totalWatchHours = Math.round(totalWatchSeconds / 3600);

    // Items watched this month
    const thisMonth = /** @type {any} */ (db.prepare(`
        SELECT COUNT(DISTINCT media_id) as c
        FROM playback_history
        WHERE user_id = ? AND timestamp >= date('now', 'start of month')
    `).get(userId))?.c || 0;

    // Average rating (from community_rating on episodes/albums)
    let avgRating = null;
    try {
        avgRating = /** @type {any} */ (db.prepare(`
            SELECT ROUND(AVG(community_rating), 1) as avg FROM media_children WHERE community_rating IS NOT NULL
        `).get())?.avg || null;
    } catch (e) {
        // Column may not exist in all DBs
    }

    // Library growth rate (items added in last 30 days)
    let growthRate = 0;
    try {
        const recentAdds = /** @type {any} */ (db.prepare(`
            SELECT COUNT(*) as c FROM media_parents WHERE created_at >= date('now', '-30 days')
        `).get())?.c || 0;
        growthRate = Math.round(recentAdds / 4.3); // per week
    } catch (e) {
        // created_at may not exist
    }

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
}
