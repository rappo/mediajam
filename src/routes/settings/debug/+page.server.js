import db from '$lib/server/db.js';

/** @type {import('./$types').PageServerLoad} */
export function load() {
    // 1. Parents missing ALL external IDs (no TVDB, TMDB, IMDB, or MusicBrainz)
    const missingMetadata = /** @type {any[]} */ (db.prepare(`
        SELECT id, title, media_type, jellyfin_id, release_year
        FROM media_parents
        WHERE tvdb_id IS NULL
          AND tmdb_id IS NULL
          AND imdb_id IS NULL
          AND musicbrainz_id IS NULL
        ORDER BY title
        LIMIT 100
    `).all());

    const missingMetadataTotal = /** @type {any} */ (db.prepare(`
        SELECT COUNT(*) as c FROM media_parents
        WHERE tvdb_id IS NULL AND tmdb_id IS NULL AND imdb_id IS NULL AND musicbrainz_id IS NULL
    `).get())?.c || 0;

    // 2. Parents missing poster/artwork
    const missingPosters = /** @type {any[]} */ (db.prepare(`
        SELECT id, title, media_type, release_year
        FROM media_parents
        WHERE poster_url IS NULL OR poster_url = ''
        ORDER BY title
        LIMIT 100
    `).all());

    const missingPostersTotal = /** @type {any} */ (db.prepare(`
        SELECT COUNT(*) as c FROM media_parents
        WHERE poster_url IS NULL OR poster_url = ''
    `).get())?.c || 0;

    // 3. Parents missing overview/description
    const missingOverview = /** @type {any} */ (db.prepare(`
        SELECT COUNT(*) as c FROM media_parents
        WHERE overview IS NULL OR overview = ''
    `).get())?.c || 0;

    // 4. Uncollected children (known to exist but not on disk)
    const uncollectedChildren = /** @type {any[]} */ (db.prepare(`
        SELECT mc.id, mc.title, mc.season_number, mc.item_number, mp.title as parent_title, mp.media_type
        FROM media_children mc
        JOIN media_parents mp ON mc.parent_id = mp.id
        WHERE mc.is_collected = 0 AND mc.is_special = 0
        ORDER BY mp.title, mc.season_number, mc.item_number
        LIMIT 100
    `).all());

    const uncollectedTotal = /** @type {any} */ (db.prepare(`
        SELECT COUNT(*) as c FROM media_children WHERE is_collected = 0 AND is_special = 0
    `).get())?.c || 0;

    // 5. Playback history entries with media_id = 0 or pointing to non-existent children
    const orphanedHistory = /** @type {any[]} */ (db.prepare(`
        SELECT ph.id, ph.source, ph.timestamp, ph.track_name, ph.media_id
        FROM playback_history ph
        LEFT JOIN media_children mc ON ph.media_id = mc.id
        WHERE mc.id IS NULL
        ORDER BY ph.timestamp DESC
        LIMIT 100
    `).all());

    const orphanedHistoryTotal = /** @type {any} */ (db.prepare(`
        SELECT COUNT(*) as c FROM playback_history ph
        LEFT JOIN media_children mc ON ph.media_id = mc.id
        WHERE mc.id IS NULL
    `).get())?.c || 0;

    // 6. Shows with mismatched episode counts (collected vs released)
    const mismatchedCounts = /** @type {any[]} */ (db.prepare(`
        SELECT id, title, media_type, total_released_children, collected_children, watched_children
        FROM media_parents
        WHERE media_type IN ('show', 'artist')
          AND total_released_children > 0
          AND collected_children < total_released_children
        ORDER BY (total_released_children - collected_children) DESC
        LIMIT 100
    `).all());

    const mismatchedTotal = /** @type {any} */ (db.prepare(`
        SELECT COUNT(*) as c FROM media_parents
        WHERE media_type IN ('show', 'artist')
          AND total_released_children > 0
          AND collected_children < total_released_children
    `).get())?.c || 0;

    // 7. Last.fm scrobbles not matched to library
    const unmatchedScrobbles = /** @type {any} */ (db.prepare(`
        SELECT COUNT(*) as c FROM lastfm_scrobbles
    `).get())?.c || 0;

    const matchedScrobbles = /** @type {any} */ (db.prepare(`
        SELECT COUNT(*) as c FROM playback_history WHERE source = 'lastfm'
    `).get())?.c || 0;

    // 8. Overall stats
    const totalParents = /** @type {any} */ (db.prepare('SELECT COUNT(*) as c FROM media_parents').get())?.c || 0;
    const totalChildren = /** @type {any} */ (db.prepare('SELECT COUNT(*) as c FROM media_children').get())?.c || 0;
    const totalHistory = /** @type {any} */ (db.prepare('SELECT COUNT(*) as c FROM playback_history').get())?.c || 0;
    const totalTracks = /** @type {any} */ (db.prepare('SELECT COUNT(*) as c FROM tracks').get())?.c || 0;

    return {
        stats: { totalParents, totalChildren, totalHistory, totalTracks },
        missingMetadata: { items: missingMetadata, total: missingMetadataTotal },
        missingPosters: { items: missingPosters, total: missingPostersTotal },
        missingOverview: { total: missingOverview },
        uncollected: { items: uncollectedChildren, total: uncollectedTotal },
        orphanedHistory: { items: orphanedHistory, total: orphanedHistoryTotal },
        mismatchedCounts: { items: mismatchedCounts, total: mismatchedTotal },
        scrobbles: { total: unmatchedScrobbles, matched: matchedScrobbles }
    };
}
