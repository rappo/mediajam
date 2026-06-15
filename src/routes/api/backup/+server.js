import { json } from '@sveltejs/kit';
import archiver from 'archiver';
import db from '$lib/server/db.js';
import fs from 'fs';
import path from 'path';
import { PassThrough } from 'stream';

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

    // Collect all table data
    const tables = {};

    // app_settings — strip sensitive fields unless opted in
    const settings = /** @type {any} */ (db.prepare('SELECT * FROM app_settings WHERE id = 1').get());
    if (settings) {
        if (!includeApiKeys) {
            delete settings.tvdb_api_key;
            delete settings.tmdb_api_key;
            delete settings.musicbrainz_api_key;
            delete settings.trakt_client_id;
            delete settings.trakt_client_secret;
            delete settings.lastfm_api_key;
            delete settings.lastfm_shared_secret;
            delete settings.omdb_api_key;
            delete settings.discogs_token;
            delete settings.radarr_api_key;
            delete settings.sonarr_api_key;
            delete settings.lidarr_api_key;
        }
        // Always strip the Jellyfin access token from settings unless opted in
        if (!includeTokens) {
            delete settings.jellyfin_access_token;
        }
    }
    tables['app_settings'] = settings ? [settings] : [];

    // users — strip password hashes unless opted in
    const users = /** @type {any[]} */ (db.prepare('SELECT * FROM users').all());
    tables['users'] = users.map(u => {
        const copy = { ...u };
        if (!includePasswords) delete copy.password_hash;
        return copy;
    });

    // user_identities — strip tokens unless opted in
    const identities = /** @type {any[]} */ (db.prepare('SELECT * FROM user_identities').all());
    tables['user_identities'] = identities.map(i => {
        const copy = { ...i };
        if (!includeTokens) {
            delete copy.access_token;
            delete copy.refresh_token;
        }
        return copy;
    });

    // Simple table exports
    tables['libraries'] = db.prepare('SELECT * FROM libraries').all();
    tables['media_parents'] = db.prepare('SELECT * FROM media_parents').all();
    tables['media_children'] = db.prepare('SELECT * FROM media_children').all();
    tables['tracks'] = db.prepare('SELECT * FROM tracks').all();
    tables['playback_history'] = db.prepare('SELECT * FROM playback_history').all();
    tables['lastfm_scrobbles'] = db.prepare('SELECT * FROM lastfm_scrobbles').all();
    tables['sync_state'] = db.prepare('SELECT * FROM sync_state').all();
    tables['persons'] = db.prepare('SELECT * FROM persons').all();
    tables['person_credits'] = db.prepare('SELECT * FROM person_credits').all();
    tables['external_ids'] = db.prepare('SELECT * FROM external_ids').all();
    tables['trakt_history'] = db.prepare('SELECT * FROM trakt_history').all();
    tables['sync_history'] = db.prepare('SELECT * FROM sync_history').all();
    tables['media_tags'] = db.prepare('SELECT * FROM media_tags').all();
    tables['reconcile_runs'] = db.prepare('SELECT * FROM reconcile_runs').all();
    tables['sync_conflicts'] = db.prepare('SELECT * FROM sync_conflicts').all();
    tables['discovered_media'] = db.prepare('SELECT * FROM discovered_media').all();
    tables['discovered_credits'] = db.prepare('SELECT * FROM discovered_credits').all();
    tables['external_ratings'] = db.prepare('SELECT * FROM external_ratings').all();
    tables['watchlist'] = db.prepare('SELECT * FROM watchlist').all();
    tables['activity_log'] = db.prepare('SELECT * FROM activity_log').all();
    tables['arr_events'] = db.prepare('SELECT * FROM arr_events').all();
    try { tables['embedding_hashes'] = db.prepare('SELECT * FROM embedding_hashes').all(); } catch { tables['embedding_hashes'] = []; }
    // vec0 virtual table — export embeddings as JSON arrays for portability
    try {
        const rows = /** @type {any[]} */ (db.prepare('SELECT media_parent_id, overview_embedding FROM overview_embeddings').all());
        tables['overview_embeddings'] = rows.map(r => ({
            media_parent_id: r.media_parent_id,
            overview_embedding: JSON.stringify(Array.from(new Float32Array(r.overview_embedding.buffer || r.overview_embedding)))
        }));
    } catch { tables['overview_embeddings'] = []; }

    // Build manifest
    const manifest = {
        version: 1,
        exportDate: new Date().toISOString(),
        generator: 'mediajam',
        includes: {
            passwords: includePasswords,
            tokens: includeTokens,
            apiKeys: includeApiKeys
        },
        counts: {}
    };
    for (const [name, rows] of Object.entries(tables)) {
        manifest.counts[name] = /** @type {any[]} */ (rows).length;
    }

    // Create ZIP archive
    const archive = archiver('zip', { zlib: { level: 6 } });
    const passThrough = new PassThrough();
    archive.pipe(passThrough);

    // Add manifest
    archive.append(JSON.stringify(manifest, null, 2), { name: `${prefix}/manifest.json` });

    // Add each table
    for (const [name, data] of Object.entries(tables)) {
        archive.append(JSON.stringify(data, null, 2), { name: `${prefix}/data/${name}.json` });
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

    // Convert Node stream to Web ReadableStream
    const readable = new ReadableStream({
        start(controller) {
            passThrough.on('data', (chunk) => {
                controller.enqueue(chunk);
            });
            passThrough.on('end', () => {
                controller.close();
            });
            passThrough.on('error', (err) => {
                controller.error(err);
            });
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
