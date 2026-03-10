import db from '$lib/server/db.js';
import { json, error } from '@sveltejs/kit';
import { randomBytes, createHash } from 'crypto';

const VALID_PERMISSIONS = ['read:media', 'write:media', 'read:sync', 'write:sync', 'admin'];

/** @type {import('./$types').RequestHandler} */
export async function GET({ locals }) {
    if (!locals.user) throw error(401, 'Unauthorized');

    // Admins see all keys, regular users see only their own
    const keys = locals.user.isAdmin
        ? /** @type {any[]} */ (db.prepare(`
            SELECT ak.id, ak.name, ak.key_prefix, ak.permissions, ak.last_used_at,
                   ak.created_at, ak.expires_at, u.username as owner
            FROM api_keys ak
            JOIN users u ON ak.user_id = u.id
            ORDER BY ak.created_at DESC
        `).all())
        : /** @type {any[]} */ (db.prepare(`
            SELECT id, name, key_prefix, permissions, last_used_at, created_at, expires_at
            FROM api_keys WHERE user_id = ?
            ORDER BY created_at DESC
        `).all(locals.user.id));

    return json({
        keys: keys.map(k => ({
            ...k,
            permissions: JSON.parse(k.permissions || '[]')
        }))
    });
}

/** @type {import('./$types').RequestHandler} */
export async function POST({ request, locals }) {
    if (!locals.user?.isAdmin) throw error(403, 'Admin access required');

    const body = await request.json();
    const { name, permissions, expiresAt } = body;

    if (!name?.trim()) throw error(400, 'Name is required');
    if (!Array.isArray(permissions) || permissions.length === 0) {
        throw error(400, 'At least one permission is required');
    }

    // Validate permissions
    for (const perm of permissions) {
        if (!VALID_PERMISSIONS.includes(perm)) {
            throw error(400, `Invalid permission: ${perm}`);
        }
    }

    // Generate key: mj_ + 48 random bytes (base64url)
    const rawKey = randomBytes(48).toString('base64url');
    const fullKey = `mj_${rawKey}`;
    const keyHash = createHash('sha256').update(fullKey).digest('hex');
    const keyPrefix = `mj_${rawKey.substring(0, 8)}`;

    // Validate expiry if provided
    let expiresAtValue = null;
    if (expiresAt) {
        const d = new Date(expiresAt);
        if (isNaN(d.getTime())) throw error(400, 'Invalid expiry date');
        expiresAtValue = d.toISOString();
    }

    const result = db.prepare(`
        INSERT INTO api_keys (user_id, name, key_hash, key_prefix, permissions, expires_at)
        VALUES (?, ?, ?, ?, ?, ?)
    `).run(
        locals.user.id,
        name.trim(),
        keyHash,
        keyPrefix,
        JSON.stringify(permissions),
        expiresAtValue
    );

    return json({
        id: result.lastInsertRowid,
        name: name.trim(),
        key: fullKey,  // Only returned ONCE at creation
        keyPrefix,
        permissions,
        expiresAt: expiresAtValue,
        createdAt: new Date().toISOString()
    }, { status: 201 });
}
