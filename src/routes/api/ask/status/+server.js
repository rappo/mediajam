import { json } from '@sveltejs/kit';
import db from '$lib/server/db.js';
import { isEmbeddingAvailable, healthCheck, embed } from '$lib/server/ollama.js';

/** @type {import('./$types').RequestHandler} */
export async function GET({ locals }) {
    if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

    // Read Ollama config from app_settings (same source as ollama.js)
    // Apply same defaults as ollama.js getSettings()
    let chatModel = '';
    let embeddingModel = '';
    let ollamaUrl = '';
    try {
        const settings = /** @type {any} */ (db.prepare(
            'SELECT ollama_url, ollama_embed_model, ollama_chat_model FROM app_settings WHERE id = 1'
        ).get());
        ollamaUrl = settings?.ollama_url || '';
        chatModel = settings?.ollama_chat_model || (ollamaUrl ? 'llama3.2:3b' : '');
        embeddingModel = settings?.ollama_embed_model || (ollamaUrl ? 'nomic-embed-text' : '');
    } catch { /* ignore */ }

    // Check Ollama connectivity using the shared healthCheck
    const health = await healthCheck();

    // Quick embed test — try embedding a single word
    let embedTest = 'not tested';
    try {
        const vec = await embed('test');
        if (vec && Array.isArray(vec) && vec.length > 0) {
            embedTest = `ok (${vec.length} dims)`;
        } else {
            embedTest = `failed: embed returned ${vec === null ? 'null' : typeof vec}`;
        }
    } catch (e) {
        embedTest = `error: ${e instanceof Error ? e.message : String(e)}`;
    }

    // Embedding stats
    const ragAvailable = isEmbeddingAvailable();
    let embeddingsTotal = 0;
    let overviewsTotal = 0;
    try {
        embeddingsTotal = /** @type {any} */ (db.prepare('SELECT COUNT(*) as c FROM overview_embeddings').get())?.c || 0;
        overviewsTotal = /** @type {any} */ (db.prepare("SELECT COUNT(*) as c FROM media_parents WHERE overview IS NOT NULL AND overview != ''").get())?.c || 0;
    } catch { /* table may not exist */ }

    return json({
        ollamaConnected: health.ok,
        ollamaUrl: ollamaUrl || null,
        ollamaError: health.error || null,
        chatModel,
        embeddingModel,
        embedTest,
        ragAvailable,
        embeddingsTotal,
        overviewsTotal,
        embeddingsPct: overviewsTotal > 0 ? Math.round((embeddingsTotal / overviewsTotal) * 100) : 0,
    });
}
