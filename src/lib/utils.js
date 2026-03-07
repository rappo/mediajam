/**
 * Shared utility functions for Mediajam frontend.
 */

/**
 * Proxy an image URL through the local cache.
 * Returns the original URL if null/undefined, or the proxied path.
 * @param {string | null | undefined} url
 * @param {number} [maxHeight] - Optional max height (passed to source, e.g. Jellyfin)
 * @returns {string}
 */
export function imgUrl(url, maxHeight) {
    if (!url) return '';
    const src = maxHeight ? `${url}${url.includes('?') ? '&' : '?'}maxHeight=${maxHeight}` : url;
    return `/api/image?url=${encodeURIComponent(src)}`;
}
