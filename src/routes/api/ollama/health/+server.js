import { json } from '@sveltejs/kit';

/**
 * GET /api/ollama/health?url=... — Check Ollama connectivity and available models.
 * Accepts optional ?url= param to test before saving settings.
 * @type {import('./$types').RequestHandler}
 */
export async function GET({ url, locals }) {
    if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

    // Allow testing with a URL param (before settings are saved)
    const testUrl = url.searchParams.get('url')?.replace(/\/+$/, '');

    if (!testUrl) {
        // Fall back to DB settings
        const { healthCheck } = await import('$lib/server/ollama.js');
        const result = await healthCheck();
        return json(result);
    }

    // Test the provided URL directly
    try {
        const res = await fetch(`${testUrl}/api/tags`, { signal: AbortSignal.timeout(5000) });
        if (!res.ok) return json({ ok: false, error: `HTTP ${res.status}` });
        const data = await res.json();
        const models = (data.models || []).map((/** @type {any} */ m) => m.name);
        return json({ ok: true, models });
    } catch (e) {
        return json({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
}
