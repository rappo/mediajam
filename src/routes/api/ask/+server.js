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
 * Get a simplified schema description for the LLM prompt.
 * @returns {string}
 */
function getSchemaContext() {
    return `SQLite database schema (only these tables may be queried):

media_parents: id, title, media_type ('show'|'movie'|'artist'), poster_url, overview, release_year, runtime_ticks, collected_children, watched_children, library_id, is_favorite, jellyfin_id, tmdb_id, imdb_id, tvdb_id, musicbrainz_id

media_children: id, parent_id (FK media_parents.id), jellyfin_id, title, season_number, item_number, is_special, overview, premiere_date

tracks: id, album_id (FK media_children.id), title, track_number, duration_ticks, musicbrainz_id

playback_history: id, user_id, media_id (FK media_children.id), source, timestamp, duration_consumed_seconds, completion_pct, external_event_id, track_name, track_id

persons: id, name, jellyfin_id, tmdb_id, imdb_id, photo_url, overview, is_favorite

person_credits: id, person_id (FK persons.id), media_parent_id (FK media_parents.id), role_type ('actor'|'director'|'writer'|'producer'), character_name, sort_order

media_tags: id, media_parent_id (FK media_parents.id), tag_type ('genre'|'mood'|'theme'), tag_value, source

lastfm_scrobbles: id, user_id, artist_name, track_name, album_name, timestamp_uts

trakt_history: id, user_id, trakt_id, type, watched_at, title, show_title, season, episode, year, tmdb_id, imdb_id

favorites: id, user_id, media_parent_id, person_id, created_at

libraries: jellyfin_id, name, type, total_items`;
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
        // Check for the word as a standalone token (not part of a column name)
        const regex = new RegExp(`\\b${word}\\b`, 'i');
        if (regex.test(upper) && word !== 'SELECT') {
            return { valid: false, error: `Forbidden keyword: ${word}` };
        }
    }

    // Check that only allowed tables are referenced
    // Simple heuristic — check FROM and JOIN clauses
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
 * POST /api/ask — Natural language query (text-to-SQL via LLM)
 * @type {import('./$types').RequestHandler}
 */
export async function POST({ request, locals }) {
    if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

    const body = await request.json();
    const question = body.question?.trim();
    if (!question) return json({ error: 'No question provided' }, { status: 400 });

    const schema = getSchemaContext();
    const prompt = `Given this SQLite schema:
${schema}

The current user_id is ${locals.user.id}.
Today's date is ${new Date().toISOString().split('T')[0]}.

Convert this question to a SQL query. Return ONLY the raw SQL, no explanation, no markdown, no code fences.
The query must be a SELECT statement. Use appropriate JOINs, aggregations, and WHERE clauses.
For time-based queries, the timestamp column in playback_history is in ISO format.
Limit results to 50 rows maximum.

Question: ${question}`;

    const sql = await generate(prompt, {
        temperature: 0.1,
        system: 'You are a SQL expert. You ONLY output valid SQLite SELECT queries. No explanations, no markdown. Just the SQL.',
    });

    if (!sql) {
        return json({ error: 'LLM not available' }, { status: 503 });
    }

    // Clean the response — remove code fences, preamble, and trailing text
    let cleanSql = sql
        .replace(/```sql\n?/gi, '')
        .replace(/```\n?/g, '')
        .trim();

    // If the LLM added preamble text, try to extract just the SELECT
    if (!cleanSql.toUpperCase().startsWith('SELECT')) {
        const selectIdx = cleanSql.toUpperCase().indexOf('SELECT');
        if (selectIdx >= 0) {
            cleanSql = cleanSql.slice(selectIdx).trim();
        }
    }

    // Remove trailing semicolons
    cleanSql = cleanSql.replace(/;\s*$/, '').trim();

    logInfo('ask', `Question: "${question}" → SQL: ${cleanSql}`);

    // Validate
    const validation = validateQuery(cleanSql);
    if (!validation.valid) {
        return json({ error: validation.error, sql: cleanSql }, { status: 400 });
    }

    // Execute with timeout
    try {
        const results = db.prepare(cleanSql).all();
        const sliced = results.slice(0, 50);

        // Generate natural language summary of results
        let summary = null;
        if (sliced.length > 0) {
            try {
                const summaryPrompt = `The user asked: "${question}"

The query returned ${results.length} result(s). Here is the data (JSON):
${JSON.stringify(sliced.slice(0, 15), null, 2)}

Provide a brief, friendly, conversational answer to the user's question based on this data. Be concise (2-3 sentences max). Use specific names, numbers, and facts from the data. Do NOT mention SQL or databases.`;

                summary = await generate(summaryPrompt, {
                    temperature: 0.3,
                    system: 'You are a helpful media library assistant. Answer the user\'s question naturally and conversationally based on the query results provided. Be concise and specific.',
                });
            } catch { /* summary generation failed, that's ok */ }
        }

        return json({
            question,
            sql: cleanSql,
            results: sliced,
            count: results.length,
            summary,
        });
    } catch (e) {
        return json({
            question,
            sql: cleanSql,
            error: e instanceof Error ? e.message : String(e),
        }, { status: 400 });
    }
}
