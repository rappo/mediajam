import { json } from '@sveltejs/kit';
import fs from 'node:fs';
import Database from 'better-sqlite3';

/**
 * POST /api/settings/validate-pr-db
 * Validates a Jellyfin Playback Reporting DB path:
 * - Checks if file exists
 * - Checks if it's a valid SQLite database
 * - Checks if PlaybackActivity table exists
 * - Returns row count
 */
export async function POST({ request }) {
    try {
        const { dbPath } = await request.json();

        if (!dbPath || typeof dbPath !== 'string') {
            return json({ valid: false, error: 'No path provided' });
        }

        // Check if file exists
        if (!fs.existsSync(dbPath)) {
            return json({ valid: false, error: `File not found: ${dbPath}` });
        }

        // Try opening as SQLite
        let prDb;
        try {
            prDb = new Database(dbPath, { readonly: true });
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            return json({ valid: false, error: `Cannot open as SQLite: ${msg}` });
        }

        try {
            // Check for PlaybackActivity table
            const table = prDb.prepare(
                "SELECT name FROM sqlite_master WHERE type='table' AND name='PlaybackActivity'"
            ).get();

            if (!table) {
                return json({ valid: false, error: 'PlaybackActivity table not found — is this the correct file?' });
            }

            // Count rows
            const count = /** @type {any} */ (prDb.prepare('SELECT COUNT(*) as c FROM PlaybackActivity').get());

            return json({
                valid: true,
                rows: count?.c || 0,
                message: `✓ Found ${(count?.c || 0).toLocaleString()} playback events`
            });
        } finally {
            prDb.close();
        }
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return json({ valid: false, error: msg });
    }
}
