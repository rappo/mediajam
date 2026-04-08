import db from '$lib/server/db.js';
import {
    getHomepagePrefs,
    getRecentListening,
    getNewFromFavorites,
    getRediscoverArtists,
    getHeavyRotation,
    getUnplayedAlbums,
    getItsBeenAWhile,
} from '$lib/server/homepage-engine.js';
import { json } from '@sveltejs/kit';
import { getPrecomputed, setPrecomputed } from '$lib/server/section-cache.js';

export function GET({ locals, url }) {
    const userId = locals.user?.id || 0;
    const prefs = getHomepagePrefs();
    const view = url.searchParams.get('view') || 'smart';

    // Time filter params (used by both views)
    const TIME_MAP = { '7': 7, '30': 30, '90': 90, '180': 180, '365': 365, '0': 0 };
    const rotationTime = url.searchParams.get('rotation_time') || '30';
    const recentTime = url.searchParams.get('recent_time') || '0';
    const awhileTime = url.searchParams.get('awhile_time') || '6';
    const rotationDays = TIME_MAP[rotationTime] ?? 30;
    const recentDays = TIME_MAP[recentTime] ?? 0;
    const AWHILE_MAP = { '3': 3, '6': 6, '12': 12, '24': 24 };
    const awhileMonths = AWHILE_MAP[awhileTime] ?? 6;

    if (view === 'library') {
        // ── LIBRARY VIEW: table + charts ──────────────────────────
        const page = parseInt(url.searchParams.get('page') || '1');
        const perPage = 50;
        const offset = (page - 1) * perPage;
        const search = url.searchParams.get('q') || '';
        const sort = url.searchParams.get('sort') || 'plays';

        let orderBy = 'total_plays DESC';
        if (sort === 'albums') orderBy = 'mp.collected_children DESC';
        else if (sort === 'name') orderBy = 'mp.title ASC';

        const searchFilter = search ? "AND mp.title LIKE '%' || ? || '%'" : '';
        const searchParams = search ? [search] : [];

        const totalArtists = /** @type {any} */ (
            db.prepare('SELECT COUNT(*) as c FROM media_parents WHERE media_type = ?').get('artist')
        ).c;

        const artists = /** @type {any[]} */ (db.prepare(`
            SELECT
                mp.id, mp.title, mp.poster_url, mp.collection_status,
                mp.collected_children as album_count, mp.total_released_children,
                mp.arr_status, mp.musicbrainz_id,
                COALESCE(pc.play_count, 0) as total_plays,
                CASE WHEN mp.total_released_children > 0
                    THEN ROUND(CAST(mp.collected_children AS REAL) / mp.total_released_children * 100, 1)
                    ELSE NULL END as collection_pct
            FROM media_parents mp
            LEFT JOIN (
                SELECT mc2.parent_id, COUNT(*) as play_count
                FROM (
                    SELECT DISTINCT ph.media_id, CAST(strftime('%s', ph.timestamp) / 300 AS INTEGER) as time_bucket
                    FROM playback_history ph WHERE ph.user_id = ?
                ) deduped
                JOIN media_children mc2 ON deduped.media_id = mc2.id
                GROUP BY mc2.parent_id
            ) pc ON pc.parent_id = mp.id
            WHERE mp.media_type = 'artist' ${searchFilter}
            ORDER BY ${orderBy}
            LIMIT ? OFFSET ?
        `).all(userId, ...searchParams, perPage, offset));

        for (const a of artists) { a.watch_count = a.total_plays; }

        const filteredTotal = search
            ? /** @type {any} */ (db.prepare(
                `SELECT COUNT(*) as c FROM media_parents WHERE media_type = 'artist' AND title LIKE '%' || ? || '%'`
            ).get(search)).c
            : totalArtists;

        const totalPages = Math.ceil(filteredTotal / perPage);

        // Charts
        const topArtistsByAlbums = /** @type {any[]} */ (db.prepare(`
            SELECT title, collected_children as album_count
            FROM media_parents WHERE media_type = 'artist'
            ORDER BY collected_children DESC LIMIT 15
        `).all()).map(a => ({
            label: a.title.length > 18 ? a.title.substring(0, 16) + '…' : a.title,
            y: a.album_count
        }));

        const topArtistsByPlays = /** @type {any[]} */ (db.prepare(`
            SELECT mp.title, COALESCE(SUM(mc.play_count), 0) as total_plays
            FROM media_parents mp
            LEFT JOIN media_children mc ON mc.parent_id = mp.id
            WHERE mp.media_type = 'artist'
            GROUP BY mp.id HAVING total_plays > 0
            ORDER BY total_plays DESC LIMIT 15
        `).all()).map(a => ({
            label: a.title.length > 18 ? a.title.substring(0, 16) + '…' : a.title,
            y: a.total_plays
        }));

        const albumDistData = /** @type {any[]} */ (db.prepare(`
            SELECT
                CASE WHEN collected_children >= 10 THEN '10+' ELSE CAST(collected_children AS TEXT) END as bucket,
                COUNT(*) as cnt
            FROM media_parents WHERE media_type = 'artist'
            GROUP BY bucket
        `).all()).sort((a, b) => {
            const an = a.bucket === '10+' ? 10 : Number(a.bucket);
            const bn = b.bucket === '10+' ? 10 : Number(b.bucket);
            return an - bn;
        }).map(r => ({ label: `${r.bucket} albums`, y: r.cnt }));

        // Collection stats
        let totalCollected = 0, totalReleased = 0;
        const collectionBuckets = { complete: 0, partial: 0, missing: 0 };
        for (const a of artists) {
            totalCollected += a.album_count || 0;
            totalReleased += a.total_released_children || 0;
            if (a.collection_pct === null || a.collection_pct === undefined) { /* unknown */ }
            else if (a.collection_pct >= 100) collectionBuckets.complete++;
            else if (a.collection_pct > 0) collectionBuckets.partial++;
            else collectionBuckets.missing++;
        }

        return json({
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
            pagination: { page, perPage, total: filteredTotal, totalPages },
            search,
            sort,
        });
    }

    // ── SMART VIEW: serve from precomputed cache (default filters only) ──
    const isDefaultFilters = rotationTime === '30' && recentTime === '0' && awhileTime === '6';
    const cacheKey = `music-smart-${userId}`;
    const section = url.searchParams.get('section'); // optional: load one section at a time

    if (isDefaultFilters && !section) {
        const cached = getPrecomputed(cacheKey);
        if (cached) {
            return json(cached.data);
        }
    }

    // Helper to run just one section or all
    const sectionFns = {
        recentListening: () => getRecentListening(userId, prefs.maxItemsPerSection, recentDays),
        newFromFavorites: () => getNewFromFavorites(userId, prefs.maxItemsPerSection),
        rediscover: () => getRediscoverArtists(userId, prefs),
        heavyRotation: () => getHeavyRotation(userId, prefs.maxItemsPerSection, rotationDays),
        unplayedAlbums: () => getUnplayedAlbums(userId, prefs.maxItemsPerSection),
        itsBeenAWhile: () => getItsBeenAWhile(userId, awhileMonths, prefs.maxItemsPerSection),
    };

    // If a single section is requested, just compute and return that one
    if (section && sectionFns[section]) {
        try {
            const data = sectionFns[section]();
            return json({ sections: { [section]: data }, timeFilters: { rotationTime, recentTime, awhileTime } });
        } catch (e) {
            console.error(`[music] Section ${section} error:`, e instanceof Error ? e.message : e);
            return json({ sections: { [section]: [] }, timeFilters: { rotationTime, recentTime, awhileTime } });
        }
    }

    // Cache miss or custom filters — compute all live
    const sections = {};
    for (const [name, fn] of Object.entries(sectionFns)) {
        try {
            const t0 = Date.now();
            sections[name] = fn();
            console.log(`[music] ${name}: ${Date.now() - t0}ms`);
        } catch (e) {
            console.error(`[music] ${name} error:`, e instanceof Error ? e.message : e);
            sections[name] = [];
        }
    }

    const result = {
        sections,
        timeFilters: { rotationTime, recentTime, awhileTime },
    };

    // Save to cache when using default filters
    if (isDefaultFilters) {
        try { setPrecomputed(cacheKey, result); } catch { /* non-fatal */ }
    }

    return json(result);
}
