import db from '$lib/server/db.js';
import { json } from '@sveltejs/kit';

/** @type {import('./$types').RequestHandler} */
export function GET({ locals }) {
  try {
    const userId = locals.user?.id || 0;
    const settings = /** @type {any} */ (db.prepare('SELECT jellyfin_url FROM app_settings WHERE id = 1').get());
    const jellyfinUrl = settings?.jellyfin_url || '';

    // ── All movies with enriched data ────────────────────────────
    const movies = db.prepare(`
        SELECT mp.id, mp.slug, mp.title, mp.release_year, mp.poster_url,
               mp.tmdb_id, mp.imdb_id, mp.jellyfin_id,
               mp.collection_status, mp.arr_status, mp.arr_has_file,
               mp.runtime_minutes,
               MAX(mc.runtime_ticks) as child_runtime_ticks,
               MAX(mc.community_rating) as community_rating,
               MAX(mc.watch_status) as watch_status,
               COALESCE(pc.play_count, 0) as play_count,
               pc.last_played as last_watched
        FROM media_parents mp
        LEFT JOIN media_children mc ON mc.parent_id = mp.id
        LEFT JOIN (
            SELECT mc2.parent_id, COUNT(*) as play_count, MAX(deduped.timestamp) as last_played
            FROM (
                SELECT DISTINCT ph.media_id,
                       CAST(strftime('%s', ph.timestamp) / 43200 AS INTEGER) as time_bucket,
                       MAX(ph.timestamp) as timestamp
                FROM playback_history ph
                JOIN media_children mc2 ON ph.media_id = mc2.id
                WHERE ph.user_id = ?
                GROUP BY ph.media_id, time_bucket
            ) deduped
            JOIN media_children mc2 ON deduped.media_id = mc2.id
            GROUP BY mc2.parent_id
        ) pc ON pc.parent_id = mp.id
        WHERE mp.media_type = 'movie'
          AND mp.collection_status != 'external'
        GROUP BY mp.id
        ORDER BY mp.title
    `).all(userId);

    // ── Genres for each movie ────────────────────────────────────
    const genreRows = /** @type {any[]} */ (db.prepare(`
        SELECT mt.media_parent_id, mt.tag_value
        FROM media_tags mt
        JOIN media_parents mp ON mt.media_parent_id = mp.id
        WHERE mt.tag_type = 'genre' AND mp.media_type = 'movie'
        ORDER BY mt.tag_value
    `).all());

    /** @type {Map<number, string[]>} */
    const genreMap = new Map();
    /** @type {Set<string>} */
    const allGenres = new Set();
    for (const row of genreRows) {
        const genres = genreMap.get(row.media_parent_id) || [];
        genres.push(row.tag_value);
        genreMap.set(row.media_parent_id, genres);
        allGenres.add(row.tag_value);
    }

    // ── Person credits for filtering ─────────────────────────────
    const personRows = /** @type {any[]} */ (db.prepare(`
        SELECT pc.media_parent_id, p.id as person_id, p.name, pc.role_type
        FROM person_credits pc
        JOIN persons p ON pc.person_id = p.id
        JOIN media_parents mp ON pc.media_parent_id = mp.id
        WHERE mp.media_type = 'movie'
          AND pc.role_type IN ('actor', 'director')
        ORDER BY pc.sort_order
    `).all());

    /** @type {Map<number, Array<{id: number, name: string, role: string}>>} */
    const personMap = new Map();
    /** @type {Map<number, string>} */
    const allPersons = new Map();
    for (const row of personRows) {
        const people = personMap.get(row.media_parent_id) || [];
        people.push({ id: row.person_id, name: row.name, role: row.role_type });
        personMap.set(row.media_parent_id, people);
        if (!allPersons.has(row.person_id)) {
            allPersons.set(row.person_id, row.name);
        }
    }

    // ── External ratings (best available) ────────────────────────
    const ratingRows = /** @type {any[]} */ (db.prepare(`
        SELECT er.media_parent_id, er.source, er.value, er.raw_value
        FROM external_ratings er
        JOIN media_parents mp ON er.media_parent_id = mp.id
        WHERE mp.media_type = 'movie' AND er.rating_type = 'score'
    `).all());

    /** @type {Map<number, {source: string, value: number, raw_value: string}>} */
    const ratingMap = new Map();
    const ratingPriority = /** @type {Record<string, number>} */ ({ omdb_imdb: 4, omdb_rt: 3, omdb_metacritic: 2, tmdb: 1 });
    for (const row of ratingRows) {
        const existing = ratingMap.get(row.media_parent_id);
        const newPri = ratingPriority[row.source] || 0;
        const existPri = existing ? (ratingPriority[existing.source] || 0) : -1;
        if (newPri > existPri) {
            ratingMap.set(row.media_parent_id, { source: row.source, value: row.value, raw_value: row.raw_value });
        }
    }

    // Enrich movies with genres, persons, ratings
    const enriched = movies.map((/** @type {any} */ m) => {
        // Determine effective watch status
        let status = m.watch_status || 'unwatched';
        if (m.play_count > 0 && status === 'unwatched') status = 'watched';
        if (m.collection_status === 'wanted') status = 'not_downloaded';

        // Build poster URL
        let posterUrl = m.poster_url;
        if (m.jellyfin_id) {
            posterUrl = `${jellyfinUrl}/Items/${m.jellyfin_id}/Images/Primary?maxHeight=300`;
        }

        const rating = ratingMap.get(m.id);

        // Runtime: prefer TMDB runtime_minutes, fall back to Jellyfin runtime_ticks
        let runtimeMin = m.runtime_minutes || 0;
        if (!runtimeMin && m.child_runtime_ticks) {
            runtimeMin = Math.round(m.child_runtime_ticks / 600000000);
        }

        return {
            id: m.id,
            slug: m.slug,
            title: m.title,
            release_year: m.release_year,
            poster_url: posterUrl,
            runtime_minutes: runtimeMin,
            watch_status: status,
            play_count: m.play_count,
            last_watched: m.last_watched,
            community_rating: m.community_rating,
            rating_value: rating?.value ?? null,
            rating_display: rating?.raw_value ?? null,
            rating_source: rating?.source ?? null,
            genres: genreMap.get(m.id) || [],
            person_ids: (personMap.get(m.id) || []).map(p => p.id),
            collection_status: m.collection_status,
            arr_status: m.arr_status,
            arr_has_file: m.arr_has_file,
            jellyfin_id: m.jellyfin_id,
        };
    });

    // ── Movies by Year/Decade (frontend computes watched/unwatched from movies array)
    // We just need the unique decades/years for axis labels; stacked data comes from movies[]

    // ── Top Rewatched (play_count >= 2, whole numbers only) ──────
    const topRewatched = db.prepare(`
        SELECT mp.id, mp.slug, mp.title, mp.poster_url, mp.jellyfin_id, mp.release_year,
               COUNT(*) as play_count
        FROM media_parents mp
        JOIN media_children mc ON mc.parent_id = mp.id
        JOIN (
            SELECT DISTINCT media_id, CAST(strftime('%s', timestamp) / 43200 AS INTEGER) as time_bucket
            FROM playback_history
        ) deduped ON deduped.media_id = mc.id
        WHERE mp.media_type = 'movie'
        GROUP BY mp.id HAVING play_count >= 2
        ORDER BY play_count DESC LIMIT 20
    `).all();

    // Enrich top rewatched with poster URLs
    const topRewatchedEnriched = topRewatched.map((/** @type {any} */ m) => ({
        ...m,
        poster_url: m.jellyfin_id
            ? `${jellyfinUrl}/Items/${m.jellyfin_id}/Images/Primary?maxHeight=300`
            : m.poster_url,
    }));

    // ── Genre list for filter dropdown (with counts, popular first) ─
    /** @type {Map<string, number>} */
    const genreCounts = new Map();
    for (const row of genreRows) {
        genreCounts.set(row.tag_value, (genreCounts.get(row.tag_value) || 0) + 1);
    }
    // Only genres with 2+ movies, sorted by count desc
    const genres = [...genreCounts.entries()]
        .filter(([, count]) => count >= 2)
        .sort((a, b) => b[1] - a[1])
        .map(([name, count]) => ({ name, count }));

    // ── All persons for filter (actors + directors with movies) ────
    const topPersons = /** @type {any[]} */ (db.prepare(`
        SELECT p.id, p.name, p.is_favorite,
               COUNT(DISTINCT pc.media_parent_id) as movie_count,
               COALESCE(w.watched_count, 0) as watched_count
        FROM person_credits pc
        JOIN persons p ON pc.person_id = p.id
        JOIN media_parents mp ON pc.media_parent_id = mp.id
        LEFT JOIN (
            SELECT pc2.person_id, COUNT(DISTINCT mc2.parent_id) as watched_count
            FROM person_credits pc2
            JOIN media_children mc2 ON mc2.parent_id = pc2.media_parent_id
            JOIN playback_history ph ON ph.media_id = mc2.id AND ph.user_id = ?
            WHERE pc2.role_type IN ('actor', 'director')
            GROUP BY pc2.person_id
        ) w ON w.person_id = p.id
        WHERE mp.media_type = 'movie' AND pc.role_type IN ('actor', 'director')
          AND mp.collection_status != 'external'
        GROUP BY p.id
        ORDER BY p.name
    `).all(userId));

    return json({
        movies: enriched,
        genres,
        topPersons,
        topRewatched: topRewatchedEnriched,
    });
  } catch (err) {
    console.error('[library API] Error:', err);
    return json({ error: err.message, movies: [], genres: [], topPersons: [], topRewatched: [] }, { status: 500 });
  }
}
