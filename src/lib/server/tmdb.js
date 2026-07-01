import db from '$lib/server/db.js';

const TMDB_BASE = 'https://api.themoviedb.org/3';

/**
 * Detect whether the stored TMDb key is a v3 API key or v4 Read Access Token.
 * v3 keys are ~32 char hex strings; v4 tokens are JWTs (200+ chars, start with "eyJ").
 * @param {string} key
 * @returns {'v4' | 'v3'}
 */
function detectKeyType(key) {
    if (key.startsWith('eyJ') && key.length > 100) return 'v4';
    return 'v3';
}

/**
 * Get the TMDb API key from the database.
 * @returns {{ apiKey: string, keyType: 'v3' | 'v4' } | null}
 */
export function getTmdbKey() {
    const settings = /** @type {any} */ (db.prepare('SELECT tmdb_api_key FROM app_settings WHERE id = 1').get());
    const key = settings?.tmdb_api_key?.trim();
    if (!key) return null;
    return { apiKey: key, keyType: detectKeyType(key) };
}

/**
 * Build a TMDb API URL with proper auth.
 * For v3 keys: appends ?api_key=KEY to the URL
 * For v4 tokens: returns the URL as-is (auth goes via headers)
 * @param {string} path - e.g. '/search/person' or '/person/123/combined_credits'
 * @param {Record<string, string>} [params] - additional query params
 * @param {string} [apiKey] - override key (otherwise reads from DB)
 * @returns {{ url: string, headers: Record<string, string> } | null}
 */
export function tmdbRequest(path, params = {}, apiKey) {
    const keyInfo = apiKey
        ? { apiKey, keyType: detectKeyType(apiKey) }
        : getTmdbKey();
    if (!keyInfo) return null;

    const url = new URL(`${TMDB_BASE}${path}`);
    if (keyInfo.keyType === 'v3') {
        url.searchParams.set('api_key', keyInfo.apiKey);
    }
    for (const [k, v] of Object.entries(params)) {
        url.searchParams.set(k, v);
    }

    /** @type {Record<string, string>} */
    const headers = {};
    if (keyInfo.keyType === 'v4') {
        headers['Authorization'] = `Bearer ${keyInfo.apiKey}`;
        headers['Accept'] = 'application/json';
    }

    return { url: url.toString(), headers };
}

/**
 * Fetch from TMDb with automatic authentication.
 * @param {string} path - TMDb API path, e.g. '/search/person'
 * @param {Record<string, string>} [params] - query parameters
 * @returns {Promise<Response>}
 */
export async function tmdbFetch(path, params = {}) {
    const req = tmdbRequest(path, params);
    if (!req) throw new Error('TMDb API key not configured');
    // Bound the request so a slow/unresponsive TMDb can't stall callers
    // (e.g. the dashboard) indefinitely.
    return fetch(req.url, { headers: req.headers, signal: AbortSignal.timeout(8000) });
}
