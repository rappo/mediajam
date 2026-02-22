import db from '$lib/server/db.js';

/** @type {import('./$types').PageServerLoad} */
export function load() {
    const totalArtists = db.prepare('SELECT COUNT(*) as c FROM media_parents WHERE media_type = ?').get('artist').c;

    const albumStats = db.prepare(`
        SELECT
            COUNT(*) as total_albums,
            SUM(play_count) as total_plays
        FROM media_children mc
        JOIN media_parents mp ON mc.parent_id = mp.id
        WHERE mp.media_type = 'artist'
    `).get();

    // Artists with album counts and collection info
    const artists = db.prepare(`
        SELECT
            mp.id,
            mp.title,
            mp.poster_url,
            mp.collected_children as album_count,
            mp.total_released_children,
            mp.musicbrainz_id,
            COALESCE((SELECT SUM(mc.play_count) FROM media_children mc WHERE mc.parent_id = mp.id), 0) as total_plays,
            CASE WHEN mp.total_released_children > 0
                THEN ROUND(CAST(mp.collected_children AS REAL) / mp.total_released_children * 100, 1)
                ELSE NULL END as collection_pct
        FROM media_parents mp
        WHERE mp.media_type = 'artist'
        ORDER BY mp.collected_children DESC
    `).all();

    // Collection stats
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

    // Top 15 artists by album count
    const topArtistsByAlbums = artists.slice(0, 15).map(a => ({
        label: a.title.length > 18 ? a.title.substring(0, 16) + '…' : a.title,
        y: a.album_count
    }));

    // Top artists by play count
    const topArtistsByPlays = artists
        .filter(a => a.total_plays > 0)
        .sort((a, b) => b.total_plays - a.total_plays)
        .slice(0, 15)
        .map(a => ({
            label: a.title.length > 18 ? a.title.substring(0, 16) + '…' : a.title,
            y: a.total_plays
        }));

    // Album count distribution
    const albumDistribution = {};
    for (const a of artists) {
        const bucket = a.album_count >= 10 ? '10+' : String(a.album_count);
        albumDistribution[bucket] = (albumDistribution[bucket] || 0) + 1;
    }

    const albumDistData = Object.entries(albumDistribution)
        .sort((a, b) => {
            const an = a[0] === '10+' ? 10 : Number(a[0]);
            const bn = b[0] === '10+' ? 10 : Number(b[0]);
            return an - bn;
        })
        .map(([label, count]) => ({ label: `${label} albums`, y: count }));

    return {
        totalArtists,
        totalAlbums: albumStats.total_albums || 0,
        totalPlays: albumStats.total_plays || 0,
        artists,
        topArtistsByAlbums,
        topArtistsByPlays,
        albumDistData,
        collectionBuckets,
        collectionStats: {
            totalCollected,
            totalReleased,
            overallPct: totalReleased > 0 ? Math.round((totalCollected / totalReleased) * 100) : 100
        }
    };
}
