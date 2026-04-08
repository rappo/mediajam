/**
 * Data Audit — snapshot & compare tool for before/after sync verification.
 *
 * Takes SQLite snapshots, stores them in backups/, and compares
 * row counts + content diffs across key tables.
 */

import { dirname, join } from 'path';
import { existsSync, copyFileSync, unlinkSync, readdirSync, statSync, writeFileSync, readFileSync, mkdirSync } from 'fs';
import Database from 'better-sqlite3';
import { DB_PATH } from '$lib/server/db.js';
import { BACKUP_DIR } from '$lib/server/backup-engine.js';

const AUDIT_PREFIX = 'audit-';

/** Tables to compare in audits */
const AUDIT_TABLES = [
    'media_parents',
    'media_children',
    'playback_history',
    'persons',
    'person_credits',
    'external_ids',
    'external_ratings',
    'media_tags',
    'tracks',
    'lastfm_scrobbles',
    'trakt_history',
    'discovered_media',
];

/**
 * Take a snapshot of the current database.
 * @param {string} label — user-provided label
 * @returns {{ filename: string, metaFilename: string, timestamp: string, label: string, rowCounts: Record<string, number> }}
 */
export function takeSnapshot(label) {
    mkdirSync(BACKUP_DIR, { recursive: true });
    const now = new Date();
    const ts = now.toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
    const safeLabel = label.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40);
    const filename = `${AUDIT_PREFIX}${safeLabel}-${ts}.sqlite`;
    const metaFilename = `${AUDIT_PREFIX}${safeLabel}-${ts}.json`;
    const dest = join(BACKUP_DIR, filename);

    copyFileSync(DB_PATH, dest);

    // Gather row counts from the snapshot
    const snapDb = new Database(dest, { readonly: true });
    /** @type {Record<string, number>} */
    const rowCounts = {};
    for (const table of AUDIT_TABLES) {
        try {
            const row = snapDb.prepare(`SELECT COUNT(*) as cnt FROM ${table}`).get();
            rowCounts[table] = /** @type {any} */ (row)?.cnt ?? 0;
        } catch {
            rowCounts[table] = -1; // table doesn't exist
        }
    }
    snapDb.close();

    const meta = {
        filename,
        timestamp: now.toISOString(),
        label: safeLabel,
        rowCounts,
        sizeBytes: statSync(dest).size,
    };
    writeFileSync(join(BACKUP_DIR, metaFilename), JSON.stringify(meta, null, 2));

    console.log(`[audit] Snapshot "${safeLabel}" created: ${filename}`);
    return meta;
}

/**
 * List all audit snapshots.
 * @returns {Array<{ filename: string, timestamp: string, label: string, rowCounts: Record<string, number>, sizeBytes: number }>}
 */
export function listSnapshots() {
    mkdirSync(BACKUP_DIR, { recursive: true });
    const jsonFiles = readdirSync(BACKUP_DIR).filter(f => f.startsWith(AUDIT_PREFIX) && f.endsWith('.json'));

    return jsonFiles.map(f => {
        try {
            return JSON.parse(readFileSync(join(BACKUP_DIR, f), 'utf-8'));
        } catch {
            return null;
        }
    }).filter(Boolean).sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
}

/**
 * Delete an audit snapshot (both .sqlite and .json).
 * @param {string} filename — the .sqlite filename
 * @returns {{ success: boolean, error?: string }}
 */
export function deleteSnapshot(filename) {
    if (!filename.startsWith(AUDIT_PREFIX) || !filename.endsWith('.sqlite')) {
        return { success: false, error: 'Invalid audit filename' };
    }
    const sqlitePath = join(BACKUP_DIR, filename);
    const jsonPath = join(BACKUP_DIR, filename.replace('.sqlite', '.json'));

    if (existsSync(sqlitePath)) unlinkSync(sqlitePath);
    if (existsSync(jsonPath)) unlinkSync(jsonPath);

    console.log(`[audit] Deleted snapshot: ${filename}`);
    return { success: true };
}

/**
 * @typedef {{
 *   table: string,
 *   beforeCount: number,
 *   afterCount: number,
 *   added: number,
 *   deleted: number,
 *   modified: number,
 *   samples: Array<{ type: 'added'|'deleted'|'modified', id: any, label?: string, before?: any, after?: any }>
 * }} TableDiff
 */

/**
 * Extract a human-readable label from a row object.
 * Tries title, name, track_name, then a few other common columns.
 * @param {any} row
 * @param {string} table
 * @returns {string}
 */
function resolveLabel(row, table) {
    if (!row) return '';
    // media_children: include parent context if available
    if (row.title) return row.title;
    if (row.name) return row.name;
    if (row.track_name) return row.track_name;
    if (row.source && row.timestamp) return `${row.source} @ ${row.timestamp}`;
    return '';
}

/**
 * Compare two audit snapshots and return per-table diffs.
 * @param {string} beforeFilename
 * @param {string} afterFilename
 * @returns {{ diffs: TableDiff[], error?: string }}
 */
export function compareSnapshots(beforeFilename, afterFilename) {
    const beforePath = join(BACKUP_DIR, beforeFilename);
    const afterPath = join(BACKUP_DIR, afterFilename);

    if (!existsSync(beforePath)) return { diffs: [], error: `Before snapshot not found: ${beforeFilename}` };
    if (!existsSync(afterPath)) return { diffs: [], error: `After snapshot not found: ${afterFilename}` };

    const beforeDb = new Database(beforePath, { readonly: true });
    const afterDb = new Database(afterPath, { readonly: true });

    /** @type {TableDiff[]} */
    const diffs = [];

    for (const table of AUDIT_TABLES) {
        try {
            const diff = diffTable(beforeDb, afterDb, table);
            diffs.push(diff);
        } catch (e) {
            diffs.push({
                table,
                beforeCount: -1,
                afterCount: -1,
                added: 0,
                deleted: 0,
                modified: 0,
                samples: [],
            });
        }
    }

    beforeDb.close();
    afterDb.close();

    return { diffs };
}

/**
 * Diff a single table between two databases.
 * @param {import('better-sqlite3').Database} beforeDb
 * @param {import('better-sqlite3').Database} afterDb
 * @param {string} table
 * @returns {TableDiff}
 */
function diffTable(beforeDb, afterDb, table) {
    // Get row counts
    const beforeCount = /** @type {any} */ (beforeDb.prepare(`SELECT COUNT(*) as cnt FROM ${table}`).get())?.cnt ?? 0;
    const afterCount = /** @type {any} */ (afterDb.prepare(`SELECT COUNT(*) as cnt FROM ${table}`).get())?.cnt ?? 0;

    // Determine the primary key column
    const pkCol = getPrimaryKey(beforeDb, table);

    /** @type {Array<{ type: 'added'|'deleted'|'modified', id: any, before?: any, after?: any }>} */
    const samples = [];
    let added = 0, deleted = 0, modified = 0;

    if (pkCol) {
        // Build maps of id → row hash for efficient diffing
        const beforeIds = new Set();
        const afterIds = new Set();

        const beforeRows = /** @type {any[]} */ (beforeDb.prepare(`SELECT * FROM ${table}`).all());
        const afterRows = /** @type {any[]} */ (afterDb.prepare(`SELECT * FROM ${table}`).all());

        /** @type {Map<string, any>} */
        const beforeMap = new Map();
        /** @type {Map<string, any>} */
        const afterMap = new Map();

        for (const row of beforeRows) {
            const id = String(row[pkCol]);
            beforeIds.add(id);
            beforeMap.set(id, row);
        }
        for (const row of afterRows) {
            const id = String(row[pkCol]);
            afterIds.add(id);
            afterMap.set(id, row);
        }

        // Find added rows
        for (const id of afterIds) {
            if (!beforeIds.has(id)) {
                added++;
                if (samples.length < 10) {
                    const row = afterMap.get(id);
                    samples.push({ type: 'added', id, label: resolveLabel(row, table), after: row });
                }
            }
        }

        // Find deleted rows
        for (const id of beforeIds) {
            if (!afterIds.has(id)) {
                deleted++;
                if (samples.length < 10) {
                    const row = beforeMap.get(id);
                    samples.push({ type: 'deleted', id, label: resolveLabel(row, table), before: row });
                }
            }
        }

        // Find modified rows (present in both, but content differs)
        for (const id of beforeIds) {
            if (afterIds.has(id)) {
                const bRow = beforeMap.get(id);
                const aRow = afterMap.get(id);
                if (JSON.stringify(bRow) !== JSON.stringify(aRow)) {
                    modified++;
                    if (samples.length < 10) {
                        // Only include changed fields
                        const changedFields = {};
                        for (const key of Object.keys(aRow)) {
                            if (JSON.stringify(bRow[key]) !== JSON.stringify(aRow[key])) {
                                changedFields[key] = { before: bRow[key], after: aRow[key] };
                            }
                        }
                        samples.push({ type: 'modified', id, label: resolveLabel(aRow, table), before: changedFields, after: changedFields });
                    }
                }
            }
        }
    } else {
        // No primary key — just report counts
        added = Math.max(0, afterCount - beforeCount);
        deleted = Math.max(0, beforeCount - afterCount);
    }

    return { table, beforeCount, afterCount, added, deleted, modified, samples };
}

/**
 * Get the primary key column name for a table.
 * @param {import('better-sqlite3').Database} database
 * @param {string} table
 * @returns {string|null}
 */
function getPrimaryKey(database, table) {
    try {
        const info = /** @type {any[]} */ (database.prepare(`PRAGMA table_info(${table})`).all());
        const pk = info.find(col => col.pk === 1);
        return pk ? pk.name : 'id'; // fallback to 'id'
    } catch {
        return 'id';
    }
}
