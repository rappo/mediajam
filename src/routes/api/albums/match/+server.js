import { json } from '@sveltejs/kit';
import { generateMatches, mergeAlbum, autoMergeExact } from '$lib/server/album-matcher.js';

/** @type {import('./$types').RequestHandler} */
export async function GET({ url }) {
    const artistId = url.searchParams.get('artistId') ? parseInt(url.searchParams.get('artistId') || '0') : undefined;
    const limit = parseInt(url.searchParams.get('limit') || '50');
    const offset = parseInt(url.searchParams.get('offset') || '0');

    const result = generateMatches({ artistId, limit, offset });
    return json(result);
}

/** @type {import('./$types').RequestHandler} */
export async function POST({ request }) {
    try {
        const body = await request.json();

        switch (body.action) {
            case 'merge': {
                const { unmatchedId, matchedId } = body;
                if (!unmatchedId || !matchedId) {
                    return json({ success: false, error: 'Missing unmatchedId or matchedId' }, { status: 400 });
                }
                console.log(`[album-match] Merging ${unmatchedId} → ${matchedId}`);
                const result = mergeAlbum(unmatchedId, matchedId);
                console.log(`[album-match] Result:`, result);
                return json(result);
            }

            case 'auto-merge': {
                const artistId = body.artistId || undefined;
                console.log(`[album-match] Auto-merging exact matches${artistId ? ` for artist ${artistId}` : ''}`);
                const result = autoMergeExact({ artistId });
                console.log(`[album-match] Auto-merge done:`, result);
                return json({ success: true, ...result });
            }

            default:
                return json({ success: false, error: 'Invalid action' }, { status: 400 });
        }
    } catch (err) {
        console.error('[album-match] POST error:', err);
        return json({ success: false, error: String(err?.message || err) }, { status: 500 });
    }
}
