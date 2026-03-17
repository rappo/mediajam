const Database = require('better-sqlite3');
const db = new Database('/home/rappo/Documents/projects/mediajam/mediajam.sqlite', { readonly: true });

const userId = 1;

function time(label, fn) {
    const t0 = Date.now();
    const result = fn();
    const ms = Date.now() - t0;
    console.log(`${label}: ${ms}ms  (${Array.isArray(result) ? result.length + ' rows' : 'ok'})`);
    return result;
}

// 1. getRecentListening
time('recentListening', () => db.prepare(`
    SELECT mc.id, mc.title, MAX(ph.timestamp) as last_played
    FROM playback_history ph
    JOIN media_children mc ON ph.media_id = mc.id
    JOIN media_parents mp ON mc.parent_id = mp.id
    WHERE mp.media_type = 'artist' AND ph.user_id = ?
    GROUP BY mc.id ORDER BY last_played DESC LIMIT 12
`).all(userId));

// 2. getNewFromFavorites (optimized)
time('newFromFavorites', () => db.prepare(`
    SELECT mc.id, mc.title
    FROM media_parents mp
    JOIN media_children mc ON mc.parent_id = mp.id
    LEFT JOIN playback_history ph ON ph.media_id = mc.id AND ph.user_id = ?
    WHERE mp.media_type = 'artist' AND mp.is_favorite = 1 AND mc.play_count = 0 AND ph.id IS NULL
    ORDER BY mp.title ASC, mc.item_number DESC LIMIT 12
`).all(userId));

// 3. getRediscoverArtists
time('rediscover', () => db.prepare(`
    SELECT mp.id, mp.title, MAX(ph.timestamp) as last_played,
           COUNT(DISTINCT CASE WHEN ph.id IS NOT NULL THEN mc.id END) as played_albums,
           COUNT(DISTINCT mc.id) as total_albums
    FROM media_parents mp
    JOIN media_children mc ON mc.parent_id = mp.id
    LEFT JOIN playback_history ph ON ph.media_id = mc.id AND ph.user_id = ?
    WHERE mp.media_type = 'artist' AND mp.is_favorite = 1
    GROUP BY mp.id
    HAVING last_played IS NULL OR last_played < '2025-09-01'
    ORDER BY CASE WHEN last_played IS NULL THEN 0 ELSE 1 END, last_played ASC
    LIMIT 8
`).all(userId));

// 4. getHeavyRotation
const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 30);
time('heavyRotation', () => db.prepare(`
    SELECT mc.id, mc.title,
           COUNT(DISTINCT deduped.time_bucket) as recent_plays
    FROM (
        SELECT ph.media_id,
               CAST(strftime('%s', ph.timestamp) / 300 AS INTEGER) as time_bucket
        FROM playback_history ph
        WHERE ph.user_id = ? AND ph.timestamp > ?
    ) deduped
    JOIN media_children mc ON deduped.media_id = mc.id
    JOIN media_parents mp ON mc.parent_id = mp.id
    WHERE mp.media_type = 'artist'
    GROUP BY mc.id ORDER BY recent_plays DESC LIMIT 12
`).all(userId, cutoff.toISOString()));

// 5. getUnplayedAlbums (optimized)
time('unplayedAlbums', () => db.prepare(`
    SELECT mc.id, mc.title
    FROM media_children mc
    JOIN media_parents mp ON mc.parent_id = mp.id
    LEFT JOIN playback_history ph ON ph.media_id = mc.id AND ph.user_id = ?
    WHERE mp.media_type = 'artist' AND mc.play_count = 0 AND mc.jellyfin_id IS NOT NULL AND ph.id IS NULL
    ORDER BY mp.is_favorite DESC, SUBSTR(hex(mc.id * 2654435761), 1, 8)
    LIMIT 12
`).all(userId));

// 6. getItsBeenAWhile (optimized)
const cutoff2 = new Date(); cutoff2.setMonth(cutoff2.getMonth() - 6);
time('itsBeenAWhile', () => db.prepare(`
    SELECT mc.id, mc.title, mc.play_count as total_plays, MAX(ph.timestamp) as last_played
    FROM playback_history ph
    JOIN media_children mc ON ph.media_id = mc.id
    JOIN media_parents mp ON mc.parent_id = mp.id
    WHERE mp.media_type = 'artist' AND ph.user_id = ?
    GROUP BY mc.id
    HAVING mc.play_count >= 3 AND last_played < ?
    ORDER BY mc.play_count DESC, last_played ASC LIMIT 12
`).all(userId, cutoff2.toISOString()));

db.close();
