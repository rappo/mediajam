/**
 * Backup Engine — manages SQLite database backups.
 *
 * Backup types:
 *   - boot:   created automatically on server start
 *   - auto:   created on a schedule (daily, every other day, etc.)
 *   - manual: created on-demand by the user
 *
 * All backups live in backups/ subdirectory of the appdata folder.
 * Files are named: mediajam-{type}-{YYYY-MM-DD_HH-MM-SS}.sqlite
 */

import { dirname, join, basename } from 'path';
import { existsSync, copyFileSync, unlinkSync, readdirSync, statSync, mkdirSync } from 'fs';
import Database from 'better-sqlite3';
import { DB_PATH } from '$lib/server/db.js';
import db from '$lib/server/db.js';

// ── Paths ───────────────────────────────────────────────────────────────────

export const BACKUP_DIR = join(dirname(DB_PATH), 'backups');

// ── Shared Lock (coordinates pipeline ↔ backup) ────────────────────────────

/** @type {string|null} */
let lockHolder = null;

/**
 * Acquire a named lock. Polls every 2 s until free.
 * @param {string} holder — e.g. 'pipeline' or 'backup'
 */
export async function acquireLock(holder) {
    while (lockHolder && lockHolder !== holder) {
        console.log(`[lock] ${holder} waiting for ${lockHolder} to release...`);
        await new Promise(r => setTimeout(r, 2000));
    }
    lockHolder = holder;
}

/**
 * Release a named lock.
 * @param {string} holder
 */
export function releaseLock(holder) {
    if (lockHolder === holder) lockHolder = null;
}

/** Ensure the backup directory exists. */
function ensureDir() {
    mkdirSync(BACKUP_DIR, { recursive: true });
}

// ── Settings ────────────────────────────────────────────────────────────────

/**
 * Read backup settings from the database.
 * @returns {{
 *   backupEnabled: boolean,
 *   backupFrequency: string,
 *   backupTime: string,
 *   backupKeepCount: number,
 *   backupOnBoot: boolean,
 *   bootBackupKeepCount: number,
 *   backupTimelineEpoch: string | null,
 *   backupIncludeImages: boolean
 * }}
 */
export function getBackupSettings() {
    const row = /** @type {any} */ (db.prepare(`
        SELECT backup_enabled, backup_frequency, backup_time, backup_keep_count,
               backup_on_boot, boot_backup_keep_count, backup_timeline_epoch,
               backup_include_images
        FROM app_settings WHERE id = 1
    `).get());
    return {
        backupEnabled: (row?.backup_enabled ?? 1) !== 0,
        backupFrequency: row?.backup_frequency || 'daily',
        backupTime: row?.backup_time || '05:00',
        backupKeepCount: row?.backup_keep_count ?? 7,
        backupOnBoot: (row?.backup_on_boot ?? 1) !== 0,
        bootBackupKeepCount: row?.boot_backup_keep_count ?? 3,
        backupTimelineEpoch: row?.backup_timeline_epoch || null,
        backupIncludeImages: (row?.backup_include_images ?? 0) !== 0,
    };
}

/**
 * Update backup settings.
 * @param {Partial<ReturnType<typeof getBackupSettings>>} settings
 */
export function updateBackupSettings(settings) {
    const cols = [];
    const vals = [];
    if (settings.backupEnabled !== undefined) { cols.push('backup_enabled = ?'); vals.push(settings.backupEnabled ? 1 : 0); }
    if (settings.backupFrequency !== undefined) { cols.push('backup_frequency = ?'); vals.push(settings.backupFrequency); }
    if (settings.backupTime !== undefined) { cols.push('backup_time = ?'); vals.push(settings.backupTime); }
    if (settings.backupKeepCount !== undefined) { cols.push('backup_keep_count = ?'); vals.push(settings.backupKeepCount); }
    if (settings.backupOnBoot !== undefined) { cols.push('backup_on_boot = ?'); vals.push(settings.backupOnBoot ? 1 : 0); }
    if (settings.bootBackupKeepCount !== undefined) { cols.push('boot_backup_keep_count = ?'); vals.push(settings.bootBackupKeepCount); }
    if (settings.backupTimelineEpoch !== undefined) { cols.push('backup_timeline_epoch = ?'); vals.push(settings.backupTimelineEpoch); }
    if (settings.backupIncludeImages !== undefined) { cols.push('backup_include_images = ?'); vals.push(settings.backupIncludeImages ? 1 : 0); }
    if (cols.length === 0) return;
    db.prepare(`UPDATE app_settings SET ${cols.join(', ')} WHERE id = 1`).run(...vals);
}

// ── Backup CRUD ─────────────────────────────────────────────────────────────

/**
 * @typedef {{ filename: string, type: 'boot'|'auto'|'manual', timestamp: string, sizeBytes: number, isHidden: boolean }} BackupEntry
 */

/**
 * Create a new backup.
 * @param {'boot'|'auto'|'manual'} type
 * @returns {BackupEntry}
 */
export function createBackup(type) {
    ensureDir();
    const now = new Date();
    const ts = now.toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
    const filename = `mediajam-${type}-${ts}.sqlite`;
    const dest = join(BACKUP_DIR, filename);
    copyFileSync(DB_PATH, dest);
    const stat = statSync(dest);
    console.log(`[backup] Created ${type} backup: ${filename} (${(stat.size / 1024 / 1024).toFixed(1)} MB)`);
    return {
        filename,
        type,
        timestamp: now.toISOString(),
        sizeBytes: stat.size,
        isHidden: false,
    };
}

/**
 * List all backups, sorted newest first.
 * Marks entries as hidden if they fall in the diverging timeline window.
 * @returns {BackupEntry[]}
 */
export function listBackups() {
    ensureDir();
    const { backupTimelineEpoch } = getBackupSettings();
    const files = readdirSync(BACKUP_DIR).filter(f => f.startsWith('mediajam-') && f.endsWith('.sqlite'));

    /** @type {BackupEntry[]} */
    const backups = [];
    for (const filename of files) {
        const stat = statSync(join(BACKUP_DIR, filename));
        const type = parseType(filename);
        const timestamp = parseTimestamp(filename) || stat.mtime.toISOString();

        // Determine if this backup is "hidden" due to diverging timeline
        let isHidden = false;
        if (backupTimelineEpoch) {
            // Backups created BEFORE the epoch that are NOT the restored-from backup
            // are auto/boot backups from the "old" timeline — hide them
            // Specifically: backups whose timestamp is after the restored-from backup
            // but before the epoch (restore time) are from the diverged timeline
            const epochDate = new Date(backupTimelineEpoch);
            const entryDate = new Date(timestamp);
            // "Hidden" means: created before the restore happened, but not the backup we restored from
            // The epoch marks when the restore happened — anything from before that but after
            // the restored backup is part of the old timeline
            if (entryDate < epochDate && type !== 'manual') {
                // Check if this backup was created after what we restored to
                // We approximate: anything between the epoch minus some buffer and epoch is old-timeline
                isHidden = true;
            }
        }

        backups.push({ filename, type, timestamp, sizeBytes: stat.size, isHidden });
    }

    // Sort newest first
    backups.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    return backups;
}

/**
 * Parse backup type from filename.
 * @param {string} filename
 * @returns {'boot'|'auto'|'manual'}
 */
function parseType(filename) {
    if (filename.includes('-boot-')) return 'boot';
    if (filename.includes('-auto-')) return 'auto';
    if (filename.includes('-manual-')) return 'manual';
    return 'auto'; // fallback
}

/**
 * Parse ISO timestamp from backup filename.
 * @param {string} filename
 * @returns {string|null}
 */
function parseTimestamp(filename) {
    // Extract the timestamp part: mediajam-{type}-{YYYY-MM-DD_HH-MM-SS}...sqlite
    const match = filename.match(/mediajam-(?:boot|auto|manual)-(\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2})/);
    if (!match) return null;
    // Convert back to ISO: 2026-03-12_05-00-00 → 2026-03-12T05:00:00Z
    const ts = match[1].replace('_', 'T').replace(/-/g, (m, offset) => {
        // First 2 dashes are date separators (keep as -), rest are time separators (→ :)
        // Format: YYYY-MM-DDTHH-MM-SS
        return offset > 9 ? ':' : '-';
    });
    return ts + 'Z';
}

/**
 * Delete a backup file. Only manual backups can be deleted.
 * @param {string} filename
 * @returns {{ success: boolean, error?: string }}
 */
export function deleteBackup(filename) {
    const type = parseType(filename);
    if (type !== 'manual') {
        return { success: false, error: 'Only manual backups can be deleted' };
    }
    const filepath = join(BACKUP_DIR, filename);
    if (!existsSync(filepath)) {
        return { success: false, error: 'Backup not found' };
    }
    // Safety: only allow known backup filenames
    if (!filename.startsWith('mediajam-') || !filename.endsWith('.sqlite')) {
        return { success: false, error: 'Invalid backup filename' };
    }
    unlinkSync(filepath);
    console.log(`[backup] Deleted manual backup: ${filename}`);
    return { success: true };
}

/**
 * Get full path for a backup file (for downloads/restores).
 * @param {string} filename
 * @returns {string|null}
 */
export function getBackupFilePath(filename) {
    if (!filename.startsWith('mediajam-') || !filename.endsWith('.sqlite')) return null;
    const filepath = join(BACKUP_DIR, filename);
    return existsSync(filepath) ? filepath : null;
}

/**
 * Restore from a backup file. Copies the backup over the active DB.
 * On restore, stamps backup_timeline_epoch so we can hide diverging backups.
 * After copying, the process should be restarted.
 * @param {string} filename
 * @returns {{ success: boolean, error?: string }}
 */
export function restoreBackup(filename) {
    const filepath = getBackupFilePath(filename);
    if (!filepath) {
        return { success: false, error: 'Backup not found' };
    }

    try {
        // Create a "pre-restore" backup so we can undo if needed
        createBackup('manual');

        // Stamp the timeline epoch BEFORE restoring so it's in the current DB
        const now = new Date().toISOString();

        // Close the DB connection before overwriting
        db.close();

        // Copy the backup over the active DB
        copyFileSync(filepath, DB_PATH);
        console.log(`[backup] Restored from: ${filename}`);

        // Re-open DB briefly to stamp the timeline epoch on the restored copy
        const tempDb = new Database(DB_PATH);
        try {
            // Try to add the column if it doesn't exist (restoring from old backup)
            try { tempDb.exec('ALTER TABLE app_settings ADD COLUMN backup_timeline_epoch TEXT'); } catch { /* already exists */ }
            tempDb.prepare('UPDATE app_settings SET backup_timeline_epoch = ? WHERE id = 1').run(now);
        } catch (e) {
            console.warn('[backup] Could not stamp timeline epoch:', e instanceof Error ? e.message : e);
        }
        tempDb.close();

        return { success: true };
    } catch (e) {
        return { success: false, error: e instanceof Error ? e.message : String(e) };
    }
}

/**
 * Prune backups of a given type, keeping only the newest N.
 * @param {'boot'|'auto'|'manual'} type
 * @param {number} keepCount
 * @returns {number} Number of backups deleted
 */
export function pruneBackups(type, keepCount) {
    ensureDir();
    const prefix = `mediajam-${type}-`;
    const files = readdirSync(BACKUP_DIR)
        .filter(f => f.startsWith(prefix) && f.endsWith('.sqlite'))
        .sort()
        .reverse(); // newest first

    let deleted = 0;
    if (files.length > keepCount) {
        for (const old of files.slice(keepCount)) {
            unlinkSync(join(BACKUP_DIR, old));
            console.log(`[backup] Pruned ${type} backup: ${old}`);
            deleted++;
        }
    }
    return deleted;
}

// ── Scheduler ───────────────────────────────────────────────────────────────

let schedulerTimeout = /** @type {ReturnType<typeof setTimeout>|null} */ (null);

/**
 * Calculate the next run time based on frequency and time settings.
 * @param {string} frequency - 'daily'|'every_other_day'|'twice_weekly'|'weekly'
 * @param {string} timeStr - 'HH:MM'
 * @returns {Date}
 */
function getNextRunTime(frequency, timeStr) {
    const [hours, minutes] = timeStr.split(':').map(Number);
    const now = new Date();
    const today = new Date(now);
    today.setHours(hours, minutes, 0, 0);

    // If today's run time hasn't passed yet, run today
    if (today > now) {
        return today;
    }

    // Otherwise, calculate next run
    const next = new Date(today);
    switch (frequency) {
        case 'daily':
            next.setDate(next.getDate() + 1);
            break;
        case 'every_other_day':
            next.setDate(next.getDate() + 2);
            break;
        case 'twice_weekly': {
            // Mon and Thu
            const day = next.getDay();
            if (day < 1) next.setDate(next.getDate() + 1); // Sun → Mon
            else if (day < 4) next.setDate(next.getDate() + (4 - day)); // Mon/Tue/Wed → Thu
            else next.setDate(next.getDate() + (8 - day)); // Thu-Sat → next Mon
            break;
        }
        case 'weekly':
            next.setDate(next.getDate() + 7);
            break;
        default:
            next.setDate(next.getDate() + 1);
    }
    return next;
}

/**
 * Run the automatic backup and schedule the next one.
 */
function runScheduledBackup() {
    try {
        const settings = getBackupSettings();
        if (!settings.backupEnabled) {
            console.log('[backup] Automatic backups disabled — skipping');
            return;
        }

        createBackup('auto');
        pruneBackups('auto', settings.backupKeepCount);

        // Schedule next
        scheduleNext();
    } catch (e) {
        console.error('[backup] Scheduled backup failed:', e instanceof Error ? e.message : e);
        // Still try to schedule the next one
        scheduleNext();
    }
}

/**
 * Schedule the next automatic backup.
 */
function scheduleNext() {
    if (schedulerTimeout) {
        clearTimeout(schedulerTimeout);
        schedulerTimeout = null;
    }

    const settings = getBackupSettings();
    if (!settings.backupEnabled) return;

    const nextRun = getNextRunTime(settings.backupFrequency, settings.backupTime);
    const delayMs = nextRun.getTime() - Date.now();

    console.log(`[backup] Next automatic backup scheduled for ${nextRun.toLocaleString()} (${Math.round(delayMs / 60000)}min)`);
    schedulerTimeout = setTimeout(runScheduledBackup, delayMs);
}

/**
 * Start the backup scheduler. Call on server boot after DB is ready.
 */
export function startBackupScheduler() {
    const settings = getBackupSettings();
    if (!settings.backupEnabled) {
        console.log('[backup] Automatic backups disabled');
        return;
    }
    scheduleNext();
}

/**
 * Restart the scheduler (after settings change).
 */
export function restartBackupScheduler() {
    if (schedulerTimeout) {
        clearTimeout(schedulerTimeout);
        schedulerTimeout = null;
    }
    startBackupScheduler();
}

/**
 * Stop the scheduler.
 */
export function stopBackupScheduler() {
    if (schedulerTimeout) {
        clearTimeout(schedulerTimeout);
        schedulerTimeout = null;
        console.log('[backup] Scheduler stopped');
    }
}
