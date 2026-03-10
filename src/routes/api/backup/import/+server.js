import { json } from '@sveltejs/kit';
import db from '$lib/server/db.js';
import fs from 'fs';
import path from 'path';
import { mkdirSync } from 'fs';

// We'll parse the ZIP manually using the built-in decompress approach
// Since we need to avoid heavy deps, we'll use a temp file approach with archiver's unzip

/**
 * POST /api/backup/import — Import data from a backup ZIP.
 * Query params:
 *   mode=overwrite|merge (default: merge)
 *   prefer=old|new (default: new, only used in merge mode)
 * @type {import('./$types').RequestHandler}
 */
export async function POST({ request, url, locals }) {
    // Allow import during setup (no user exists yet)
    const settings = /** @type {any} */ (db.prepare('SELECT setup_complete FROM app_settings WHERE id = 1').get());
    const isSetupComplete = settings?.setup_complete === 1;

    if (isSetupComplete && !locals.user?.isAdmin) {
        return json({ error: 'Admin access required' }, { status: 403 });
    }

    const mode = url.searchParams.get('mode') || 'merge';
    const prefer = url.searchParams.get('prefer') || 'new';

    // Save uploaded ZIP to temp
    const tempDir = path.resolve('/tmp/mediajam-import-' + Date.now());
    mkdirSync(tempDir, { recursive: true });
    const zipPath = path.join(tempDir, 'backup.zip');

    try {
        const arrayBuffer = await request.arrayBuffer();
        fs.writeFileSync(zipPath, Buffer.from(arrayBuffer));

        // Extract ZIP using node's built-in zlib + manual parsing
        // We'll use a simple approach: shell out to unzip
        const { execSync } = await import('child_process');
        execSync(`unzip -o "${zipPath}" -d "${tempDir}"`, { stdio: 'ignore' });

        // Find the backup directory (should be mediajam-backup-*)
        const entries = fs.readdirSync(tempDir).filter(e => e.startsWith('mediajam-backup'));
        if (entries.length === 0) {
            return json({ error: 'Invalid backup: no mediajam-backup directory found' }, { status: 400 });
        }
        const backupDir = path.join(tempDir, entries[0]);

        // Read manifest
        const manifestPath = path.join(backupDir, 'manifest.json');
        if (!fs.existsSync(manifestPath)) {
            return json({ error: 'Invalid backup: manifest.json not found' }, { status: 400 });
        }
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));

        // Read table data files
        const dataDir = path.join(backupDir, 'data');
        const results = { imported: {}, errors: [] };

        // Import order matters for foreign keys
        const importOrder = [
            'app_settings',
            'users',
            'user_identities',
            'libraries',
            'media_parents',
            'media_children',
            'tracks',
            'playback_history',
            'lastfm_scrobbles',
            'sync_state',
            'persons',
            'person_credits',
            'external_ids',
            'trakt_history',
            'sync_history',
            'media_tags',
            'reconcile_runs',
            'sync_conflicts',
            'discovered_media',
            'discovered_credits',
            'external_ratings',
            'watchlist',
            'activity_log'
        ];

        // In overwrite mode, clear tables in reverse order
        if (mode === 'overwrite') {
            const clearOrder = [...importOrder].reverse();
            for (const table of clearOrder) {
                try {
                    if (table === 'app_settings') {
                        // Don't delete app_settings, we'll update it
                        continue;
                    }
                    db.prepare(`DELETE FROM ${table}`).run();
                } catch (e) {
                    // Table might not exist
                }
            }
        }

        // Import each table
        for (const tableName of importOrder) {
            const filePath = path.join(dataDir, `${tableName}.json`);
            if (!fs.existsSync(filePath)) {
                results.imported[tableName] = 0;
                continue;
            }

            try {
                const rows = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
                if (!Array.isArray(rows) || rows.length === 0) {
                    results.imported[tableName] = 0;
                    continue;
                }

                let count = 0;

                if (tableName === 'app_settings') {
                    // Special handling: update the single settings row
                    const row = rows[0];
                    if (row) {
                        const existingSettings = /** @type {any} */ (db.prepare('SELECT * FROM app_settings WHERE id = 1').get());
                        if (existingSettings && mode === 'merge' && prefer === 'old') {
                            // Only fill in fields that are null/empty in existing
                            for (const [key, value] of Object.entries(row)) {
                                if (key === 'id') continue;
                                if (value != null && value !== '' && (existingSettings[key] == null || existingSettings[key] === '')) {
                                    try {
                                        db.prepare(`UPDATE app_settings SET ${key} = ? WHERE id = 1`).run(value);
                                        count++;
                                    } catch { /* column might not exist */ }
                                }
                            }
                        } else {
                            // Overwrite or merge-prefer-new: update all non-null fields
                            for (const [key, value] of Object.entries(row)) {
                                if (key === 'id') continue;
                                if (value != null) {
                                    try {
                                        db.prepare(`UPDATE app_settings SET ${key} = ? WHERE id = 1`).run(value);
                                        count++;
                                    } catch { /* column might not exist */ }
                                }
                            }
                        }
                    }
                    results.imported[tableName] = count;
                    continue;
                }

                // Generic table import
                const columns = Object.keys(rows[0]);
                const placeholders = columns.map(() => '?').join(', ');
                const columnList = columns.join(', ');

                if (mode === 'overwrite') {
                    // Simple insert (table was already cleared)
                    const stmt = db.prepare(`INSERT OR IGNORE INTO ${tableName} (${columnList}) VALUES (${placeholders})`);
                    const insertMany = db.transaction((/** @type {any[]} */ items) => {
                        for (const row of items) {
                            try {
                                const values = columns.map(c => row[c] ?? null);
                                stmt.run(...values);
                                count++;
                            } catch { /* skip bad rows */ }
                        }
                    });
                    insertMany(rows);
                } else {
                    // Merge mode
                    if (prefer === 'new') {
                        const stmt = db.prepare(`INSERT OR REPLACE INTO ${tableName} (${columnList}) VALUES (${placeholders})`);
                        const upsertMany = db.transaction((/** @type {any[]} */ items) => {
                            for (const row of items) {
                                try {
                                    const values = columns.map(c => row[c] ?? null);
                                    stmt.run(...values);
                                    count++;
                                } catch { /* skip bad rows */ }
                            }
                        });
                        upsertMany(rows);
                    } else {
                        // prefer=old: only insert new records, don't update existing
                        const stmt = db.prepare(`INSERT OR IGNORE INTO ${tableName} (${columnList}) VALUES (${placeholders})`);
                        const insertNew = db.transaction((/** @type {any[]} */ items) => {
                            for (const row of items) {
                                try {
                                    const values = columns.map(c => row[c] ?? null);
                                    const result = stmt.run(...values);
                                    if (result.changes > 0) count++;
                                } catch { /* skip bad rows */ }
                            }
                        });
                        insertNew(rows);
                    }
                }

                results.imported[tableName] = count;
            } catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                results.errors.push(`${tableName}: ${msg}`);
                results.imported[tableName] = 0;
            }
        }

        // Restore avatar uploads
        const avatarDir = path.join(backupDir, 'uploads', 'avatars');
        if (fs.existsSync(avatarDir)) {
            const destDir = path.resolve('uploads/avatars');
            mkdirSync(destDir, { recursive: true });
            const files = fs.readdirSync(avatarDir);
            let avatarCount = 0;
            for (const file of files) {
                try {
                    fs.copyFileSync(path.join(avatarDir, file), path.join(destDir, file));
                    avatarCount++;
                } catch { /* skip */ }
            }
            results.imported['avatars'] = avatarCount;
        }

        // Restore cached images
        const cacheImgDir = path.join(backupDir, 'cache', 'images');
        if (fs.existsSync(cacheImgDir)) {
            const destDir = path.resolve('cache/images');
            mkdirSync(destDir, { recursive: true });
            const files = fs.readdirSync(cacheImgDir);
            let cacheCount = 0;
            for (const file of files) {
                try {
                    const destPath = path.join(destDir, file);
                    // Only restore if not already cached
                    if (!fs.existsSync(destPath)) {
                        fs.copyFileSync(path.join(cacheImgDir, file), destPath);
                        cacheCount++;
                    }
                } catch { /* skip */ }
            }
            results.imported['cached_images'] = cacheCount;
        }

        return json({
            success: true,
            mode,
            prefer: mode === 'merge' ? prefer : undefined,
            manifest,
            results
        });

    } finally {
        // Cleanup temp dir
        try {
            fs.rmSync(tempDir, { recursive: true, force: true });
        } catch { /* ignore */ }
    }
}
