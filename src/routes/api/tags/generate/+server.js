import { json } from '@sveltejs/kit';
import db from '$lib/server/db.js';
import { generate } from '$lib/server/ollama.js';

/**
 * POST /api/tags/generate — Generate LLM tags for all media_parents with overviews
 * Streams SSE progress.
 * @type {import('./$types').RequestHandler}
 */
export async function POST({ locals }) {
    if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

    // Test LLM is available
    const test = await generate('Say "ok"', { temperature: 0 });
    if (!test) {
        return json({ error: 'Ollama chat model not available' }, { status: 503 });
    }

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
        async start(controller) {
            const send = (/** @type {any} */ data) => {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
            };

            try {
                // Get media_parents that don't have tags yet
                const parents = /** @type {any[]} */ (db.prepare(`
                    SELECT mp.id, mp.title, mp.overview, mp.media_type
                    FROM media_parents mp
                    WHERE mp.overview IS NOT NULL AND mp.overview != ''
                    AND mp.id NOT IN (SELECT DISTINCT media_parent_id FROM media_tags)
                    ORDER BY mp.title
                `).all());

                send({ type: 'status', total: parents.length });

                const insertTag = db.prepare(
                    'INSERT OR IGNORE INTO media_tags (media_parent_id, tag_type, tag_value) VALUES (?, ?, ?)'
                );

                let done = 0;
                let tagged = 0;

                for (const parent of parents) {
                    const mediaTypeLabel = parent.media_type === 'artist' ? 'music artist' : parent.media_type;
                    const prompt = `Categorize this ${mediaTypeLabel}:
Title: ${parent.title}
Overview: ${parent.overview}

Return a JSON object with these arrays:
- genres: up to 3 genre tags (e.g. Action, Comedy, Rock, Jazz)
- moods: up to 2 mood/tone tags (e.g. Dark, Uplifting, Suspenseful, Chill)
- themes: up to 3 theme tags (e.g. Family, Revenge, Space, Coming-of-age)

Only return valid JSON, no explanation.`;

                    const response = await generate(prompt, {
                        temperature: 0.2,
                        format: 'json',
                        system: 'You are a media categorization expert. Return only valid JSON with genres, moods, and themes arrays.',
                    });

                    if (response) {
                        try {
                            const tags = JSON.parse(response);
                            const insert = db.transaction(() => {
                                for (const genre of (tags.genres || [])) {
                                    insertTag.run(parent.id, 'genre', String(genre).toLowerCase().trim());
                                }
                                for (const mood of (tags.moods || [])) {
                                    insertTag.run(parent.id, 'mood', String(mood).toLowerCase().trim());
                                }
                                for (const theme of (tags.themes || [])) {
                                    insertTag.run(parent.id, 'theme', String(theme).toLowerCase().trim());
                                }
                            });
                            insert();
                            tagged++;
                        } catch {
                            // LLM returned invalid JSON — skip
                            send({ type: 'log', message: `Skipped ${parent.title}: invalid JSON response` });
                        }
                    }

                    done++;
                    if (done % 5 === 0 || done === parents.length) {
                        send({
                            type: 'progress',
                            done,
                            total: parents.length,
                            tagged,
                            current: parent.title,
                        });
                    }
                }

                send({ type: 'complete', total: parents.length, tagged });
            } catch (e) {
                send({ type: 'error', message: e instanceof Error ? e.message : String(e) });
            }

            controller.close();
        },
    });

    return new Response(stream, {
        headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache, no-transform',
            Connection: 'keep-alive',
        },
    });
}

/**
 * GET /api/tags/generate — Get tagging stats
 * @type {import('./$types').RequestHandler}
 */
export async function GET({ locals }) {
    if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

    const totalTagged = /** @type {any} */ (db.prepare(
        'SELECT COUNT(DISTINCT media_parent_id) as c FROM media_tags'
    ).get())?.c || 0;

    const totalTags = /** @type {any} */ (db.prepare(
        'SELECT COUNT(*) as c FROM media_tags'
    ).get())?.c || 0;

    const totalWithOverview = /** @type {any} */ (db.prepare(
        "SELECT COUNT(*) as c FROM media_parents WHERE overview IS NOT NULL AND overview != ''"
    ).get())?.c || 0;

    const tagsByType = /** @type {any[]} */ (db.prepare(
        'SELECT tag_type, COUNT(*) as count FROM media_tags GROUP BY tag_type'
    ).all());

    const topTags = /** @type {any[]} */ (db.prepare(
        'SELECT tag_type, tag_value, COUNT(*) as count FROM media_tags GROUP BY tag_type, tag_value ORDER BY count DESC LIMIT 20'
    ).all());

    return json({
        totalTagged,
        totalTags,
        totalWithOverview,
        tagsByType,
        topTags,
    });
}
