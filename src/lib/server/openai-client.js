import db from '$lib/server/db.js';

/**
 * OpenAI-compatible API client.
 * Works with OpenAI, Kimi (Moonshot), and any OpenAI-format provider.
 */

/** @typedef {{ provider: string, apiKey: string, apiUrl: string, chatModel: string, embedModel: string }} OpenAIConfig */

/**
 * Get OpenAI-compatible config from app_settings.
 * @returns {OpenAIConfig | null}
 */
export function getConfig() {
    const settings = /** @type {any} */ (db.prepare(
        'SELECT llm_provider, llm_api_key, llm_api_url, llm_chat_model, llm_embed_model, openai_api_key, kimi_api_key FROM app_settings WHERE id = 1'
    ).get());

    const provider = settings?.llm_provider || 'openai';

    // Use per-provider key first, fallback to shared llm_api_key
    const providerKey = provider === 'kimi' ? settings?.kimi_api_key : settings?.openai_api_key;
    const apiKey = providerKey || settings?.llm_api_key;
    if (!apiKey) return null;

    /** @type {Record<string, { url: string, model: string, embedModel: string }>} */
    const defaults = {
        openai: { url: 'https://api.openai.com', model: 'gpt-4o-mini', embedModel: 'text-embedding-3-small' },
        kimi:   { url: 'https://api.moonshot.cn', model: 'kimi-k2-0711-preview', embedModel: '' },
    };
    const d = defaults[provider] || defaults.openai;

    return {
        provider,
        apiKey,
        apiUrl: (settings.llm_api_url || d.url).replace(/\/+$/, ''),
        chatModel: settings.llm_chat_model || d.model,
        embedModel: settings.llm_embed_model || d.embedModel,
    };
}

/**
 * Check if the provider is reachable.
 * @param {OpenAIConfig} [cfg]
 * @returns {Promise<{ ok: boolean, models?: string[], error?: string }>}
 */
export async function healthCheck(cfg) {
    cfg = cfg || /** @type {any} */ (getConfig());
    if (!cfg) return { ok: false, error: 'API key not configured' };

    try {
        const res = await fetch(`${cfg.apiUrl}/v1/models`, {
            headers: { 'Authorization': `Bearer ${cfg.apiKey}` },
            signal: AbortSignal.timeout(10000),
        });
        if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
        const data = await res.json();
        const models = (data.data || []).map((/** @type {any} */ m) => m.id);
        return { ok: true, models };
    } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
}

/**
 * Generate text via OpenAI-compatible chat completions.
 * @param {string} prompt
 * @param {{ model?: string, system?: string, temperature?: number, num_predict?: number }} [options]
 * @param {OpenAIConfig} [cfg]
 * @returns {Promise<string | null>}
 */
export async function generate(prompt, options = {}, cfg) {
    cfg = cfg || /** @type {any} */ (getConfig());
    if (!cfg) return null;

    /** @type {any[]} */
    const messages = [];
    if (options.system) {
        messages.push({ role: 'system', content: options.system });
    }
    messages.push({ role: 'user', content: prompt });

    try {
        const res = await fetch(`${cfg.apiUrl}/v1/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${cfg.apiKey}`,
            },
            body: JSON.stringify({
                model: options.model || cfg.chatModel,
                messages,
                temperature: options.temperature ?? 0.1,
                max_tokens: options.num_predict || 1024,
            }),
            signal: AbortSignal.timeout(120000),
        });
        if (!res.ok) {
            const errText = await res.text().catch(() => '');
            console.warn(`[openai-client] generate() HTTP ${res.status}: ${errText.slice(0, 200)}`);
            return null;
        }
        const data = await res.json();
        return data.choices?.[0]?.message?.content || null;
    } catch (e) {
        console.warn(`[openai-client] generate() error: ${e instanceof Error ? e.message : e}`);
        return null;
    }
}

/**
 * Generate embeddings.
 * @param {string} text
 * @param {string} [model]
 * @param {OpenAIConfig} [cfg]
 * @returns {Promise<number[] | null>}
 */
export async function embed(text, model, cfg) {
    cfg = cfg || /** @type {any} */ (getConfig());
    if (!cfg || !cfg.embedModel) return null;

    try {
        const res = await fetch(`${cfg.apiUrl}/v1/embeddings`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${cfg.apiKey}`,
            },
            body: JSON.stringify({
                model: model || cfg.embedModel,
                input: text,
            }),
            signal: AbortSignal.timeout(30000),
        });
        if (!res.ok) {
            const errText = await res.text().catch(() => '');
            console.warn(`[openai-client] embed() HTTP ${res.status}: ${errText.slice(0, 200)}`);
            return null;
        }
        const data = await res.json();
        return data.data?.[0]?.embedding || null;
    } catch (e) {
        console.warn(`[openai-client] embed() error: ${e instanceof Error ? e.message : e}`);
        return null;
    }
}
