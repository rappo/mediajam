import { json } from '@sveltejs/kit';
import db from '$lib/server/db.js';
import { isEmbeddingAvailable, healthCheck } from '$lib/server/ollama.js';

/** @type {import('./$types').RequestHandler} */
export async function GET({ locals }) {
    if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

    // Read Ollama config from app_settings (same source as ollama.js)
    let chatModel = '';
    let embeddingModel = '';
    let ollamaUrl = '';
    try {
        const settings = /** @type {any} */ (db.prepare(
            'SELECT ollama_url, ollama_embed_model, ollama_chat_model FROM app_settings WHERE id = 1'
        ).get());
        ollamaUrl = settings?.ollama_url || '';
        chatModel = settings?.ollama_chat_model || '';
        embeddingModel = settings?.ollama_embed_model || '';
    } catch { /* ignore */ }

    // Check Ollama connectivity using the shared healthCheck
    const health = await healthCheck();

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
        ollamaError: health.error || null,
        chatModel,
        embeddingModel,
        ragAvailable,
        embeddingsTotal,
        overviewsTotal,
        embeddingsPct: overviewsTotal > 0 ? Math.round((embeddingsTotal / overviewsTotal) * 100) : 0,
    });
}
