import { json } from '@sveltejs/kit';
import { healthCheck } from '$lib/server/ollama.js';

/**
 * GET /api/ollama/health — Check Ollama connectivity and available models
 * @type {import('./$types').RequestHandler}
 */
export async function GET({ locals }) {
    if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

    const result = await healthCheck();
    return json(result);
}
