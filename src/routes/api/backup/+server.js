import { json } from '@sveltejs/kit';
import archiver from 'archiver';
import db from '$lib/server/db.js';
import fs from 'fs';
import path from 'path';
import { PassThrough, Readable } from 'stream';

/**
 * A Node Readable that streams a table as a pretty-printed JSON array, one row
 * at a time via better-sqlite3's iterator — so the full table is never
 * materialized in memory (the old code held every table + a per-table string
 * simultaneously, ~700MB on a large DB).
 * @param {import('better-sqlite3').Statement} stmt
 * @param {(row: any) => any} [transform] — per-row transform; return undefined to skip
 */
function tableJsonStream(stmt, transform) {
    async function* gen() {
        yield '[';
        let first = true;
        for (const row of stmt.iterate()) {
            const out = transform ? transform(row) : row;
            if (out === undefined) continue;
            yield (first ? '\n  ' : ',\n  ') + JSON.stringify(out);
            first = false;
        }
        yield first ? ']\n' : '\n]\n';
    }
    return Readable.from(gen());
}

/**
 * GET /api/backup — Export all data as a ZIP file.
 * Query params:
 *   includePasswords=1  — include password hashes
 *   includeTokens=1     — include access tokens
 *   includeApiKeys=1    — include API keys
 * @type {import('./$types').RequestHandler}
 */
export async function GET({ url, locals }) {
    if (!locals.user?.isAdmin) {
        return json({ error: 'Admin access required' }, { status: 403 });
    }

    const includePasswords = url.searchParams.get('includePasswords') === '1';
    const includeTokens = url.searchParams.get('includeTokens') === '1';
    const includeApiKeys = url.searchParams.get('includeApiKeys') === '1';
    const includeImages = url.searchParams.get('includeImages') === '1';

    const now = new Date(); const ts = `${now.toISOString().split('T')[0]}_${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}`;
    const prefix = `mediajam-backup-${ts}`;

    // Per-row transforms for the tables that strip sensitive fields.
    const stripSettings = (/** @type {any} */ s) => {
        if (!includeApiKeys) {
            for (const k of ['tvdb_api_key', 'tmdb_api_key', 'musicbrainz_api_key', 'trakt_client_id',
                'trakt_client_secret', 'lastfm_api_key', 'lastfm_shared_secret', 'omdb_api_key',
                'discogs_token', 'radarr_api_key', 'sonarr_api_key', 'lidarr_api_key']) delete s[k];
        }
        if (!includeTokens) delete s.jellyfin_access_token;
        return s;
    };
    const stripUser = (/** @type {any} */ u) => {
        if (!includePasswords) delete u.password_hash;
        return u;
    };
    const stripIdentity = (/** @type {any} */ i) => {
        if (!includeTokens) { delete i.access_token; delete i.refresh_token; }
        return i;
    };
    const embeddingRow = (/** @type {any} */ r) => ({
        media_parent_id: r.media_parent_id,
        overview_embedding: JSON.stringify(Array.from(new Float32Array(r.overview_embedding.buffer || r.overview_embedding)))
    });

    // [table name, SELECT sql, per-row transform] — order defines archive order.
    // Every table streams row-by-row (constant memory) instead of materializing.
    /** @type {[string, string, ((row: any) => any)?][]} */
    const tableSpecs = [
        ['app_settings', 'SELECT * FROM app_settings WHERE id = 1', stripSettings],
        ['users', 'SELECT * FROM users', stripUser],
        ['user_identities', 'SELECT * FROM user_identities', stripIdentity],
        ['libraries', 'SELECT * FROM libraries'],
        ['media_parents', 'SELECT * FROM media_parents'],
        ['media_children', 'SELECT * FROM media_children'],
        ['tracks', 'SELECT * FROM tracks'],
        ['playback_history', 'SELECT * FROM playback_history'],
        ['lastfm_scrobbles', 'SELECT * FROM lastfm_scrobbles'],
        ['sync_state', 'SELECT * FROM sync_state'],
        ['persons', 'SELECT * FROM persons'],
        ['person_credits', 'SELECT * FROM person_credits'],
        ['external_ids', 'SELECT * FROM external_ids'],
        ['trakt_history', 'SELECT * FROM trakt_history'],
        ['sync_history', 'SELECT * FROM sync_history'],
        ['media_tags', 'SELECT * FROM media_tags'],
        ['reconcile_runs', 'SELECT * FROM reconcile_runs'],
        ['sync_conflicts', 'SELECT * FROM sync_conflicts'],
        ['discovered_media', 'SELECT * FROM discovered_media'],
        ['discovered_credits', 'SELECT * FROM discovered_credits'],
        ['external_ratings', 'SELECT * FROM external_ratings'],
        ['watchlist', 'SELECT * FROM watchlist'],
        ['activity_log', 'SELECT * FROM activity_log'],
        ['arr_events', 'SELECT * FROM arr_events'],
        ['embedding_hashes', 'SELECT * FROM embedding_hashes'],
        ['overview_embeddings', 'SELECT media_parent_id, overview_embedding FROM overview_embeddings', embeddingRow],
    ];

    // Build manifest counts with cheap COUNT(*) — no row materialization.
    /** @type {Record<string, number>} */
    const counts = {};
    for (const [name, sql] of tableSpecs) {
        try {
            const from = sql.replace(/^SELECT .*? FROM /i, 'SELECT COUNT(*) AS c FROM ');
            counts[name] = /** @type {any} */ (db.prepare(from).get())?.c ?? 0;
        } catch { counts[name] = 0; }
    }

    const manifest = {
        version: 1,
        exportDate: new Date().toISOString(),
        generator: 'mediajam',
        includes: { passwords: includePasswords, tokens: includeTokens, apiKeys: includeApiKeys },
        counts,
    };

    // Create ZIP archive
    const archive = archiver('zip', { zlib: { level: 6 } });
    const passThrough = new PassThrough();
    archive.pipe(passThrough);

    // Add manifest
    archive.append(JSON.stringify(manifest, null, 2), { name: `${prefix}/manifest.json` });

    // Add each table as a row-streamed JSON file
    for (const [name, sql, transform] of tableSpecs) {
        try {
            archive.append(tableJsonStream(db.prepare(sql), transform), { name: `${prefix}/data/${name}.json` });
        } catch {
            archive.append('[]\n', { name: `${prefix}/data/${name}.json` });
        }
    }

    // Add avatar uploads
    const uploadsDir = path.resolve('uploads/avatars');
    if (fs.existsSync(uploadsDir)) {
        const files = fs.readdirSync(uploadsDir);
        for (const file of files) {
            const filePath = path.join(uploadsDir, file);
            if (fs.statSync(filePath).isFile()) {
                archive.file(filePath, { name: `${prefix}/uploads/avatars/${file}` });
            }
        }
    }

    // Add cached images if opted in
    if (includeImages) {
        const cacheDir = path.resolve('cache/images');
        if (fs.existsSync(cacheDir)) {
            const files = fs.readdirSync(cacheDir);
            for (const file of files) {
                const filePath = path.join(cacheDir, file);
                if (fs.statSync(filePath).isFile()) {
                    archive.file(filePath, { name: `${prefix}/cache/images/${file}` });
                }
            }
        }
    }

    archive.finalize();

    // Convert Node stream to Web ReadableStream, honoring backpressure so a slow
    // client can't make us buffer the whole ZIP in the controller queue.
    const readable = new ReadableStream({
        start(controller) {
            passThrough.on('data', (chunk) => {
                controller.enqueue(chunk);
                if (controller.desiredSize !== null && controller.desiredSize <= 0) {
                    passThrough.pause();
                }
            });
            passThrough.on('end', () => controller.close());
            passThrough.on('error', (err) => controller.error(err));
        },
        pull() {
            passThrough.resume();
        },
        cancel() {
            passThrough.destroy();
            archive.destroy();
        }
    });

    return new Response(readable, {
        headers: {
            'Content-Type': 'application/zip',
            'Content-Disposition': `attachment; filename="${prefix}.zip"`,
            'Cache-Control': 'no-store'
        }
    });
}
