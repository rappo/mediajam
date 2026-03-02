import { json } from '@sveltejs/kit';

/**
 * POST /api/spokes/lastfm/scrobble — Outbound Last.fm scrobble (placeholder).
 * @type {import('./$types').RequestHandler}
 */
export async function POST() {
    return json({
        status: 'not_implemented',
        message: 'Outbound Last.fm scrobbling is planned for a future release.'
    }, { status: 501 });
}
