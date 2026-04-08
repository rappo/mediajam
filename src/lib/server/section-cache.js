/**
 * Precomputed smart-section cache.
 *
 * Stores fully-built page data in a DB table so the API can return instantly.
 * Rebuilt:
 *   • On server boot (if stale or missing)
 *   • After Jellyfin sync completes
 *   • As a nightly pipeline phase
 *
 * The actual computation is done by the callers (API endpoints / pipeline phase)
 * to avoid circular dependencies with homepage-engine.
 */
import db from '$lib/server/db.js';

// ── Schema ──────────────────────────────────────────────────────────────────
db.exec(`
CREATE TABLE IF NOT EXISTS precomputed_sections (
    page_key   TEXT PRIMARY KEY,
    data       TEXT NOT NULL,
    built_at   TEXT NOT NULL DEFAULT (datetime('now'))
)
`);

/**
 * Read precomputed data for a page.
 * @param {string} pageKey — e.g. 'movies-smart-0', 'tv-smart-0', 'music-smart-0'
 * @returns {{ data: any, built_at: string } | null}
 */
export function getPrecomputed(pageKey) {
    const row = /** @type {any} */ (
        db.prepare('SELECT data, built_at FROM precomputed_sections WHERE page_key = ?').get(pageKey)
    );
    if (!row) return null;
    try {
        return { data: JSON.parse(row.data), built_at: row.built_at };
    } catch {
        return null;
    }
}

/**
 * Store precomputed data for a page.
 * @param {string} pageKey
 * @param {any} data
 */
export function setPrecomputed(pageKey, data) {
    db.prepare(`
        INSERT OR REPLACE INTO precomputed_sections (page_key, data, built_at)
        VALUES (?, ?, datetime('now'))
    `).run(pageKey, JSON.stringify(data));
}

/**
 * Check if precomputed data exists and is recent enough.
 * @param {string} pageKey
 * @param {number} maxAgeMs — max age in milliseconds (default: 24 hours)
 * @returns {boolean}
 */
export function isPrecomputedFresh(pageKey, maxAgeMs = 24 * 60 * 60 * 1000) {
    const row = /** @type {any} */ (
        db.prepare('SELECT built_at FROM precomputed_sections WHERE page_key = ?').get(pageKey)
    );
    if (!row) return false;
    const builtAt = new Date(row.built_at + 'Z').getTime();
    return (Date.now() - builtAt) < maxAgeMs;
}

/**
 * Invalidate (delete) precomputed data for a page or prefix.
 * @param {string} [prefix] — delete keys starting with this. If omitted, deletes all.
 */
export function invalidatePrecomputed(prefix) {
    if (prefix) {
        db.prepare("DELETE FROM precomputed_sections WHERE page_key LIKE ? || '%'").run(prefix);
    } else {
        db.prepare('DELETE FROM precomputed_sections').run();
    }
}
