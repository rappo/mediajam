import { json } from '@sveltejs/kit';

/**
 * Proxy fetch endpoint — lets the frontend make server-side requests
 * to internal services (LiteLLM, etc.) that may not be reachable from
 * the browser due to CORS or network topology.
 * 
 * POST /api/settings/proxy-fetch
 * Body: { url: string, headers?: Record<string, string> }
 */
export async function POST({ request }) {
    try {
        const { url, headers = {} } = await request.json();
        if (!url) return json({ error: 'Missing url' }, { status: 400 });

        const res = await fetch(url, {
            headers,
            signal: AbortSignal.timeout(10000),
        });

        if (!res.ok) {
            const errText = await res.text().catch(() => '');
            return json({ error: `HTTP ${res.status}: ${errText.slice(0, 200)}` }, { status: res.status });
        }

        const data = await res.json();
        return json(data);
    } catch (e) {
        return json({ error: e instanceof Error ? e.message : 'Proxy fetch failed' }, { status: 502 });
    }
}
