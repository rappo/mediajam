import { json } from '@sveltejs/kit';
import db, { sqliteVecLoaded } from '$lib/server/db.js';
import { embed, isEmbeddingAvailable } from '$lib/server/ollama.js';

/**
 * POST /api/embeddings/generate — Start batch embedding generation
 * Generates embeddings for all media_parents (overviews) and media_children (titles).
 * Returns SSE progress stream.
 * @type {import('./$types').RequestHandler}
 */
export async function POST({ locals }) {
    if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

    // Check if vec0 tables exist (requires sqlite-vec + server restart)
    try {
        db.prepare('SELECT COUNT(*) FROM overview_embeddings LIMIT 0').get();
    } catch {
        return json({ error: 'Embedding tables not created. Restart the dev server to initialize sqlite-vec tables.' }, { status: 503 });
    }

    // Test embedding works
    const testEmbed = await embed('test');
    if (!testEmbed) {
        return json({ error: 'Ollama not available or embedding model not loaded' }, { status: 503 });
    }

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
        async start(controller) {
            const send = (/** @type {any} */ data) => {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
            };

            try {
                // Phase 1: Embed media_parents overviews
                const parents = /** @type {any[]} */ (db.prepare(
                    `SELECT id, title, overview FROM media_parents
                     WHERE overview IS NOT NULL AND overview != ''
                     AND id NOT IN (SELECT media_parent_id FROM overview_embeddings)`
                ).all());

                send({ type: 'status', phase: 'overviews', total: parents.length });

                let done = 0;
                for (const parent of parents) {
                    const text = `${parent.title}. ${parent.overview}`;
                    const embedding = await embed(text);
                    if (embedding) {
                        try {
                            db.prepare(
                                'INSERT OR REPLACE INTO overview_embeddings (media_parent_id, overview_embedding) VALUES (?, ?)'
                            ).run(parent.id, JSON.stringify(embedding));
                        } catch (insertErr) {
                            if (done === 1) {
                                const errMsg = insertErr instanceof Error ? insertErr.message : String(insertErr);
                                send({ type: 'warning', message: `Embedding insert error (dim=${embedding.length}): ${errMsg}` });
                                console.error(`[embeddings] INSERT failed (dim=${embedding.length}, expected 768):`, errMsg);
                            }
                        }
                    }
                    done++;
                    if (done % 10 === 0 || done === parents.length) {
                        send({ type: 'progress', phase: 'overviews', done, total: parents.length });
                    }
                }

                // Phase 2: Embed media_children titles (albums, episodes, tracks)
                const children = /** @type {any[]} */ (db.prepare(
                    `SELECT mc.id, mc.title, mp.title as parent_title
                     FROM media_children mc
                     JOIN media_parents mp ON mc.parent_id = mp.id
                     WHERE mc.id NOT IN (SELECT media_id FROM media_embeddings)`
                ).all());

                send({ type: 'status', phase: 'titles', total: children.length });

                done = 0;
                for (const child of children) {
                    const text = `${child.parent_title} - ${child.title}`;
                    const embedding = await embed(text);
                    if (embedding) {
                        try {
                            db.prepare(
                                'INSERT OR REPLACE INTO media_embeddings (media_id, title_embedding) VALUES (?, ?)'
                            ).run(child.id, JSON.stringify(embedding));
                        } catch (insertErr) {
                            if (done === 1) {
                                const errMsg = insertErr instanceof Error ? insertErr.message : String(insertErr);
                                send({ type: 'warning', message: `Title embedding insert error (dim=${embedding.length}): ${errMsg}` });
                                console.error(`[embeddings] Title INSERT failed (dim=${embedding.length}, expected 768):`, errMsg);
                            }
                        }
                    }
                    done++;
                    if (done % 10 === 0 || done === children.length) {
                        send({ type: 'progress', phase: 'titles', done, total: children.length });
                    }
                }

                send({ type: 'complete', overviews: parents.length, titles: children.length });
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
 * GET /api/embeddings/generate — Get embedding stats
 * @type {import('./$types').RequestHandler}
 */
export async function GET({ locals }) {
    if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

    const available = isEmbeddingAvailable();
    let overviewCount = 0;
    let titleCount = 0;
    let totalParents = 0;
    let totalChildren = 0;

    try {
        overviewCount = /** @type {any} */ (db.prepare('SELECT COUNT(*) as c FROM overview_embeddings').get())?.c || 0;
        titleCount = /** @type {any} */ (db.prepare('SELECT COUNT(*) as c FROM media_embeddings').get())?.c || 0;
    } catch { /* vec0 tables don't exist */ }

    totalParents = /** @type {any} */ (db.prepare(
        "SELECT COUNT(*) as c FROM media_parents WHERE overview IS NOT NULL AND overview != ''"
    ).get())?.c || 0;
    totalChildren = /** @type {any} */ (db.prepare('SELECT COUNT(*) as c FROM media_children').get())?.c || 0;

    return json({
        available,
        sqliteVecLoaded,
        overviewEmbeddings: overviewCount,
        titleEmbeddings: titleCount,
        totalParentsWithOverview: totalParents,
        totalChildren,
    });
}
