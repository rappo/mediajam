/**
 * GET /api/backups — list all backups and settings
 * POST /api/backups — create a manual backup
 */
import { json } from '@sveltejs/kit';
import { listBackups, createBackup, getBackupSettings } from '$lib/server/backup-engine.js';

/** @type {import('./$types').RequestHandler} */
export function GET() {
    try {
        const backups = listBackups();
        const settings = getBackupSettings();
        return json({ backups, settings });
    } catch (e) {
        return json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
    }
}

/** @type {import('./$types').RequestHandler} */
export function POST() {
    try {
        const backup = createBackup('manual');
        return json({ success: true, backup });
    } catch (e) {
        return json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
    }
}
