import { json } from '@sveltejs/kit';
import db from '$lib/server/db.js';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { resolve, join, dirname } from 'path';

// Store avatars in the same persistent directory as the database
const DB_PATH = process.env.DATABASE_PATH || resolve(process.cwd(), 'mediajam.sqlite');
const UPLOAD_DIR = resolve(dirname(DB_PATH), 'uploads', 'avatars');

// Ensure upload directory exists
if (!existsSync(UPLOAD_DIR)) {
    mkdirSync(UPLOAD_DIR, { recursive: true });
}

/** @type {import('./$types').RequestHandler} */
export async function POST({ request, locals }) {
    if (!locals.user) {
        return json({ error: 'Unauthorized' }, { status: 401 });
    }

    const contentType = request.headers.get('content-type') || '';

    if (contentType.includes('application/json')) {
        // Icon selection (just a string like "icon:star-face")
        const { avatarUrl } = await request.json();
        db.prepare('UPDATE users SET avatar_url = ? WHERE id = ?').run(avatarUrl, locals.user.id);
        return json({ success: true, avatarUrl });
    }

    if (contentType.includes('multipart/form-data')) {
        // Image upload
        const formData = await request.formData();
        const file = /** @type {File} */ (formData.get('avatar'));

        if (!file || !file.size) {
            return json({ error: 'No file provided' }, { status: 400 });
        }

        // Validate file type
        const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
        if (!allowedTypes.includes(file.type)) {
            return json({ error: 'Invalid file type. Use JPEG, PNG, GIF, or WebP.' }, { status: 400 });
        }

        // Max 2MB
        if (file.size > 2 * 1024 * 1024) {
            return json({ error: 'File too large. Max 2MB.' }, { status: 400 });
        }

        const ext = file.type.split('/')[1].replace('jpeg', 'jpg');
        const filename = `${locals.user.id}-${Date.now()}.${ext}`;
        const filepath = join(UPLOAD_DIR, filename);

        const buffer = Buffer.from(await file.arrayBuffer());
        writeFileSync(filepath, buffer);

        const avatarUrl = `/api/avatar/uploads/${filename}`;
        db.prepare('UPDATE users SET avatar_url = ? WHERE id = ?').run(avatarUrl, locals.user.id);

        return json({ success: true, avatarUrl });
    }

    return json({ error: 'Invalid request' }, { status: 400 });
}

/** @type {import('./$types').RequestHandler} */
export async function DELETE({ locals }) {
    if (!locals.user) {
        return json({ error: 'Unauthorized' }, { status: 401 });
    }

    db.prepare('UPDATE users SET avatar_url = NULL WHERE id = ?').run(locals.user.id);
    return json({ success: true });
}
