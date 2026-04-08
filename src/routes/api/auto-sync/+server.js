import { json } from '@sveltejs/kit';
import db from '$lib/server/db.js';

/** @type {import('./$types').RequestHandler} */
export async function POST({ request, locals }) {
    if (!locals.user) {
        return json({ error: 'Not authenticated' }, { status: 401 });
    }

    const { provider, enabled } = await request.json();

    if (!provider || typeof enabled !== 'boolean') {
        return json({ error: 'Missing provider or enabled' }, { status: 400 });
    }

    const validProviders = ['trakt', 'lastfm', 'jellyfin'];
    if (!validProviders.includes(provider)) {
        return json({ error: 'Invalid provider' }, { status: 400 });
    }

    // Check that the identity exists
    const identity = db.prepare(
        'SELECT id FROM user_identities WHERE user_id = ? AND provider = ?'
    ).get(locals.user.id, provider);

    if (!identity) {
        return json({ error: `No ${provider} account linked` }, { status: 400 });
    }

    db.prepare('UPDATE user_identities SET auto_sync = ? WHERE user_id = ? AND provider = ?')
        .run(enabled ? 1 : 0, locals.user.id, provider);

    return json({ success: true, provider, auto_sync: enabled });
}
