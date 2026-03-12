import db from '$lib/server/db.js';

/**
 * OpenAI-compatible API client.
 * Supports Codex CLI OAuth tokens (pasted by user), per-provider API keys, and shared keys.
 * Works with OpenAI, Kimi (Moonshot), and any OpenAI-format provider.
 */

/** @typedef {{ provider: string, apiKey: string, apiUrl: string, chatModel: string, embedModel: string, authSource?: string }} OpenAIConfig */

const CODEX_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';

/**
 * Get stored Codex OAuth tokens from app_settings.
 * @returns {{ accessToken: string, refreshToken: string | null } | null}
 */
function getStoredCodexTokens() {
    try {
        const settings = /** @type {any} */ (db.prepare(
            'SELECT codex_access_token, codex_refresh_token FROM app_settings WHERE id = 1'
        ).get());
        if (!settings?.codex_access_token) return null;
        return {
            accessToken: settings.codex_access_token,
            refreshToken: settings.codex_refresh_token || null,
        };
    } catch {
        return null;
    }
}

/**
 * Try to refresh an expired Codex OAuth token.
 * Writes the refreshed tokens back to app_settings.
 * @returns {Promise<string | null>} New access token, or null
 */
async function refreshCodexToken() {
    try {
        const tokens = getStoredCodexTokens();
        if (!tokens?.refreshToken) return null;

        const res = await fetch('https://auth.openai.com/oauth/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                client_id: CODEX_CLIENT_ID,
                refresh_token: tokens.refreshToken,
                grant_type: 'refresh_token',
            }),
            signal: AbortSignal.timeout(15000),
        });

        if (!res.ok) {
            console.warn(`[openai-client] Codex token refresh failed: HTTP ${res.status}`);
            return null;
        }

        const data = await res.json();
        if (!data.access_token) return null;

        // Update stored tokens
        db.prepare(`
            UPDATE app_settings
            SET codex_access_token = ?, codex_refresh_token = ?
            WHERE id = 1
        `).run(data.access_token, data.refresh_token || tokens.refreshToken);

        console.log('[openai-client] Codex token refreshed successfully');
        return data.access_token;
    } catch (e) {
        console.warn(`[openai-client] Token refresh error: ${e instanceof Error ? e.message : e}`);
        return null;
    }
}

/**
 * Get a valid Codex access token, refreshing if needed.
 * @returns {Promise<string | null>}
 */
async function getCodexToken() {
    const tokens = getStoredCodexTokens();
    if (!tokens) return null;

    // Try a quick API call to see if the token is valid
    // (we can't decode JWT expiry without a library, so we just use it and refresh on failure)
    return tokens.accessToken;
}

/**
 * Check if Codex tokens are stored.
 * @returns {boolean}
 */
export function hasCodexAuth() {
    return getStoredCodexTokens() !== null;
}

/**
 * Get OpenAI-compatible config from app_settings + Codex auth.
 * Priority: Codex token → per-provider API key → shared llm_api_key
 * @returns {Promise<OpenAIConfig | null>}
 */
export async function getConfig() {
    const settings = /** @type {any} */ (db.prepare(
        'SELECT llm_provider, llm_api_key, llm_api_url, llm_chat_model, llm_embed_model, openai_api_key, kimi_api_key FROM app_settings WHERE id = 1'
    ).get());

    const provider = settings?.llm_provider || 'openai';

    // For OpenAI: try Codex token first
    let apiKey = null;
    let authSource = 'api-key';
    if (provider === 'openai') {
        apiKey = await getCodexToken();
        if (apiKey) authSource = 'codex';
    }

    // Fall back to per-provider key, then shared key
    if (!apiKey) {
        const providerKey = provider === 'kimi' ? settings?.kimi_api_key : settings?.openai_api_key;
        apiKey = providerKey || settings?.llm_api_key;
    }

    if (!apiKey) return null;

    /** @type {Record<string, { url: string, model: string, embedModel: string }>} */
    const defaults = {
        openai: { url: 'https://api.openai.com', model: 'gpt-5.4', embedModel: 'text-embedding-3-small' },
        kimi:   { url: 'https://api.moonshot.cn', model: 'kimi-k2-0711-preview', embedModel: '' },
    };
    const d = defaults[provider] || defaults.openai;

    return {
        provider,
        apiKey,
        authSource,
        apiUrl: (settings.llm_api_url || d.url).replace(/\/+$/, ''),
        chatModel: settings.llm_chat_model || d.model,
        embedModel: settings.llm_embed_model || d.embedModel,
    };
}

/**
 * Check if the provider is reachable.
 * @param {OpenAIConfig} [cfg]
 * @returns {Promise<{ ok: boolean, models?: string[], error?: string, authSource?: string }>}
 */
export async function healthCheck(cfg) {
    cfg = cfg || /** @type {any} */ (await getConfig());
    if (!cfg) return { ok: false, error: 'No API key or Codex token configured' };

    // Codex consumer tokens can't access /v1/models (403), so use a minimal
    // chat completion as the health probe instead.
    if (cfg.authSource === 'codex') {
        return _healthCheckViaChat(cfg);
    }

    try {
        const res = await fetch(`${cfg.apiUrl}/v1/models`, {
            headers: { 'Authorization': `Bearer ${cfg.apiKey}` },
            signal: AbortSignal.timeout(10000),
        });
        if (!res.ok) {
            return { ok: false, error: `HTTP ${res.status}` };
        }
        const data = await res.json();
        const models = (data.data || []).map((/** @type {any} */ m) => m.id);
        return { ok: true, models, authSource: cfg.authSource };
    } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
}

/**
 * Health check for Codex tokens — does NOT make a real API call to avoid
 * burning quota. Codex tokens can't access /v1/models (403), and using
 * /v1/chat/completions wastes tokens. Instead we just verify tokens are
 * stored and try a HEAD request to the API root.
 * @param {OpenAIConfig} cfg
 * @returns {Promise<{ ok: boolean, models?: string[], error?: string, authSource?: string }>}
 */
async function _healthCheckViaChat(cfg) {
    try {
        // Just verify the API is reachable with a lightweight request.
        // We can't use /v1/models (403 for Codex), so hit the API root.
        const res = await fetch(cfg.apiUrl, {
            method: 'HEAD',
            signal: AbortSignal.timeout(5000),
        });
        // Any response (even 404/405) means the API is reachable.
        // The token itself will be validated when the user actually sends a message.
        return { ok: true, authSource: 'codex' };
    } catch (e) {
        // Network error — API unreachable
        return { ok: false, error: e instanceof Error ? e.message : String(e), authSource: 'codex' };
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
    cfg = cfg || /** @type {any} */ (await getConfig());
    if (!cfg) return null;

    /** @type {any[]} */
    const messages = [];
    if (options.system) {
        messages.push({ role: 'system', content: options.system });
    }
    messages.push({ role: 'user', content: prompt });

    try {
        let res = await fetch(`${cfg.apiUrl}/v1/chat/completions`, {
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

        // Auto-refresh on 401/403 for Codex tokens
        if ((res.status === 401 || res.status === 403) && cfg.authSource === 'codex') {
            const newToken = await refreshCodexToken();
            if (newToken) {
                res = await fetch(`${cfg.apiUrl}/v1/chat/completions`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${newToken}`,
                    },
                    body: JSON.stringify({
                        model: options.model || cfg.chatModel,
                        messages,
                        temperature: options.temperature ?? 0.1,
                        max_tokens: options.num_predict || 1024,
                    }),
                    signal: AbortSignal.timeout(120000),
                });
            }
        }

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
    cfg = cfg || /** @type {any} */ (await getConfig());
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
