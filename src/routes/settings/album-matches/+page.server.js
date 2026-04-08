import { generateMatches } from '$lib/server/album-matcher.js';

/** @type {import('./$types').PageServerLoad} */
export function load({ url }) {
    const artistId = url.searchParams.get('artistId') ? parseInt(url.searchParams.get('artistId') || '0') : undefined;
    const limit = parseInt(url.searchParams.get('limit') || '50');
    const offset = parseInt(url.searchParams.get('offset') || '0');

    return generateMatches({ artistId, limit, offset });
}
