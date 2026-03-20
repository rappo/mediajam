import { json } from '@sveltejs/kit';
import db from '$lib/server/db.js';
import { generate, embed, isEmbeddingAvailable } from '$lib/server/llm.js';
import { logInfo, logWarn } from '$lib/server/logger.js';
import { tmdbFetch, getTmdbKey } from '$lib/server/tmdb.js';

/** Max chars for embedding input (~500 tokens). Beyond this, quality degrades. */
const EMBED_CHAR_LIMIT = 2000;
/** Max total chars for discovery prompt context (~1500 tokens). */
const CONTEXT_CHAR_BUDGET = 6000;

/**
 * Truncate text to a character limit, breaking at the last sentence boundary.
 * @param {string} text
 * @param {number} maxChars
 * @returns {string}
 */
function truncateText(text, maxChars) {
    if (!text || text.length <= maxChars) return text;
    const trimmed = text.slice(0, maxChars);
    const lastPeriod = Math.max(trimmed.lastIndexOf('. '), trimmed.lastIndexOf('! '), trimmed.lastIndexOf('? '));
    if (lastPeriod > maxChars * 0.5) return trimmed.slice(0, lastPeriod + 1);
    const lastSpace = trimmed.lastIndexOf(' ');
    return lastSpace > maxChars * 0.5 ? trimmed.slice(0, lastSpace) + '...' : trimmed + '...';
}

/**
 * Fit multiple context sections into a character budget, prioritizing earlier sections.
 * @param {string[]} sections - ordered by priority (highest first)
 * @param {number} budget - total character budget
 * @returns {string}
 */
function budgetContextSections(sections, budget) {
    const filtered = sections.filter(Boolean);
    if (filtered.length === 0) return '';

    const result = [];
    let remaining = budget;

    for (const section of filtered) {
        if (remaining <= 0) break;
        if (section.length <= remaining) {
            result.push(section);
            remaining -= section.length;
        } else {
            result.push(truncateText(section, remaining));
            remaining = 0;
        }
    }

    return result.join('\n\n');
}

/** Tables that are safe to query */
const ALLOWED_TABLES = [
    'media_parents', 'media_children', 'playback_history', 'tracks',
    'persons', 'person_credits', 'media_tags', 'lastfm_scrobbles',
    'trakt_history', 'favorites', 'libraries',
];

/**
 * Get a detailed schema description for the LLM prompt.
 * @returns {string}
 */
function getSchemaContext() {
    return `SQLite database schema.

CRITICAL RULES — violating these will produce errors:
1. media_parents has NO user_id column. Never filter media_parents by user.
2. media_children has NO media_type column. To filter by type, JOIN to media_parents.media_type.
3. playback_history.media_id → media_children.id (NOT media_parents.id). Always JOIN through media_children.
4. "albums" are media_children rows whose parent's media_type = 'artist'.
5. "episodes" are media_children rows whose parent's media_type = 'show'.
6. For movies, each media_parent has exactly 1 media_children row.
7. "recently" = last 30 days. Use: timestamp > datetime('now', '-30 days')
8. runtime_ticks is in Jellyfin 100-nanosecond units. ALWAYS convert:
   - To seconds: runtime_ticks / 10000000.0
   - To minutes: runtime_ticks / 600000000.0
   - To hours: runtime_ticks / 36000000000.0
   NEVER divide runtime_ticks by 3600 (that gives nanosecond-scale garbage).
9. watch_status values: 'watched', 'unwatched', 'in_progress'
10. "unwatched" or "remaining" episodes = watch_status = 'unwatched' OR watch_status = 'in_progress'
11. duration_consumed_seconds in playback_history IS already in seconds (no conversion needed).
12. DEDUP RULE: playback_history may contain duplicate entries from different sources (Jellyfin + Trakt) for the SAME viewing event. When counting plays, ALWAYS deduplicate using: SELECT COUNT(*) FROM (SELECT DISTINCT media_id, CAST(strftime('%s', timestamp) / 43200 AS INTEGER) as time_bucket FROM playback_history GROUP BY media_id, time_bucket). The 43200 seconds = 12-hour window merges multi-source plays of the same item.

Tables:

media_parents: id, title, media_type ('show'|'movie'|'artist'), release_year, poster_url, overview,
  collected_children, watched_children, total_released_children, library_id, is_favorite,
  jellyfin_id, tmdb_id, imdb_id, tvdb_id, musicbrainz_id, collection_status

media_children: id, parent_id (FK→media_parents.id), jellyfin_id, title, season_number, item_number,
  is_special, is_collected, watch_status ('watched'|'unwatched'|'in_progress'), play_count,
  runtime_ticks (100-nanosecond units — see rule 8), premiere_date, poster_url, community_rating
  ⚠️ NO media_type column — use parent's media_type via JOIN

playback_history: id, user_id, media_id (FK→media_children.id), source, timestamp (ISO),
  duration_consumed_seconds (already in seconds), completion_pct, track_name

tracks: id, album_id (FK→media_children.id), title, track_number, disc_number, runtime_ticks

persons: id, name, photo_url, tmdb_person_id, is_favorite

person_credits: id, person_id (FK→persons.id), media_parent_id (FK→media_parents.id),
  role_type ('actor'|'director'|'writer'|'producer'|'composer'), character_name

media_tags: id, media_parent_id (FK→media_parents.id), tag_type ('genre'|'mood'|'tag'), tag_value

favorites: id, user_id, media_parent_id, person_id, created_at

libraries: jellyfin_id, name, type, total_items

EXAMPLE QUERIES — FOLLOW THESE PATTERNS EXACTLY:
-- How many movies: SELECT COUNT(*) as count FROM media_parents WHERE media_type = 'movie'
-- How many albums: SELECT COUNT(*) as count FROM media_children mc JOIN media_parents mp ON mc.parent_id = mp.id WHERE mp.media_type = 'artist'
-- Total runtime of a show in hours: SELECT ROUND(SUM(mc.runtime_ticks) / 36000000000.0, 1) as hours FROM media_children mc JOIN media_parents mp ON mc.parent_id = mp.id WHERE mp.title LIKE '%Simpsons%' AND mp.media_type = 'show'
-- Unwatched episodes remaining (hours): SELECT ROUND(SUM(mc.runtime_ticks) / 36000000000.0, 1) as hours_remaining, COUNT(*) as episodes FROM media_children mc JOIN media_parents mp ON mc.parent_id = mp.id WHERE mp.title LIKE '%Simpsons%' AND mc.watch_status != 'watched'
-- What movies did I watch this week (RETURN TITLES, not just count): SELECT DISTINCT mp.title, mp.release_year, ph.timestamp FROM playback_history ph JOIN media_children mc ON ph.media_id = mc.id JOIN media_parents mp ON mc.parent_id = mp.id WHERE mp.media_type = 'movie' AND ph.timestamp > datetime('now', '-7 days') ORDER BY ph.timestamp DESC LIMIT 20
-- Recently watched movies: SELECT DISTINCT mp.title, mp.release_year, ph.timestamp FROM playback_history ph JOIN media_children mc ON ph.media_id = mc.id JOIN media_parents mp ON mc.parent_id = mp.id WHERE mp.media_type = 'movie' AND ph.timestamp > datetime('now', '-30 days') ORDER BY ph.timestamp DESC LIMIT 20
-- Movies by director: SELECT mp.title, mp.release_year FROM person_credits pc JOIN persons p ON pc.person_id = p.id JOIN media_parents mp ON pc.media_parent_id = mp.id WHERE p.name LIKE '%Spielberg%' AND pc.role_type = 'director'
-- Unwatched movies by director ("haven't I seen", "not watched"): SELECT mp.title, mp.release_year, mc.watch_status FROM person_credits pc JOIN persons p ON pc.person_id = p.id JOIN media_parents mp ON pc.media_parent_id = mp.id JOIN media_children mc ON mc.parent_id = mp.id WHERE p.name LIKE '%Kurosawa%' AND pc.role_type = 'director' AND mc.watch_status != 'watched'
-- All movies by director with watch status: SELECT mp.title, mp.release_year, mc.watch_status FROM person_credits pc JOIN persons p ON pc.person_id = p.id JOIN media_parents mp ON pc.media_parent_id = mp.id JOIN media_children mc ON mc.parent_id = mp.id WHERE p.name LIKE '%Kurosawa%' AND pc.role_type = 'director' ORDER BY mp.release_year
-- Who stars in a director's films: SELECT p2.name, COUNT(*) as appearances FROM person_credits pc1 JOIN persons p1 ON pc1.person_id = p1.id JOIN person_credits pc2 ON pc2.media_parent_id = pc1.media_parent_id JOIN persons p2 ON pc2.person_id = p2.id WHERE p1.name LIKE '%Kurosawa%' AND pc1.role_type = 'director' AND pc2.role_type = 'actor' GROUP BY p2.id ORDER BY appearances DESC LIMIT 10
-- Genres for a type: SELECT mt.tag_value, COUNT(*) as cnt FROM media_tags mt JOIN media_parents mp ON mt.media_parent_id = mp.id WHERE mp.media_type = 'movie' AND mt.tag_type = 'genre' GROUP BY mt.tag_value ORDER BY cnt DESC
-- Most watched artists: SELECT mp.title, SUM(mc.play_count) as plays FROM media_children mc JOIN media_parents mp ON mc.parent_id = mp.id WHERE mp.media_type = 'artist' GROUP BY mp.id ORDER BY plays DESC LIMIT 10
-- Hours of music listened: SELECT ROUND(SUM(ph.duration_consumed_seconds) / 3600.0, 1) as hours FROM playback_history ph JOIN media_children mc ON ph.media_id = mc.id JOIN media_parents mp ON mc.parent_id = mp.id WHERE mp.media_type = 'artist'
-- What is a movie about / tell me about X: SELECT mp.title, mp.release_year, mp.overview, mp.media_type FROM media_parents mp WHERE mp.title LIKE '%Ran%' LIMIT 5

COMMON MISTAKES — NEVER DO THESE:
❌ WRONG: ... JOIN persons p ON pc.person_id = p.id ... (using 'pc' before defining it)
✅ RIGHT: ... FROM person_credits pc JOIN persons p ON pc.person_id = p.id ...
❌ WRONG: SELECT COUNT(*) when user asks "what", "which", "list" (they want names/titles!)
✅ RIGHT: SELECT mp.title, mp.release_year ... when user asks "what did I watch"
❌ WRONG: Using playback_history to check if something is watched/unwatched
✅ RIGHT: Use media_children.watch_status = 'watched' or != 'watched'`;
}

/**
 * Validate that a SQL query is safe to execute.
 * @param {string} sql
 * @returns {{ valid: boolean, error?: string }}
 */
function validateQuery(sql) {
    const trimmed = sql.trim();

    // Must be SELECT only
    if (!trimmed.toUpperCase().startsWith('SELECT')) {
        return { valid: false, error: 'Only SELECT queries are allowed' };
    }

    // Check for dangerous keywords
    const dangerous = ['INSERT', 'UPDATE', 'DELETE', 'DROP', 'ALTER', 'CREATE', 'EXEC', 'ATTACH', 'DETACH'];
    const upper = trimmed.toUpperCase();
    for (const word of dangerous) {
        const regex = new RegExp(`\\b${word}\\b`, 'i');
        if (regex.test(upper) && word !== 'SELECT') {
            return { valid: false, error: `Forbidden keyword: ${word}` };
        }
    }

    // Check that only allowed tables are referenced
    const tablePattern = /(?:FROM|JOIN)\s+(\w+)/gi;
    let match;
    while ((match = tablePattern.exec(trimmed)) !== null) {
        const table = match[1].toLowerCase();
        if (!ALLOWED_TABLES.includes(table)) {
            return { valid: false, error: `Table not allowed: ${table}` };
        }
    }

    return { valid: true };
}

/**
 * Quick library stats for the LLM context.
 * @returns {string}
 */
function getLibraryStats() {
    try {
        const movies = /** @type {any} */ (db.prepare("SELECT COUNT(*) as c FROM media_parents WHERE media_type='movie'").get())?.c || 0;
        const shows = /** @type {any} */ (db.prepare("SELECT COUNT(*) as c FROM media_parents WHERE media_type='show'").get())?.c || 0;
        const artists = /** @type {any} */ (db.prepare("SELECT COUNT(*) as c FROM media_parents WHERE media_type='artist'").get())?.c || 0;
        const plays = /** @type {any} */ (db.prepare("SELECT COUNT(*) as c FROM (SELECT DISTINCT media_id, CAST(strftime('%s', timestamp) / 43200 AS INTEGER) as tb FROM playback_history GROUP BY media_id, tb)").get())?.c || 0;
        return `Library: ${movies} movies, ${shows} TV shows, ${artists} music artists, ${plays} play history entries.`;
    } catch {
        return '';
    }
}

/**
 * Detect what media type the user is asking about.
 * @param {string} question
 * @returns {{ filter: string, label: string }}
 */
function detectMediaType(question) {
    const q = question.toLowerCase();
    if (/\b(movie|movies|film|films)\b/.test(q)) return { filter: "AND mp.media_type = 'movie'", label: 'movie' };
    if (/\b(show|shows|series|tv)\b/.test(q)) return { filter: "AND mp.media_type = 'show'", label: 'show' };
    if (/\b(album|albums|music|artist|artists|song|songs|listen)\b/.test(q)) return { filter: "AND mp.media_type = 'artist'", label: 'music' };
    return { filter: '', label: '' };
}

/**
 * Build a taste profile from the user's watch/listen history.
 * Always available — no RAG dependency.
 * @param {number} userId
 * @param {string} [mediaTypeFilter]
 * @returns {string}
 */
function buildTasteProfile(userId, mediaTypeFilter = '') {
    const parts = [];

    // Recent watch history (last 2 weeks)
    try {
        const recent = /** @type {any[]} */ (db.prepare(`
            SELECT DISTINCT mp.title, mp.media_type, mp.release_year,
                   MAX(ph.timestamp) as last_watched
            FROM playback_history ph
            JOIN media_children mc ON ph.media_id = mc.id
            JOIN media_parents mp ON mc.parent_id = mp.id
            WHERE ph.user_id = ? AND ph.timestamp > datetime('now', '-14 days')
            ${mediaTypeFilter}
            GROUP BY mp.id
            ORDER BY last_watched DESC
            LIMIT 15
        `).all(userId));
        if (recent.length > 0) {
            parts.push('RECENTLY WATCHED/LISTENED (past 2 weeks):\n' +
                recent.map(r => `- ${r.title} (${r.release_year || '?'}) [${r.media_type}]`).join('\n'));
        }
    } catch { /* ok */ }

    // Top genres from last 60 days
    try {
        const genres = /** @type {any[]} */ (db.prepare(`
            SELECT mt.tag_value, COUNT(DISTINCT mp.id) as cnt
            FROM playback_history ph
            JOIN media_children mc ON ph.media_id = mc.id
            JOIN media_parents mp ON mc.parent_id = mp.id
            JOIN media_tags mt ON mt.media_parent_id = mp.id
            WHERE ph.user_id = ? AND ph.timestamp > datetime('now', '-60 days')
            AND mt.tag_type = 'genre' ${mediaTypeFilter}
            GROUP BY mt.tag_value ORDER BY cnt DESC LIMIT 10
        `).all(userId));
        if (genres.length > 0) {
            parts.push('FAVORITE GENRES (based on recent activity): ' +
                genres.map(g => `${g.tag_value} (${g.cnt})`).join(', '));
        }
    } catch { /* ok */ }

    // Favorite directors and actors (from all-time play history)
    try {
        const people = /** @type {any[]} */ (db.prepare(`
            SELECT p.name, pc.role_type, COUNT(DISTINCT mp.id) as cnt
            FROM playback_history ph
            JOIN media_children mc ON ph.media_id = mc.id
            JOIN media_parents mp ON mc.parent_id = mp.id
            JOIN person_credits pc ON pc.media_parent_id = mp.id
            JOIN persons p ON pc.person_id = p.id
            WHERE ph.user_id = ? AND pc.role_type IN ('director', 'actor')
            ${mediaTypeFilter}
            GROUP BY p.id, pc.role_type
            ORDER BY cnt DESC
            LIMIT 12
        `).all(userId));
        const dirs = people.filter(p => p.role_type === 'director').slice(0, 5);
        const acts = people.filter(p => p.role_type === 'actor').slice(0, 5);
        if (dirs.length > 0) parts.push('FAVORITE DIRECTORS: ' + dirs.map(d => `${d.name} (${d.cnt} titles)`).join(', '));
        if (acts.length > 0) parts.push('FAVORITE ACTORS: ' + acts.map(a => `${a.name} (${a.cnt} titles)`).join(', '));
    } catch { /* ok */ }

    // Favorited items
    try {
        const favs = /** @type {any[]} */ (db.prepare(`
            SELECT mp.title, mp.media_type, mp.release_year
            FROM favorites f
            JOIN media_parents mp ON f.media_parent_id = mp.id
            WHERE f.user_id = ? ${mediaTypeFilter}
            ORDER BY f.created_at DESC LIMIT 8
        `).all(userId));
        if (favs.length > 0) {
            parts.push('FAVORITED: ' + favs.map(f => `${f.title} (${f.release_year || '?'})`).join(', '));
        }
    } catch { /* ok */ }

    return parts.length > 0
        ? '=== USER TASTE PROFILE ===\n' + parts.join('\n\n') + '\n=== END PROFILE ==='
        : '';
}

/**
 * Get "neglected gems" — unwatched in-library items sorted by rating.
 * @param {string} [mediaTypeFilter]
 * @returns {string}
 */
function getNeglectedMedia(mediaTypeFilter = '') {
    try {
        const neglected = /** @type {any[]} */ (db.prepare(`
            SELECT mp.id, mp.title, mp.release_year, mp.media_type,
                   mc.community_rating,
                   SUBSTR(mp.overview, 1, 120) as overview
            FROM media_parents mp
            JOIN media_children mc ON mc.parent_id = mp.id
            WHERE mc.watch_status != 'watched' AND mc.is_collected = 1
            ${mediaTypeFilter || "AND mp.media_type IN ('movie', 'show')"}
            AND mp.overview IS NOT NULL AND mp.overview != ''
            AND mc.community_rating IS NOT NULL
            ORDER BY mc.community_rating DESC, mp.release_year DESC
            LIMIT 15
        `).all());
        if (neglected.length === 0) return '';
        return 'UNWATCHED IN YOUR LIBRARY (hidden gems):\n' +
            neglected.map(n => {
                const rating = n.community_rating ? ` ⭐${n.community_rating.toFixed(1)}` : '';
                return `- ${n.title} (${n.release_year || '?'}) [${n.media_type}]${rating}: ${n.overview || 'No description'}...`;
            }).join('\n');
    } catch {
        return '';
    }
}

/**
 * Get external recommendations from TMDB based on recently watched items.
 * @param {number} userId
 * @param {string} mediaTypeLabel - 'movie', 'show', or ''
 * @returns {Promise<string>}
 */
async function getExternalRecommendations(userId, mediaTypeLabel) {
    if (!getTmdbKey()) return '';
    const tmdbType = mediaTypeLabel === 'show' ? 'tv' : 'movie';
    const actualType = mediaTypeLabel === 'music' ? '' : tmdbType;
    if (!actualType) return '';

    try {
        const recentWithTmdb = /** @type {any[]} */ (db.prepare(`
            SELECT DISTINCT mp.tmdb_id, mp.title
            FROM playback_history ph
            JOIN media_children mc ON ph.media_id = mc.id
            JOIN media_parents mp ON mc.parent_id = mp.id
            WHERE ph.user_id = ? AND mp.tmdb_id IS NOT NULL
            AND mp.media_type = ?
            AND ph.timestamp > datetime('now', '-30 days')
            ORDER BY ph.timestamp DESC
            LIMIT 3
        `).all(userId, actualType === 'tv' ? 'show' : 'movie'));

        if (recentWithTmdb.length === 0) return '';

        /** @type {Map<string, any>} */
        const seen = new Map();
        const checkLibrary = db.prepare('SELECT id FROM media_parents WHERE tmdb_id = ? LIMIT 1');

        for (const item of recentWithTmdb.slice(0, 2)) {
            try {
                const res = await tmdbFetch(`/${actualType}/${item.tmdb_id}/recommendations`, { page: '1' });
                if (!res.ok) continue;
                const data = await res.json();
                for (const rec of (data.results || []).slice(0, 8)) {
                    const tmdbId = String(rec.id);
                    if (seen.has(tmdbId)) continue;
                    const existing = /** @type {any} */ (checkLibrary.get(tmdbId));
                    if (existing) continue;
                    const title = rec.title || rec.name;
                    if (!title) continue;
                    seen.set(tmdbId, {
                        title,
                        year: (rec.release_date || rec.first_air_date || '').split('-')[0] || '?',
                        overview: (rec.overview || '').slice(0, 120),
                        rating: rec.vote_average || 0,
                        basedOn: item.title,
                    });
                }
            } catch { /* skip this item */ }
        }

        if (seen.size === 0) return '';
        const recs = [...seen.values()]
            .sort((a, b) => b.rating - a.rating)
            .slice(0, 10);

        return 'NOT IN YOUR LIBRARY — EXTERNAL RECOMMENDATIONS (from TMDB):\n' +
            recs.map(r => `- ${r.title} (${r.year}) ⭐${r.rating.toFixed(1)} (because you watched ${r.basedOn}): ${r.overview}...`).join('\n');
    } catch (e) {
        logWarn('ask', `TMDB recs failed: ${e instanceof Error ? e.message : e}`);
        return '';
    }
}

/**
 * Retrieve semantically similar media for RAG context.
 * Embeds the query, searches vec0, enriches with tags/status/history.
 * @param {string} question
 * @param {number} [userId]
 * @returns {Promise<{ context: string, sources: any[], mediaTypeLabel: string } | null>}
 */
async function retrieveContext(question, userId) {
    if (!isEmbeddingAvailable()) {
        logWarn('ask', 'RAG: isEmbeddingAvailable() returned false');
        return null;
    }

    // Detect media type preference from the question
    const qLower = question.toLowerCase();
    let mediaTypeFilter = '';
    let mediaTypeLabel = '';
    if (/\b(movie|movies|film|films)\b/.test(qLower)) {
        mediaTypeFilter = "AND mp.media_type = 'movie'";
        mediaTypeLabel = 'movie';
    } else if (/\b(show|shows|series|tv)\b/.test(qLower)) {
        mediaTypeFilter = "AND mp.media_type = 'show'";
        mediaTypeLabel = 'show';
    } else if (/\b(album|albums|music|artist|artists|song|songs)\b/.test(qLower)) {
        mediaTypeFilter = "AND mp.media_type = 'artist'";
        mediaTypeLabel = 'music';
    }

    // Detect if the user is asking for history-based recommendations
    const isHistoryBased = /\b(my history|my watch|i'?ve been watch|i'?ve watched|i watched|been watching|watched recently|watched lately|recent watches|past week|past month|past few)\b/i.test(question);

    /** @type {number[] | null} */
    let queryVec = null;

    if (isHistoryBased && userId) {
        // Use average of recently-watched item embeddings for better personalization
        // Filter by detected media type — "movies based on my history" should only look at watched movies
        const historyTypeFilter = mediaTypeLabel === 'movie' ? "AND mp.media_type = 'movie'"
            : mediaTypeLabel === 'show' ? "AND mp.media_type = 'show'"
            : mediaTypeLabel === 'music' ? "AND mp.media_type = 'artist'"
            : "AND mp.media_type IN ('movie', 'show')"; // default: visual media only
        try {
            const recentEmbeddings = /** @type {any[]} */ (db.prepare(`
                SELECT oe.overview_embedding
                FROM playback_history ph
                JOIN media_children mc ON ph.media_id = mc.id
                JOIN media_parents mp ON mc.parent_id = mp.id
                JOIN overview_embeddings oe ON oe.media_parent_id = mp.id
                WHERE ph.user_id = ? AND ph.timestamp > datetime('now', '-30 days')
                ${historyTypeFilter}
                GROUP BY mp.id
                ORDER BY MAX(ph.timestamp) DESC
                LIMIT 10
            `).all(userId));

            if (recentEmbeddings.length > 0) {
                // Average the embeddings
                const dim = 768;
                const avg = new Float32Array(dim);
                for (const row of recentEmbeddings) {
                    const buf = row.overview_embedding;
                    const vec = new Float32Array(buf.buffer || buf);
                    for (let i = 0; i < dim; i++) avg[i] += vec[i];
                }
                for (let i = 0; i < dim; i++) avg[i] /= recentEmbeddings.length;
                queryVec = Array.from(avg);
                logInfo('ask', `RAG: using averaged embedding from ${recentEmbeddings.length} recent watches`);
            }
        } catch (e) {
            logWarn('ask', `RAG: history embedding failed: ${e instanceof Error ? e.message : e}`);
        }
    }

    // Fall back to embedding the question text
    if (!queryVec) {
        queryVec = await embed(question);
        if (!queryVec) {
            logWarn('ask', 'RAG: embed() returned null — Ollama embedding call failed');
            return null;
        }
    }

    // Semantic search: find closest media by overview embedding
    // NOTE: sqlite-vec does NOT support WHERE on computed distance columns (silently returns 0).
    //       Use ORDER BY + LIMIT, then filter in JS.
    /** @type {any[]} */
    let matches = [];
    try {
        const rawMatches = db.prepare(`
            SELECT oe.media_parent_id, vec_distance_cosine(oe.overview_embedding, ?) as distance
            FROM overview_embeddings oe
            ORDER BY distance
            LIMIT 30
        `).all(JSON.stringify(queryVec));
        // Post-filter: keep only reasonable matches (cosine distance < 0.75)
        matches = rawMatches.filter((/** @type {any} */ m) => m.distance < 0.75);
    } catch (e) {
        logWarn('ask', `Semantic search failed: ${e instanceof Error ? e.message : e}`);
        return null;
    }

    if (matches.length === 0) return null;

    // Enrich matches with full media details
    const matchIds = matches.map(m => m.media_parent_id);
    const distanceMap = Object.fromEntries(matches.map(m => [m.media_parent_id, m.distance]));

    /** @type {any[]} */
    let candidates;
    try {
        const placeholders = matchIds.map(() => '?').join(',');
        candidates = db.prepare(`
            SELECT id, title, media_type, release_year, overview,
                   watched_children, collected_children, total_released_children,
                   is_favorite
            FROM media_parents mp
            WHERE id IN (${placeholders}) ${mediaTypeFilter}
        `).all(...matchIds);
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        logWarn('ask', `Media enrichment failed: ${msg}`);
        return null;
    }

    // Attach distances and sort
    candidates = candidates.map(c => ({ ...c, distance: distanceMap[c.id] || 1.0 }));
    candidates.sort((a, b) => a.distance - b.distance);

    // Enrich each candidate with tags and watch info
    const enriched = candidates.map(c => {
        // Get tags
        /** @type {any[]} */
        let tags = [];
        try {
            tags = db.prepare(
                'SELECT tag_type, tag_value FROM media_tags WHERE media_parent_id = ?'
            ).all(c.id);
        } catch { /* no tags */ }

        // Get watch status summary (for shows/artists with children)
        let watchInfo = '';
        if (c.media_type === 'show') {
            const watched = c.watched_children || 0;
            const total = c.collected_children || c.total_released_children || 0;
            if (total > 0) {
                watchInfo = watched === total ? '(fully watched)' :
                    watched === 0 ? `(unwatched — ${total} episodes)` :
                    `(${watched}/${total} episodes watched)`;
            }
        } else if (c.media_type === 'movie') {
            try {
                const child = /** @type {any} */ (db.prepare(
                    'SELECT watch_status FROM media_children WHERE parent_id = ? LIMIT 1'
                ).get(c.id));
                if (child) watchInfo = child.watch_status === 'watched' ? '(watched)' : '(unwatched)';
            } catch { /* ok */ }
        }

        const genreTags = tags.filter(t => t.tag_type === 'genre').map(t => t.tag_value);
        const moodTags = tags.filter(t => t.tag_type === 'mood').map(t => t.tag_value);

        return {
            id: c.id,
            title: c.title,
            type: c.media_type,
            year: c.release_year,
            overview: c.overview?.slice(0, 200),
            genres: genreTags,
            moods: moodTags,
            watchInfo,
            distance: Math.round(c.distance * 1000) / 1000,
            favorite: c.is_favorite === 1,
        };
    });

    // Get recent watch history for personalization
    let recentWatches = '';
    if (userId) {
        try {
            const recent = /** @type {any[]} */ (db.prepare(`
                SELECT DISTINCT mp.title, mp.media_type
                FROM playback_history ph
                JOIN media_children mc ON ph.media_id = mc.id
                JOIN media_parents mp ON mc.parent_id = mp.id
                WHERE ph.user_id = ? AND ph.timestamp > datetime('now', '-30 days')
                ORDER BY ph.timestamp DESC
                LIMIT 10
            `).all(userId));
            if (recent.length > 0) {
                recentWatches = `\nRecently watched/listened: ${recent.map(r => r.title).join(', ')}`;
            }
        } catch { /* ok */ }
    }

    // Build context string
    const lines = enriched.map((item, i) => {
        let line = `${i + 1}. ${item.title}`;
        if (item.year) line += ` (${item.year})`;
        line += ` [${item.type}]`;
        if (item.watchInfo) line += ` ${item.watchInfo}`;
        if (item.favorite) line += ' ⭐';
        if (item.genres.length) line += ` — ${item.genres.join(', ')}`;
        if (item.moods.length) line += ` | mood: ${item.moods.join(', ')}`;
        if (item.overview) line += `\n   ${item.overview}...`;
        return line;
    });

    const context = `Items from the user's library that match their request:\n${lines.join('\n')}${recentWatches}`;

    return { context, sources: enriched, mediaTypeLabel };
}

/**
 * POST /api/ask — Chat with your media library
 * Handles both conversational questions and data queries (text-to-SQL).
 * @type {import('./$types').RequestHandler}
 */
export async function POST({ request, locals }) {
    if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

    const body = await request.json();
    const question = body.question?.trim();
    const history = Array.isArray(body.history) ? body.history.slice(-10) : [];
    if (!question) return json({ error: 'No question provided' }, { status: 400 });

    // Format conversation history for context
    const historyContext = history.length > 0
        ? history.map(/** @param {{ role: string, text: string }} m */ m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.text}`).join('\n') + '\n'
        : '';

    // Step 1: Ask the LLM to classify the question
    const classifyPrompt = `Classify this user message into one of three categories:
- "data" — requires querying a database (counts, lists, lookups, statistics, viewing specific watch history, who stars in X, filmography queries, movies by a director, do I have more from X, "what is X about", "tell me about X")
- "discovery" — recommendations, suggestions, mood-based picks, similarity, exploration, wanting picks BASED ON history, or conversational follow-ups about recommendations
- "chat" — greeting, thanks, general conversation, non-library question

IMPORTANT: If the conversation has been about recommendations and the user is continuing that thread (corrections, follow-ups, refinements), classify as "discovery". But factual lookups about people/directors/actors/specific titles are always "data".

Examples: "how many movies?" → data | "recommend something dark" → discovery | "something like Breaking Bad" → discovery | "what should I watch?" → discovery | "hello" → chat | "what did I watch today?" → data | "tell me about Inception" → data | "what is Ran about?" → data | "thanks!" → chat | "what's a good movie based on my history?" → discovery | "suggest something like what I've been watching" → discovery | "list my recently watched" → data | "why do you say that?" → discovery | "only movies please" → discovery | "who stars in kurosawa films?" → data | "do I have more movies from Nolan?" → data | "what else has that actor been in?" → data | "movies directed by Spielberg" → data | "what movies did I watch this week?" → data | "I only watched X once" → chat | "that's wrong" → chat | "two of those aren't movies" → discovery

${historyContext ? `Recent conversation:\n${historyContext}\n` : ''}Reply with ONLY the word "data", "discovery", or "chat".

Message: ${question}`;

    const classification = await generate(classifyPrompt, {
        temperature: 0,
        system: 'You classify messages. Reply with exactly one word: "data", "discovery", or "chat".',
    });

    const classWord = classification?.trim().toLowerCase().replace(/[^a-z]/g, '') || 'chat';
    let isDataQuery = classWord.startsWith('data');
    let isDiscovery = classWord.startsWith('discover');

    // Safety net: catch obvious discovery/recommendation questions the LLM might miss
    if (!isDataQuery && !isDiscovery) {
        const discoveryOverride = /\b(recommend|suggest|what should i (watch|see|listen)|good (movie|show|film|series)|tonight|mood for|feel like watch|something like|similar to|based on (my|what)|hidden gem|overlooked|neglected|missing out|check out)\b/i.test(question);
        if (discoveryOverride) {
            isDiscovery = true;
            logInfo('ask', `Classification override: "${question}" → forced discovery (was chat)`);
        }
    }

    logInfo('ask', `Question: "${question}" → classified as ${isDataQuery ? 'data' : isDiscovery ? 'discovery' : 'chat'}`);

    // Step 2a: For chat/conversational questions, just answer directly
    if (!isDataQuery && !isDiscovery) {
        const stats = getLibraryStats();
        const chatResponse = await generate(
            `${stats ? `Context: ${stats}\n` : ''}${historyContext ? `Conversation so far:\n${historyContext}\n` : ''}User: ${question}`,
            {
                temperature: 0.5,
                num_predict: 150,
                system: 'You are Mediajam, a media library assistant. Be concise — answer in 1-3 sentences max. Never use bullet lists or numbered lists in casual chat. Be warm but brief.',
            }
        );

        return json({
            question,
            type: 'chat',
            summary: chatResponse || "I tried to respond but couldn't reach the LLM. Check your Settings → LLM configuration — make sure a provider is connected and working.",
        });
    }

    // Step 2b: Discovery — multi-layered recommendations
    if (isDiscovery) {
        const userId = locals.user?.id;
        const { filter: mediaTypeFilter, label: mediaTypeLabel } = detectMediaType(question);

        // === Layer 1: Always-on taste profile (SQL, no RAG needed) ===
        const tasteProfile = userId ? buildTasteProfile(userId, mediaTypeFilter) : '';
        logInfo('ask', `Discovery: taste profile ${tasteProfile ? `built (${tasteProfile.length} chars)` : 'empty'}`);

        // === Layer 2: Neglected library gems ===
        const neglectedGems = getNeglectedMedia(mediaTypeFilter);
        logInfo('ask', `Discovery: neglected gems ${neglectedGems ? 'found' : 'empty'}`);

        // === Layer 3: RAG enrichment (additive, not required) ===
        let ragSection = '';
        /** @type {any[]} */
        let ragSources = [];
        const ragContext = await retrieveContext(question, userId);
        if (ragContext) {
            ragSection = '\nSEMANTICALLY SIMILAR (from your library):\n' + ragContext.context;
            ragSources = ragContext.sources;
            logInfo('ask', `Discovery: RAG found ${ragSources.length} sources`);
        }

        // === Layer 4: External TMDB recommendations ===
        let externalRecs = '';
        // Only fetch external recs if the question seems to want them
        const wantsExternal = /\b(new|out there|discover|haven.t seen|outside|missing out|check out|should.*(try|see|watch)|not in.*library)\b/i.test(question);
        if (wantsExternal && userId && mediaTypeLabel !== 'music') {
            externalRecs = await getExternalRecommendations(userId, mediaTypeLabel);
            logInfo('ask', `Discovery: TMDB external recs ${externalRecs ? 'found' : 'empty'}`);
        }

        // === Build the combined prompt (with budget) ===
        const contextSections = budgetContextSections(
            [tasteProfile, neglectedGems, ragSection, externalRecs],
            CONTEXT_CHAR_BUDGET
        );

        if (contextSections.length > 0) {
            const typeInstruction = mediaTypeLabel
                ? `IMPORTANT: The user asked about ${mediaTypeLabel}s. Focus on ${mediaTypeLabel}s.\n`
                : '';

            const hasExternal = externalRecs.length > 0;
            const recInstruction = hasExternal
                ? 'Recommend 2-3 UNWATCHED items from their library AND 1-2 external titles they don\'t own yet. Clearly separate "From your library" and "You might also like" sections.'
                : 'Recommend 3-5 UNWATCHED items from their library. For each, give a one-line reason why it matches their taste.';

            const discoveryPrompt = `${historyContext ? `Conversation so far:\n${historyContext}\n` : ''}User: "${question}"

${contextSections}

${typeInstruction}${recInstruction}
Be conversational, specific, and brief. Reference their recent watches or favorite genres to explain why each pick fits.`;

            const discoveryResponse = await generate(discoveryPrompt, {
                temperature: 0.5,
                num_predict: 500,
                system: `You are Mediajam, a knowledgeable media library assistant. The user's complete taste profile and library data is provided above — USE IT. NEVER say "I don't know what you've been watching" or ask the user for information that's already in the context. Make specific, personalized recommendations based on the data provided. Be concise but warm. No bullet-point walls — use short paragraphs or a small list with brief reasons.`,
            });

            return json({
                question,
                type: 'discovery',
                summary: discoveryResponse || 'I had trouble generating a response. Could you try rephrasing or asking a more specific question?',
                sources: ragSources.slice(0, 8),
            });
        }

        // Absolute fallback: no context available at all
        return json({
            question,
            type: 'discovery',
            error: true,
            summary: '⚠️ I don\'t have enough data to make recommendations yet. Try watching a few things first, or ask me a specific question like "what unwatched movies do I have?"',
        });
    }

    // Step 2b: For data questions, generate SQL
    const schema = getSchemaContext();
    const today = new Date().toISOString().split('T')[0];
    const prompt = `Given this SQLite schema:
${schema}

The current user_id is ${locals.user.id}.
Today's date is ${today}.

RULES:
1. Output ONLY the raw SQL query. No explanation, no markdown, no code fences.
2. Must be a SELECT statement.
3. media_parents has NO user_id column — do not filter it by user.
4. To check watched/unwatched/in-progress status: use media_children.watch_status directly (values: 'watched', 'unwatched', 'in_progress'). Do NOT use playback_history for this.
5. playback_history is ONLY for: play timestamps, duration consumed, listening history, "recently played". playback_history.media_id → media_children.id.
6. "recently" means last 30 days. "this week" means last 7 days. "past week" means last 7 days. Use: timestamp > datetime('now', '-7 days') or '-30 days'.
7. For counting movies: SELECT COUNT(*) FROM media_parents WHERE media_type = 'movie'
8. Limit results to 50 rows.
9. Always use table aliases for JOINs. Define every alias BEFORE referencing it.
10. IMPORTANT: When the question mentions a director, actor, writer, or any person by name, ALWAYS start FROM person_credits and JOIN to persons and media_parents. Pattern: FROM person_credits pc JOIN persons p ON pc.person_id = p.id JOIN media_parents mp ON pc.media_parent_id = mp.id. NEVER reference an alias (like 'pc') before defining it in a FROM or JOIN clause.
11. "haven't seen", "haven't watched", "not watched", "unwatched" = mc.watch_status != 'watched'. Always JOIN media_children mc ON mc.parent_id = mp.id to check this.
12. When the user asks "what" or "which" or "list" — ALWAYS return titles and details (mp.title, mp.release_year, etc.), NOT just COUNT(*). Only use COUNT(*) when the user explicitly asks "how many".
13. When the user asks "what did I watch" — SELECT DISTINCT mp.title, mp.release_year, ph.timestamp FROM playback_history ph JOIN media_children mc ON ph.media_id = mc.id JOIN media_parents mp ON mc.parent_id = mp.id WHERE ... ORDER BY ph.timestamp DESC.

Question: ${question}
${historyContext ? `\nConversation context (use this to resolve pronouns like "them", "those", "it", references to previous results):\n${historyContext}` : ''}`;

    const sql = await generate(prompt, {
        temperature: 0.1,
        system: 'You are a SQL expert. You ONLY output valid SQLite SELECT queries. No explanations, no markdown. Just the SQL.',
    });

    if (!sql) {
        return json({ error: 'LLM not available', type: 'error' }, { status: 503 });
    }

    // Clean the response
    let cleanSql = sql
        .replace(/```sql\n?/gi, '')
        .replace(/```\n?/g, '')
        .trim();

    // Extract SELECT if there's preamble
    if (!cleanSql.toUpperCase().startsWith('SELECT')) {
        const selectIdx = cleanSql.toUpperCase().indexOf('SELECT');
        if (selectIdx >= 0) {
            cleanSql = cleanSql.slice(selectIdx).trim();
        }
    }

    // Remove trailing semicolons
    cleanSql = cleanSql.replace(/;\s*$/, '').trim();

    // Post-processing: detect COUNT-only queries when user asked for specifics
    const wantsDetails = /\b(which|what|list|show me|name|tell me)\b/i.test(question) && !/\b(how many|how much|count|total|number of)\b/i.test(question);
    if (wantsDetails && /^\s*SELECT\s+COUNT\s*\(/i.test(cleanSql)) {
        logInfo('ask', `SQL fix: user asked "${question}" but LLM generated COUNT — rewriting to return titles`);
        // Rewrite: replace "SELECT COUNT(*)" with "SELECT DISTINCT mp.title, mp.release_year"
        // and remove any GROUP BY that would break it
        cleanSql = cleanSql
            .replace(/SELECT\s+COUNT\s*\([^)]*\)\s*(as\s+\w+)?/i, 'SELECT DISTINCT mp.title, mp.release_year, mc.watch_status')
            .replace(/\s+GROUP\s+BY\s+[^\s]+(?:\s*,\s*[^\s]+)*/i, '');
        // Ensure LIMIT exists
        if (!/LIMIT/i.test(cleanSql)) cleanSql += ' LIMIT 50';
        logInfo('ask', `SQL rewritten: ${cleanSql}`);
    }

    logInfo('ask', `SQL: ${cleanSql}`);

    // Validate
    const validation = validateQuery(cleanSql);
    if (!validation.valid) {
        logWarn('ask', `Validation failed: ${validation.error} for SQL: ${cleanSql}`);
        // Fall back to a chat response instead of a hard error
        const fallbackResponse = await generate(
            `The user asked about their media library: "${question}". I couldn't query the database for this. Please give a helpful response explaining you couldn't find the data, and suggest how they might rephrase their question.`,
            { temperature: 0.5, system: 'You are Mediajam, a friendly media library assistant. Be concise.' }
        );
        return json({
            question,
            type: 'chat',
            summary: fallbackResponse || `I couldn't process that query. Try rephrasing your question, e.g. "How many movies do I have?" or "What did I watch this week?"`,
        });
    }

    // Execute
    try {
        const results = db.prepare(cleanSql).all();
        const sliced = results.slice(0, 50);

        // Generate natural language summary
        let summary = null;
        if (sliced.length > 0) {
            try {
                const dataPreview = JSON.stringify(sliced.slice(0, 15), null, 2);
                const summaryPrompt = `The user asked: "${question}"

The database query returned ${results.length} result(s)${results.length > 15 ? ` (showing first 15)` : ''}. Here is the data (JSON):
${dataPreview}

CRITICAL RULES:
- Answer ONLY based on the data above. Do NOT invent or fabricate any facts.
- If the data shows titles, LIST them by name. Do not say "I don't have information" when the data clearly contains it.
- If the data shows a count, state the exact number.
- If a COUNT(*) is 28, that means 28 items were found — say that, don't say "none" or "zero".
- Be concise (2-3 sentences max). Be conversational. Do NOT mention SQL or databases.`;

                summary = await generate(summaryPrompt, {
                    temperature: 0.2,
                    system: 'You are a helpful media library assistant. Answer ONLY based on the data provided. Never contradict the data. List specific titles when available. Be concise and specific.',
                });
            } catch { /* ok */ }
        } else {
            summary = 'No results found for that query.';
        }

        return json({
            question,
            type: 'data',
            sql: cleanSql,
            results: sliced,
            count: results.length,
            summary,
        });
    } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e);
        logWarn('ask', `SQL execution failed: ${errMsg}`);
        // Fall back to chat instead of hard error
        return json({
            question,
            type: 'chat',
            summary: `I tried to look that up but ran into an issue. Try rephrasing — for example, "What movies did I watch recently?" or "How many TV shows do I have?"`,
            sql: cleanSql,
        });
    }
}
