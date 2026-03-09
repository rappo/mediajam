/**
 * Service Icon Cache
 * Downloads dashboard icons from CDN on server boot and serves them locally.
 * Icons are stored in DATA_DIR/cache/icons/ as SVG files.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join, resolve } from 'path';

const DATA_DIR = dirname(process.env.DATABASE_PATH || resolve(process.cwd(), 'mediajam.sqlite'));
const ICON_DIR = join(DATA_DIR, 'cache', 'icons');
const CDN = 'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons@latest';

/** Map of service key → CDN icon slug */
const ICONS = {
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
};

let initialized = false;

/**
 * Download all icons on boot. Skips icons that already exist locally.
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
        if (existsSync(localPath)) {
            skipped++;
            continue;
        }
        try {
            const url = `${CDN}/svg/${slug}.svg`;
            const res = await fetch(url);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const svg = await res.text();
            writeFileSync(localPath, svg, 'utf-8');
            fetched++;
        } catch (err) {
            console.warn(`[icon-cache] Failed to fetch ${service}: ${/** @type {Error} */(err).message}`);
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
