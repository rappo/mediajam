import db from '$lib/server/db.js';

/** @type {import('./$types').PageServerLoad} */
export function load() {
    const totalShows = db.prepare('SELECT COUNT(*) as c FROM media_parents WHERE media_type = ?').get('show').c;

    const episodeStats = db.prepare(`
        SELECT
            COUNT(*) as total,
            SUM(CASE WHEN watch_status = 'watched' THEN 1 ELSE 0 END) as watched,
            SUM(CASE WHEN watch_status = 'in_progress' THEN 1 ELSE 0 END) as in_progress,
            SUM(CASE WHEN watch_status = 'unwatched' THEN 1 ELSE 0 END) as unwatched,
            SUM(play_count) as total_plays,
            SUM(runtime_ticks) as total_runtime
        FROM media_children mc
        JOIN media_parents mp ON mc.parent_id = mp.id
        WHERE mp.media_type = 'show'
    `).get();

    const runtimeHours = Math.round((episodeStats.total_runtime || 0) / 10000000 / 3600);

    // Shows sorted by episode count
    const shows = db.prepare(`
        SELECT
            mp.id,
            mp.title,
            mp.release_year,
            mp.poster_url,
            mp.collected_children,
            mp.watched_children,
            mp.total_released_children,
            mp.overview,
            mp.tvdb_id,
            mp.tmdb_id,
            mp.imdb_id,
            CASE WHEN mp.collected_children > 0
                THEN ROUND(CAST(mp.watched_children AS REAL) / mp.collected_children * 100, 1)
                ELSE 0 END as completion,
            CASE WHEN mp.total_released_children > 0
                THEN ROUND(CAST(mp.collected_children AS REAL) / mp.total_released_children * 100, 1)
                ELSE NULL END as collection_pct,
            COALESCE((SELECT COUNT(*) FROM playback_history ph JOIN media_children mc2 ON ph.media_id = mc2.id WHERE mc2.parent_id = mp.id), 0) as watch_count
        FROM media_parents mp
        WHERE mp.media_type = 'show'
        ORDER BY mp.collected_children DESC
    `).all();

    // Top 15 shows by episode count for bar chart
    const topShowsByEpisodes = shows.slice(0, 15).map(s => ({
        label: s.title.length > 20 ? s.title.substring(0, 18) + '…' : s.title,
        y: s.collected_children
    }));

    // Shows by year
    const showsByYear = db.prepare(`
        SELECT release_year as year, COUNT(*) as count
        FROM media_parents
        WHERE media_type = 'show' AND release_year IS NOT NULL
        GROUP BY release_year
        ORDER BY release_year
    `).all();

    // Completion distribution
    const completionBuckets = { full: 0, partial: 0, none: 0 };
    const collectionBuckets = { complete: 0, partial: 0, missing: 0 };
    let totalCollected = 0;
    let totalReleased = 0;
    for (const s of shows) {
        if (s.completion >= 100) completionBuckets.full++;
        else if (s.completion > 0) completionBuckets.partial++;
        else completionBuckets.none++;

        totalCollected += s.collected_children || 0;
        totalReleased += s.total_released_children || 0;
        if (s.collection_pct === null || s.collection_pct === undefined) { /* unknown, skip */ }
        else if (s.collection_pct >= 100) collectionBuckets.complete++;
        else if (s.collection_pct > 0) collectionBuckets.partial++;
        else collectionBuckets.missing++;
    }

    return {
        totalShows,
        episodeStats: {
            total: episodeStats.total || 0,
            watched: episodeStats.watched || 0,
            inProgress: episodeStats.in_progress || 0,
            unwatched: episodeStats.unwatched || 0,
            totalPlays: episodeStats.total_plays || 0
        },
        runtimeHours,
        shows,
        topShowsByEpisodes,
        showsByYear,
        completionBuckets,
        collectionBuckets,
        collectionStats: {
            totalCollected,
            totalReleased,
            overallPct: totalReleased > 0 ? Math.round((totalCollected / totalReleased) * 100) : 100
        }
    };
}
