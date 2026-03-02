import { json } from '@sveltejs/kit';

/**
 * POST /api/spokes/trakt/scrobble — Outbound Trakt scrobble (placeholder).
 * @type {import('./$types').RequestHandler}
 */
export async function POST() {
    return json({
        status: 'not_implemented',
        message: 'Outbound Trakt scrobbling is planned for a future release.'
    }, { status: 501 });
}
