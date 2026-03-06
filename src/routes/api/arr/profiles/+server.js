import { fetchArrOptions } from '$lib/server/arr-sync.js';
import { json } from '@sveltejs/kit';

/** GET /api/arr/profiles — fetch quality profiles, root folders, metadata profiles from all configured services */
export async function GET({ locals }) {
    if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

    try {
        const options = await fetchArrOptions();
        return json(options);
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return json({ error: msg }, { status: 500 });
    }
}
