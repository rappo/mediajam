import { json } from '@sveltejs/kit';
import { compareSnapshots } from '$lib/server/data-audit.js';

/** Compare two audit snapshots */
export async function POST({ request }) {
    try {
        const { before, after } = await request.json();
        if (!before || !after) {
            return json({ error: 'before and after filenames are required' }, { status: 400 });
        }
        const result = compareSnapshots(before, after);
        return json(result);
    } catch (e) {
        return json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
    }
}
