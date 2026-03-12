import { json } from '@sveltejs/kit';
import { syncBandMembers } from '$lib/server/musicbrainz-members.js';

/**
 * POST /api/music/:id/sync-members — Manually sync band members from MusicBrainz.
 */
export async function POST({ params, locals }) {
    if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

    const mediaParentId = parseInt(params.id);
    if (!mediaParentId) return json({ error: 'Invalid ID' }, { status: 400 });

    try {
        const result = await syncBandMembers(mediaParentId);
        return json({
            success: true,
            members: result.members.length,
            errors: result.errors,
        });
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return json({ error: msg }, { status: 500 });
    }
}
