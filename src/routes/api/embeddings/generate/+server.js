import { json } from '@sveltejs/kit';
import db, { sqliteVecLoaded } from '$lib/server/db.js';
import { embed, isEmbeddingAvailable } from '$lib/server/llm.js';
import crypto from 'crypto';

/** Max chars for embedding input (~500 tokens for nomic-embed-text). */
const EMBED_CHAR_LIMIT = 2000;
/** Max chars for title embeddings (short strings). */
const TITLE_CHAR_LIMIT = 500;

/**
 * Truncate text at a sentence boundary.
 * @param {string} text
 * @param {number} max
 * @returns {string}
 */
function truncateForEmbed(text, max) {
    if (!text || text.length <= max) return text;
    const t = text.slice(0, max);
    const last = Math.max(t.lastIndexOf('. '), t.lastIndexOf('! '), t.lastIndexOf('? '));
    return last > max * 0.5 ? t.slice(0, last + 1) : t;
}

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
    const embedDim = testEmbed.length;
    console.log(`[embeddings] Test embed OK — dimension=${embedDim}, expected=768`);
    if (embedDim !== 768) {
        return json({ error: `Embedding dimension mismatch: got ${embedDim}, expected 768. Check your embed model.` }, { status: 400 });
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

                // Filter to items needing embedding: no hash (new), hash mismatch (stale),
                // or hash exists but actual vec0 row is missing (orphan from failed INSERT OR REPLACE)
                const checkVecExists = db.prepare(
                    'SELECT 1 FROM overview_embeddings WHERE media_parent_id = ? LIMIT 1'
                );
                const needsEmbedding = parents.filter(p => {
                    const hash = contentHash(`${p.title}. ${p.overview}`);
                    p._hash = hash; // stash for later
                    if (!p.content_hash || p.content_hash !== hash) return true;
                    // Hash matches — verify the embedding actually exists in vec0
                    try {
                        return !checkVecExists.get(Number(p.id));
                    } catch {
                        return true; // if check fails, re-embed to be safe
                    }
                });

                const staleCount = needsEmbedding.filter(p => p.content_hash).length;
                const newCount = needsEmbedding.length - staleCount;
                send({ type: 'status', phase: 'overviews', total: needsEmbedding.length, new: newCount, stale: staleCount });

                let done = 0;
                let successCount = 0;
                let failCount = 0;
                let lastError = '';
                for (const parent of needsEmbedding) {
                    const text = truncateForEmbed(`${parent.title}. ${parent.overview}`, EMBED_CHAR_LIMIT);
                    const embedding = await embed(text);
                    if (embedding) {
                        try {
                            const pid = parent.id;
                            const vecJson = JSON.stringify(embedding);
                            // vec0 doesn't support OR REPLACE — use DELETE + INSERT
                            // CAST ensures vec0 sees INTEGER type (better-sqlite3 may bind Number as REAL)
                            try { db.prepare('DELETE FROM overview_embeddings WHERE media_parent_id = CAST(? AS INTEGER)').run(pid); } catch { /* may not exist */ }
                            const result = db.prepare(
                                'INSERT INTO overview_embeddings (media_parent_id, overview_embedding) VALUES (CAST(? AS INTEGER), ?)'
                            ).run(pid, vecJson);
                            // Store the content hash
                            db.prepare(
                                'INSERT OR REPLACE INTO embedding_hashes (media_parent_id, content_hash, embedded_at) VALUES (?, ?, datetime(\'now\'))'
                            ).run(pid, parent._hash);
                            successCount++;

                            // Verify first insert actually persisted
                            if (successCount === 1) {
                                let readBack = null;
                                try { readBack = db.prepare('SELECT media_parent_id FROM overview_embeddings WHERE media_parent_id = CAST(? AS INTEGER)').get(pid); } catch (rbErr) {
                                    const rbMsg = rbErr instanceof Error ? rbErr.message : String(rbErr);
                                    send({ type: 'warning', message: `Read-back SELECT failed: ${rbMsg}` });
                                    console.error('[embeddings] Read-back failed:', rbMsg);
                                }
                                send({ type: 'diagnostic', phase: 'first-insert', id: pid, changes: result.changes, readBack: readBack ? 'found' : 'NOT_FOUND', dim: embedding.length });
                                console.log(`[embeddings] First insert: id=${pid}, changes=${result.changes}, readBack=${readBack ? 'found' : 'NOT_FOUND'}`);
                            }
                        } catch (insertErr) {
                            failCount++;
                            const errMsg = insertErr instanceof Error ? insertErr.message : String(insertErr);
                            lastError = errMsg;
                            if (failCount <= 5) {
                                send({ type: 'warning', message: `Embedding insert error (id=${parent.id}, dim=${embedding.length}): ${errMsg}` });
                                console.error(`[embeddings] INSERT failed for id=${parent.id} (dim=${embedding.length}):`, errMsg);
                            }
                        }
                    } else {
                        // Track when embed() returns null
                        if (done === 0) {
                            send({ type: 'warning', message: `embed() returned null for first item (id=${parent.id})` });
                        }
                    }
                    done++;
                    if (done % 10 === 0 || done === needsEmbedding.length) {
                        send({ type: 'progress', phase: 'overviews', done, total: needsEmbedding.length, ok: successCount, fail: failCount });
                    }
                }
                // Diagnostic: verify persistence
                let verifyCount = 0;
                try { verifyCount = /** @type {any} */ (db.prepare('SELECT COUNT(*) as c FROM (SELECT media_parent_id FROM overview_embeddings)').get())?.c || 0; } catch {}
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
                    const text = truncateForEmbed(`${child.parent_title} - ${child.title}`, TITLE_CHAR_LIMIT);
                    const embedding = await embed(text);
                    if (embedding) {
                        try {
                            const cid = child.id;
                            // vec0 doesn't support OR REPLACE — use DELETE + INSERT
                            // CAST ensures vec0 sees INTEGER type
                            try { db.prepare('DELETE FROM media_embeddings WHERE media_id = CAST(? AS INTEGER)').run(cid); } catch { /* may not exist */ }
                            db.prepare(
                                'INSERT INTO media_embeddings (media_id, title_embedding) VALUES (CAST(? AS INTEGER), ?)'
                            ).run(cid, JSON.stringify(embedding));
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
        overviewCount = /** @type {any} */ (db.prepare('SELECT COUNT(*) as c FROM (SELECT media_parent_id FROM overview_embeddings)').get())?.c || 0;
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
