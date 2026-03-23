import { json } from '@sveltejs/kit';
import { findShortestPath, searchPeople } from '$lib/server/connections.js';

/** @type {import('./$types').RequestHandler} */
export function GET({ url }) {
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');
    const search = url.searchParams.get('search');

    // Person search mode (for autocomplete)
    if (search) {
        const results = searchPeople(search, 10);
        return json({ results });
    }

    // Connection search mode
    if (!from || !to) {
        return json({ error: 'Missing "from" and "to" person IDs' }, { status: 400 });
    }

    const fromId = parseInt(from);
    const toId = parseInt(to);

    if (isNaN(fromId) || isNaN(toId)) {
        return json({ error: 'Invalid person IDs' }, { status: 400 });
    }

    const result = findShortestPath(fromId, toId);
    return json(result);
}
