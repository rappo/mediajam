/**
 * GET /api/backups/download/[filename] — download a backup file
 */
import { getBackupFilePath } from '$lib/server/backup-engine.js';
import { readFileSync } from 'fs';

/** @type {import('./$types').RequestHandler} */
export function GET({ params }) {
    const { filename } = params;
    const filepath = getBackupFilePath(filename);

    if (!filepath) {
        return new Response('Backup not found', { status: 404 });
    }

    const fileBuffer = readFileSync(filepath);

    return new Response(fileBuffer, {
        headers: {
            'Content-Type': 'application/x-sqlite3',
            'Content-Disposition': `attachment; filename="${filename}"`,
            'Content-Length': String(fileBuffer.length),
        },
    });
}
