import db from '$lib/server/db.js';

/**
 * Google Gemini API client.
 * Supports both API key and OAuth2 token authentication.
 */

const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

/**
 * @typedef {{ apiKey?: string, accessToken?: string, chatModel: string, embedModel: string }} GeminiConfig
 */

/**
 * Get Gemini config from app_settings + user_identities.
 * @param {number} [userId]
 * @returns {GeminiConfig | null}
 */
export function getConfig(userId) {
    const settings = /** @type {any} */ (db.prepare(
        'SELECT llm_api_key, llm_chat_model, llm_embed_model FROM app_settings WHERE id = 1'
    ).get());

    // Try OAuth token first
    let accessToken = null;
    if (userId) {
        const identity = /** @type {any} */ (db.prepare(
            "SELECT access_token, token_expires_at FROM user_identities WHERE user_id = ? AND provider = 'gemini'"
        ).get(userId));
        if (identity?.access_token) {
            // Check expiry
            if (!identity.token_expires_at || new Date(identity.token_expires_at) > new Date()) {
                accessToken = identity.access_token;
            }
        }
    }

    // Fall back to API key
    const apiKey = settings?.llm_api_key || null;

    if (!accessToken && !apiKey) return null;

    return {
        apiKey,
        accessToken,
        chatModel: settings?.llm_chat_model || 'gemini-2.5-flash',
        embedModel: settings?.llm_embed_model || 'gemini-embedding-001',
    };
}

/**
 * Build auth params/headers for Gemini requests.
 * @param {GeminiConfig} cfg
 * @returns {{ urlSuffix: string, headers: Record<string, string> }}
 */
function authParams(cfg) {
    if (cfg.accessToken) {
        return {
            urlSuffix: '',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${cfg.accessToken}`,
            },
        };
    }
    return {
        urlSuffix: `?key=${cfg.apiKey}`,
        headers: { 'Content-Type': 'application/json' },
    };
}

/**
 * Check if Gemini is reachable.
 * @param {GeminiConfig} [cfg]
 * @returns {Promise<{ ok: boolean, models?: string[], error?: string }>}
 */
export async function healthCheck(cfg) {
    cfg = cfg || /** @type {any} */ (getConfig());
    if (!cfg) return { ok: false, error: 'Gemini not configured' };

    const { urlSuffix, headers } = authParams(cfg);
    try {
        const res = await fetch(`${BASE_URL}/models${urlSuffix}`, {
            headers,
            signal: AbortSignal.timeout(10000),
        });
        if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
        const data = await res.json();
        const models = (data.models || []).map((/** @type {any} */ m) => m.name?.replace('models/', '') || m.name);
        return { ok: true, models };
    } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
}

/**
 * Generate text via Gemini.
 * @param {string} prompt
 * @param {{ model?: string, system?: string, temperature?: number, num_predict?: number }} [options]
 * @param {GeminiConfig} [cfg]
 * @returns {Promise<string | null>}
 */
export async function generate(prompt, options = {}, cfg) {
    cfg = cfg || /** @type {any} */ (getConfig());
    if (!cfg) return null;

    const model = options.model || cfg.chatModel;
    const { urlSuffix, headers } = authParams(cfg);

    /** @type {any} */
    const body = {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
            temperature: options.temperature ?? 0.1,
            maxOutputTokens: options.num_predict || 1024,
        },
    };

    if (options.system) {
        body.systemInstruction = { parts: [{ text: options.system }] };
    }

    try {
        const res = await fetch(`${BASE_URL}/models/${model}:generateContent${urlSuffix}`, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(120000),
        });
        if (!res.ok) {
            const errText = await res.text().catch(() => '');
            console.warn(`[gemini-client] generate() HTTP ${res.status}: ${errText.slice(0, 200)}`);
            return null;
        }
        const data = await res.json();
        return data.candidates?.[0]?.content?.parts?.[0]?.text || null;
    } catch (e) {
        console.warn(`[gemini-client] generate() error: ${e instanceof Error ? e.message : e}`);
        return null;
    }
}

/**
 * Generate embeddings via Gemini.
 * @param {string} text
 * @param {string} [model]
 * @param {GeminiConfig} [cfg]
 * @returns {Promise<number[] | null>}
 */
export async function embed(text, model, cfg) {
    cfg = cfg || /** @type {any} */ (getConfig());
    if (!cfg) return null;

    const embedModel = model || cfg.embedModel;
    const { urlSuffix, headers } = authParams(cfg);

    try {
        const res = await fetch(`${BASE_URL}/models/${embedModel}:embedContent${urlSuffix}`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                model: `models/${embedModel}`,
                content: { parts: [{ text }] },
            }),
            signal: AbortSignal.timeout(30000),
        });
        if (!res.ok) {
            const errText = await res.text().catch(() => '');
            console.warn(`[gemini-client] embed() HTTP ${res.status}: ${errText.slice(0, 200)}`);
            return null;
        }
        const data = await res.json();
        return data.embedding?.values || null;
    } catch (e) {
        console.warn(`[gemini-client] embed() error: ${e instanceof Error ? e.message : e}`);
        return null;
    }
}
