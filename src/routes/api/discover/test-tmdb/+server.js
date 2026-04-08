import { json } from '@sveltejs/kit';
import db from '$lib/server/db.js';

/**
 * GET /api/discover/test-tmdb — Diagnostic endpoint to check TMDb API connectivity.
 * Hit this in your browser to see if TMDb is reachable and the API key works.
 */
export async function GET({ locals }) {
    if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

    const results = {
        timestamp: new Date().toISOString(),
        steps: /** @type {any[]} */ ([]),
    };

    // Step 1: Check API key in DB
    const settings = /** @type {any} */ (db.prepare('SELECT tmdb_api_key FROM app_settings WHERE id = 1').get());
    const rawKey = settings?.tmdb_api_key || '';
    const apiKey = rawKey.trim();
    results.steps.push({
        step: 'api_key_check',
        hasKey: !!apiKey,
        keyLength: apiKey.length,
        keyPrefix: apiKey.substring(0, 6),
        keySuffix: apiKey.substring(apiKey.length - 4),
        hasPaddingOrWhitespace: rawKey !== apiKey,
    });

    if (!apiKey) {
        return json({ ...results, error: 'No TMDb API key configured' });
    }

    // Step 2: Test TMDb configuration endpoint (simplest call)
    try {
        const configUrl = `https://api.themoviedb.org/3/configuration?api_key=${apiKey}`;
        const start = Date.now();
        const res = await fetch(configUrl);
        const elapsed = Date.now() - start;
        const body = await res.text();
        results.steps.push({
            step: 'tmdb_config_test',
            url: configUrl.replace(apiKey, '***'),
            status: res.status,
            statusText: res.statusText,
            elapsed_ms: elapsed,
            response_length: body.length,
            response_preview: body.substring(0, 300),
        });
    } catch (/** @type {any} */ err) {
        results.steps.push({
            step: 'tmdb_config_test',
            network_error: err.message || String(err),
            error_type: err.constructor?.name,
        });
    }

    // Step 3: Test a person search (same call discover/person uses)
    try {
        const searchUrl = `https://api.themoviedb.org/3/search/person?api_key=${apiKey}&query=Tom+Hanks&page=1`;
        const start = Date.now();
        const res = await fetch(searchUrl);
        const elapsed = Date.now() - start;
        const body = await res.text();
        results.steps.push({
            step: 'tmdb_person_search',
            url: searchUrl.replace(apiKey, '***'),
            status: res.status,
            statusText: res.statusText,
            elapsed_ms: elapsed,
            response_length: body.length,
            response_preview: body.substring(0, 300),
        });
    } catch (/** @type {any} */ err) {
        results.steps.push({
            step: 'tmdb_person_search',
            network_error: err.message || String(err),
            error_type: err.constructor?.name,
        });
    }

    // Step 4: Check person 9823 specifically
    const person = /** @type {any} */ (db.prepare('SELECT id, name, tmdb_person_id FROM persons WHERE id = 9823').get());
    results.steps.push({
        step: 'person_9823_lookup',
        found: !!person,
        ...(person ? { name: person.name, tmdb_person_id: person.tmdb_person_id } : {}),
    });

    if (person?.tmdb_person_id) {
        try {
            const creditsUrl = `https://api.themoviedb.org/3/person/${person.tmdb_person_id}/combined_credits?api_key=${apiKey}`;
            const start = Date.now();
            const res = await fetch(creditsUrl);
            const elapsed = Date.now() - start;
            const body = await res.text();
            results.steps.push({
                step: 'tmdb_credits_9823',
                url: creditsUrl.replace(apiKey, '***'),
                status: res.status,
                statusText: res.statusText,
                elapsed_ms: elapsed,
                response_length: body.length,
                response_preview: body.substring(0, 300),
            });
        } catch (/** @type {any} */ err) {
            results.steps.push({
                step: 'tmdb_credits_9823',
                network_error: err.message || String(err),
                error_type: err.constructor?.name,
            });
        }
    }

    return json(results, { status: 200 });
}
