/**
 * Homepage recommendation engine — shared across Movies/TV/Music landing pages.
 * Each function takes a userId and returns structured section data with "reason" tags.
 */
import db from '$lib/server/db.js';

// ── Seeded shuffle (deterministic per seed, changes daily) ──────────────────

/** @returns {number} A seed that changes once per day */
function dailySeed() {
    const d = new Date();
    return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
}

/**
 * Fisher-Yates shuffle with a simple seeded PRNG.
 * Same seed always produces the same order.
 * @template T
 * @param {T[]} arr
 * @param {number} seed
 * @returns {T[]}
 */
function seededShuffle(arr, seed) {
    const copy = [...arr];
    let s = seed;
    for (let i = copy.length - 1; i > 0; i--) {
        s = (s * 1664525 + 1013904223) & 0x7fffffff;
        const j = s % (i + 1);
        [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
}

// ── Preferences ─────────────────────────────────────────────────────────────

const DEFAULTS = {
    patternThreshold: 2,       // min watches to detect a pattern (director/actor streak)
    recentDays: 14,            // look-back window for pattern detection
    lookaheadDaysDefault: 7,   // initial calendar window
    lookaheadDaysMax: 30,      // expand if too few results
    minCalendarResults: 3,     // expand to max if fewer than this
    maxBecauseYouLove: 3,      // max "Because You Love X" sections
    maxItemsPerSection: 12,    // max items in a section row
    rediscoverMonths: 3,       // months since last play to trigger "Rediscover"
};

/** @returns {typeof DEFAULTS} */
export function getHomepagePrefs() {
    try {
        const row = /** @type {any} */ (
            db.prepare('SELECT homepage_preferences FROM app_settings WHERE id = 1').get()
        );
        const parsed = row?.homepage_preferences ? JSON.parse(row.homepage_preferences) : {};
        return { ...DEFAULTS, ...parsed };
    } catch {
        // Column may not exist yet (migration not run); return defaults
        return { ...DEFAULTS };
    }
}

// ── Movies ──────────────────────────────────────────────────────────────────

/**
 * Detect viewing patterns — directors/actors with threshold+ watches in recentDays.
 * Returns a hero section: { title, subtitle, items[], person, role }
 * @param {number} userId
 * @param {typeof DEFAULTS} prefs
 */
export function detectMoviePatterns(userId, prefs) {
    const patterns = /** @type {any[]} */ (db.prepare(`
        SELECT p.id as person_id, p.name, pc.role_type,
               COUNT(DISTINCT mp.id) as watch_count,
               GROUP_CONCAT(DISTINCT mp.title) as watched_titles
        FROM playback_history ph
        JOIN media_children mc ON ph.media_id = mc.id
        JOIN media_parents mp ON mc.parent_id = mp.id
        JOIN person_credits pc ON pc.media_parent_id = mp.id
        JOIN persons p ON pc.person_id = p.id
        WHERE ph.user_id = ? AND mp.media_type = 'movie'
          AND ph.timestamp >= datetime('now', ?)
          AND pc.role_type IN ('director', 'actor')
        GROUP BY p.id, pc.role_type
        HAVING watch_count >= ?
        ORDER BY watch_count DESC
        LIMIT 5
    `).all(userId, `-${prefs.recentDays} days`, prefs.patternThreshold));

    if (patterns.length === 0) return null;

    // Pick the strongest pattern (prefer directors over actors at same count)
    const best = patterns.sort((a, b) => {
        if (b.watch_count !== a.watch_count) return b.watch_count - a.watch_count;
        return a.role_type === 'director' ? -1 : 1;
    })[0];

    // Find unwatched movies by this person
    const unwatched = /** @type {any[]} */ (db.prepare(`
        SELECT DISTINCT mp.id, mp.title, mp.poster_url, mp.release_year, mp.overview
        FROM person_credits pc
        JOIN media_parents mp ON pc.media_parent_id = mp.id
        JOIN media_children mc ON mc.parent_id = mp.id
        WHERE pc.person_id = ? AND pc.role_type = ?
          AND mp.media_type = 'movie'
          AND mc.watch_status != 'watched'
        ORDER BY mp.release_year DESC
        LIMIT ?
    `).all(best.person_id, best.role_type, prefs.maxItemsPerSection));

    if (unwatched.length === 0) return null;

    const watchedTitles = best.watched_titles.split(',');
    const roleLabel = best.role_type === 'director' ? 'directed by' : 'starring';
    const watchedList = watchedTitles.length <= 3
        ? watchedTitles.join(', ')
        : watchedTitles.slice(0, 3).join(', ') + ` and ${watchedTitles.length - 3} more`;

    return {
        title: `Continue the ${best.name} ${best.role_type === 'director' ? 'Marathon' : 'Binge'}`,
        subtitle: `You watched ${watchedList} recently`,
        person: best.name,
        role: best.role_type,
        reason: `${roleLabel} ${best.name}`,
        items: unwatched,
    };
}

/**
 * Contextual person-based recommendations with accurate labels.
 * Priority: favorited people → most-watched people → most-credited people.
 * Returns sections with a contextual sectionTitle like "Because You Favorited",
 * "Because You've Watched", or "More from".
 * @param {number} userId
 * @param {typeof DEFAULTS} prefs
 */
export function getBecauseYouLove(userId, prefs) {
    /**
     * Find unwatched movies for a given person+role.
     * @param {number} personId
     * @param {string} roleType
     * @returns {any[]}
     */
    function getUnwatchedByPerson(personId, roleType) {
        return /** @type {any[]} */ (db.prepare(`
            SELECT DISTINCT mp.id, mp.title, mp.poster_url, mp.release_year
            FROM person_credits pc
            JOIN media_parents mp ON pc.media_parent_id = mp.id
            JOIN media_children mc ON mc.parent_id = mp.id
            WHERE pc.person_id = ? AND pc.role_type = ?
              AND mp.media_type = 'movie'
              AND mc.watch_status != 'watched'
              AND NOT EXISTS (
                  SELECT 1 FROM playback_history ph WHERE ph.media_id = mc.id
              )
            ORDER BY mp.release_year DESC
            LIMIT ?
        `).all(personId, roleType, prefs.maxItemsPerSection));
    }

    /** @type {Array<{person: string, personId: number, photoUrl: string|null, role: string, totalInLibrary: number, reason: string, sectionTitle: string, items: any[]}>} */
    const eligible = [];
    /** @type {Set<string>} */
    const usedKeys = new Set();

    // ── Tier 1: Favorited people ────────────────────────────────────────
    const favorited = /** @type {any[]} */ (db.prepare(`
        SELECT p.id as person_id, p.name, p.photo_url, pc.role_type,
               COUNT(DISTINCT pc.media_parent_id) as total_movies
        FROM persons p
        JOIN person_credits pc ON pc.person_id = p.id
        JOIN media_parents mp ON pc.media_parent_id = mp.id
        WHERE p.is_favorite = 1
          AND pc.role_type IN ('actor', 'director') AND mp.media_type = 'movie'
        GROUP BY p.id, pc.role_type
        ORDER BY total_movies DESC
        LIMIT 20
    `).all());

    for (const person of favorited) {
        const key = `${person.person_id}-${person.role_type}`;
        if (usedKeys.has(key)) continue;
        const unwatched = getUnwatchedByPerson(person.person_id, person.role_type);
        if (unwatched.length < 2) continue;
        usedKeys.add(key);
        const roleLabel = person.role_type === 'director' ? 'directed by' : 'starring';
        eligible.push({
            person: person.name, personId: person.person_id, photoUrl: person.photo_url,
            role: person.role_type, totalInLibrary: person.total_movies,
            sectionTitle: `Because You Favorited ${person.name}`,
            reason: `${roleLabel} ${person.name}`,
            items: unwatched,
        });
    }

    // ── Tier 2: Most-watched people (3+ movies watched) ────────────────
    const mostWatched = /** @type {any[]} */ (db.prepare(`
        SELECT p.id as person_id, p.name, p.photo_url, pc.role_type,
               COUNT(DISTINCT mp.id) as watched_count,
               (SELECT COUNT(DISTINCT pc2.media_parent_id) FROM person_credits pc2
                JOIN media_parents mp2 ON pc2.media_parent_id = mp2.id
                WHERE pc2.person_id = p.id AND pc2.role_type = pc.role_type
                AND mp2.media_type = 'movie') as total_movies
        FROM persons p
        JOIN person_credits pc ON pc.person_id = p.id
        JOIN media_parents mp ON pc.media_parent_id = mp.id
        JOIN media_children mc ON mc.parent_id = mp.id
        JOIN playback_history ph ON ph.media_id = mc.id AND ph.user_id = ?
        WHERE pc.role_type IN ('actor', 'director') AND mp.media_type = 'movie'
        GROUP BY p.id, pc.role_type
        HAVING watched_count >= 3
        ORDER BY watched_count DESC
        LIMIT 30
    `).all(userId));

    for (const person of mostWatched) {
        const key = `${person.person_id}-${person.role_type}`;
        if (usedKeys.has(key)) continue;
        const unwatched = getUnwatchedByPerson(person.person_id, person.role_type);
        if (unwatched.length < 2) continue;
        usedKeys.add(key);
        const roleLabel = person.role_type === 'director' ? 'directed by' : 'starring';
        eligible.push({
            person: person.name, personId: person.person_id, photoUrl: person.photo_url,
            role: person.role_type, totalInLibrary: person.total_movies,
            sectionTitle: `Because You've Watched ${person.name}`,
            reason: `${roleLabel} ${person.name}`,
            items: unwatched,
        });
    }

    // ── Tier 3: Most-credited people (fallback) ────────────────────────
    const topCredited = /** @type {any[]} */ (db.prepare(`
        SELECT p.id as person_id, p.name, p.photo_url, pc.role_type,
               COUNT(DISTINCT pc.media_parent_id) as total_movies
        FROM persons p
        JOIN person_credits pc ON pc.person_id = p.id
        JOIN media_parents mp ON pc.media_parent_id = mp.id
        WHERE pc.role_type IN ('actor', 'director') AND mp.media_type = 'movie'
        GROUP BY p.id, pc.role_type
        HAVING total_movies >= 3
        ORDER BY total_movies DESC
        LIMIT 30
    `).all());

    for (const person of topCredited) {
        const key = `${person.person_id}-${person.role_type}`;
        if (usedKeys.has(key)) continue;
        const unwatched = getUnwatchedByPerson(person.person_id, person.role_type);
        if (unwatched.length < 2) continue;
        usedKeys.add(key);
        const roleLabel = person.role_type === 'director' ? 'directed by' : 'starring';
        eligible.push({
            person: person.name, personId: person.person_id, photoUrl: person.photo_url,
            role: person.role_type, totalInLibrary: person.total_movies,
            sectionTitle: `More from ${person.name}`,
            reason: `${roleLabel} ${person.name}`,
            items: unwatched,
        });
    }

    // Daily shuffle so it rotates which people are featured
    const shuffled = seededShuffle(eligible, dailySeed());
    return shuffled.slice(0, prefs.maxBecauseYouLove);
}

/**
 * Recently watched movies — chronological timeline.
 * @param {number} userId
 * @param {number} limit
 */
export function getRecentlyWatchedMovies(userId, limit = 20) {
    return /** @type {any[]} */ (db.prepare(`
        SELECT DISTINCT mp.id, mp.title, mp.poster_url, mp.release_year,
               MAX(ph.timestamp) as last_watched, ph.source
        FROM playback_history ph
        JOIN media_children mc ON ph.media_id = mc.id
        JOIN media_parents mp ON mc.parent_id = mp.id
        WHERE mp.media_type = 'movie' AND ph.user_id = ?
          AND mp.poster_url IS NOT NULL AND ph.timestamp > '2000-01-01'
        GROUP BY mp.id
        ORDER BY last_watched DESC
        LIMIT ?
    `).all(userId, limit));
}

/**
 * Unwatched movies in library — truly unwatched (no playback_history),
 * excludes not-downloaded/wanted movies, shuffled daily.
 * @param {number} limit
 */
export function getUnwatchedMovies(limit = 20) {
    // Fetch a larger pool so we can shuffle and still fill the section
    const pool = /** @type {any[]} */ (db.prepare(`
        SELECT mp.id, mp.title, mp.poster_url, mp.release_year, mp.overview,
               mp.arr_status, mp.collection_status
        FROM media_parents mp
        JOIN media_children mc ON mc.parent_id = mp.id
        WHERE mp.media_type = 'movie'
          AND mc.watch_status = 'unwatched'
          AND mp.poster_url IS NOT NULL
          AND mp.collection_status != 'wanted'
          AND NOT EXISTS (
              SELECT 1 FROM playback_history ph WHERE ph.media_id = mc.id
          )
        ORDER BY mp.release_year DESC
        LIMIT ?
    `).all(limit * 4));

    // Daily shuffle so different movies surface each day
    return seededShuffle(pool, dailySeed()).slice(0, limit);
}

/**
 * Recommended movies — unwatched movies sharing tags with recently watched.
 * Uses a daily seed so recommendations rotate.
 * @param {number} userId
 * @param {number} limit
 */
export function getRecommendedMovies(userId, limit = 12) {
    // Step 1: Get tags from recently watched movies (last 30 days or last 10 movies)
    const recentTags = /** @type {any[]} */ (db.prepare(`
        SELECT DISTINCT mt.tag_type, mt.tag_value, COUNT(*) as freq
        FROM media_tags mt
        JOIN media_parents mp ON mt.media_parent_id = mp.id
        JOIN media_children mc ON mc.parent_id = mp.id
        JOIN playback_history ph ON ph.media_id = mc.id
        WHERE mp.media_type = 'movie' AND ph.user_id = ?
          AND mt.tag_type IN ('genre', 'theme', 'mood', 'setting')
        GROUP BY mt.tag_type, mt.tag_value
        ORDER BY freq DESC
        LIMIT 15
    `).all(userId));

    if (recentTags.length === 0) return [];

    // Step 2: Build tag value list for matching
    const tagValues = recentTags.map(t => t.tag_value);
    const placeholders = tagValues.map(() => '?').join(',');

    // Step 3: Find unwatched movies that share these tags, scored by match count
    const candidates = /** @type {any[]} */ (db.prepare(`
        SELECT mp.id, mp.title, mp.poster_url, mp.release_year, mp.overview,
               mp.community_rating,
               COUNT(DISTINCT mt.tag_value) as tag_matches,
               GROUP_CONCAT(DISTINCT mt.tag_value) as matched_tags
        FROM media_parents mp
        JOIN media_children mc ON mc.parent_id = mp.id
        JOIN media_tags mt ON mt.media_parent_id = mp.id
        WHERE mp.media_type = 'movie'
          AND mc.watch_status = 'unwatched'
          AND mp.poster_url IS NOT NULL
          AND mp.collection_status != 'wanted'
          AND mt.tag_value IN (${placeholders})
          AND NOT EXISTS (
              SELECT 1 FROM playback_history ph WHERE ph.media_id = mc.id
          )
        GROUP BY mp.id
        ORDER BY tag_matches DESC, mp.community_rating DESC
        LIMIT ?
    `).all(...tagValues, limit * 3));

    if (candidates.length === 0) return [];

    // Step 4: Weighted shuffle — top matches more likely to appear but not deterministic
    const shuffled = seededShuffle(candidates, dailySeed() + 7);
    return shuffled.slice(0, limit).map(c => ({
        ...c,
        reason: c.matched_tags?.split(',').slice(0, 3).join(', ') || '',
    }));
}

// ── TV Shows ────────────────────────────────────────────────────────────────

/**
 * Episodes airing in the next 3 weeks — grouped by date with download/availability status.
 * @param {typeof DEFAULTS} prefs
 */
export function getAiringThisWeek(prefs) {
    // Start from Monday of the current week
    const now = new Date();
    const dayOfWeek = now.getDay();
    const monday = new Date(now);
    monday.setDate(now.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
    monday.setHours(0, 0, 0, 0);
    // 3 weeks = 21 days
    const endDate = new Date(monday);
    endDate.setDate(monday.getDate() + 20);
    endDate.setHours(23, 59, 59);

    const mondayISO = monday.toISOString().split('T')[0];
    const endISO = endDate.toISOString().split('T')[0];

    const episodes = /** @type {any[]} */ (db.prepare(`
        SELECT mc.id as episode_id, mc.title as episode_title,
               mc.season_number, mc.item_number, mc.premiere_date,
               mc.watch_status, mc.is_collected,
               mp.id as show_id, mp.title as show_title, mp.poster_url,
               mp.arr_status
        FROM media_children mc
        JOIN media_parents mp ON mc.parent_id = mp.id
        WHERE mp.media_type = 'show'
          AND mc.premiere_date IS NOT NULL
          AND date(mc.premiere_date) >= ?
          AND date(mc.premiere_date) <= ?
          AND mc.is_special = 0
        ORDER BY mc.premiere_date ASC, mp.title ASC
    `).all(mondayISO, endISO));

    // Group by date
    /** @type {Record<string, any[]>} */
    const byDate = {};
    // Pre-populate all 21 days
    for (let i = 0; i < 21; i++) {
        const d = new Date(monday);
        d.setDate(monday.getDate() + i);
        const key = d.toISOString().split('T')[0];
        byDate[key] = [];
    }

    for (const ep of episodes) {
        const dateKey = ep.premiere_date.split('T')[0];
        if (!byDate[dateKey]) byDate[dateKey] = [];
        // Determine status
        let status = 'not_aired';
        const airDate = new Date(ep.premiere_date);
        if (airDate <= now) {
            status = ep.is_collected ? 'downloaded' : 'available';
        }
        byDate[dateKey].push({ ...ep, status });
    }

    return Object.entries(byDate).map(([date, eps]) => ({ date, episodes: eps }));
}

/**
 * Recently aired unwatched episodes — what you need to catch up on.
 * @param {typeof DEFAULTS} _prefs
 * @param {number} limit
 */
export function getNewUnwatchedEpisodes(_prefs, userId = 0, limit = 15) {
    // Only show episodes from shows the user is engaged with:
    // - Caught up: watched >= 80% of collected episodes
    // - Nearly caught up: at most 5 episodes behind
    // - Recently active: has playback history in the last 90 days
    const episodes = /** @type {any[]} */ (db.prepare(`
        SELECT mc.id as episode_id, mc.title as episode_title,
               mc.season_number, mc.item_number, mc.premiere_date,
               mc.watch_status, mc.is_collected,
               mp.id as show_id, mp.title as show_title, mp.poster_url,
               mp.arr_status
        FROM media_children mc
        JOIN media_parents mp ON mc.parent_id = mp.id
        WHERE mp.media_type = 'show'
          AND mc.premiere_date IS NOT NULL
          AND date(mc.premiere_date) <= date('now')
          AND date(mc.premiere_date) >= date('now', '-30 days')
          AND mc.watch_status != 'watched'
          AND mc.is_special = 0
          AND (
              -- Caught up: watched >= 80% of collected episodes
              (mp.collected_children > 0 AND mp.watched_children >= mp.collected_children * 0.8)
              -- Nearly caught up: at most 5 episodes behind
              OR (mp.collected_children > 0 AND (mp.collected_children - mp.watched_children) <= 5)
              -- Recently active: has playback in last 90 days
              OR mp.id IN (
                  SELECT DISTINCT mc2.parent_id
                  FROM playback_history ph
                  JOIN media_children mc2 ON ph.media_id = mc2.id
                  WHERE ph.user_id = ? AND ph.timestamp >= datetime('now', '-90 days')
              )
          )
        ORDER BY mc.premiere_date DESC
        LIMIT ?
    `).all(userId, limit));

    return episodes.map(ep => ({
        ...ep,
        status: ep.is_collected ? 'downloaded' : 'available',
    }));
}

/**
 * Shows you're behind on — started watching but have unwatched episodes.
 * Sorted by progress percentage (shows you've started rank higher).
 * @param {number} _userId
 * @param {number} limit
 */
export function getBehindOnShows(_userId, limit = 12) {
    return /** @type {any[]} */ (db.prepare(`
        SELECT mp.id, mp.title, mp.poster_url,
               mp.watched_children as watched, mp.collected_children as total,
               CASE WHEN mp.collected_children > 0
                    THEN ROUND(CAST(mp.watched_children AS REAL) / mp.collected_children * 100, 1)
                    ELSE 0 END as pct
        FROM media_parents mp
        WHERE mp.media_type = 'show'
          AND mp.watched_children > 0
          AND mp.watched_children < mp.collected_children
          AND mp.collected_children > 0
        ORDER BY pct DESC, mp.watched_children DESC
        LIMIT ?
    `).all(limit));
}

/**
 * Upcoming episodes — dynamic lookahead (expand if too few results).
 * Highlights season premieres and finales.
 * @param {typeof DEFAULTS} prefs
 */
export function getUpcomingEpisodes(prefs, userId = 0) {
    // Try with default lookahead first
    let episodes = _fetchUpcoming(prefs.lookaheadDaysDefault, userId);

    // Expand window if too few results
    if (episodes.length < prefs.minCalendarResults && prefs.lookaheadDaysDefault < prefs.lookaheadDaysMax) {
        episodes = _fetchUpcoming(prefs.lookaheadDaysMax, userId);
    }

    return episodes;
}

/**
 * @param {number} days
 */
function _fetchUpcoming(days, userId = 0) {
    // Only show upcoming episodes for shows the user is engaged with
    const episodes = /** @type {any[]} */ (db.prepare(`
        SELECT mc.id as episode_id, mc.title as episode_title,
               mc.season_number, mc.item_number, mc.premiere_date,
               mp.id as show_id, mp.title as show_title, mp.poster_url
        FROM media_children mc
        JOIN media_parents mp ON mc.parent_id = mp.id
        WHERE mp.media_type = 'show'
          AND mc.premiere_date IS NOT NULL
          AND date(mc.premiere_date) > date('now')
          AND date(mc.premiere_date) <= date('now', ?)
          AND mc.is_special = 0
          AND (
              -- Caught up: watched >= 80% of collected episodes
              (mp.collected_children > 0 AND mp.watched_children >= mp.collected_children * 0.8)
              -- Nearly caught up: at most 5 episodes behind
              OR (mp.collected_children > 0 AND (mp.collected_children - mp.watched_children) <= 5)
              -- Recently active: has playback in last 90 days
              OR mp.id IN (
                  SELECT DISTINCT mc2.parent_id
                  FROM playback_history ph
                  JOIN media_children mc2 ON ph.media_id = mc2.id
                  WHERE ph.user_id = ? AND ph.timestamp >= datetime('now', '-90 days')
              )
          )
        ORDER BY mc.premiere_date ASC
        LIMIT 20
    `).all(`+${days} days`, userId));

    // Detect season premieres (E1) and finales
    return episodes.map(ep => ({
        ...ep,
        isSeasonPremiere: ep.item_number === 1,
        isFinale: false, // would need total episode count per season — skip for now
    }));
}

/**
 * Recently watched TV shows — last 20 shows the user watched episodes of.
 * @param {number} userId
 * @param {number} limit
 */
export function getRecentlyWatchedShows(userId, limit = 20) {
    return /** @type {any[]} */ (db.prepare(`
        SELECT DISTINCT mp.id, mp.title, mp.poster_url,
               mp.watched_children as watched, mp.collected_children as total,
               MAX(ph.timestamp) as last_watched
        FROM playback_history ph
        JOIN media_children mc ON ph.media_id = mc.id
        JOIN media_parents mp ON mc.parent_id = mp.id
        WHERE mp.media_type = 'show' AND ph.user_id = ?
          AND mp.poster_url IS NOT NULL AND ph.timestamp > '2000-01-01'
        GROUP BY mp.id
        ORDER BY last_watched DESC
        LIMIT ?
    `).all(userId, limit));
}

// ── Music ───────────────────────────────────────────────────────────────────

/**
 * Recent listening — album-level play data with timestamps.
 * @param {number} userId
 * @param {number} limit
 */
export function getRecentListening(userId, limit = 12) {
    return /** @type {any[]} */ (db.prepare(`
        SELECT DISTINCT mc.id as album_id, mc.title as album_title,
               mp.id as artist_id, mp.title as artist_name, mp.poster_url as artist_poster,
               mp.is_favorite,
               MAX(ph.timestamp) as last_played
        FROM playback_history ph
        JOIN media_children mc ON ph.media_id = mc.id
        JOIN media_parents mp ON mc.parent_id = mp.id
        WHERE mp.media_type = 'artist' AND ph.user_id = ?
          AND ph.timestamp > '2000-01-01'
        GROUP BY mc.id
        ORDER BY last_played DESC
        LIMIT ?
    `).all(userId, limit));
}

/**
 * New releases from favorite artists — albums you haven't played yet.
 * @param {number} userId
 * @param {number} limit
 */
export function getNewFromFavorites(userId, limit = 12) {
    // Find favorite artists with albums that have 0 plays
    return /** @type {any[]} */ (db.prepare(`
        SELECT mc.id as album_id, mc.title as album_title,
               mp.id as artist_id, mp.title as artist_name, mp.poster_url as artist_poster
        FROM media_parents mp
        JOIN media_children mc ON mc.parent_id = mp.id
        WHERE mp.media_type = 'artist'
          AND mp.is_favorite = 1
          AND mc.play_count = 0
          AND NOT EXISTS (
              SELECT 1 FROM playback_history ph
              WHERE ph.media_id = mc.id AND ph.user_id = ?
          )
        ORDER BY mp.title ASC
        LIMIT ?
    `).all(userId, limit));
}

/**
 * "Rediscover" — favorited artists you haven't played recently, or never played at all.
 * @param {number} userId
 * @param {typeof DEFAULTS} prefs
 * @param {number} limit
 */
export function getRediscoverArtists(userId, prefs, limit = 8) {
    const cutoffDate = new Date();
    cutoffDate.setMonth(cutoffDate.getMonth() - prefs.rediscoverMonths);
    const cutoffISO = cutoffDate.toISOString();

    // Favorite artists where last play is old or nonexistent
    const artists = /** @type {any[]} */ (db.prepare(`
        SELECT mp.id, mp.title, mp.poster_url, mp.collected_children as album_count,
               MAX(ph.timestamp) as last_played,
               COUNT(DISTINCT CASE WHEN ph.id IS NOT NULL THEN mc.id END) as played_albums,
               COUNT(DISTINCT mc.id) as total_albums
        FROM media_parents mp
        JOIN media_children mc ON mc.parent_id = mp.id
        LEFT JOIN playback_history ph ON ph.media_id = mc.id AND ph.user_id = ?
        WHERE mp.media_type = 'artist' AND mp.is_favorite = 1
        GROUP BY mp.id
        HAVING last_played IS NULL OR last_played < ?
        ORDER BY
            CASE WHEN last_played IS NULL THEN 0 ELSE 1 END,
            last_played ASC
        LIMIT ?
    `).all(userId, cutoffISO, limit));

    return artists.map(a => {
        const unplayed = a.total_albums - a.played_albums;
        let reason;
        if (!a.last_played) {
            reason = `You favorited ${a.title} but never played any tracks`;
        } else {
            const lastDate = new Date(a.last_played);
            const months = Math.round((Date.now() - lastDate.getTime()) / (1000 * 60 * 60 * 24 * 30));
            reason = `You haven't listened to ${a.title} in ${months} month${months === 1 ? '' : 's'}`;
        }
        if (unplayed > 0) {
            reason += ` · ${unplayed} unplayed album${unplayed === 1 ? '' : 's'}`;
        }
        return { ...a, unplayedAlbums: unplayed, reason };
    });
}
