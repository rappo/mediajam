/**
 * Image Cache
 * 
 * Local filesystem cache for all served images.
 * SHA-256 hash of URL → flat file in DATA_DIR/cache/images/ab/abcdef...
 * 6-month TTL with stale-while-revalidate.
 */

import { createHash } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync, readdirSync, rmSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { logInfo, logError, logWarn } from '$lib/server/logger.js';

// Put cache alongside the database in the persistent data directory (same as logs)
const DATA_DIR = dirname(process.env.DATABASE_PATH || resolve(process.cwd(), 'mediajam.sqlite'));
const CACHE_DIR = process.env.IMAGE_CACHE_DIR || join(DATA_DIR, 'cache', 'images');
const MAX_AGE_MS = 6 * 30 * 24 * 60 * 60 * 1000; // ~6 months

// Ensure cache root exists
try {
    if (!existsSync(CACHE_DIR)) {
        mkdirSync(CACHE_DIR, { recursive: true });
        console.log(`[image-cache] Created cache directory: ${CACHE_DIR}`);
    }
} catch (e) {
    console.error(`[image-cache] Failed to create cache dir: ${e instanceof Error ? e.message : e}`);
}

/**
 * Hash a URL to a cache key.
 * @param {string} url
 * @returns {{ hash: string, dir: string, path: string }}
 */
function cacheKey(url) {
    const hash = createHash('sha256').update(url).digest('hex');
    const dir = join(CACHE_DIR, hash.slice(0, 2));
    const path = join(dir, hash);
    return { hash, dir, path };
}

/**
 * Get a cached image if it exists and is fresh enough.
 * @param {string} url
 * @returns {{ buffer: Buffer, contentType: string, stale: boolean } | null}
 */
export function getCachedImage(url) {
    const { path } = cacheKey(url);
    const metaPath = path + '.meta';

    if (!existsSync(path) || !existsSync(metaPath)) return null;

    try {
        const stat = statSync(path);
        const meta = JSON.parse(readFileSync(metaPath, 'utf-8'));
        const age = Date.now() - stat.mtimeMs;
        const stale = age > MAX_AGE_MS;

        return {
            buffer: readFileSync(path),
            contentType: meta.contentType || 'image/jpeg',
            stale
        };
    } catch {
        return null;
    }
}

/**
 * Write an image to the cache.
 * @param {string} url
 * @param {Buffer} buffer
 * @param {string} contentType
 */
export function cacheImage(url, buffer, contentType) {
    const { dir, path } = cacheKey(url);
    try {
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
        writeFileSync(path, buffer);
        writeFileSync(path + '.meta', JSON.stringify({
            url,
            contentType,
            cachedAt: new Date().toISOString()
        }));
    } catch (e) {
        logError('image-cache', `Failed to cache: ${url}`, { error: e instanceof Error ? e.message : String(e) });
    }
}

/**
 * Fetch an image from source, cache it, and return it.
 * @param {string} url
 * @param {number} [timeoutMs=10000]
 * @returns {Promise<{ buffer: Buffer, contentType: string } | null>}
 */
async function fetchAndCache(url, timeoutMs = 10000) {
    try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);

        const res = await fetch(url, {
            signal: controller.signal,
            headers: { 'Accept': 'image/*' }
        });
        clearTimeout(timer);

        if (!res.ok) {
            logWarn('image-cache', `HTTP ${res.status} fetching: ${url}`);
            return null;
        }

        const buffer = Buffer.from(await res.arrayBuffer());
        const contentType = res.headers.get('content-type') || 'image/jpeg';
        cacheImage(url, buffer, contentType);
        return { buffer, contentType };
    } catch (e) {
        if (e instanceof Error && e.name === 'AbortError') {
            logWarn('image-cache', `Timeout fetching: ${url}`);
        } else {
            logError('image-cache', `Fetch error: ${url}`, { error: e instanceof Error ? e.message : String(e) });
        }
        return null;
    }
}

/**
 * Get an image — cache-first with stale-while-revalidate.
 * @param {string} url
 * @returns {Promise<{ buffer: Buffer, contentType: string } | null>}
 */
export async function getOrFetch(url) {
    const cached = getCachedImage(url);
    if (cached) {
        if (cached.stale) {
            // Revalidate in background, serve stale now
            fetchAndCache(url).catch(() => {});
        }
        return { buffer: cached.buffer, contentType: cached.contentType };
    }
    return fetchAndCache(url);
}

/**
 * Pre-cache a batch of URLs (non-blocking). Used during syncs.
 * @param {string[]} urls
 * @param {number} [concurrency=5]
 */
export async function warmCache(urls, concurrency = 5) {
    // Filter to only URLs not already cached
    const uncached = urls.filter(url => {
        if (!url) return false;
        const cached = getCachedImage(url);
        return !cached || cached.stale;
    });

    if (uncached.length === 0) return;

    logInfo('image-cache', `Warming cache for ${uncached.length} images...`);
    let completed = 0;

    // Process in batches
    for (let i = 0; i < uncached.length; i += concurrency) {
        const batch = uncached.slice(i, i + concurrency);
        await Promise.allSettled(batch.map(url => fetchAndCache(url)));
        completed += batch.length;
    }

    logInfo('image-cache', `Cache warm complete: ${completed} images processed`);
}

/**
 * Clear the entire image cache.
 */
export function clearCache() {
    try {
        if (!existsSync(CACHE_DIR)) return;

        rmSync(CACHE_DIR, { recursive: true, force: true });
        mkdirSync(CACHE_DIR, { recursive: true });
        logInfo('image-cache', 'Cache cleared');
    } catch (e) {
        logError('image-cache', `Failed to clear cache: ${e instanceof Error ? e.message : String(e)}`);
    }
}

/**
 * Get cache stats.
 * @returns {{ totalFiles: number, totalSize: number }}
 */
export function getCacheStats() {
    let totalFiles = 0;
    let totalSize = 0;

    try {
        if (!existsSync(CACHE_DIR)) return { totalFiles, totalSize };

        const dirs = readdirSync(CACHE_DIR);
        for (const dir of dirs) {
            const dirPath = join(CACHE_DIR, dir);
            try {
                const files = readdirSync(dirPath).filter(f => !f.endsWith('.meta'));
                for (const file of files) {
                    try {
                        const stat = statSync(join(dirPath, file));
                        totalFiles++;
                        totalSize += stat.size;
                    } catch { /* skip */ }
                }
            } catch { /* skip */ }
        }
    } catch { /* skip */ }

    return { totalFiles, totalSize };
}
