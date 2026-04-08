import { json } from '@sveltejs/kit';
import db from '$lib/server/db.js';
import { processLastfmScrobbles, backfillTrakt, backfillLastfm } from '$lib/server/backfill-engine.js';

/**
 * POST /api/backfill/rebuild
 * Rebuild playback_history from raw tables (trakt_history, lastfm_scrobbles)
 * without deleting any existing data. Uses incremental INSERT OR IGNORE.
 * If raw tables are empty (no initial sync was ever done), falls through
 * to a full API fetch instead.
 */
export async function POST({ locals }) {
    if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
    if (!locals.user.isAdmin) return json({ error: 'Admin required' }, { status: 403 });

    const userId = locals.user.id;
    /** @type {{ trakt: any, lastfm: any }} */
    const results = { trakt: null, lastfm: null };

    try {
        // Check if Trakt is linked
        const hasTrakt = /** @type {any} */ (db.prepare(
            "SELECT 1 FROM user_identities WHERE user_id = ? AND provider = 'trakt' AND access_token IS NOT NULL"
        ).get(userId));
        if (hasTrakt) {
            // Always do a full re-fetch from the Trakt API to ensure completeness.
            // Incremental fetches can miss old data if the initial import was interrupted.
            results.trakt = await backfillTrakt(userId, { fullFetch: true });
        } else {
            results.trakt = { imported: 0, external: 0, skipped: 0, note: 'No Trakt account linked' };
        }
    } catch (e) {
        console.error('[rebuild] Trakt error:', e instanceof Error ? e.message : String(e));
        results.trakt = { error: e instanceof Error ? e.message : String(e) };
    }

    try {
        // Check if we have raw Last.fm data to reprocess
        const lastfmCount = /** @type {any} */ (db.prepare(
            'SELECT COUNT(*) as cnt FROM lastfm_scrobbles WHERE user_id = ?'
        ).get(userId))?.cnt || 0;

        if (lastfmCount > 0) {
            // Re-process existing raw data → playback_history (incremental)
            results.lastfm = processLastfmScrobbles(userId);
        } else {
            // No raw data — check if Last.fm is linked and do a full fetch
            const hasLastfm = /** @type {any} */ (db.prepare(
                "SELECT 1 FROM user_identities WHERE user_id = ? AND provider = 'lastfm' AND provider_uid IS NOT NULL"
            ).get(userId));
            if (hasLastfm) {
                results.lastfm = await backfillLastfm(userId);
            } else {
                results.lastfm = { imported: 0, external: 0, skipped: 0, note: 'No Last.fm account linked' };
            }
        }
    } catch (e) {
        console.error('[rebuild] Last.fm error:', e instanceof Error ? e.message : String(e));
        results.lastfm = { error: e instanceof Error ? e.message : String(e) };
    }

    return json({ success: true, results });
}

