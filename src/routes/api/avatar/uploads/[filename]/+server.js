import { error } from '@sveltejs/kit';
import { readFileSync, existsSync } from 'fs';
import { resolve, join, dirname } from 'path';

// Must match the path used in the avatar upload endpoint
const DB_PATH = process.env.DATABASE_PATH || resolve(process.cwd(), 'mediajam.sqlite');
const UPLOAD_DIR = resolve(dirname(DB_PATH), 'uploads', 'avatars');

/** @type {import('./$types').RequestHandler} */
export async function GET({ params }) {
    const filename = params.filename;

    // Sanitize filename to prevent path traversal
    if (filename.includes('..') || filename.includes('/')) {
        throw error(400, 'Invalid filename');
    }

    const filepath = join(UPLOAD_DIR, filename);

    if (!existsSync(filepath)) {
        throw error(404, 'Not found');
    }

    const file = readFileSync(filepath);
    const ext = filename.split('.').pop()?.toLowerCase();
    const mimeTypes = {
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        png: 'image/png',
        gif: 'image/gif',
        webp: 'image/webp'
    };

    return new Response(file, {
        headers: {
            'Content-Type': mimeTypes[ext] || 'application/octet-stream',
            'Cache-Control': 'public, max-age=31536000, immutable'
        }
    });
}
