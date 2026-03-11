import { json } from '@sveltejs/kit';
import db from '$lib/server/db.js';

/**
 * POST /api/llm/openai/codex-token — Accept pasted ~/.codex/auth.json content.
 * Parses out the access_token and refresh_token and stores them in app_settings.
 * @type {import('./$types').RequestHandler}
 */
export async function POST({ request, locals }) {
    if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

    try {
        const body = await request.json();

        // Accept either the full auth.json or just { access_token, refresh_token }
        let accessToken, refreshToken;

        if (body.tokens?.access_token) {
            // Full auth.json format: { auth_mode, tokens: { access_token, refresh_token, ... } }
            accessToken = body.tokens.access_token;
            refreshToken = body.tokens.refresh_token || null;
        } else if (body.access_token) {
            // Direct format: { access_token, refresh_token }
            accessToken = body.access_token;
            refreshToken = body.refresh_token || null;
        } else {
            return json({ error: 'Could not find tokens. Paste the full output of: cat ~/.codex/auth.json' }, { status: 400 });
        }

        if (!accessToken || typeof accessToken !== 'string') {
            return json({ error: 'Invalid access token.' }, { status: 400 });
        }

        // Store tokens
        db.prepare(`
            UPDATE app_settings
            SET codex_access_token = ?, codex_refresh_token = ?, llm_provider = 'openai'
            WHERE id = 1
        `).run(accessToken, refreshToken);

        console.log('[codex-token] Codex tokens saved successfully');
        return json({ success: true, message: 'Codex tokens saved. OpenAI is now your chat provider.' });
    } catch (e) {
        console.error('[codex-token] Error:', e);
        return json({ error: 'Invalid JSON. Paste the full output of: cat ~/.codex/auth.json' }, { status: 400 });
    }
}

/**
 * DELETE /api/llm/openai/codex-token — Remove stored Codex tokens.
 * @type {import('./$types').RequestHandler}
 */
export async function DELETE({ locals }) {
    if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

    db.prepare(`
        UPDATE app_settings
        SET codex_access_token = NULL, codex_refresh_token = NULL
        WHERE id = 1
    `).run();

    return json({ success: true, message: 'Codex tokens removed.' });
}
