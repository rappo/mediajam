/**
 * MediaJam MCP — Shared API client
 *
 * Thin wrapper around fetch() that injects base URL and auth header.
 */

import { getConfig } from './auth.js';

const config = getConfig();

/**
 * Make an authenticated request to the MediaJam API.
 *
 * @param {string} path  — API path, e.g. "/api/search?q=test"
 * @param {object} [opts] — fetch options (method, body, headers, etc.)
 * @returns {Promise<any>} — parsed JSON response
 */
export async function api(path, opts = {}) {
  const url = `${config.url}${path}`;
  const headers = {
    'Authorization': `Bearer ${config.apiKey}`,
    ...(opts.headers || {}),
  };

  // Auto-set Content-Type for JSON bodies
  if (opts.body && typeof opts.body === 'object' && !(opts.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(opts.body);
  }

  const res = await fetch(url, { ...opts, headers });

  if (!res.ok) {
    let detail = '';
    try {
      const err = await res.json();
      detail = err.error || err.message || JSON.stringify(err);
    } catch {
      detail = await res.text().catch(() => '');
    }
    throw new Error(`MediaJam API ${res.status}: ${detail || res.statusText}`);
  }

  // Handle empty responses (204, etc.)
  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('json')) {
    return { success: true };
  }

  return res.json();
}

/**
 * GET helper
 * @param {string} path
 */
export function get(path) {
  return api(path, { method: 'GET' });
}

/**
 * POST helper
 * @param {string} path
 * @param {object} [body]
 */
export function post(path, body) {
  return api(path, { method: 'POST', body });
}

/**
 * PUT helper
 * @param {string} path
 * @param {object} [body]
 */
export function put(path, body) {
  return api(path, { method: 'PUT', body });
}
