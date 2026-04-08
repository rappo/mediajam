import { json } from '@sveltejs/kit';
import db from '$lib/server/db.js';
import { clearCache } from '$lib/server/image-cache.js';
import { unlinkSync } from 'fs';
import { resolve } from 'path';

/**
 * POST /api/factory-reset — Wipe the database and reset to fresh install state.
 * Requires admin privileges and confirmation phrase "goodbye" in the request body.
 * After deleting the DB, the process exits so Docker (or the user) can restart it fresh.
 * @type {import('./$types').RequestHandler}
 */
export async function POST({ request, locals }) {
    // Admin check
    const user = locals.user;
    if (!user) {
        return json({ error: 'Not authenticated.' }, { status: 401 });
    }
    const dbUser = /** @type {any} */ (db.prepare('SELECT is_admin FROM users WHERE id = ?').get(user.id));
    if (!dbUser?.is_admin) {
        return json({ error: 'Admin access required.' }, { status: 403 });
    }

    const { confirmation } = await request.json();

    if (confirmation !== 'goodbye') {
        return json({ error: 'Invalid confirmation phrase.' }, { status: 400 });
    }

    try {
        const dbPath = process.env.DATABASE_PATH || resolve(process.cwd(), 'mediajam.sqlite');

        // Close the database connection
        db.close();

        // Delete the database file and WAL/SHM files
        for (const suffix of ['', '-wal', '-shm']) {
            try {
                unlinkSync(dbPath + suffix);
            } catch {
                // File may not exist, that's fine
            }
        }

        // Clear the image cache
        clearCache();

        console.log('[factory-reset] Database deleted. Process will exit in 1s for clean restart.');

        // Schedule process exit after the response is sent.
        // Docker's restart policy (or the dev server) will bring it back with a fresh DB.
        setTimeout(() => {
            process.exit(0);
        }, 1000);

        return json({ success: true, message: 'Factory reset complete. Server restarting...' });
    } catch (e) {
        console.error('[factory-reset] Error:', e);
        return json({ error: 'Factory reset failed: ' + (e instanceof Error ? e.message : String(e)) }, { status: 500 });
    }
}
