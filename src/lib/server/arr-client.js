/**
 * Thin shared client for Radarr / Sonarr / Lidarr APIs.
 * All use the same auth pattern: X-Api-Key header + REST JSON.
 */

/** @type {Record<string, { apiVersion: string, defaultPort: number, listEndpoint: string }>} */
const SERVICE_CONFIG = {
    radarr: { apiVersion: 'v3', defaultPort: 7878, listEndpoint: 'movie' },
    sonarr: { apiVersion: 'v3', defaultPort: 8989, listEndpoint: 'series' },
    lidarr: { apiVersion: 'v1', defaultPort: 8686, listEndpoint: 'artist' },
};

/**
 * Make an authenticated request to an *arr API.
 * @param {string} baseUrl — e.g. "http://localhost:7878"
 * @param {string} apiKey
 * @param {string} service — radarr | sonarr | lidarr
 * @param {string} path — e.g. "system/status"
 * @param {RequestInit} [opts]
 * @returns {Promise<any>}
 */
export async function arrFetch(baseUrl, apiKey, service, path, opts = {}) {
    const config = SERVICE_CONFIG[service];
    if (!config) throw new Error(`Unknown *arr service: ${service}`);

    const url = `${baseUrl.replace(/\/+$/, '')}/api/${config.apiVersion}/${path}`;
    const res = await fetch(url, {
        ...opts,
        headers: {
            'X-Api-Key': apiKey,
            'Content-Type': 'application/json',
            ...(opts.headers || {}),
        },
        signal: opts.signal || AbortSignal.timeout(10000),
    });

    if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`${service} API error ${res.status}: ${text.slice(0, 200)}`);
    }

    return res.json();
}

/**
 * Test connection to an *arr instance. Returns status info.
 * @param {string} url
 * @param {string} apiKey
 * @param {string} service
 * @returns {Promise<{ ok: boolean, name: string, version: string, itemCount: number }>}
 */
export async function testConnection(url, apiKey, service) {
    try {
        const status = await arrFetch(url, apiKey, service, 'system/status');
        const config = SERVICE_CONFIG[service];
        // Get item count
        let itemCount = 0;
        try {
            const items = await arrFetch(url, apiKey, service, config.listEndpoint);
            itemCount = Array.isArray(items) ? items.length : 0;
        } catch { /* count is optional */ }

        return {
            ok: true,
            name: status.appName || status.instanceName || service,
            version: status.version || 'unknown',
            itemCount,
        };
    } catch (err) {
        return {
            ok: false,
            name: service,
            version: '',
            itemCount: 0,
        };
    }
}

/**
 * Probe an IP:port to check if an *arr service is running.
 * Doesn't require an API key — just checks if the port responds.
 * @param {string} ip
 * @param {number} port
 * @param {string} service
 * @returns {Promise<{ service: string, url: string, needsAuth: boolean } | null>}
 */
export async function probeArr(ip, port, service) {
    const url = `http://${ip}:${port}`;
    const config = SERVICE_CONFIG[service];
    if (!config) return null;

    try {
        const res = await fetch(`${url}/api/${config.apiVersion}/system/status`, {
            signal: AbortSignal.timeout(800),
        });
        // 200 = open access, 401 = needs API key (but service exists!)
        if (res.ok || res.status === 401) {
            return { service, url, needsAuth: res.status === 401 };
        }
        return null;
    } catch {
        return null;
    }
}

export { SERVICE_CONFIG };
