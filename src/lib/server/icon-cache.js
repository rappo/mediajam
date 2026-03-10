/**
 * Service Icon Cache
 * Downloads dashboard icons from CDN on server boot and serves them locally.
 * Icons are stored in DATA_DIR/cache/icons/ as SVG files.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'fs';
import { dirname, join, resolve } from 'path';

const DATA_DIR = dirname(process.env.DATABASE_PATH || resolve(process.cwd(), 'mediajam.sqlite'));
const ICON_DIR = join(DATA_DIR, 'cache', 'icons');
const CDN = 'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons@latest';

/** Map of service key → CDN icon slug */
const ICONS = /** @type {Record<string, string>} */ ({
    jellyfin: 'jellyfin',
    radarr: 'radarr',
    sonarr: 'sonarr',
    lidarr: 'lidarr',
    trakt: 'trakt',
    lastfm: 'last-fm',
    tmdb: 'tmdb',
    imdb: 'imdb',
    tvdb: 'thetvdb',
    musicbrainz: 'musicbrainz',
    wikipedia: 'wikipedia',
    omdb: 'omdb',
    discogs: 'discogs',
    fanart: 'fanart-tv',
});

let initialized = false;

/** Bundled SVG fallbacks for services that may not be on dashboardicons */
const FALLBACK_SVGS = /** @type {Record<string, string>} */ ({
    imdb: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="8" fill="#F5C518"/><text x="32" y="44" font-family="Arial,Helvetica,sans-serif" font-weight="900" font-size="24" text-anchor="middle" fill="#000">IMDb</text></svg>`,
    tvdb: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="64" fill="#6CD491"/><text x="256" y="340" font-family="Arial,sans-serif" font-weight="bold" font-size="200" text-anchor="middle" fill="white">TV</text></svg>`,
    wikipedia: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 512"><path fill="#999" d="M640 51.2l-.3 12.2c-28.1.8-45 15.8-55.8 40.3-25 57.8-103.3 240-155.3 358.6H415l-81.9-193.1c-32.5 63.6-68.3 130-99.2 193.1-.3.3-15 0-15-.3C172 352.3 122.7 243.4 75.6 133.4 64.2 107.3 48 90.9 12 89.1v-12.2c33.3 0 62.5 1.4 89.5 0v12.2c-10.6 7.5-20.1 13.2-20.1 26.5 0 1.6 3.8 12.3 6.5 18.3 31.5 72.6 78.3 179.1 115.4 268.5 21.7-46.6 52.3-107.5 73-157.1-20.4-50.5-56.8-133.3-66.6-158.5-8.3-21.1-18-32.2-44.8-33.4v-12.2c28.6 1.4 56.2 1.5 82.6 0v12.2c-12.6 3-18.5 11.8-18.5 21.5 0 4 4.6 18.6 6.5 23.6l56.5 133.9 33.2-72.8c-11.2-27.5-27.5-67.7-37.9-92-6.6-18.5-18.5-27.8-40.6-28.9v-12.2c26.4 1.4 51.5 1.4 76.8 0v12.2c-8.3.7-18.5 6.5-18.5 17.8 0 3 2.6 10.6 4.6 16l45.3 105 32.8-69.6c7.8-17.4 11-30.1 11-37.9 0-12.6-7.4-27.6-31-27.6v-12.2c22 1.3 40.7 1.4 58.2 0v12.2c-18.8 3.3-27.5 25-36.1 44.8l-40.3 81 50.4 115.3 87.8-209.8c4.1-9.8 6.6-19.8 6.6-26.4 0-11.8-13.4-19-30.2-20.4V51.2c19 1.4 38.4 1.4 57.6 0z"/></svg>`,
    fanart: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="8" fill="#17a2b8"/><text x="32" y="28" font-family="Arial,sans-serif" font-weight="bold" font-size="12" text-anchor="middle" fill="white">fan</text><text x="32" y="44" font-family="Arial,sans-serif" font-weight="bold" font-size="12" text-anchor="middle" fill="white">art.tv</text></svg>`,
});

/**
 * Check if a cached icon is a valid SVG (not an error page)
 * @param {string} path
 * @returns {boolean}
 */
function isValidSvg(path) {
    try {
        const content = readFileSync(path, 'utf-8');
        return content.trim().startsWith('<svg') || content.trim().startsWith('<?xml');
    } catch {
        return false;
    }
}

/**
 * Download all icons on boot. Re-downloads invalid cached icons.
 * Runs in the background — doesn't block server startup.
 */
export async function prefetchIcons() {
    if (initialized) return;
    initialized = true;

    mkdirSync(ICON_DIR, { recursive: true });

    const entries = Object.entries(ICONS);
    let fetched = 0;
    let skipped = 0;

    for (const [service, slug] of entries) {
        const localPath = join(ICON_DIR, `${service}.svg`);

        // Skip valid cached icons
        if (existsSync(localPath) && isValidSvg(localPath)) {
            skipped++;
            continue;
        }

        // Remove invalid cached file
        if (existsSync(localPath)) {
            try { unlinkSync(localPath); } catch { /* ignore */ }
        }

        try {
            const url = `${CDN}/svg/${slug}.svg`;
            const res = await fetch(url);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const svg = await res.text();
            if (!svg.trim().startsWith('<svg') && !svg.trim().startsWith('<?xml')) {
                throw new Error('Response is not SVG');
            }
            writeFileSync(localPath, svg, 'utf-8');
            fetched++;
        } catch (err) {
            // Use bundled fallback if CDN fails
            if (FALLBACK_SVGS[service]) {
                writeFileSync(localPath, FALLBACK_SVGS[service], 'utf-8');
                fetched++;
                console.log(`[icon-cache] Used bundled fallback for ${service}`);
            } else {
                console.warn(`[icon-cache] Failed to fetch ${service}: ${/** @type {Error} */(err).message}`);
            }
        }
    }

    if (fetched > 0 || skipped < entries.length) {
        console.log(`[icon-cache] Cached ${fetched} new icons, ${skipped} already cached`);
    }
}

/**
 * Get the local SVG content for a service icon.
 * @param {string} service
 * @returns {Buffer | null}
 */
export function getIconSvg(service) {
    const localPath = join(ICON_DIR, `${service}.svg`);
    try {
        return readFileSync(localPath);
    } catch {
        return null;
    }
}

/** Get list of all known service icon keys */
export function getIconServices() {
    return Object.keys(ICONS);
}
