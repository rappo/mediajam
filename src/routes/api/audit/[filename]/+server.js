import { json } from '@sveltejs/kit';
import { deleteSnapshot } from '$lib/server/data-audit.js';

/** Delete an audit snapshot */
export async function DELETE({ params }) {
    try {
        const result = deleteSnapshot(params.filename);
        if (!result.success) {
            return json(result, { status: 400 });
        }
        return json(result);
    } catch (e) {
        return json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
    }
}
