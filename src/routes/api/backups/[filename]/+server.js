/**
 * DELETE /api/backups/[filename] — delete a manual backup
 */
import { json } from '@sveltejs/kit';
import { deleteBackup } from '$lib/server/backup-engine.js';

/** @type {import('./$types').RequestHandler} */
export function DELETE({ params }) {
    const { filename } = params;
    const result = deleteBackup(filename);

    if (!result.success) {
        return json({ error: result.error }, { status: 400 });
    }

    return json({ success: true });
}
