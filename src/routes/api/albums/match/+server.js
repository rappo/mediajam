import { json } from '@sveltejs/kit';
import { generateMatches, mergeAlbum, autoMergeExact, autoMergeMediumPlus, smartMergeCompilations, enrichUnmatchedAlbums } from '$lib/server/album-matcher.js';

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
                if (!result.success) {
                    return json({ success: false, error: 'Merge failed — artist mismatch or missing album' }, { status: 400 });
                }
                return json(result);
            }

            case 'auto-merge': {
                const artistId = body.artistId || undefined;
                console.log(`[album-match] Auto-merging exact matches${artistId ? ` for artist ${artistId}` : ''}`);
                const result = autoMergeExact({ artistId });
                console.log(`[album-match] Auto-merge done:`, result);
                return json({ success: true, ...result });
            }

            case 'auto-merge-medium-plus': {
                const artistId2 = body.artistId || undefined;
                console.log(`[album-match] Auto-merging medium+ matches${artistId2 ? ` for artist ${artistId2}` : ''}`);
                const result = autoMergeMediumPlus({ artistId: artistId2 });
                console.log(`[album-match] Auto-merge medium+ done:`, result);
                return json({ success: true, ...result });
            }

            case 'smart-merge-compilations': {
                const artistId3 = body.artistId || undefined;
                const dryRun = body.dryRun || false;
                console.log(`[album-match] Smart-merging compilations${artistId3 ? ` for artist ${artistId3}` : ''}${dryRun ? ' (dry run)' : ''}`);
                const result = smartMergeCompilations({ artistId: artistId3, dryRun });
                console.log(`[album-match] Smart-merge done:`, result.merged, 'merged,', result.playsRouted, 'plays routed,', result.skipped, 'skipped');
                return json({ success: true, ...result });
            }

            case 'enrich-unmatched': {
                const artistId4 = body.artistId || undefined;
                const dryRun2 = body.dryRun || false;
                console.log(`[album-match] Enriching unmatched albums${artistId4 ? ` for artist ${artistId4}` : ''}${dryRun2 ? ' (dry run)' : ''}`);
                const result = await enrichUnmatchedAlbums({ artistId: artistId4, dryRun: dryRun2 });
                console.log(`[album-match] Enrich done:`, result.enriched, 'enriched,', result.notFound, 'not found');
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
