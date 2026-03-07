import { getOrFetch } from '$lib/server/image-cache.js';

/** @type {import('./$types').RequestHandler} */
export async function GET({ url }) {
    const imageUrl = url.searchParams.get('url');

    if (!imageUrl) {
        return new Response('Missing url parameter', { status: 400 });
    }

    // Validate URL
    try {
        const parsed = new URL(imageUrl);
        const allowed = [
            'image.tmdb.org',
            'artworks.thetvdb.com',
            'coverartarchive.org',
            'img.discogs.com',
        ];
        // Allow Jellyfin (any host on local network or custom domain)
        // Allow known CDNs
        const isAllowed = allowed.some(h => parsed.hostname.includes(h)) ||
            parsed.pathname.includes('/Items/') ||  // Jellyfin pattern
            parsed.hostname.match(/^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/) || // Private IPs
            parsed.hostname === 'localhost';

        if (!isAllowed) {
            return new Response('URL not allowed', { status: 403 });
        }
    } catch {
        return new Response('Invalid URL', { status: 400 });
    }

    const result = await getOrFetch(imageUrl);

    if (!result) {
        return new Response('Failed to fetch image', { status: 502 });
    }

    return new Response(new Uint8Array(result.buffer), {
        headers: {
            'Content-Type': result.contentType,
            'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800',
            'X-Image-Cache': 'hit',
        }
    });
}
