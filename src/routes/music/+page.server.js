import db from '$lib/server/db.js';

/** @type {import('./$types').PageServerLoad} */
export function load({ locals, url }) {
    const userId = locals.user?.id || 0;
    const page = parseInt(url.searchParams.get('page') || '1');
    const perPage = 50;
    const offset = (page - 1) * perPage;
    const search = url.searchParams.get('q') || '';
    const sort = url.searchParams.get('sort') || 'plays'; // plays, albums, name

    // Total counts (fast, no subqueries)
    const totalArtists = /** @type {any} */ (
        db.prepare('SELECT COUNT(*) as c FROM media_parents WHERE media_type = ?').get('artist')
    ).c;

    const albumStats = /** @type {any} */ (db.prepare(`
        SELECT
            COUNT(*) as total_albums,
            SUM(play_count) as total_plays
        FROM media_children mc
        JOIN media_parents mp ON mc.parent_id = mp.id
        WHERE mp.media_type = 'artist'
    `).get());

    // Pre-compute deduplicated play counts per artist
    // Plays within 5 minutes from different sources count as 1 play
    const playCountMap = /** @type {Record<number, number>} */ ({});
    const playCounts = /** @type {any[]} */ (db.prepare(`
        SELECT mc.parent_id, COUNT(*) as play_count
        FROM (
            SELECT DISTINCT ph.media_id, CAST(strftime('%s', ph.timestamp) / 300 AS INTEGER) as time_bucket
            FROM playback_history ph
            WHERE ph.user_id = ?
        ) deduped
        JOIN media_children mc ON deduped.media_id = mc.id
        JOIN media_parents mp ON mc.parent_id = mp.id
        WHERE mp.media_type = 'artist'
        GROUP BY mc.parent_id
    `).all(userId));
    for (const row of playCounts) {
        playCountMap[row.parent_id] = row.play_count;
    }

    // Build sort clause
    let orderBy = 'total_plays DESC';
    if (sort === 'albums') orderBy = 'mp.collected_children DESC';
    else if (sort === 'name') orderBy = 'mp.title ASC';

    // Search filter
    const searchFilter = search ? "AND mp.title LIKE '%' || ? || '%'" : '';
    const searchParams = search ? [search] : [];

    // Paginated artists — play count from local playback_history via LEFT JOIN
    const artists = /** @type {any[]} */ (db.prepare(`
        SELECT
            mp.id,
            mp.title,
            mp.poster_url,
            mp.collection_status,
            mp.collected_children as album_count,
            mp.total_released_children,
            mp.arr_status,
            mp.musicbrainz_id,
            COALESCE(pc.play_count, 0) as total_plays,
            CASE WHEN mp.total_released_children > 0
                THEN ROUND(CAST(mp.collected_children AS REAL) / mp.total_released_children * 100, 1)
                ELSE NULL END as collection_pct
        FROM media_parents mp
        LEFT JOIN (
            SELECT mc2.parent_id, COUNT(*) as play_count
            FROM (
                SELECT DISTINCT ph.media_id, CAST(strftime('%s', ph.timestamp) / 300 AS INTEGER) as time_bucket
                FROM playback_history ph
                WHERE ph.user_id = ?
            ) deduped
            JOIN media_children mc2 ON deduped.media_id = mc2.id
            GROUP BY mc2.parent_id
        ) pc ON pc.parent_id = mp.id
        WHERE mp.media_type = 'artist' ${searchFilter}
        ORDER BY ${orderBy}
        LIMIT ? OFFSET ?
    `).all(userId, ...searchParams, perPage, offset));

    // Attach watch_count (same as total_plays from local data)
    for (const a of artists) {
        a.watch_count = a.total_plays;
    }

    // Filtered total for pagination
    const filteredTotal = search
        ? /** @type {any} */ (db.prepare(
            `SELECT COUNT(*) as c FROM media_parents WHERE media_type = 'artist' AND title LIKE '%' || ? || '%'`
        ).get(search)).c
        : totalArtists;

    const totalPages = Math.ceil(filteredTotal / perPage);

    // Collection stats (use cached counts, no per-row subqueries)
    let totalCollected = 0;
    let totalReleased = 0;
    const collectionBuckets = { complete: 0, partial: 0, missing: 0 };
    for (const a of artists) {
        totalCollected += a.album_count || 0;
        totalReleased += a.total_released_children || 0;
        if (a.collection_pct === null || a.collection_pct === undefined) { /* unknown */ }
        else if (a.collection_pct >= 100) collectionBuckets.complete++;
        else if (a.collection_pct > 0) collectionBuckets.partial++;
        else collectionBuckets.missing++;
    }

    // Top charts — only compute on page 1 with no search
    let topArtistsByAlbums = [];
    let topArtistsByPlays = [];
    let albumDistData = [];
    if (page === 1 && !search) {
        // Top 15 by album count (fast query, no subqueries)
        const topByAlbums = /** @type {any[]} */ (db.prepare(`
            SELECT title, collected_children as album_count
            FROM media_parents WHERE media_type = 'artist'
            ORDER BY collected_children DESC LIMIT 15
        `).all());
        topArtistsByAlbums = topByAlbums.map(a => ({
            label: a.title.length > 18 ? a.title.substring(0, 16) + '…' : a.title,
            y: a.album_count
        }));

        // Top 15 by play count
        const topByPlays = /** @type {any[]} */ (db.prepare(`
            SELECT mp.title, COALESCE(SUM(mc.play_count), 0) as total_plays
            FROM media_parents mp
            LEFT JOIN media_children mc ON mc.parent_id = mp.id
            WHERE mp.media_type = 'artist'
            GROUP BY mp.id
            HAVING total_plays > 0
            ORDER BY total_plays DESC LIMIT 15
        `).all());
        topArtistsByPlays = topByPlays.map(a => ({
            label: a.title.length > 18 ? a.title.substring(0, 16) + '…' : a.title,
            y: a.total_plays
        }));

        // Album count distribution
        const distRows = /** @type {any[]} */ (db.prepare(`
            SELECT
                CASE WHEN collected_children >= 10 THEN '10+' ELSE CAST(collected_children AS TEXT) END as bucket,
                COUNT(*) as cnt
            FROM media_parents WHERE media_type = 'artist'
            GROUP BY bucket
        `).all());

        albumDistData = distRows
            .sort((a, b) => {
                const an = a.bucket === '10+' ? 10 : Number(a.bucket);
                const bn = b.bucket === '10+' ? 10 : Number(b.bucket);
                return an - bn;
            })
            .map(r => ({ label: `${r.bucket} albums`, y: r.cnt }));
    }

    return {
        totalArtists,
        totalAlbums: albumStats?.total_albums || 0,
        totalPlays: albumStats?.total_plays || 0,
        artists,
        topArtistsByAlbums,
        topArtistsByPlays,
        albumDistData,
        collectionBuckets,
        collectionStats: {
            totalCollected,
            totalReleased,
            overallPct: totalReleased > 0 ? Math.round((totalCollected / totalReleased) * 100) : 100
        },
        pagination: {
            page,
            perPage,
            total: filteredTotal,
            totalPages
        },
        search,
        sort
    };
}
