import { json } from '@sveltejs/kit';
import db, { sqliteVecLoaded } from '$lib/server/db.js';
import { embed, isEmbeddingAvailable } from '$lib/server/ollama.js';
import crypto from 'crypto';

/** Compute a content hash for a given text
 * @param {string} text
 */
function contentHash(text) {
    return crypto.createHash('sha256').update(text).digest('hex');
}

/**
 * POST /api/embeddings/generate — Start batch embedding generation
 * Generates embeddings for all media_parents (overviews) and media_children (titles).
 * Uses content hashes to detect stale embeddings that need re-generation.
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
                // Get all parents with overviews, along with their stored content hash
                const parents = /** @type {any[]} */ (db.prepare(
                    `SELECT mp.id, mp.title, mp.overview, eh.content_hash
                     FROM media_parents mp
                     LEFT JOIN embedding_hashes eh ON eh.media_parent_id = mp.id
                     WHERE mp.overview IS NOT NULL AND mp.overview != ''`
                ).all());

                // Filter to items needing embedding: no hash (new) or hash mismatch (stale)
                const needsEmbedding = parents.filter(p => {
                    const hash = contentHash(`${p.title}. ${p.overview}`);
                    p._hash = hash; // stash for later
                    return !p.content_hash || p.content_hash !== hash;
                });

                const staleCount = needsEmbedding.filter(p => p.content_hash).length;
                const newCount = needsEmbedding.length - staleCount;
                send({ type: 'status', phase: 'overviews', total: needsEmbedding.length, new: newCount, stale: staleCount });

                let done = 0;
                let successCount = 0;
                let failCount = 0;
                let lastError = '';
                for (const parent of needsEmbedding) {
                    const text = `${parent.title}. ${parent.overview}`;
                    const embedding = await embed(text);
                    if (embedding) {
                        try {
                            db.prepare(
                                'INSERT OR REPLACE INTO overview_embeddings (media_parent_id, overview_embedding) VALUES (?, ?)'
                            ).run(Number(parent.id), JSON.stringify(embedding));
                            // Store the content hash
                            db.prepare(
                                'INSERT OR REPLACE INTO embedding_hashes (media_parent_id, content_hash, embedded_at) VALUES (?, ?, datetime(\'now\'))'
                            ).run(Number(parent.id), parent._hash);
                            successCount++;
                        } catch (insertErr) {
                            failCount++;
                            const errMsg = insertErr instanceof Error ? insertErr.message : String(insertErr);
                            lastError = errMsg;
                            if (failCount <= 5) {
                                send({ type: 'warning', message: `Embedding insert error (id=${parent.id}, dim=${embedding.length}): ${errMsg}` });
                                console.error(`[embeddings] INSERT failed for id=${parent.id} (dim=${embedding.length}):`, errMsg);
                            }
                        }
                    }
                    done++;
                    if (done % 10 === 0 || done === needsEmbedding.length) {
                        send({ type: 'progress', phase: 'overviews', done, total: needsEmbedding.length, ok: successCount, fail: failCount });
                    }
                }
                // Diagnostic: verify persistence
                let verifyCount = 0;
                try { verifyCount = /** @type {any} */ (db.prepare('SELECT COUNT(*) as c FROM overview_embeddings').get())?.c || 0; } catch {}
                send({ type: 'diagnostic', phase: 'overviews', succeeded: successCount, failed: failCount, lastError, verifiedCount: Number(verifyCount) });

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
                            ).run(Number(child.id), JSON.stringify(embedding));
                        } catch (insertErr) {
                            if (done === 0) {
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

                send({ type: 'complete', overviews: needsEmbedding.length, titles: children.length, staleRefreshed: staleCount });
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
