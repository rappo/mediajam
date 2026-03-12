/**
 * POST /api/backups/restore — restore from a backup file
 */
import { json } from '@sveltejs/kit';
import { restoreBackup } from '$lib/server/backup-engine.js';

/** @type {import('./$types').RequestHandler} */
export async function POST({ request }) {
    try {
        const { filename } = await request.json();
        if (!filename) {
            return json({ error: 'filename is required' }, { status: 400 });
        }

        const result = restoreBackup(filename);
        if (!result.success) {
            return json({ error: result.error }, { status: 400 });
        }

        // Schedule a process exit after a short delay so the response can be sent
        setTimeout(() => {
            console.log('[backup] Restarting server after restore...');
            process.exit(0);
        }, 500);

        return json({ success: true, message: 'Restored successfully. Server is restarting...' });
    } catch (e) {
        return json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
    }
}
