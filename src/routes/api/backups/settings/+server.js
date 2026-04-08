/**
 * PUT /api/backups/settings — update backup settings
 */
import { json } from '@sveltejs/kit';
import { updateBackupSettings, restartBackupScheduler } from '$lib/server/backup-engine.js';

/** @type {import('./$types').RequestHandler} */
export async function PUT({ request }) {
    try {
        const body = await request.json();
        updateBackupSettings({
            backupEnabled: body.backupEnabled,
            backupFrequency: body.backupFrequency,
            backupTime: body.backupTime,
            backupKeepCount: body.backupKeepCount,
            backupOnBoot: body.backupOnBoot,
            bootBackupKeepCount: body.bootBackupKeepCount,
        });
        // Restart the scheduler with new settings
        restartBackupScheduler();
        return json({ success: true });
    } catch (e) {
        return json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
    }
}
