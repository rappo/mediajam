import db from '$lib/server/db.js';
import { json } from '@sveltejs/kit';

/**
 * GET /api/debug/timestamps — Show raw timestamps for recent history entries
 * Temporary diagnostic endpoint to debug timezone issues.
 */
export function GET() {
    const rows = /** @type {any[]} */ (db.prepare(`
        SELECT ph.id, ph.timestamp, ph.source, mp.title as parent_title, mc.title as item_title
        FROM playback_history ph
        JOIN media_children mc ON ph.media_id = mc.id
        JOIN media_parents mp ON mc.parent_id = mp.id
        ORDER BY ph.timestamp DESC
        LIMIT 20
    `).all());

    // Also test datetime('now') output
    const sqliteNow = /** @type {any} */ (db.prepare("SELECT datetime('now') as dt, strftime('%Y-%m-%dT%H:%M:%fZ', 'now') as iso_z").get());

    return json({
        sqliteNow,
        serverTZ: process.env.TZ || 'not set',
        serverTime: new Date().toISOString(),
        entries: rows,
    });
}
