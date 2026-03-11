import db from '$lib/server/db.js';
import * as ollama from '$lib/server/ollama.js';
import * as openaiClient from '$lib/server/openai-client.js';
import * as geminiClient from '$lib/server/gemini-client.js';
import * as claudeClient from '$lib/server/claude-client.js';

/**
 * LLM abstraction layer.
 * Routes generate/embed/healthCheck calls to the active provider.
 * Chat and embed providers can be different (e.g. OpenAI for chat, Ollama for embeddings).
 */

/**
 * Get the active chat provider name.
 * @returns {string}
 */
function getChatProvider() {
    try {
        const row = /** @type {any} */ (db.prepare(
            "SELECT llm_provider FROM app_settings WHERE id = 1"
        ).get());
        return row?.llm_provider || 'ollama';
    } catch {
        return 'ollama';
    }
}

/**
 * Get the active embed provider name.
 * @returns {string}
 */
function getEmbedProvider() {
    try {
        const row = /** @type {any} */ (db.prepare(
            "SELECT llm_embed_provider FROM app_settings WHERE id = 1"
        ).get());
        return row?.llm_embed_provider || 'ollama';
    } catch {
        return 'ollama';
    }
}

/**
 * Generate text using the active chat provider.
 * @param {string} prompt
 * @param {{ model?: string, system?: string, format?: string, temperature?: number, num_predict?: number }} [options]
 * @returns {Promise<string | null>}
 */
export async function generate(prompt, options = {}) {
    const provider = getChatProvider();

    switch (provider) {
        case 'openai':
        case 'kimi':
            return openaiClient.generate(prompt, options);
        case 'gemini':
            return geminiClient.generate(prompt, options);
        case 'claude':
            return claudeClient.generate(prompt, options);
        case 'ollama':
        default:
            return ollama.generate(prompt, options);
    }
}

/**
 * Generate embeddings using the active embed provider.
 * @param {string} text
 * @param {string} [model]
 * @returns {Promise<number[] | null>}
 */
export async function embed(text, model) {
    const provider = getEmbedProvider();

    switch (provider) {
        case 'openai':
        case 'kimi':
            return openaiClient.embed(text, model);
        case 'gemini':
            return geminiClient.embed(text, model);
        case 'claude':
            // Claude has no embeddings — fall back to Ollama
            return ollama.embed(text, model);
        case 'ollama':
        default:
            return ollama.embed(text, model);
    }
}

/**
 * Batch embed using sequential calls (works for any provider).
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
 * Health check the active chat provider.
 * @returns {Promise<{ ok: boolean, models?: string[], error?: string, provider?: string }>}
 */
export async function healthCheck() {
    const provider = getChatProvider();
    let result;

    switch (provider) {
        case 'openai':
        case 'kimi':
            result = await openaiClient.healthCheck();
            break;
        case 'gemini':
            result = await geminiClient.healthCheck();
            break;
        case 'claude':
            result = await claudeClient.healthCheck();
            break;
        case 'ollama':
        default:
            result = await ollama.healthCheck();
            break;
    }

    return { ...result, provider };
}

/**
 * Check if embedding infrastructure is available.
 * @returns {boolean}
 */
export function isEmbeddingAvailable() {
    const provider = getEmbedProvider();

    // For Ollama, use the existing check (includes vec0 table check)
    if (provider === 'ollama') {
        return ollama.isEmbeddingAvailable();
    }

    // For cloud providers, check per-provider key or shared key or OAuth
    try {
        const settings = /** @type {any} */ (db.prepare(
            'SELECT llm_api_key, llm_embed_model, openai_api_key, gemini_api_key, claude_api_key, kimi_api_key, codex_access_token FROM app_settings WHERE id = 1'
        ).get());
        if (!settings?.llm_embed_model) return false;

        // Check if any API key or Codex token is available
        const hasKey = settings.openai_api_key || settings.gemini_api_key || settings.claude_api_key || settings.kimi_api_key || settings.llm_api_key || settings.codex_access_token;
        if (!hasKey) {
            // Check for OAuth token
            const identity = /** @type {any} */ (db.prepare(
                "SELECT access_token FROM user_identities WHERE provider = 'openai' LIMIT 1"
            ).get());
            if (!identity?.access_token) return false;
        }

        // Check vec0 table exists
        db.prepare('SELECT COUNT(*) FROM overview_embeddings LIMIT 0').get();
        return true;
    } catch {
        return false;
    }
}

/**
 * Get a human-readable label for the current provider.
 * @returns {{ chat: string, embed: string }}
 */
export function getProviderLabels() {
    /** @type {Record<string, string>} */
    const labels = {
        ollama: 'Ollama (local)',
        openai: 'OpenAI',
        gemini: 'Google Gemini',
        claude: 'Claude',
        kimi: 'Kimi (Moonshot)',
    };
    const chat = getChatProvider();
    const embd = getEmbedProvider();
    return {
        chat: labels[chat] || chat,
        embed: labels[embd] || embd,
    };
}
