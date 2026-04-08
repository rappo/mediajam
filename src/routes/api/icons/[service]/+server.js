import { getIconSvg } from '$lib/server/icon-cache.js';

/** @type {import('./$types').RequestHandler} */
export function GET({ params }) {
    const svg = getIconSvg(params.service);
    if (!svg) {
        return new Response('Not found', { status: 404 });
    }
    return new Response(svg.toString(), {
        headers: {
            'Content-Type': 'image/svg+xml',
            'Cache-Control': 'public, max-age=604800, immutable',
        },
    });
}
