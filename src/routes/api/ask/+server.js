import { json } from '@sveltejs/kit';
import db from '$lib/server/db.js';
import { generate, embed, isEmbeddingAvailable } from '$lib/server/ollama.js';
import { logInfo, logWarn } from '$lib/server/logger.js';

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

EXAMPLE QUERIES (follow these patterns):
-- How many movies: SELECT COUNT(*) as count FROM media_parents WHERE media_type = 'movie'
-- How many albums: SELECT COUNT(*) as count FROM media_children mc JOIN media_parents mp ON mc.parent_id = mp.id WHERE mp.media_type = 'artist'
-- Total runtime of a show in hours: SELECT ROUND(SUM(mc.runtime_ticks) / 36000000000.0, 1) as hours FROM media_children mc JOIN media_parents mp ON mc.parent_id = mp.id WHERE mp.title LIKE '%Simpsons%' AND mp.media_type = 'show'
-- Unwatched episodes remaining (hours): SELECT ROUND(SUM(mc.runtime_ticks) / 36000000000.0, 1) as hours_remaining, COUNT(*) as episodes FROM media_children mc JOIN media_parents mp ON mc.parent_id = mp.id WHERE mp.title LIKE '%Simpsons%' AND mc.watch_status != 'watched'
-- Recently watched movies: SELECT DISTINCT mp.title, mp.release_year, ph.timestamp FROM playback_history ph JOIN media_children mc ON ph.media_id = mc.id JOIN media_parents mp ON mc.parent_id = mp.id WHERE mp.media_type = 'movie' AND ph.timestamp > datetime('now', '-30 days') ORDER BY ph.timestamp DESC LIMIT 20
-- Movies by director: SELECT mp.title, mp.release_year FROM person_credits pc JOIN persons p ON pc.person_id = p.id JOIN media_parents mp ON pc.media_parent_id = mp.id WHERE p.name LIKE '%Spielberg%' AND pc.role_type = 'director'
-- Genres for a type: SELECT mt.tag_value, COUNT(*) as cnt FROM media_tags mt JOIN media_parents mp ON mt.media_parent_id = mp.id WHERE mp.media_type = 'movie' AND mt.tag_type = 'genre' GROUP BY mt.tag_value ORDER BY cnt DESC
-- Most watched artists: SELECT mp.title, SUM(mc.play_count) as plays FROM media_children mc JOIN media_parents mp ON mc.parent_id = mp.id WHERE mp.media_type = 'artist' GROUP BY mp.id ORDER BY plays DESC LIMIT 10
-- Hours of music listened: SELECT ROUND(SUM(ph.duration_consumed_seconds) / 3600.0, 1) as hours FROM playback_history ph JOIN media_children mc ON ph.media_id = mc.id JOIN media_parents mp ON mc.parent_id = mp.id WHERE mp.media_type = 'artist'`;
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
        const plays = /** @type {any} */ (db.prepare("SELECT COUNT(*) as c FROM playback_history").get())?.c || 0;
        return `Library: ${movies} movies, ${shows} TV shows, ${artists} music artists, ${plays} play history entries.`;
    } catch {
        return '';
    }
}

/**
 * Retrieve semantically similar media for RAG context.
 * Embeds the query, searches vec0, enriches with tags/status/history.
 * @param {string} question
 * @param {number} [userId]
 * @returns {Promise<{ context: string, sources: any[] } | null>}
 */
async function retrieveContext(question, userId) {
    if (!isEmbeddingAvailable()) {
        logWarn('ask', 'RAG: isEmbeddingAvailable() returned false');
        return null;
    }

    const queryVec = await embed(question);
    if (!queryVec) {
        logWarn('ask', 'RAG: embed() returned null — Ollama embedding call failed');
        return null;
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
            LIMIT 20
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
            FROM media_parents
            WHERE id IN (${placeholders})
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

    return { context, sources: enriched };
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
- "data" — requires querying a database (counts, lists, lookups, statistics, viewing specific watch history)
- "discovery" — recommendations, suggestions, mood-based picks, similarity, exploration, asking about specific media, or wanting picks BASED ON history
- "chat" — greeting, thanks, general conversation, non-library question

Examples: "how many movies?" → data | "recommend something dark" → discovery | "something like Breaking Bad" → discovery | "what should I watch?" → discovery | "hello" → chat | "what did I watch today?" → data | "tell me about Inception" → discovery | "thanks!" → chat | "what's a good movie based on my history?" → discovery | "suggest something like what I've been watching" → discovery | "list my recently watched" → data

${historyContext ? `Recent conversation:\n${historyContext}\n` : ''}Reply with ONLY the word "data", "discovery", or "chat".

Message: ${question}`;

    const classification = await generate(classifyPrompt, {
        temperature: 0,
        system: 'You classify messages. Reply with exactly one word: "data", "discovery", or "chat".',
    });

    const classWord = classification?.trim().toLowerCase().replace(/[^a-z]/g, '') || 'chat';
    const isDataQuery = classWord.startsWith('data');
    const isDiscovery = classWord.startsWith('discover');

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
            summary: chatResponse || "Try asking something like \"What did I watch this month?\" or \"Recommend a dark movie.\"",
        });
    }

    // Step 2b: Discovery — RAG-powered recommendations and exploration
    if (isDiscovery) {
        const ragContext = await retrieveContext(question, locals.user?.id);

        if (ragContext) {
            logInfo('ask', `RAG context: ${ragContext.sources.length} sources retrieved`);

            const discoveryPrompt = `${historyContext ? `Conversation so far:\n${historyContext}\n` : ''}User: "${question}"

${ragContext.context}

Recommend 2-4 specific titles from the list above. For each, give a one-line reason. Note watched/unwatched status. Be conversational and brief — no more than 4-5 sentences total.`;

            const discoveryResponse = await generate(discoveryPrompt, {
                temperature: 0.4,
                num_predict: 250,
                system: 'You are Mediajam, a media library assistant. You recommend items ONLY from the user\'s actual library (provided in context). Be specific and concise — no filler, no questions back, no lists of suggestions for "how to explore." Just give the picks with brief reasons.',
            });

            return json({
                question,
                type: 'discovery',
                summary: discoveryResponse || 'I found some matches but couldn\'t generate a recommendation. Try rephrasing your question.',
                sources: ragContext.sources.slice(0, 8),
            });
        }

        // Fallback: RAG context unavailable
        logWarn('ask', 'RAG context unavailable — embeddings missing or embed failed');

        return json({
            question,
            type: 'discovery',
            error: true,
            summary: '⚠️ I can\'t provide personalized recommendations right now — there\'s a problem with my embedding system.\n\n' +
                '**To diagnose:**\n' +
                '1. Click the ⚙️ button in this chat header to check system status\n' +
                '2. Verify Ollama is connected and the embedding model is configured\n' +
                '3. Go to Settings → Server → "Generate Embeddings" and run it\n' +
                '4. If embeddings show 0%, the vec0 module may not be loaded\n\n' +
                'In the meantime, try a data question like "what movies did I watch this week?" — those don\'t need embeddings.',
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
6. "recently" means last 30 days. Use: timestamp > datetime('now', '-30 days')
7. For counting movies: SELECT COUNT(*) FROM media_parents WHERE media_type = 'movie'
8. Limit results to 50 rows.
9. Always use table aliases for JOINs.

Question: ${question}`;

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
                const summaryPrompt = `The user asked: "${question}"

The query returned ${results.length} result(s). Here is the data (JSON):
${JSON.stringify(sliced.slice(0, 15), null, 2)}

Provide a brief, friendly, conversational answer to the user's question based on this data. Be concise (2-3 sentences max). Use specific names, numbers, and facts from the data. Do NOT mention SQL or databases.`;

                summary = await generate(summaryPrompt, {
                    temperature: 0.3,
                    system: 'You are a helpful media library assistant. Answer naturally and conversationally. Be concise and specific.',
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
