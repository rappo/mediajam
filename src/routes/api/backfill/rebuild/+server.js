import { json } from '@sveltejs/kit';
import { processTraktHistory, processLastfmScrobbles } from '$lib/server/backfill-engine.js';

/**
 * POST /api/backfill/rebuild
 * Rebuild playback_history from raw tables (trakt_history, lastfm_scrobbles)
 * without deleting any existing data. Uses incremental INSERT OR IGNORE.
 */
export async function POST({ locals }) {
    if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
    if (!locals.user.isAdmin) return json({ error: 'Admin required' }, { status: 403 });

    const userId = locals.user.id;
    /** @type {{ trakt: any, lastfm: any }} */
    const results = { trakt: null, lastfm: null };

    try {
        // Re-process Trakt raw data → playback_history (incremental, skips existing)
        results.trakt = processTraktHistory(userId);
    } catch (e) {
        console.error('[rebuild] Trakt error:', e instanceof Error ? e.message : String(e));
        results.trakt = { error: e instanceof Error ? e.message : String(e) };
    }

    try {
        // Re-process Last.fm raw data → playback_history (incremental, skips existing)
        results.lastfm = processLastfmScrobbles(userId);
    } catch (e) {
        console.error('[rebuild] Last.fm error:', e instanceof Error ? e.message : String(e));
        results.lastfm = { error: e instanceof Error ? e.message : String(e) };
    }

    return json({ success: true, results });
}
