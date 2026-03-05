import db from '$lib/server/db.js';

/**
 * Ollama API client for Mediajam.
 * All methods gracefully return null when Ollama is not configured.
 */

/**
 * Get Ollama settings from app_settings.
 * @returns {{ url: string, embedModel: string, chatModel: string } | null}
 */
function getSettings() {
    const settings = /** @type {any} */ (db.prepare(
        'SELECT ollama_url, ollama_embed_model, ollama_chat_model FROM app_settings WHERE id = 1'
    ).get());
    if (!settings?.ollama_url) return null;
    return {
        url: settings.ollama_url.replace(/\/+$/, ''),
        embedModel: settings.ollama_embed_model || 'nomic-embed-text',
        chatModel: settings.ollama_chat_model || 'llama3.2:3b',
    };
}

/**
 * Check if Ollama is configured and reachable.
 * @returns {Promise<{ ok: boolean, models?: string[], error?: string }>}
 */
export async function healthCheck() {
    const cfg = getSettings();
    if (!cfg) return { ok: false, error: 'Ollama URL not configured' };

    try {
        const res = await fetch(`${cfg.url}/api/tags`, { signal: AbortSignal.timeout(5000) });
        if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
        const data = await res.json();
        const models = (data.models || []).map((/** @type {any} */ m) => m.name);
        return { ok: true, models };
    } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
}

/**
 * Generate embeddings for a single text string.
 * @param {string} text
 * @param {string} [model] — override model name
 * @returns {Promise<number[] | null>} — embedding vector or null if unavailable
 */
export async function embed(text, model) {
    const cfg = getSettings();
    if (!cfg) return null;

    try {
        const res = await fetch(`${cfg.url}/api/embeddings`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: model || cfg.embedModel,
                prompt: text,
            }),
            signal: AbortSignal.timeout(30000),
        });
        if (!res.ok) return null;
        const data = await res.json();
        return data.embedding || null;
    } catch {
        return null;
    }
}

/**
 * Generate embeddings for multiple texts (sequentially).
 * @param {string[]} texts
 * @param {string} [model]
 * @param {(progress: { done: number, total: number }) => void} [onProgress]
 * @returns {Promise<(number[] | null)[]>}
 */
export async function embedBatch(texts, model, onProgress) {
    const results = [];
    for (let i = 0; i < texts.length; i++) {
        results.push(await embed(texts[i], model));
        if (onProgress) onProgress({ done: i + 1, total: texts.length });
    }
    return results;
}

/**
 * Generate text via Ollama chat/generate API.
 * @param {string} prompt
 * @param {{ model?: string, system?: string, format?: string, temperature?: number }} [options]
 * @returns {Promise<string | null>}
 */
export async function generate(prompt, options = {}) {
    const cfg = getSettings();
    if (!cfg) return null;

    try {
        const res = await fetch(`${cfg.url}/api/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: options.model || cfg.chatModel,
                prompt,
                system: options.system || '',
                format: options.format || undefined,
                stream: false,
                options: {
                    temperature: options.temperature ?? 0.1,
                },
            }),
            signal: AbortSignal.timeout(120000), // 2 min for generation
        });
        if (!res.ok) return null;
        const data = await res.json();
        return data.response || null;
    } catch {
        return null;
    }
}

/**
 * Check if embedding infrastructure is available (Ollama configured + vec0 tables exist).
 * @returns {boolean}
 */
export function isEmbeddingAvailable() {
    const cfg = getSettings();
    if (!cfg) return false;
    try {
        db.prepare('SELECT COUNT(*) FROM media_embeddings LIMIT 0').get();
        return true;
    } catch {
        return false;
    }
}
