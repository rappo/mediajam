import { json } from '@sveltejs/kit';
import { listSnapshots, takeSnapshot } from '$lib/server/data-audit.js';

/** List all audit snapshots */
export async function GET() {
    try {
        const snapshots = listSnapshots();
        return json(snapshots);
    } catch (e) {
        return json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
    }
}

/** Take a new audit snapshot */
export async function POST({ request }) {
    try {
        const { label } = await request.json();
        if (!label || typeof label !== 'string') {
            return json({ error: 'label is required' }, { status: 400 });
        }
        const result = takeSnapshot(label);
        return json(result);
    } catch (e) {
        return json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
    }
}
