import { json } from '@sveltejs/kit';
import db from '$lib/server/db.js';
import { isEmbeddingAvailable, healthCheck, embed, getProviderLabels } from '$lib/server/llm.js';

/** @type {import('./$types').RequestHandler} */
export async function GET({ locals }) {
    if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

    // Read provider config from app_settings
    let chatModel = '';
    let embeddingModel = '';
    let providerName = 'ollama';
    let ollamaUrl = '';
    try {
        const settings = /** @type {any} */ (db.prepare(
            'SELECT llm_provider, llm_chat_model, llm_embed_provider, llm_embed_model, ollama_url, ollama_embed_model, ollama_chat_model FROM app_settings WHERE id = 1'
        ).get());
        providerName = settings?.llm_provider || 'ollama';
        ollamaUrl = settings?.ollama_url || '';

        // Use provider-specific model names, falling back to Ollama
        if (providerName === 'ollama') {
            chatModel = settings?.ollama_chat_model || (ollamaUrl ? 'llama3.2:3b' : '');
            embeddingModel = settings?.ollama_embed_model || (ollamaUrl ? 'nomic-embed-text' : '');
        } else {
            chatModel = settings?.llm_chat_model || '';
            embeddingModel = settings?.llm_embed_model || settings?.ollama_embed_model || '';
        }
    } catch { /* ignore */ }

    // Check provider connectivity
    const health = await healthCheck();
    const labels = getProviderLabels();

    // Quick embed test
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
        // vec0 COUNT(*) is unreliable — use a subquery
        embeddingsTotal = /** @type {any} */ (db.prepare('SELECT COUNT(*) as c FROM (SELECT media_parent_id FROM overview_embeddings)').get())?.c || 0;
        overviewsTotal = /** @type {any} */ (db.prepare("SELECT COUNT(*) as c FROM media_parents WHERE overview IS NOT NULL AND overview != ''").get())?.c || 0;
    } catch { /* table may not exist */ }

    return json({
        provider: providerName,
        providerLabel: labels.chat,
        embedProviderLabel: labels.embed,
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
