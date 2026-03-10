import { json } from '@sveltejs/kit';
import db from '$lib/server/db.js';
import { generate } from '$lib/server/ollama.js';
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
 * POST /api/ask — Chat with your media library
 * Handles both conversational questions and data queries (text-to-SQL).
 * @type {import('./$types').RequestHandler}
 */
export async function POST({ request, locals }) {
    if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

    const body = await request.json();
    const question = body.question?.trim();
    if (!question) return json({ error: 'No question provided' }, { status: 400 });

    // Step 1: Ask the LLM to classify the question
    const classifyPrompt = `Classify this user message as either "data" (requires querying a media library database) or "chat" (general conversation, greeting, opinion, recommendation, or non-data question).

Examples:
- "hello" → chat
- "what movies do I have?" → data
- "how many shows did I watch?" → data
- "recommend a good movie" → chat
- "what's the weather?" → chat
- "who directed the most movies in my library?" → data
- "thanks!" → chat
- "what did I listen to today?" → data

Reply with ONLY the word "data" or "chat".

Message: ${question}`;

    const classification = await generate(classifyPrompt, {
        temperature: 0,
        system: 'You classify messages. Reply with exactly one word: "data" or "chat".',
    });

    const isDataQuery = classification?.trim().toLowerCase().startsWith('data');

    logInfo('ask', `Question: "${question}" → classified as ${isDataQuery ? 'data' : 'chat'}`);

    // Step 2a: For chat/conversational questions, just answer directly
    if (!isDataQuery) {
        const stats = getLibraryStats();
        const chatResponse = await generate(
            `${stats ? `Context: ${stats}\n\n` : ''}User says: "${question}"`,
            {
                temperature: 0.7,
                system: `You are Mediajam, a friendly media library assistant. You help users with their movie, TV, and music collection. Be concise and helpful. If the user asks something you can't answer without database access, suggest they ask a specific data question like "how many movies do I have?" or "what did I watch this week?"`,
            }
        );

        return json({
            question,
            type: 'chat',
            summary: chatResponse || "I'm here to help with your media library! Try asking something like \"What movies did I watch this month?\" or \"How many albums do I have?\"",
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
