import db from '$lib/server/db.js';

/**
 * OpenAI-compatible API client.
 * Supports OAuth tokens (Codex), per-provider API keys, and shared keys.
 * Works with OpenAI, Kimi (Moonshot), and any OpenAI-format provider.
 */

/** @typedef {{ provider: string, apiKey: string, apiUrl: string, chatModel: string, embedModel: string }} OpenAIConfig */

/**
 * Try to refresh an expired OAuth token.
 * @param {any} identity - The user_identities row
 * @returns {Promise<string | null>} New access token, or null
 */
async function refreshOAuthToken(identity) {
    if (!identity?.refresh_token) return null;

    try {
        // PKCE public client — use the same client ID as Codex CLI, no secret needed
        const OPENAI_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';

        const res = await fetch('https://auth.openai.com/oauth/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                client_id: OPENAI_CLIENT_ID,
                refresh_token: identity.refresh_token,
                grant_type: 'refresh_token',
            }),
            signal: AbortSignal.timeout(15000),
        });

        if (!res.ok) {
            console.warn(`[openai-client] Token refresh failed: HTTP ${res.status}`);
            return null;
        }

        const data = await res.json();
        const newAccess = data.access_token;
        const newRefresh = data.refresh_token || identity.refresh_token;
        const expiresAt = data.expires_in
            ? new Date(Date.now() + data.expires_in * 1000).toISOString()
            : null;

        // Update stored tokens
        db.prepare(`
            UPDATE user_identities
            SET access_token = ?, refresh_token = ?, token_expires_at = ?
            WHERE id = ?
        `).run(newAccess, newRefresh, expiresAt, identity.id);

        console.log('[openai-client] OAuth token refreshed successfully');
        return newAccess;
    } catch (e) {
        console.warn(`[openai-client] Token refresh error: ${e instanceof Error ? e.message : e}`);
        return null;
    }
}

/**
 * Get OAuth access token from user_identities (if available).
 * @returns {Promise<string | null>}
 */
async function getOAuthToken() {
    try {
        const identity = /** @type {any} */ (db.prepare(
            "SELECT id, access_token, refresh_token, token_expires_at FROM user_identities WHERE provider = 'openai' ORDER BY id DESC LIMIT 1"
        ).get());

        if (!identity?.access_token) return null;

        // Check if expired
        if (identity.token_expires_at) {
            const expiresAt = new Date(identity.token_expires_at);
            if (expiresAt <= new Date()) {
                // Token expired — try to refresh
                return await refreshOAuthToken(identity);
            }
        }

        return identity.access_token;
    } catch {
        return null;
    }
}

/**
 * Get OpenAI-compatible config from app_settings + OAuth.
 * Priority: OAuth token > per-provider API key > shared llm_api_key
 * @returns {Promise<OpenAIConfig | null>}
 */
export async function getConfig() {
    const settings = /** @type {any} */ (db.prepare(
        'SELECT llm_provider, llm_api_key, llm_api_url, llm_chat_model, llm_embed_model, openai_api_key, kimi_api_key FROM app_settings WHERE id = 1'
    ).get());

    const provider = settings?.llm_provider || 'openai';

    // For OpenAI: try OAuth token first
    let apiKey = null;
    if (provider === 'openai') {
        apiKey = await getOAuthToken();
    }

    // Fall back to per-provider key, then shared key
    if (!apiKey) {
        const providerKey = provider === 'kimi' ? settings?.kimi_api_key : settings?.openai_api_key;
        apiKey = providerKey || settings?.llm_api_key;
    }

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
    cfg = cfg || /** @type {any} */ (await getConfig());
    if (!cfg) return { ok: false, error: 'No API key or OAuth token configured' };

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
    cfg = cfg || /** @type {any} */ (await getConfig());
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
