/**
 * Service Icon Cache
 * Downloads dashboard icons from CDN on server boot and serves them locally.
 * Icons are stored in DATA_DIR/cache/icons/ as SVG files.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'fs';
import { dirname, join, resolve } from 'path';

const DATA_DIR = dirname(process.env.DATABASE_PATH || resolve(process.cwd(), 'mediajam.sqlite'));
const ICON_DIR = join(DATA_DIR, 'cache', 'icons');
const CDN = 'https://cdn.jsdelivr.net/gh/selfhst/icons';

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
    tvdb: 'tvdb',
    musicbrainz: 'musicbrainz',
    wikipedia: 'wikipedia',
    omdb: 'omdb',
    discogs: 'discogs',
    fanart: 'fanart-tv',
    ollama: 'ollama',
    openai: 'openai',
    gemini: 'google-gemini',
    claude: 'claude',
    kimi: 'kimi',
    litellm: 'litellm',
    metacritic: 'metacritic',
    rottentomatoes: 'rotten-tomatoes',
});

let initialized = false;

/** Bundled SVG fallbacks for services not available on the CDN */
const FALLBACK_SVGS = /** @type {Record<string, string>} */ ({
    omdb: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="12" fill="#1a1a2e"/><text x="32" y="28" font-family="Arial,sans-serif" font-weight="bold" font-size="11" text-anchor="middle" fill="#f59e0b">OMDb</text><text x="32" y="44" font-family="Arial,sans-serif" font-size="8" text-anchor="middle" fill="#a0a0a0">API</text></svg>`,
    fanart: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="8" fill="#17a2b8"/><text x="32" y="28" font-family="Arial,sans-serif" font-weight="bold" font-size="12" text-anchor="middle" fill="white">fan</text><text x="32" y="44" font-family="Arial,sans-serif" font-weight="bold" font-size="12" text-anchor="middle" fill="white">art.tv</text></svg>`,
    discogs: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="12" fill="#333"/><circle cx="32" cy="32" r="20" fill="none" stroke="#fff" stroke-width="2"/><circle cx="32" cy="32" r="8" fill="#333" stroke="#fff" stroke-width="1.5"/><circle cx="32" cy="32" r="2" fill="#fff"/></svg>`,
    kimi: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="12" fill="#1a1a2e"/><circle cx="32" cy="30" r="14" fill="none" stroke="#60a5fa" stroke-width="2.5"/><path d="M26 28c0-3.3 2.7-6 6-6s6 2.7 6 6" fill="none" stroke="#60a5fa" stroke-width="2" stroke-linecap="round"/><circle cx="28" cy="30" r="2" fill="#60a5fa"/><circle cx="36" cy="30" r="2" fill="#60a5fa"/><path d="M28 36c1.5 2 3 3 4 3s2.5-1 4-3" fill="none" stroke="#60a5fa" stroke-width="1.5" stroke-linecap="round"/><text x="32" y="56" font-family="Arial,sans-serif" font-weight="bold" font-size="8" text-anchor="middle" fill="#60a5fa">KIMI</text></svg>`,
    metacritic: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="12" fill="#FFCC34"/><text x="32" y="42" font-family="Arial,sans-serif" font-weight="900" font-size="32" text-anchor="middle" fill="#000">M</text></svg>`,
    rottentomatoes: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="12" fill="#FA320A"/><text x="32" y="42" font-family="Arial,sans-serif" font-weight="900" font-size="28" text-anchor="middle" fill="#fff">RT</text></svg>`,
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
 * Purge icons cached from the old CDN (homarr-labs/dashboard-icons).
 * Detects stale icons by checking for small file size (likely error pages or
 * the old ugly fallback SVGs) and forces re-download from the new CDN.
 */
function _purgeStaleIcons() {
    if (!existsSync(ICON_DIR)) return;
    const markerPath = join(ICON_DIR, '.selfhst-migrated');
    if (existsSync(markerPath)) return; // already migrated

    let purged = 0;
    for (const service of Object.keys(ICONS)) {
        const localPath = join(ICON_DIR, `${service}.svg`);
        if (existsSync(localPath)) {
            try { unlinkSync(localPath); purged++; } catch { /* ignore */ }
        }
    }
    // Also remove old slug files (e.g., thetvdb.svg → now tvdb)
    const oldSlugPath = join(ICON_DIR, 'thetvdb.svg');
    if (existsSync(oldSlugPath)) {
        try { unlinkSync(oldSlugPath); } catch { /* ignore */ }
    }

    writeFileSync(markerPath, new Date().toISOString(), 'utf-8');
    if (purged > 0) {
        console.log(`[icon-cache] Purged ${purged} icons from old CDN, will re-download from selfhst/icons`);
    }
}


/**
 * Download all icons on boot. Re-downloads invalid cached icons.
 * Runs in the background — doesn't block server startup.
 */
export async function prefetchIcons() {
    if (initialized) return;
    initialized = true;

    // Purge icons cached from the old CDN (homarr-labs) by checking for known bad content
    _purgeStaleIcons();

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
