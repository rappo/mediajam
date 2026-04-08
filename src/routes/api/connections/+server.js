import { json } from '@sveltejs/kit';
import { findShortestPath, findMultiplePaths, searchPeople, getWatchedMediaIds } from '$lib/server/connections.js';

/** @type {import('./$types').RequestHandler} */
export function GET({ url }) {
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');
    const search = url.searchParams.get('search');
    const excludeParam = url.searchParams.get('exclude');
    const countParam = url.searchParams.get('count');
    const watchedOnly = url.searchParams.get('watchedOnly') === '1';

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

    // Parse excluded media IDs
    /** @type {Set<number>|undefined} */
    let excludeMedia;
    if (excludeParam) {
        excludeMedia = new Set(
            excludeParam.split(',').map(Number).filter(n => !isNaN(n))
        );
    }

    // Build watched media whitelist if requested
    /** @type {Set<number>|undefined} */
    const watchedMedia = watchedOnly ? getWatchedMediaIds() : undefined;

    // Multiple paths mode
    const count = Math.min(parseInt(countParam || '1') || 1, 10);

    if (count > 1) {
        const paths = findMultiplePaths(fromId, toId, count, excludeMedia, watchedMedia);
        return json({ paths });
    }

    // Single path mode
    const result = findShortestPath(fromId, toId, excludeMedia, watchedMedia);
    return json(result);
}
