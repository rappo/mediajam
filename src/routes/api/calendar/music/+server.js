import { getUpcomingAlbums } from '$lib/server/homepage-engine.js';
import { json } from '@sveltejs/kit';

/**
 * GET /api/calendar/music?offset=0 — Fetch music calendar data with week offset.
 * offset=0 is current 3 weeks, offset=-3 is 3 weeks in the past, offset=3 is 3 weeks ahead.
 */
export async function GET({ url, locals }) {
    if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

    const offset = parseInt(url.searchParams.get('offset') || '0') || 0;
    const clampedOffset = Math.max(-12, Math.min(12, offset));

    const days = getUpcomingAlbums(/** @type {any} */ ({}), clampedOffset);
    return json({ days });
}
