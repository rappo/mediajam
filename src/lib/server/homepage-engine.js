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
    maxPersonSections: 3,      // max person-based recommendation sections
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
        SELECT DISTINCT mp.id, mp.title, mp.poster_url, mp.release_year
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
export function getPersonRecommendations(userId, prefs) {
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

    /**
     * Enrich each movie with a unique per-item reason/subtitle.
     * For actor sections: highlight director, writer, or notable co-star.
     * For director sections: highlight lead actor.
     * @param {any[]} movies
     * @param {number} sectionPersonId
     * @param {string} sectionRole
     */
    function enrichMovieReasons(movies, sectionPersonId, sectionRole) {
        if (movies.length === 0) return;
        const movieIds = movies.map(m => m.id);
        const ph = movieIds.map(() => '?').join(',');

        // Pre-compute which person IDs the user has watched (cached once for all sections)
        if (!watchedPersonIdsCache) {
            watchedPersonIdsCache = new Set(
                /** @type {any[]} */ (db.prepare(`
                    SELECT DISTINCT pc.person_id
                    FROM playback_history ph2
                    JOIN media_children mc2 ON ph2.media_id = mc2.id
                    JOIN person_credits pc ON pc.media_parent_id = mc2.parent_id
                    WHERE ph2.user_id = ?
                `).all(userId)).map(r => r.person_id)
            );
        }
        const watchedPersonIds = watchedPersonIdsCache;

        const credits = /** @type {any[]} */ (db.prepare(`
            SELECT pc.media_parent_id, p.name, p.id as person_id, pc.role_type, p.is_favorite
            FROM person_credits pc
            JOIN persons p ON pc.person_id = p.id
            WHERE pc.media_parent_id IN (${ph})
              AND pc.person_id != ?
              AND pc.role_type IN ('actor', 'director', 'writer')
            ORDER BY p.is_favorite DESC, pc.role_type ASC
        `).all(...movieIds, sectionPersonId));

        // Sort credits so watched/favorited people come first
        credits.sort((a, b) => {
            const aScore = (a.is_favorite ? 2 : 0) + (watchedPersonIds.has(a.person_id) ? 1 : 0);
            const bScore = (b.is_favorite ? 2 : 0) + (watchedPersonIds.has(b.person_id) ? 1 : 0);
            return bScore - aScore;
        });

        /** @type {Map<number, any[]>} */
        const byMovie = new Map();
        for (const c of credits) {
            if (!byMovie.has(c.media_parent_id)) byMovie.set(c.media_parent_id, []);
            byMovie.get(c.media_parent_id)?.push(c);
        }

        /** @type {Set<string>} */
        const used = new Set();

        for (const movie of movies) {
            const mc = byMovie.get(movie.id) || [];
            let reason = '';
            let reasonPersonId = null;
            let reasonPersonName = '';

            if (sectionRole === 'actor') {
                const dir = mc.find(c => c.role_type === 'director');
                const wr = mc.find(c => c.role_type === 'writer');
                const coFav = mc.find(c => c.role_type === 'actor' && (c.is_favorite || watchedPersonIds.has(c.person_id)));
                const coAny = mc.find(c => c.role_type === 'actor');

                if (dir && !used.has(`d-${dir.name}`)) {
                    reason = `directed by ${dir.name}`;
                    reasonPersonId = dir.person_id;
                    reasonPersonName = dir.name;
                    used.add(`d-${dir.name}`);
                } else if (coFav && !used.has(`s-${coFav.name}`)) {
                    reason = `also starring ${coFav.name}`;
                    reasonPersonId = coFav.person_id;
                    reasonPersonName = coFav.name;
                    used.add(`s-${coFav.name}`);
                } else if (wr && !used.has(`w-${wr.name}`)) {
                    reason = `written by ${wr.name}`;
                    reasonPersonId = wr.person_id;
                    reasonPersonName = wr.name;
                    used.add(`w-${wr.name}`);
                } else if (dir) {
                    reason = `directed by ${dir.name}`;
                    reasonPersonId = dir.person_id;
                    reasonPersonName = dir.name;
                } else if (coAny) {
                    reason = `also starring ${coAny.name}`;
                    reasonPersonId = coAny.person_id;
                    reasonPersonName = coAny.name;
                }
            } else {
                const favActor = mc.find(c => c.role_type === 'actor' && (c.is_favorite || watchedPersonIds.has(c.person_id)));
                const lead = mc.find(c => c.role_type === 'actor');

                if (favActor && !used.has(`s-${favActor.name}`)) {
                    reason = `starring ${favActor.name}`;
                    reasonPersonId = favActor.person_id;
                    reasonPersonName = favActor.name;
                    used.add(`s-${favActor.name}`);
                } else if (lead && !used.has(`s-${lead.name}`)) {
                    reason = `starring ${lead.name}`;
                    reasonPersonId = lead.person_id;
                    reasonPersonName = lead.name;
                    used.add(`s-${lead.name}`);
                } else if (lead) {
                    reason = `starring ${lead.name}`;
                    reasonPersonId = lead.person_id;
                    reasonPersonName = lead.name;
                }
            }

            movie.reason = reason || `${movie.release_year || ''}`;
            movie.reasonPersonId = reasonPersonId;
            movie.reasonPersonName = reasonPersonName;
        }
    }

    /** @type {Array<{person: string, personId: number, role: string, totalInLibrary: number, sectionTitle: string, items: any[]}>} */
    const eligible = [];
    /** @type {Set<string>} */
    const usedKeys = new Set();
    /** @type {Set<number>|null} */
    let watchedPersonIdsCache = null;
    const maxSections = prefs.maxPersonSections;

    // ── Tier 1: Favorited people ────────────────────────────────────────
    const favorited = /** @type {any[]} */ (db.prepare(`
        SELECT p.id as person_id, p.name, pc.role_type,
               COUNT(DISTINCT pc.media_parent_id) as total_movies
        FROM persons p
        JOIN person_credits pc ON pc.person_id = p.id
        JOIN media_parents mp ON pc.media_parent_id = mp.id
        WHERE p.is_favorite = 1
          AND pc.role_type IN ('actor', 'director') AND mp.media_type = 'movie'
        GROUP BY p.id, pc.role_type
        ORDER BY total_movies DESC
        LIMIT 5
    `).all());

    for (const person of favorited) {
        const key = `${person.person_id}-${person.role_type}`;
        if (usedKeys.has(key)) continue;
        const unwatched = getUnwatchedByPerson(person.person_id, person.role_type);
        if (unwatched.length < 2) continue;
        enrichMovieReasons(unwatched, person.person_id, person.role_type);
        usedKeys.add(key);
        eligible.push({
            person: person.name, personId: person.person_id,
            role: person.role_type, totalInLibrary: person.total_movies,
            sectionTitle: `Because You Favorited ${person.name}`,
            items: unwatched,
        });
        if (eligible.length >= maxSections) break;
    }

    // ── Tier 2: Most-watched people (3+ movies watched) ────────────────
    const mostWatched = /** @type {any[]} */ (db.prepare(`
        SELECT p.id as person_id, p.name, pc.role_type,
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
        LIMIT 8
    `).all(userId));

    if (eligible.length < maxSections) {
    for (const person of mostWatched) {
        if (eligible.length >= maxSections) break;
        const key = `${person.person_id}-${person.role_type}`;
        if (usedKeys.has(key)) continue;
        const unwatched = getUnwatchedByPerson(person.person_id, person.role_type);
        if (unwatched.length < 2) continue;
        enrichMovieReasons(unwatched, person.person_id, person.role_type);
        usedKeys.add(key);
        eligible.push({
            person: person.name, personId: person.person_id,
            role: person.role_type, totalInLibrary: person.total_movies,
            sectionTitle: `Because You've Watched ${person.name}`,
            items: unwatched,
        });
    }
    }

    // ── Tier 3: Most-credited people (fallback, only if we need more) ──
    if (eligible.length < maxSections) {
        const topCredited = /** @type {any[]} */ (db.prepare(`
            SELECT p.id as person_id, p.name, pc.role_type,
                   COUNT(DISTINCT pc.media_parent_id) as total_movies
            FROM persons p
            JOIN person_credits pc ON pc.person_id = p.id
            JOIN media_parents mp ON pc.media_parent_id = mp.id
            WHERE pc.role_type IN ('actor', 'director') AND mp.media_type = 'movie'
            GROUP BY p.id, pc.role_type
            HAVING total_movies >= 3
            ORDER BY total_movies DESC
            LIMIT 8
        `).all());

        for (const person of topCredited) {
            if (eligible.length >= maxSections) break;
            const key = `${person.person_id}-${person.role_type}`;
            if (usedKeys.has(key)) continue;
            const unwatched = getUnwatchedByPerson(person.person_id, person.role_type);
            if (unwatched.length < 2) continue;
            enrichMovieReasons(unwatched, person.person_id, person.role_type);
            usedKeys.add(key);
            eligible.push({
                person: person.name, personId: person.person_id,
                role: person.role_type, totalInLibrary: person.total_movies,
                sectionTitle: `More from ${person.name}`,
                items: unwatched,
            });
        }
    }

    // Daily shuffle so it rotates which people are featured
    const shuffled = seededShuffle(eligible, dailySeed());
    return shuffled.slice(0, prefs.maxPersonSections);
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
        SELECT mp.id, mp.title, mp.poster_url, mp.release_year
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
        SELECT mp.id, mp.title, mp.poster_url, mp.release_year,
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
        ORDER BY tag_matches DESC
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
export function getAiringThisWeek(prefs, weekOffset = 0) {
    // Start from Monday of the current week, shifted by weekOffset * 7 days
    const now = new Date();
    const dayOfWeek = now.getDay();
    const monday = new Date(now);
    monday.setDate(now.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1) + (weekOffset * 7));
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
          AND mp.is_dashboard_hidden = 0
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
 * Upcoming album releases — calendar view for the music page.
 * Mirrors getAiringThisWeek() but queries albums (media_children) under artists.
 * @param {typeof DEFAULTS} _prefs
 * @param {number} weekOffset
 */
export function getUpcomingAlbums(_prefs, weekOffset = 0) {
    const now = new Date();
    const dayOfWeek = now.getDay();
    const monday = new Date(now);
    monday.setDate(now.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1) + (weekOffset * 7));
    monday.setHours(0, 0, 0, 0);
    const endDate = new Date(monday);
    endDate.setDate(monday.getDate() + 20);
    endDate.setHours(23, 59, 59);

    const mondayISO = monday.toISOString().split('T')[0];
    const endISO = endDate.toISOString().split('T')[0];

    const albums = /** @type {any[]} */ (db.prepare(`
        SELECT mc.id as album_id, mc.title as album_title,
               mc.premiere_date, mc.is_collected, mc.poster_url as album_poster,
               mp.id as artist_id, mp.title as artist_title, mp.poster_url
        FROM media_children mc
        JOIN media_parents mp ON mc.parent_id = mp.id
        WHERE mp.media_type = 'artist'
          AND mp.is_dashboard_hidden = 0
          AND mc.premiere_date IS NOT NULL
          AND date(mc.premiere_date) >= ?
          AND date(mc.premiere_date) <= ?
        ORDER BY mc.premiere_date ASC, mp.title ASC
    `).all(mondayISO, endISO));

    // Group by date — same shape as TV calendar
    /** @type {Record<string, any[]>} */
    const byDate = {};
    for (let i = 0; i < 21; i++) {
        const d = new Date(monday);
        d.setDate(monday.getDate() + i);
        const key = d.toISOString().split('T')[0];
        byDate[key] = [];
    }

    for (const album of albums) {
        const dateKey = album.premiere_date.split('T')[0];
        if (!byDate[dateKey]) byDate[dateKey] = [];
        let status = 'not_aired';
        const releaseDate = new Date(album.premiere_date);
        if (releaseDate <= now) {
            status = album.is_collected ? 'downloaded' : 'available';
        }
        byDate[dateKey].push({
            ...album,
            // Map to CalendarStrip expected fields
            show_id: album.artist_id,
            show_title: album.artist_title,
            episode_title: album.album_title,
            poster_url: album.album_poster || album.poster_url,
            status,
        });
    }

    return Object.entries(byDate).map(([date, episodes]) => ({ date, episodes }));
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
          AND mp.is_dashboard_hidden = 0
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
export function getBehindOnShows(_userId, limit = 20) {
    return /** @type {any[]} */ (db.prepare(`
        SELECT mp.id, mp.title, mp.poster_url,
               mp.watched_children as watched, mp.collected_children as total,
               COALESCE(mp.total_released_children, mp.collected_children) as total_released,
               COALESCE(mp.total_released_children, mp.collected_children) - mp.collected_children as missing,
               CASE WHEN mp.collected_children > 0
                    THEN ROUND(CAST(mp.watched_children AS REAL) / mp.collected_children * 100, 1)
                    ELSE 0 END as pct,
               MAX(ph.timestamp) as last_watched
        FROM media_parents mp
        JOIN media_children mc ON mc.parent_id = mp.id
        JOIN playback_history ph ON ph.media_id = mc.id
        WHERE mp.media_type = 'show'
          AND mp.is_dashboard_hidden = 0
          AND mp.watched_children > 0
          AND mp.watched_children < mp.collected_children
          AND mp.collected_children > 0
        GROUP BY mp.id
        ORDER BY last_watched DESC
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
          AND mp.is_dashboard_hidden = 0
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
          AND mp.is_dashboard_hidden = 0
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
export function getRecentListening(userId, limit = 12, days = 0) {
    const settings = /** @type {any} */ (db.prepare('SELECT jellyfin_url FROM app_settings WHERE id = 1').get());
    const jfUrl = settings?.jellyfin_url || '';

    let cutoffClause = "AND ph.timestamp > '2000-01-01'";
    if (days > 0) {
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - days);
        cutoffClause = `AND ph.timestamp > '${cutoff.toISOString()}'`;
    }

    const rows = /** @type {any[]} */ (db.prepare(`
        SELECT mc.id as album_id, mc.title as album_title,
               mc.jellyfin_id as album_jellyfin_id, mc.poster_url as album_poster_url,
               mp.id as artist_id, mp.title as artist_name,
               mp.jellyfin_id as artist_jellyfin_id, mp.poster_url as artist_poster,
               mp.is_favorite,
               MAX(ph.timestamp) as last_played
        FROM playback_history ph
        JOIN media_children mc ON ph.media_id = mc.id
        JOIN media_parents mp ON mc.parent_id = mp.id
        WHERE mp.media_type = 'artist' AND ph.user_id = ?
          ${cutoffClause}
        GROUP BY mc.id
        ORDER BY last_played DESC
        LIMIT ?
    `).all(userId, limit));

    return rows.map(r => ({
        ...r,
        album_art: r.album_jellyfin_id
            ? `${jfUrl}/Items/${r.album_jellyfin_id}/Images/Primary?maxHeight=300`
            : (r.album_poster_url || r.artist_poster || null),
    }));
}

/**
 * New releases from favorite artists — albums you haven't played yet.
 * Grouped by album, shows album art.
 * @param {number} userId
 * @param {number} limit
 */
export function getNewFromFavorites(userId, limit = 12) {
    const settings = /** @type {any} */ (db.prepare('SELECT jellyfin_url FROM app_settings WHERE id = 1').get());
    const jfUrl = settings?.jellyfin_url || '';

    const rows = /** @type {any[]} */ (db.prepare(`
        SELECT mc.id as album_id, mc.title as album_title,
               mc.jellyfin_id as album_jellyfin_id, mc.poster_url as album_poster_url,
               mp.id as artist_id, mp.title as artist_name,
               mp.jellyfin_id as artist_jellyfin_id, mp.poster_url as artist_poster
        FROM media_parents mp
        JOIN media_children mc ON mc.parent_id = mp.id
        WHERE mp.media_type = 'artist'
          AND mp.is_favorite = 1
          AND mc.play_count = 0
          AND NOT EXISTS (
              SELECT 1 FROM playback_history ph
              WHERE ph.media_id = mc.id AND ph.user_id = ?
          )
        ORDER BY mp.title ASC, mc.item_number DESC
        LIMIT ?
    `).all(userId, limit));

    return rows.map(r => ({
        ...r,
        album_art: r.album_jellyfin_id
            ? `${jfUrl}/Items/${r.album_jellyfin_id}/Images/Primary?maxHeight=300`
            : (r.album_poster_url || r.artist_poster || null),
    }));
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

/**
 * "Heavy Rotation" — most-played albums in the last 30 days.
 * @param {number} userId
 * @param {number} limit
 */
export function getHeavyRotation(userId, limit = 12, days = 30) {
    const settings = /** @type {any} */ (db.prepare('SELECT jellyfin_url FROM app_settings WHERE id = 1').get());
    const jfUrl = settings?.jellyfin_url || '';

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const cutoffISO = cutoff.toISOString();

    const rows = /** @type {any[]} */ (db.prepare(`
        SELECT mc.id as album_id, mc.title as album_title,
               mc.jellyfin_id as album_jellyfin_id, mc.poster_url as album_poster_url,
               mp.id as artist_id, mp.title as artist_name,
               mp.jellyfin_id as artist_jellyfin_id, mp.poster_url as artist_poster,
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
        GROUP BY mc.id
        ORDER BY recent_plays DESC
        LIMIT ?
    `).all(userId, cutoffISO, limit));

    return rows.map(r => ({
        ...r,
        album_art: r.album_jellyfin_id
            ? `${jfUrl}/Items/${r.album_jellyfin_id}/Images/Primary?maxHeight=300`
            : (r.album_poster_url || r.artist_poster || null),
    }));
}

/**
 * "Unplayed Albums" — albums in your collection with 0 plays.
 * @param {number} userId
 * @param {number} limit
 */
export function getUnplayedAlbums(userId, limit = 12) {
    const settings = /** @type {any} */ (db.prepare('SELECT jellyfin_url FROM app_settings WHERE id = 1').get());
    const jfUrl = settings?.jellyfin_url || '';

    const rows = /** @type {any[]} */ (db.prepare(`
        SELECT mc.id as album_id, mc.title as album_title,
               mc.jellyfin_id as album_jellyfin_id, mc.poster_url as album_poster_url,
               mp.id as artist_id, mp.title as artist_name,
               mp.jellyfin_id as artist_jellyfin_id, mp.poster_url as artist_poster,
               mp.is_favorite
        FROM media_children mc
        JOIN media_parents mp ON mc.parent_id = mp.id
        WHERE mp.media_type = 'artist'
          AND mc.play_count = 0
          AND mc.jellyfin_id IS NOT NULL
          AND NOT EXISTS (
              SELECT 1 FROM playback_history ph
              WHERE ph.media_id = mc.id AND ph.user_id = ?
          )
        ORDER BY mp.is_favorite DESC, RANDOM()
        LIMIT ?
    `).all(userId, limit));

    return rows.map(r => ({
        ...r,
        album_art: r.album_jellyfin_id
            ? `${jfUrl}/Items/${r.album_jellyfin_id}/Images/Primary?maxHeight=300`
            : (r.album_poster_url || r.artist_poster || null),
    }));
}

/**
 * "Deep Cuts" — unplayed albums from your most-listened artists.
 * Finds artists you listen to the most, then returns their albums you haven't played.
 * @param {number} userId
 * @param {number} limit
 */
export function getDeepCuts(userId, limit = 12) {
    const settings = /** @type {any} */ (db.prepare('SELECT jellyfin_url FROM app_settings WHERE id = 1').get());
    const jfUrl = settings?.jellyfin_url || '';

    const rows = /** @type {any[]} */ (db.prepare(`
        SELECT mc.id as album_id, mc.title as album_title,
               mc.jellyfin_id as album_jellyfin_id, mc.poster_url as album_poster_url,
               mp.id as artist_id, mp.title as artist_name,
               mp.jellyfin_id as artist_jellyfin_id, mp.poster_url as artist_poster,
               top_artists.total_plays as artist_plays
        FROM media_children mc
        JOIN media_parents mp ON mc.parent_id = mp.id
        JOIN (
            SELECT mc2.parent_id, COUNT(DISTINCT deduped.time_bucket) as total_plays
            FROM (
                SELECT ph.media_id,
                       CAST(strftime('%s', ph.timestamp) / 300 AS INTEGER) as time_bucket
                FROM playback_history ph WHERE ph.user_id = ?
            ) deduped
            JOIN media_children mc2 ON deduped.media_id = mc2.id
            GROUP BY mc2.parent_id
            HAVING total_plays >= 5
            ORDER BY total_plays DESC
            LIMIT 20
        ) top_artists ON top_artists.parent_id = mp.id
        WHERE mp.media_type = 'artist'
          AND mc.play_count = 0
          AND NOT EXISTS (
              SELECT 1 FROM playback_history ph
              WHERE ph.media_id = mc.id AND ph.user_id = ?
          )
        ORDER BY top_artists.total_plays DESC, RANDOM()
        LIMIT ?
    `).all(userId, userId, limit));

    return rows.map(r => ({
        ...r,
        album_art: r.album_jellyfin_id
            ? `${jfUrl}/Items/${r.album_jellyfin_id}/Images/Primary?maxHeight=300`
            : (r.album_poster_url || r.artist_poster || null),
    }));
}

/**
 * "It's Been a While" — albums you've listened to multiple times but not recently.
 * Finds albums with ≥3 historical plays where last play was before the cutoff.
 * @param {number} userId
 * @param {number} sinceMonths - how many months of silence qualifies
 * @param {number} limit
 */
export function getItsBeenAWhile(userId, sinceMonths = 6, limit = 12) {
    const settings = /** @type {any} */ (db.prepare('SELECT jellyfin_url FROM app_settings WHERE id = 1').get());
    const jfUrl = settings?.jellyfin_url || '';

    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - sinceMonths);
    const cutoffISO = cutoff.toISOString();

    const rows = /** @type {any[]} */ (db.prepare(`
        SELECT mc.id as album_id, mc.title as album_title,
               mc.jellyfin_id as album_jellyfin_id, mc.poster_url as album_poster_url,
               mp.id as artist_id, mp.title as artist_name,
               mp.jellyfin_id as artist_jellyfin_id, mp.poster_url as artist_poster,
               COUNT(DISTINCT deduped.time_bucket) as total_plays,
               MAX(ph.timestamp) as last_played
        FROM playback_history ph
        JOIN media_children mc ON ph.media_id = mc.id
        JOIN media_parents mp ON mc.parent_id = mp.id
        JOIN (
            SELECT ph2.media_id,
                   CAST(strftime('%s', ph2.timestamp) / 300 AS INTEGER) as time_bucket
            FROM playback_history ph2 WHERE ph2.user_id = ?
        ) deduped ON deduped.media_id = mc.id
        WHERE mp.media_type = 'artist' AND ph.user_id = ?
        GROUP BY mc.id
        HAVING total_plays >= 3 AND last_played < ?
        ORDER BY total_plays DESC, last_played ASC
        LIMIT ?
    `).all(userId, userId, cutoffISO, limit));

    return rows.map(r => ({
        ...r,
        album_art: r.album_jellyfin_id
            ? `${jfUrl}/Items/${r.album_jellyfin_id}/Images/Primary?maxHeight=300`
            : (r.album_poster_url || r.artist_poster || null),
    }));
}

