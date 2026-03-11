import db from '$lib/server/db.js';

/**
 * Anthropic Claude API client.
 * Note: Claude has no embeddings API — embed() always returns null.
 */

const BASE_URL = 'https://api.anthropic.com';
const API_VERSION = '2023-06-01';

/**
 * @typedef {{ apiKey: string, chatModel: string }} ClaudeConfig
 */

/**
 * Get Claude config from app_settings.
 * @returns {ClaudeConfig | null}
 */
export function getConfig() {
    const settings = /** @type {any} */ (db.prepare(
        'SELECT llm_api_key, llm_chat_model, claude_api_key FROM app_settings WHERE id = 1'
    ).get());
    const apiKey = settings?.claude_api_key || settings?.llm_api_key;
    if (!apiKey) return null;
    return {
        apiKey,
        chatModel: settings.llm_chat_model || 'claude-sonnet-4-5-20250514',
    };
}

/**
 * Check if Claude is reachable.
 * @param {ClaudeConfig} [cfg]
 * @returns {Promise<{ ok: boolean, models?: string[], error?: string }>}
 */
export async function healthCheck(cfg) {
    cfg = cfg || /** @type {any} */ (getConfig());
    if (!cfg) return { ok: false, error: 'Claude API key not configured' };

    // Claude has no /models endpoint, so we send a minimal message
    try {
        const res = await fetch(`${BASE_URL}/v1/messages`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': cfg.apiKey,
                'anthropic-version': API_VERSION,
            },
            body: JSON.stringify({
                model: cfg.chatModel,
                max_tokens: 1,
                messages: [{ role: 'user', content: 'hi' }],
            }),
            signal: AbortSignal.timeout(15000),
        });
        if (res.ok || res.status === 200) {
            return { ok: true, models: [cfg.chatModel] };
        }
        const errText = await res.text().catch(() => '');
        return { ok: false, error: `HTTP ${res.status}: ${errText.slice(0, 100)}` };
    } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
}

/**
 * Generate text via Claude Messages API.
 * @param {string} prompt
 * @param {{ model?: string, system?: string, temperature?: number, num_predict?: number }} [options]
 * @param {ClaudeConfig} [cfg]
 * @returns {Promise<string | null>}
 */
export async function generate(prompt, options = {}, cfg) {
    cfg = cfg || /** @type {any} */ (getConfig());
    if (!cfg) return null;

    /** @type {any} */
    const body = {
        model: options.model || cfg.chatModel,
        max_tokens: options.num_predict || 1024,
        messages: [{ role: 'user', content: prompt }],
    };

    if (options.system) {
        body.system = options.system;
    }
    if (options.temperature !== undefined) {
        body.temperature = options.temperature;
    }

    try {
        const res = await fetch(`${BASE_URL}/v1/messages`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': cfg.apiKey,
                'anthropic-version': API_VERSION,
            },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(120000),
        });
        if (!res.ok) {
            const errText = await res.text().catch(() => '');
            console.warn(`[claude-client] generate() HTTP ${res.status}: ${errText.slice(0, 200)}`);
            return null;
        }
        const data = await res.json();
        // Claude returns content as an array of content blocks
        const textBlock = data.content?.find((/** @type {any} */ b) => b.type === 'text');
        return textBlock?.text || null;
    } catch (e) {
        console.warn(`[claude-client] generate() error: ${e instanceof Error ? e.message : e}`);
        return null;
    }
}

/**
 * Claude has no embeddings API.
 * @returns {Promise<null>}
 */
export async function embed() {
    return null;
}
