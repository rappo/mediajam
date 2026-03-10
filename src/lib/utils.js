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

/**
 * Copy text to clipboard. Works on HTTP (not just HTTPS).
 * Falls back to execCommand('copy') when navigator.clipboard is unavailable.
 * @param {string} text
 * @returns {Promise<boolean>} true if copied successfully
 */
export async function copyToClipboard(text) {
    // Modern API — only available in secure contexts (HTTPS / localhost)
    if (navigator.clipboard?.writeText) {
        try {
            await navigator.clipboard.writeText(text);
            return true;
        } catch {
            // Fall through to legacy method
        }
    }
    // Legacy fallback — works on HTTP
    try {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(textarea);
        return ok;
    } catch {
        return false;
    }
}
