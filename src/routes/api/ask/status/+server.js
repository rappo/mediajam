import { json } from '@sveltejs/kit';
import db from '$lib/server/db.js';
import { isEmbeddingAvailable } from '$lib/server/ollama.js';

/** @type {import('./$types').RequestHandler} */
export async function GET({ locals }) {
    if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

    // Check Ollama connectivity
    let ollamaConnected = false;
    let chatModel = '';
    let embeddingModel = '';
    try {
        const settings = /** @type {any[]} */ (db.prepare(
            "SELECT key, value FROM settings WHERE key IN ('ollama_url', 'ollama_chat_model', 'ollama_embedding_model')"
        ).all());
        const map = Object.fromEntries(settings.map(/** @param {any} s */ s => [s.key, s.value]));
        chatModel = map.ollama_chat_model || '';
        embeddingModel = map.ollama_embedding_model || '';
        if (map.ollama_url) {
            const res = await fetch(`${map.ollama_url}/api/tags`, { signal: AbortSignal.timeout(3000) });
            ollamaConnected = res.ok;
        }
    } catch { /* ignore */ }

    // Embedding stats
    const ragAvailable = isEmbeddingAvailable();
    let embeddingsTotal = 0;
    let overviewsTotal = 0;
    try {
        embeddingsTotal = /** @type {any} */ (db.prepare('SELECT COUNT(*) as c FROM overview_embeddings').get())?.c || 0;
        overviewsTotal = /** @type {any} */ (db.prepare("SELECT COUNT(*) as c FROM media_parents WHERE overview IS NOT NULL AND overview != ''").get())?.c || 0;
    } catch { /* table may not exist */ }

    return json({
        ollamaConnected,
        chatModel,
        embeddingModel,
        ragAvailable,
        embeddingsTotal,
        overviewsTotal,
        embeddingsPct: overviewsTotal > 0 ? Math.round((embeddingsTotal / overviewsTotal) * 100) : 0,
    });
}
