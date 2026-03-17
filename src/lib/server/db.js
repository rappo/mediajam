import Database from 'better-sqlite3';
import { resolve, dirname, join, basename } from 'path';
import { mkdirSync, existsSync, copyFileSync, unlinkSync, renameSync, readdirSync, statSync } from 'fs';

const DB_PATH = process.env.DATABASE_PATH || resolve(process.cwd(), 'mediajam.sqlite');
export { DB_PATH };

// Ensure the directory exists (important for /app/data/ in Docker)
mkdirSync(dirname(DB_PATH), { recursive: true });

// ── Boot backup into backups/ directory ──────────────────────────────────
// Read backup settings from existing DB using a throwaway connection.
let bootBackupEnabled = true;
let bootBackupKeepCount = 3;
if (existsSync(DB_PATH)) {
    try {
        const probe = new Database(DB_PATH, { readonly: true, fileMustExist: true });
        try {
            const row = /** @type {any} */ (probe.prepare(
                'SELECT backup_on_boot, boot_backup_keep_count, db_backup_count FROM app_settings WHERE id = 1'
            ).get());
            if (row) {
                // New columns take precedence; fall back to old db_backup_count
                if (typeof row.backup_on_boot === 'number') {
                    bootBackupEnabled = row.backup_on_boot !== 0;
                } else if (typeof row.db_backup_count === 'number') {
                    bootBackupEnabled = row.db_backup_count > 0;
                }
                if (typeof row.boot_backup_keep_count === 'number') {
                    bootBackupKeepCount = row.boot_backup_keep_count;
                } else if (typeof row.db_backup_count === 'number' && row.db_backup_count > 0) {
                    bootBackupKeepCount = row.db_backup_count;
                }
            }
        } catch { /* columns don't exist yet — use defaults */ }
        probe.close();
    } catch { /* DB unreadable — skip backup */ }

    const backupDir = join(dirname(DB_PATH), 'backups');
    mkdirSync(backupDir, { recursive: true });

    // Migrate old .bak.N files into backups/ dir (one-time)
    try {
        for (let i = 1; i <= 10; i++) {
            const oldBak = `${DB_PATH}.bak.${i}`;
            if (existsSync(oldBak)) {
                const stat = statSync(oldBak);
                const ts = stat.mtime.toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
                const dest = join(backupDir, `mediajam-boot-${ts}-migrated${i}.sqlite`);
                renameSync(oldBak, dest);
                console.log(`[db] Migrated old backup ${basename(oldBak)} → ${basename(dest)}`);
            }
        }
    } catch (e) {
        console.warn(`[db] Old backup migration warning:`, e instanceof Error ? e.message : e);
    }

    if (bootBackupEnabled && bootBackupKeepCount > 0) {
        try {
            // Skip backup if the most recent one is less than 5 minutes old (crash loop protection)
            const bootFiles = readdirSync(backupDir)
                .filter(f => f.startsWith('mediajam-boot-') && f.endsWith('.sqlite'))
                .sort()
                .reverse(); // newest first

            const newestBackup = bootFiles[0];
            let skipBackup = false;
            if (newestBackup) {
                const newestPath = join(backupDir, newestBackup);
                const age = Date.now() - statSync(newestPath).mtimeMs;
                if (age < 5 * 60 * 1000) {
                    skipBackup = true;
                    console.log(`[db] Skipping boot backup (last one ${Math.round(age / 1000)}s ago)`);
                }
            }

            if (!skipBackup) {
                const now = new Date();
                const ts = now.toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
                const backupFile = join(backupDir, `mediajam-boot-${ts}.sqlite`);
                copyFileSync(DB_PATH, backupFile);
                console.log(`[db] Boot backup created: ${basename(backupFile)}`);
            }

            // Prune old boot backups beyond keep count (always, even if we skipped backup)
            const allBootFiles = readdirSync(backupDir)
                .filter(f => f.startsWith('mediajam-boot-') && f.endsWith('.sqlite'))
                .sort()
                .reverse();
            if (allBootFiles.length > bootBackupKeepCount) {
                for (const old of allBootFiles.slice(bootBackupKeepCount)) {
                    unlinkSync(join(backupDir, old));
                    console.log(`[db] Pruned old boot backup: ${old}`);
                }
            }
        } catch (e) {
            console.error(`[db] Boot backup failed:`, e instanceof Error ? e.message : e);
        }
    }
}

const db = new Database(DB_PATH);

// Enable WAL mode for better concurrent performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

/** @type {Array<{type: 'warning' | 'error', message: string, detail?: string}>} */
const bootWarnings = [];

// Load sqlite-vec extension for vector search (optional — graceful fallback)
let sqliteVecLoaded = false;
try {
    const sqliteVec = await import('sqlite-vec');
    const loader = sqliteVec.default ?? sqliteVec;
    loader.load(db);
    sqliteVecLoaded = true;
    console.log('[db] sqlite-vec extension loaded');
} catch (e) {
    const msg = /** @type {Error} */(e).message;
    console.warn('[db] sqlite-vec not available — embedding features disabled:', msg);
    bootWarnings.push({
        type: 'warning',
        message: 'sqlite-vec not loaded — vector search disabled',
        detail: `${msg}. Run "npm install" to install native dependencies.`
    });
}

export { sqliteVecLoaded };

/** Get any boot warnings/errors that occurred during startup */
export function getBootWarnings() { return bootWarnings; }

// Initialize schema
db.exec(`
-- 1. App Settings (Single Row Table)
CREATE TABLE IF NOT EXISTS app_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    jellyfin_url TEXT,
    theme TEXT DEFAULT 'dark',
    tvdb_api_key TEXT,
    tmdb_api_key TEXT,
    musicbrainz_api_key TEXT,
    include_specials INTEGER DEFAULT 0,
    setup_complete INTEGER DEFAULT 0
);

-- 2. Users Table
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT,
    jellyfin_user_id TEXT,
    jellyfin_access_token TEXT,
    is_admin INTEGER DEFAULT 1,
    avatar_url TEXT DEFAULT NULL,
    created_at TEXT DEFAULT (datetime('now'))
);

-- 3. Sync State Table
CREATE TABLE IF NOT EXISTS sync_state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    status TEXT DEFAULT 'idle',
    current_task TEXT,
    progress_percent INTEGER DEFAULT 0,
    items_synced INTEGER DEFAULT 0,
    items_total INTEGER DEFAULT 0,
    errors INTEGER DEFAULT 0,
    last_sync_timestamp TEXT,
    log TEXT DEFAULT '[]'
);

-- 3b. Sync History (per-type timestamps and status)
CREATE TABLE IF NOT EXISTS sync_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sync_type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'running',
    started_at TEXT NOT NULL,
    finished_at TEXT,
    summary TEXT
);
CREATE INDEX IF NOT EXISTS idx_sync_history_type ON sync_history(sync_type, id DESC);

-- 4. Tracked Libraries
CREATE TABLE IF NOT EXISTS libraries (
    jellyfin_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    media_type TEXT NOT NULL,
    is_tracked INTEGER DEFAULT 1
);

-- 5. Media Parents (Shows, Movie Collections, Artists, Albums)
CREATE TABLE IF NOT EXISTS media_parents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    jellyfin_id TEXT UNIQUE,
    library_id TEXT,
    title TEXT NOT NULL,
    media_type TEXT NOT NULL,
    tvdb_id TEXT,
    tmdb_id TEXT,
    musicbrainz_id TEXT,
    imdb_id TEXT,
    release_year INTEGER,
    poster_url TEXT,
    overview TEXT,
    jellyfin_user_rating REAL,
    total_released_children INTEGER DEFAULT 0,
    collected_children INTEGER DEFAULT 0,
    watched_children INTEGER DEFAULT 0,
    FOREIGN KEY(library_id) REFERENCES libraries(jellyfin_id) ON DELETE CASCADE
);

-- 6. Media Children (Episodes, Movies, Tracks)
CREATE TABLE IF NOT EXISTS media_children (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    parent_id INTEGER,
    jellyfin_id TEXT UNIQUE,
    title TEXT NOT NULL,
    season_number INTEGER,
    item_number INTEGER,
    is_special INTEGER DEFAULT 0,
    is_collected INTEGER DEFAULT 0,
    watch_status TEXT DEFAULT 'unwatched',
    play_count INTEGER DEFAULT 0,
    external_api_id TEXT,
    runtime_ticks INTEGER,
    FOREIGN KEY(parent_id) REFERENCES media_parents(id) ON DELETE CASCADE
);

-- 6b. Tracks (individual songs / episodes within an album/season)
CREATE TABLE IF NOT EXISTS tracks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    album_id INTEGER NOT NULL,
    jellyfin_id TEXT UNIQUE,
    title TEXT NOT NULL,
    track_number INTEGER,
    disc_number INTEGER DEFAULT 1,
    runtime_ticks INTEGER DEFAULT 0,
    musicbrainz_id TEXT,
    FOREIGN KEY(album_id) REFERENCES media_children(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_tracks_album ON tracks(album_id);

-- 7. Playback History (Timeline Events)
CREATE TABLE IF NOT EXISTS playback_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    media_id INTEGER NOT NULL,
    source TEXT NOT NULL,
    timestamp DATETIME NOT NULL,
    duration_consumed_seconds INTEGER,
    completion_pct REAL,
    external_event_id TEXT UNIQUE,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY(user_id) REFERENCES users(id),
    FOREIGN KEY(media_id) REFERENCES media_children(id)
);

-- 8. User Identities (Multi-Provider Linking)
CREATE TABLE IF NOT EXISTS user_identities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    provider TEXT NOT NULL,
    provider_uid TEXT NOT NULL,
    access_token TEXT,
    refresh_token TEXT,
    token_expires_at TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE(user_id, provider)
);

-- 9. Active Sessions (Now Playing State)
CREATE TABLE IF NOT EXISTS active_sessions (
    id TEXT PRIMARY KEY,
    user_id INTEGER,
    media_id INTEGER,
    jellyfin_item_id TEXT,
    title TEXT,
    media_type TEXT,
    progress_ticks INTEGER DEFAULT 0,
    runtime_ticks INTEGER DEFAULT 0,
    started_at TEXT DEFAULT (datetime('now')),
    last_update TEXT DEFAULT (datetime('now')),
    is_paused INTEGER DEFAULT 0,
    FOREIGN KEY(user_id) REFERENCES users(id)
);

-- Indexes for Dashboard Performance
CREATE INDEX IF NOT EXISTS idx_media_parents_type ON media_parents(media_type);
CREATE INDEX IF NOT EXISTS idx_media_parents_library ON media_parents(library_id);
CREATE INDEX IF NOT EXISTS idx_media_children_parent ON media_children(parent_id);
CREATE INDEX IF NOT EXISTS idx_media_children_status ON media_children(watch_status, is_collected);

-- Indexes for Timeline Performance
CREATE INDEX IF NOT EXISTS idx_history_user_time ON playback_history(user_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_history_media ON playback_history(media_id);
CREATE INDEX IF NOT EXISTS idx_history_media_user ON playback_history(media_id, user_id);

-- 10. Last.fm Raw Scrobbles (1:1 mirror of external data)
CREATE TABLE IF NOT EXISTS lastfm_scrobbles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    artist_name TEXT NOT NULL,
    track_name TEXT NOT NULL,
    album_name TEXT DEFAULT '',
    timestamp_uts INTEGER NOT NULL,
    timestamp TEXT NOT NULL,
    artist_mbid TEXT DEFAULT '',
    track_mbid TEXT DEFAULT '',
    album_mbid TEXT DEFAULT '',
    image_url TEXT,
    FOREIGN KEY(user_id) REFERENCES users(id),
    UNIQUE(user_id, artist_name, track_name, timestamp_uts)
);
CREATE INDEX IF NOT EXISTS idx_lastfm_scrobbles_user ON lastfm_scrobbles(user_id, timestamp_uts DESC);
CREATE INDEX IF NOT EXISTS idx_lastfm_scrobbles_artist ON lastfm_scrobbles(artist_name);

-- 11. Trakt Raw History (1:1 mirror of external data)
CREATE TABLE IF NOT EXISTS trakt_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    trakt_id INTEGER NOT NULL,
    type TEXT NOT NULL,
    watched_at TEXT NOT NULL,
    title TEXT NOT NULL,
    show_title TEXT,
    season_number INTEGER,
    episode_number INTEGER,
    year INTEGER,
    tmdb_id TEXT,
    imdb_id TEXT,
    trakt_slug TEXT,
    FOREIGN KEY(user_id) REFERENCES users(id),
    UNIQUE(user_id, trakt_id)
);
CREATE INDEX IF NOT EXISTS idx_trakt_history_user ON trakt_history(user_id, watched_at DESC);

-- 12. Watchlist (to-watch list for movies/shows)
CREATE TABLE IF NOT EXISTS watchlist (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    media_parent_id INTEGER NOT NULL,
    added_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY(user_id) REFERENCES users(id),
    FOREIGN KEY(media_parent_id) REFERENCES media_parents(id) ON DELETE CASCADE,
    UNIQUE(user_id, media_parent_id)
);
CREATE INDEX IF NOT EXISTS idx_watchlist_user ON watchlist(user_id, added_at DESC);

-- 13. Persons (cross-media: actors, directors, musicians, writers, producers)
CREATE TABLE IF NOT EXISTS persons (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    tmdb_person_id TEXT,
    musicbrainz_artist_id TEXT,
    imdb_person_id TEXT,
    jellyfin_id TEXT,
    photo_url TEXT,
    bio TEXT,
    birth_date TEXT,
    death_date TEXT,
    birth_place TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_persons_tmdb ON persons(tmdb_person_id) WHERE tmdb_person_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_persons_name ON persons(name);
CREATE UNIQUE INDEX IF NOT EXISTS idx_persons_jellyfin ON persons(jellyfin_id) WHERE jellyfin_id IS NOT NULL;

-- 13. Person Credits (links persons to media)
CREATE TABLE IF NOT EXISTS person_credits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    person_id INTEGER NOT NULL,
    media_parent_id INTEGER NOT NULL,
    role_type TEXT NOT NULL,
    character_name TEXT,
    sort_order INTEGER DEFAULT 0,
    FOREIGN KEY(person_id) REFERENCES persons(id) ON DELETE CASCADE,
    FOREIGN KEY(media_parent_id) REFERENCES media_parents(id) ON DELETE CASCADE,
    UNIQUE(person_id, media_parent_id, role_type, character_name)
);
CREATE INDEX IF NOT EXISTS idx_credits_person ON person_credits(person_id);
CREATE INDEX IF NOT EXISTS idx_credits_media ON person_credits(media_parent_id);

-- 14. External IDs (generic link table for MusicBrainz-sourced external references per person)
CREATE TABLE IF NOT EXISTS external_ids (
    person_id INTEGER NOT NULL,
    source TEXT NOT NULL,
    external_id TEXT NOT NULL,
    PRIMARY KEY (person_id, source),
    FOREIGN KEY(person_id) REFERENCES persons(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_persons_musicbrainz ON persons(musicbrainz_artist_id) WHERE musicbrainz_artist_id IS NOT NULL;

-- Initialize singleton rows if not present
INSERT OR IGNORE INTO app_settings (id) VALUES (1);
INSERT OR IGNORE INTO sync_state (id) VALUES (1);
`);

// -- App Settings schema migrations (add columns if missing) --
const appSettingsInfo = db.prepare("PRAGMA table_info(app_settings)").all();
const existingCols = new Set(appSettingsInfo.map((/** @type {any} */ c) => c.name));
const newAppCols = [
    ['trakt_client_id', 'TEXT'],
    ['trakt_client_secret', 'TEXT'],
    ['lastfm_api_key', 'TEXT'],
    ['lastfm_shared_secret', 'TEXT'],
    ['jellyfin_pr_db_path', 'TEXT'],
    ['jellyfin_timezone', "TEXT DEFAULT ''"],
    ['jellyfin_sync_check', 'INTEGER DEFAULT 1'],
    ['ollama_url', 'TEXT'],
    ['ollama_embed_model', "TEXT DEFAULT 'nomic-embed-text'"],
    ['ollama_chat_model', "TEXT DEFAULT 'llama3.2:3b'"],
    // *arr integration
    ['radarr_url', 'TEXT'],
    ['radarr_api_key', 'TEXT'],
    ['radarr_external_url', 'TEXT'],
    ['sonarr_url', 'TEXT'],
    ['sonarr_api_key', 'TEXT'],
    ['sonarr_external_url', 'TEXT'],
    ['lidarr_url', 'TEXT'],
    ['lidarr_api_key', 'TEXT'],
    ['lidarr_external_url', 'TEXT'],
    ['radarr_quality_profile_id', 'INTEGER'],
    ['radarr_root_folder', 'TEXT'],
    ['sonarr_quality_profile_id', 'INTEGER'],
    ['sonarr_root_folder', 'TEXT'],
    ['lidarr_quality_profile_id', 'INTEGER'],
    ['lidarr_metadata_profile_id', 'INTEGER'],
    ['lidarr_root_folder', 'TEXT'],
    // External ratings
    ['omdb_api_key', 'TEXT'],
    ['discogs_token', 'TEXT'],
    // Fanart.tv
    ['fanart_api_key', 'TEXT'],
    // Database backups
    ['db_backup_count', 'INTEGER DEFAULT 2'],
    ['backup_enabled', 'INTEGER DEFAULT 1'],
    ['backup_frequency', "TEXT DEFAULT 'daily'"],
    ['backup_time', "TEXT DEFAULT '05:00'"],
    ['backup_keep_count', 'INTEGER DEFAULT 7'],
    ['backup_on_boot', 'INTEGER DEFAULT 1'],
    ['boot_backup_keep_count', 'INTEGER DEFAULT 3'],
    ['backup_timeline_epoch', 'TEXT'],
    ['backup_include_images', 'INTEGER DEFAULT 0'],
    // LLM provider support
    ['llm_provider', "TEXT DEFAULT 'ollama'"],      // 'ollama'|'openai'|'gemini'|'claude'|'kimi'
    ['llm_api_key', 'TEXT'],                         // Legacy shared key (backward compat)
    ['llm_api_url', 'TEXT'],                         // Custom base URL (e.g. Kimi endpoint)
    ['llm_chat_model', 'TEXT'],                      // Cloud chat model name
    ['llm_embed_provider', "TEXT DEFAULT 'ollama'"], // Separate embed provider
    ['llm_embed_model', 'TEXT'],                     // Cloud embed model name
    // Per-provider API keys (so switching providers doesn't lose keys)
    ['openai_api_key', 'TEXT'],
    ['gemini_api_key', 'TEXT'],
    ['claude_api_key', 'TEXT'],
    ['kimi_api_key', 'TEXT'],
    // OAuth client IDs for LLM providers
    ['openai_client_id', 'TEXT'],
    ['openai_client_secret', 'TEXT'],
    ['gemini_client_id', 'TEXT'],
    ['gemini_client_secret', 'TEXT'],
    // Codex CLI OAuth tokens (pasted from ~/.codex/auth.json)
    ['codex_access_token', 'TEXT'],
    ['codex_refresh_token', 'TEXT'],
    // Nightly/weekly pipeline scheduler
    ['pipeline_enabled', 'INTEGER DEFAULT 0'],
    ['nightly_pipeline_time', "TEXT DEFAULT '02:00'"],
    ['weekly_pipeline_day', "TEXT DEFAULT 'sunday'"],
    ['weekly_pipeline_time', "TEXT DEFAULT '03:00'"],
    ['pipeline_phase_flags', "TEXT DEFAULT '{}'"],
    ['nightly_pipeline_days', "TEXT"],
    // Homepage smart sections
    ['homepage_preferences', "TEXT DEFAULT '{}'"],
];
for (const [col, type] of newAppCols) {
    if (!existingCols.has(col)) {
        db.exec(`ALTER TABLE app_settings ADD COLUMN ${col} ${type}`);
    }
}

// -- media_parents schema migrations --
const mediaParentsCols = new Set(
    db.prepare("PRAGMA table_info(media_parents)").all().map((/** @type {any} */ c) => c.name)
);
if (!mediaParentsCols.has('collection_status')) {
    db.exec("ALTER TABLE media_parents ADD COLUMN collection_status TEXT DEFAULT 'collected'");
}
if (!mediaParentsCols.has('date_last_modified')) {
    db.exec("ALTER TABLE media_parents ADD COLUMN date_last_modified TEXT");
}
if (!mediaParentsCols.has('jellyfin_child_count')) {
    db.exec("ALTER TABLE media_parents ADD COLUMN jellyfin_child_count INTEGER DEFAULT 0");
}
if (!mediaParentsCols.has('unplayed_count')) {
    db.exec("ALTER TABLE media_parents ADD COLUMN unplayed_count INTEGER");
}
// *arr tracking columns
const arrParentCols = [
    ['radarr_id', 'INTEGER'],
    ['sonarr_id', 'INTEGER'],
    ['lidarr_id', 'INTEGER'],
    ['arr_monitored', 'INTEGER DEFAULT 0'],
    ['arr_quality_profile', 'TEXT'],
    ['arr_has_file', 'INTEGER'],
    ['arr_status', 'TEXT'],
    ['arr_slug', 'TEXT'],
    ['arr_sync_pending', 'INTEGER DEFAULT 0'],
];
for (const [col, type] of arrParentCols) {
    if (!mediaParentsCols.has(col)) {
        db.exec(`ALTER TABLE media_parents ADD COLUMN ${col} ${type}`);
    }
}
if (!mediaParentsCols.has('backdrop_url')) {
    db.exec("ALTER TABLE media_parents ADD COLUMN backdrop_url TEXT");
}
if (!mediaParentsCols.has('is_dashboard_hidden')) {
    db.exec("ALTER TABLE media_parents ADD COLUMN is_dashboard_hidden INTEGER DEFAULT 0");
}

// -- Unique external-ID constraints (dedup existing data first) --
const hasUniqueIdx = /** @type {any} */ (db.prepare(
    "SELECT name FROM sqlite_master WHERE type='index' AND name='uq_media_parents_musicbrainz'"
).get());

if (!hasUniqueIdx) {
    // Temporarily disable FK checks for migration
    db.pragma('foreign_keys = OFF');

    // Dedup existing data before adding constraints
    for (const col of ['musicbrainz_id', 'tmdb_id', 'imdb_id']) {
        const dupes = /** @type {any[]} */ (db.prepare(`
            SELECT ${col} as extId, media_type, GROUP_CONCAT(id) as ids
            FROM media_parents
            WHERE ${col} IS NOT NULL AND ${col} != ''
            GROUP BY ${col}, media_type
            HAVING COUNT(*) > 1
        `).all());

        if (dupes.length > 0) {
            db.transaction(() => {
                for (const group of dupes) {
                    const ids = group.ids.split(',').map(Number);
                    // Prefer entry with jellyfin_id, then highest id
                    const rows = /** @type {any[]} */ (db.prepare(
                        `SELECT id, jellyfin_id FROM media_parents WHERE id IN (${ids.join(',')})`
                    ).all());
                    rows.sort((a, b) => {
                        const aJ = a.jellyfin_id ? 1 : 0;
                        const bJ = b.jellyfin_id ? 1 : 0;
                        if (aJ !== bJ) return bJ - aJ;
                        return b.id - a.id;
                    });
                    const keepId = rows[0].id;
                    const keepChild = /** @type {any} */ (db.prepare(
                        'SELECT id FROM media_children WHERE parent_id = ? LIMIT 1'
                    ).get(keepId));

                    for (const row of rows.slice(1)) {
                        const staleId = row.id;
                        const staleChildren = /** @type {any[]} */ (db.prepare(
                            'SELECT id FROM media_children WHERE parent_id = ?'
                        ).all(staleId));
                        for (const sc of staleChildren) {
                            if (keepChild) {
                                db.prepare('UPDATE playback_history SET media_id = ? WHERE media_id = ?').run(keepChild.id, sc.id);
                            } else {
                                db.prepare('DELETE FROM playback_history WHERE media_id = ?').run(sc.id);
                            }
                        }
                        db.prepare('DELETE FROM person_credits WHERE media_parent_id = ?').run(staleId);
                        db.prepare('DELETE FROM media_children WHERE parent_id = ?').run(staleId);
                        db.prepare('DELETE FROM media_parents WHERE id = ?').run(staleId);
                    }
                }
            })();
            console.log(`[migration] Deduped ${dupes.length} groups by ${col}`);
        }
    }

    // Now add unique indexes (WHERE filters out NULLs/empty — SQLite allows multiple NULLs in unique indexes)
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS uq_media_parents_musicbrainz ON media_parents(musicbrainz_id, media_type) WHERE musicbrainz_id IS NOT NULL AND musicbrainz_id != ''`);
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS uq_media_parents_tmdb ON media_parents(tmdb_id, media_type) WHERE tmdb_id IS NOT NULL AND tmdb_id != ''`);
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS uq_media_parents_imdb ON media_parents(imdb_id) WHERE imdb_id IS NOT NULL AND imdb_id != ''`);
    console.log('[migration] Added unique indexes on external IDs');

    // Re-enable FK checks
    db.pragma('foreign_keys = ON');
}

// -- media_children schema migrations --
const mediaChildrenCols = new Set(
    db.prepare("PRAGMA table_info(media_children)").all().map((/** @type {any} */ c) => c.name)
);
if (!mediaChildrenCols.has('premiere_date')) {
    db.exec("ALTER TABLE media_children ADD COLUMN premiere_date TEXT");
}
if (!mediaChildrenCols.has('poster_url')) {
    db.exec("ALTER TABLE media_children ADD COLUMN poster_url TEXT");
}
if (!mediaChildrenCols.has('overview')) {
    db.exec("ALTER TABLE media_children ADD COLUMN overview TEXT");
}
if (!mediaChildrenCols.has('musicbrainz_id')) {
    db.exec("ALTER TABLE media_children ADD COLUMN musicbrainz_id TEXT");
}
if (!mediaChildrenCols.has('community_rating')) {
    db.exec("ALTER TABLE media_children ADD COLUMN community_rating REAL");
}
if (!mediaChildrenCols.has('is_hidden')) {
    db.exec("ALTER TABLE media_children ADD COLUMN is_hidden INTEGER DEFAULT 0");
}

// -- playback_history schema migrations --
const historyCols = new Set(
    db.prepare("PRAGMA table_info(playback_history)").all().map((/** @type {any} */ c) => c.name)
);
if (!historyCols.has('track_name')) {
    db.exec("ALTER TABLE playback_history ADD COLUMN track_name TEXT");
}

// Backfill track_name from external_event_id for lastfm entries
// Format: lastfm:artist:trackName:timestamp
const nullTrackCount = /** @type {any} */ (db.prepare(
    "SELECT COUNT(*) as c FROM playback_history WHERE track_name IS NULL AND source = 'lastfm' AND external_event_id LIKE 'lastfm:%'"
).get())?.c || 0;
if (nullTrackCount > 0) {
    const updateStmt = db.prepare(
        "UPDATE playback_history SET track_name = ? WHERE id = ?"
    );
    const rows = /** @type {any[]} */ (db.prepare(
        "SELECT id, external_event_id FROM playback_history WHERE track_name IS NULL AND source = 'lastfm' AND external_event_id LIKE 'lastfm:%'"
    ).all());
    const txn = db.transaction(() => {
        for (const row of rows) {
            // lastfm:artist:trackName:timestamp — split and take the track part
            const parts = row.external_event_id.split(':');
            // parts[0] = 'lastfm', parts[1] = artist, parts[last] = uts, everything in between = track
            if (parts.length >= 4) {
                const trackName = parts.slice(2, -1).join(':');
                if (trackName) updateStmt.run(trackName, row.id);
            }
        }
    });
    txn();
    console.log(`[db] Backfilled track_name for ${rows.length} Last.fm history entries`);
}

// -- Add track_id FK to playback_history --
if (!historyCols.has('track_id')) {
    db.exec("ALTER TABLE playback_history ADD COLUMN track_id INTEGER REFERENCES tracks(id)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_history_track ON playback_history(track_id)");
    console.log('[db] Added track_id column to playback_history');
}

// Backfill track_id for history entries that have track_name but no track_id
{
    const nullTrackIdCount = /** @type {any} */ (db.prepare(
        `SELECT COUNT(*) as c FROM playback_history ph
         WHERE ph.track_id IS NULL AND ph.track_name IS NOT NULL
         AND EXISTS (SELECT 1 FROM tracks t WHERE t.album_id = ph.media_id)`
    ).get())?.c || 0;

    if (nullTrackIdCount > 0) {
        // Match track_name to tracks.title using normalized comparison
        db.exec(`
            UPDATE playback_history SET track_id = (
                SELECT t.id FROM tracks t
                WHERE t.album_id = playback_history.media_id
                AND LOWER(TRIM(t.title)) = LOWER(TRIM(playback_history.track_name))
                LIMIT 1
            )
            WHERE track_id IS NULL
            AND track_name IS NOT NULL
            AND EXISTS (SELECT 1 FROM tracks t WHERE t.album_id = playback_history.media_id)
        `);
        const matched = /** @type {any} */ (db.prepare(
            "SELECT COUNT(*) as c FROM playback_history WHERE track_id IS NOT NULL"
        ).get())?.c || 0;
        console.log(`[db] Backfilled track_id: ${matched} history entries linked to tracks`);
    }
}

// -- Fix bare-UTC timestamps from webhook source --
// datetime('now') produces "YYYY-MM-DD HH:MM:SS" without Z, which JavaScript
// misinterprets as local time when TZ env is set. Convert to ISO-Z format.
{
    const bareUtcCount = /** @type {any} */ (db.prepare(`
        SELECT COUNT(*) as c FROM playback_history
        WHERE source = 'webhook'
        AND timestamp NOT LIKE '%Z'
        AND timestamp NOT LIKE '%+%'
        AND timestamp NOT LIKE '%-%-%-%'
        AND timestamp LIKE '____-__-__ __:__:__'
    `).get())?.c || 0;

    if (bareUtcCount > 0) {
        db.exec(`
            UPDATE playback_history
            SET timestamp = REPLACE(timestamp, ' ', 'T') || 'Z'
            WHERE source = 'webhook'
            AND timestamp NOT LIKE '%Z'
            AND timestamp NOT LIKE '%+%'
            AND timestamp LIKE '____-__-__ __:__:__'
        `);
        console.log(`[db] Fixed ${bareUtcCount} webhook timestamps: added Z suffix for UTC`);
    }
}
// -- Deduplicate tracks and add composite unique index --
// Lidarr enrichment was inserting tracks without jellyfin_id (NULL), bypassing
// the UNIQUE(jellyfin_id) constraint. This migration dedupes and prevents recurrence.
{
    const dupeCount = /** @type {any} */ (db.prepare(`
        SELECT COUNT(*) as c FROM (
            SELECT album_id, disc_number, track_number, COUNT(*) as cnt
            FROM tracks GROUP BY album_id, disc_number, track_number HAVING cnt > 1
        )
    `).get())?.c || 0;

    if (dupeCount > 0) {
        // First, reassign playback_history.track_id from dupe tracks to the survivor (MIN id)
        // so the DELETE doesn't violate FK constraints
        db.exec(`
            UPDATE playback_history SET track_id = (
                SELECT MIN(t2.id) FROM tracks t2
                WHERE t2.album_id = (SELECT album_id FROM tracks WHERE id = playback_history.track_id)
                  AND t2.disc_number = (SELECT disc_number FROM tracks WHERE id = playback_history.track_id)
                  AND t2.track_number = (SELECT track_number FROM tracks WHERE id = playback_history.track_id)
            )
            WHERE track_id IS NOT NULL
              AND track_id NOT IN (SELECT MIN(id) FROM tracks GROUP BY album_id, disc_number, track_number)
        `);

        // Now safe to delete duplicates
        const deleted = db.prepare(`
            DELETE FROM tracks WHERE id NOT IN (
                SELECT MIN(id) FROM tracks GROUP BY album_id, disc_number, track_number
            )
        `).run();
        console.log(`[db] Deduplicated tracks: removed ${deleted.changes} duplicate rows from ${dupeCount} groups`);
    }

    // Add composite unique index (idempotent)
    try {
        db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_tracks_album_disc_track ON tracks(album_id, disc_number, track_number)');
    } catch {
        // Index may fail if there are still dupes — reassign FKs and retry
        db.exec(`
            UPDATE playback_history SET track_id = (
                SELECT MIN(t2.id) FROM tracks t2
                WHERE t2.album_id = (SELECT album_id FROM tracks WHERE id = playback_history.track_id)
                  AND t2.disc_number = (SELECT disc_number FROM tracks WHERE id = playback_history.track_id)
                  AND t2.track_number = (SELECT track_number FROM tracks WHERE id = playback_history.track_id)
            )
            WHERE track_id IS NOT NULL
              AND track_id NOT IN (SELECT MIN(id) FROM tracks GROUP BY album_id, disc_number, track_number)
        `);
        db.exec(`
            DELETE FROM tracks WHERE id NOT IN (
                SELECT MIN(id) FROM tracks GROUP BY album_id, disc_number, track_number
            )
        `);
        db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_tracks_album_disc_track ON tracks(album_id, disc_number, track_number)');
    }
}

// -- Fix runtime_ticks stored 1000x too large --
// Lidarr enrichment multiplied ms duration by 10,000,000 instead of 10,000,
// producing values 1000x too large. Any runtime_ticks > 36 billion (1 hour)
// is almost certainly inflated. Normal 5-min track = ~3 billion ticks.
{
    const inflatedCount = /** @type {any} */ (db.prepare(
        'SELECT COUNT(*) as c FROM tracks WHERE runtime_ticks > 36000000000'
    ).get())?.c || 0;

    if (inflatedCount > 0) {
        db.prepare(
            'UPDATE tracks SET runtime_ticks = runtime_ticks / 1000 WHERE runtime_ticks > 36000000000'
        ).run();
        console.log(`[db] Fixed ${inflatedCount} tracks with 1000x inflated runtime_ticks`);
    }
}

// -- UNDO incorrect pr_tz migration (v1 wrongly added +4/5h) --
// The Jellyfin PR plugin stores DateCreated in UTC (DateTime.UtcNow), so
// the original stored values were already correct. The v1 migration broke them
// by adding 4-5 hours. This v2 migration subtracts those hours back.
{
    try { db.exec("ALTER TABLE app_settings ADD COLUMN pr_tz_migrated INTEGER DEFAULT 0"); } catch { /* already exists */ }
    try { db.exec("ALTER TABLE app_settings ADD COLUMN pr_tz_v2_migrated INTEGER DEFAULT 0"); } catch { /* already exists */ }
    const flags = /** @type {any} */ (db.prepare("SELECT pr_tz_migrated, pr_tz_v2_migrated FROM app_settings WHERE id = 1").get());
    // Only run v2 if v1 already ran (broke things) and v2 hasn't run yet
    if (flags?.pr_tz_migrated && !flags?.pr_tz_v2_migrated) {
        const prEntries = /** @type {any[]} */ (db.prepare(
            "SELECT id, timestamp FROM playback_history WHERE source = 'jellyfin_pr'"
        ).all());
        if (prEntries.length > 0) {
            // Reverse the v1 migration: subtract the same offsets it added
            // v1 used dstBoundary = 2026-03-08T07:00:00Z on the ORIGINAL timestamps,
            // but now timestamps are shifted. An entry originally at 06:00Z on Mar 8
            // is now at 11:00Z (after +5h). So we check: if current - 5h < boundary → was EST (+5h),
            // else was EDT (+4h). Subtract accordingly.
            const dstBoundary = new Date('2026-03-08T07:00:00Z').getTime();
            const updateStmt = db.prepare("UPDATE playback_history SET timestamp = ? WHERE id = ?");
            const txn = db.transaction(() => {
                let fixed = 0;
                for (const entry of prEntries) {
                    const ts = entry.timestamp;
                    if (!ts) continue;
                    const d = new Date(ts);
                    if (isNaN(d.getTime())) continue;
                    // Try both offsets and see which original value is below/above boundary
                    const orig5 = d.getTime() - 5 * 3600000;
                    const orig4 = d.getTime() - 4 * 3600000;
                    // If subtracting 5h puts us below the DST boundary, v1 added 5h (EST)
                    const offsetHours = orig5 < dstBoundary ? 5 : 4;
                    const restored = new Date(d.getTime() - offsetHours * 3600000);
                    updateStmt.run(restored.toISOString(), entry.id);
                    fixed++;
                }
                return fixed;
            });
            const count = txn();
            console.log(`[db] Reverted ${count} jellyfin_pr timestamps (undid incorrect +4/5h shift)`);
        }
        db.prepare("UPDATE app_settings SET pr_tz_v2_migrated = 1 WHERE id = 1").run();
    }
}

/** @type {Array<{id: number, jellyfin_user_id: string, jellyfin_access_token: string}>} */
const usersWithJellyfin = /** @type {any} */ (db.prepare(
    'SELECT id, jellyfin_user_id, jellyfin_access_token FROM users WHERE jellyfin_user_id IS NOT NULL'
).all());
const upsertIdentity = db.prepare(`
    INSERT OR IGNORE INTO user_identities (user_id, provider, provider_uid, access_token)
    VALUES (?, 'jellyfin', ?, ?)
`);
for (const user of usersWithJellyfin) {
    upsertIdentity.run(user.id, user.jellyfin_user_id, user.jellyfin_access_token);
}

// -- Add avatar_url column if not present --
try {
    db.prepare('SELECT avatar_url FROM users LIMIT 0').get();
} catch {
    db.exec('ALTER TABLE users ADD COLUMN avatar_url TEXT DEFAULT NULL');
    console.log('[db] Added avatar_url column to users table');
}

// -- user_identities auto-sync migrations --
const identityCols = new Set(
    db.prepare("PRAGMA table_info(user_identities)").all().map((/** @type {any} */ c) => c.name)
);
if (!identityCols.has('auto_sync')) {
    db.exec("ALTER TABLE user_identities ADD COLUMN auto_sync INTEGER DEFAULT 0");
}
if (!identityCols.has('last_auto_sync_at')) {
    db.exec("ALTER TABLE user_identities ADD COLUMN last_auto_sync_at TEXT");
}

// -- Add preferences JSON column to users --
try {
    db.prepare('SELECT preferences FROM users LIMIT 0').get();
} catch {
    db.exec("ALTER TABLE users ADD COLUMN preferences TEXT DEFAULT '{}'");
    console.log('[db] Added preferences column to users table');
}

// -- Add is_favorite column to media_parents and persons --
try {
    db.prepare('SELECT is_favorite FROM media_parents LIMIT 0').get();
} catch {
    db.exec('ALTER TABLE media_parents ADD COLUMN is_favorite INTEGER DEFAULT 0');
    console.log('[db] Added is_favorite column to media_parents');
}
try {
    db.prepare('SELECT is_favorite FROM persons LIMIT 0').get();
} catch {
    db.exec('ALTER TABLE persons ADD COLUMN is_favorite INTEGER DEFAULT 0');
    console.log('[db] Added is_favorite column to persons');
}

// -- Add birth_place column to persons if missing --
try {
    db.prepare('SELECT birth_place FROM persons LIMIT 0').get();
} catch {
    db.exec('ALTER TABLE persons ADD COLUMN birth_place TEXT');
    console.log('[db] Added birth_place column to persons');
}

// -- Add logging_enabled column to app_settings --
try {
    db.prepare('SELECT logging_enabled FROM app_settings LIMIT 0').get();
} catch {
    db.exec('ALTER TABLE app_settings ADD COLUMN logging_enabled INTEGER DEFAULT NULL');
    console.log('[db] Added logging_enabled column to app_settings');
}

// -- Add heart border display preference columns --
const appCols = new Set(
    db.prepare("PRAGMA table_info(app_settings)").all().map((/** @type {any} */ c) => c.name)
);
if (!appCols.has('heart_border_movies')) {
    db.exec('ALTER TABLE app_settings ADD COLUMN heart_border_movies INTEGER DEFAULT 1');
}
if (!appCols.has('heart_border_shows')) {
    db.exec('ALTER TABLE app_settings ADD COLUMN heart_border_shows INTEGER DEFAULT 1');
}
if (!appCols.has('heart_border_music')) {
    db.exec('ALTER TABLE app_settings ADD COLUMN heart_border_music INTEGER DEFAULT 1');
}
if (!appCols.has('heart_border_people')) {
    db.exec('ALTER TABLE app_settings ADD COLUMN heart_border_people INTEGER DEFAULT 1');
}
if (!appCols.has('welcome_complete')) {
    db.exec('ALTER TABLE app_settings ADD COLUMN welcome_complete INTEGER DEFAULT 0');
    // Auto-mark welcome complete for existing installs that already finished setup
    db.exec('UPDATE app_settings SET welcome_complete = 1 WHERE setup_complete = 1');
    console.log('[db] Added welcome_complete column to app_settings');
}
if (!appCols.has('jellyfin_auth_status')) {
    db.exec("ALTER TABLE app_settings ADD COLUMN jellyfin_auth_status TEXT DEFAULT 'ok'");
}

// -- Add Wikipedia columns to media_parents and persons --
const mpCols2 = new Set(db.prepare("PRAGMA table_info(media_parents)").all().map((/** @type {any} */ c) => c.name));
if (!mpCols2.has('wikipedia_url')) {
    db.exec("ALTER TABLE media_parents ADD COLUMN wikipedia_url TEXT");
    db.exec("ALTER TABLE media_parents ADD COLUMN wikipedia_summary TEXT");
    db.exec("ALTER TABLE media_parents ADD COLUMN wikipedia_fetched_at TEXT");
    console.log('[db] Added Wikipedia columns to media_parents');
}
const pCols2 = new Set(db.prepare("PRAGMA table_info(persons)").all().map((/** @type {any} */ c) => c.name));
if (!pCols2.has('wikipedia_url')) {
    db.exec("ALTER TABLE persons ADD COLUMN wikipedia_url TEXT");
    db.exec("ALTER TABLE persons ADD COLUMN wikipedia_summary TEXT");
    db.exec("ALTER TABLE persons ADD COLUMN wikipedia_fetched_at TEXT");
    console.log('[db] Added Wikipedia columns to persons');
}
// -- Per-source bio columns --
if (!pCols2.has('bio_tmdb')) {
    db.exec("ALTER TABLE persons ADD COLUMN bio_jellyfin TEXT");
    db.exec("ALTER TABLE persons ADD COLUMN bio_tmdb TEXT");
    // Migrate existing bio → bio_tmdb (most were populated from TMDB enrichment)
    db.exec("UPDATE persons SET bio_tmdb = bio WHERE bio IS NOT NULL AND bio_tmdb IS NULL");
    console.log('[db] Added per-source bio columns to persons, migrated existing bio → bio_tmdb');
}
// -- External runtime for media parents (TMDB runtime in minutes) --
const mpCols3 = new Set(db.prepare("PRAGMA table_info(media_parents)").all().map((/** @type {any} */ c) => c.name));
if (!mpCols3.has('runtime_minutes')) {
    db.exec("ALTER TABLE media_parents ADD COLUMN runtime_minutes INTEGER");
    console.log('[db] Added runtime_minutes column to media_parents');
}
if (!mpCols3.has('mb_enriched_at')) {
    db.exec("ALTER TABLE media_parents ADD COLUMN mb_enriched_at TEXT");
    console.log('[db] Added mb_enriched_at column to media_parents');
}
if (!mpCols3.has('backdrop_fetched_at')) {
    db.exec("ALTER TABLE media_parents ADD COLUMN backdrop_fetched_at TEXT");
    console.log('[db] Added backdrop_fetched_at column to media_parents');
}

// -- tmdb_enriched_at on persons (tracks when TMDB enrich was last attempted) --
const pCols3 = new Set(db.prepare("PRAGMA table_info(persons)").all().map((/** @type {any} */ c) => c.name));
if (!pCols3.has('tmdb_enriched_at')) {
    db.exec("ALTER TABLE persons ADD COLUMN tmdb_enriched_at TEXT");
    // Backfill: mark persons that already have TMDB data as enriched
    db.exec("UPDATE persons SET tmdb_enriched_at = datetime('now') WHERE tmdb_person_id IS NOT NULL AND bio_tmdb IS NOT NULL AND photo_url IS NOT NULL");
    console.log('[db] Added tmdb_enriched_at column to persons');
}

// -- URL Slugs for stable URLs --
import { slugify, ensureUniqueSlug } from '$lib/server/slugify.js';

const mpCols4 = new Set(db.prepare("PRAGMA table_info(media_parents)").all().map((/** @type {any} */ c) => c.name));
if (!mpCols4.has('slug')) {
    db.exec("ALTER TABLE media_parents ADD COLUMN slug TEXT");
    console.log('[db] Added slug column to media_parents');

    // Backfill slugs for all existing media_parents
    const parents = /** @type {any[]} */ (db.prepare('SELECT id, title, release_year, media_type FROM media_parents').all());
    const updateSlug = db.prepare('UPDATE media_parents SET slug = ? WHERE id = ?');
    const usedSlugs = new Set();
    db.transaction(() => {
        for (const p of parents) {
            const addYear = (p.media_type === 'movie' || p.media_type === 'show') ? p.release_year : null;
            let base = slugify(p.title || 'untitled', addYear);
            let slug = base;
            let suffix = 2;
            while (usedSlugs.has(slug)) {
                slug = `${base}-${suffix++}`;
            }
            usedSlugs.add(slug);
            updateSlug.run(slug, p.id);
        }
    })();
    console.log(`[db] Backfilled slugs for ${parents.length} media_parents`);

    try { db.exec("CREATE UNIQUE INDEX idx_media_parents_slug ON media_parents(slug)"); } catch { /* index may already exist */ }
}

const mcCols2 = new Set(db.prepare("PRAGMA table_info(media_children)").all().map((/** @type {any} */ c) => c.name));
if (!mcCols2.has('slug')) {
    db.exec("ALTER TABLE media_children ADD COLUMN slug TEXT");
    console.log('[db] Added slug column to media_children');

    // Backfill slugs for all existing media_children
    const children = /** @type {any[]} */ (db.prepare('SELECT id, title, parent_id FROM media_children').all());
    const updateChildSlug = db.prepare('UPDATE media_children SET slug = ? WHERE id = ?');
    // Slugs need to be unique per parent
    /** @type {Map<number, Set<string>>} */
    const usedByParent = new Map();
    db.transaction(() => {
        for (const c of children) {
            if (!usedByParent.has(c.parent_id)) usedByParent.set(c.parent_id, new Set());
            const parentSlugs = /** @type {Set<string>} */ (usedByParent.get(c.parent_id));
            let base = slugify(c.title || 'untitled');
            let slug = base;
            let suffix = 2;
            while (parentSlugs.has(slug)) {
                slug = `${base}-${suffix++}`;
            }
            parentSlugs.add(slug);
            updateChildSlug.run(slug, c.id);
        }
    })();
    console.log(`[db] Backfilled slugs for ${children.length} media_children`);

    try { db.exec("CREATE INDEX idx_media_children_slug ON media_children(parent_id, slug)"); } catch { /* index may already exist */ }
}

const pCols4 = new Set(db.prepare("PRAGMA table_info(persons)").all().map((/** @type {any} */ c) => c.name));
if (!pCols4.has('slug')) {
    db.exec("ALTER TABLE persons ADD COLUMN slug TEXT");
    console.log('[db] Added slug column to persons');

    // Backfill slugs for all persons
    const persons = /** @type {any[]} */ (db.prepare('SELECT id, name FROM persons').all());
    const updatePersonSlug = db.prepare('UPDATE persons SET slug = ? WHERE id = ?');
    const usedPersonSlugs = new Set();
    db.transaction(() => {
        for (const p of persons) {
            let base = slugify(p.name || 'unknown');
            let slug = base;
            let suffix = 2;
            while (usedPersonSlugs.has(slug)) {
                slug = `${base}-${suffix++}`;
            }
            usedPersonSlugs.add(slug);
            updatePersonSlug.run(slug, p.id);
        }
    })();
    console.log(`[db] Backfilled slugs for ${persons.length} persons`);

    try { db.exec("CREATE UNIQUE INDEX idx_persons_slug ON persons(slug)"); } catch { /* index may already exist */ }
}

// -- LLM Embedding & Tagging Tables --
try {
    db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS media_embeddings USING vec0(
            media_id INTEGER PRIMARY KEY,
            title_embedding FLOAT[768]
        )
    `);
    db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS overview_embeddings USING vec0(
            media_parent_id INTEGER PRIMARY KEY,
            overview_embedding FLOAT[768]
        )
    `);
    console.log('[db] vec0 embedding tables ready');
} catch (e) {
    console.warn('[db] Could not create vec0 tables (sqlite-vec not loaded):', /** @type {Error} */(e).message);
}

// -- Embedding content hashes (for stale embedding detection) --
db.exec(`
    CREATE TABLE IF NOT EXISTS embedding_hashes (
        media_parent_id INTEGER PRIMARY KEY,
        content_hash TEXT NOT NULL,
        embedded_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY(media_parent_id) REFERENCES media_parents(id) ON DELETE CASCADE
    )
`);

// -- Media Tags table (for LLM auto-tagging) --
db.exec(`
    CREATE TABLE IF NOT EXISTS media_tags (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        media_parent_id INTEGER NOT NULL,
        tag_type TEXT NOT NULL,
        tag_value TEXT NOT NULL,
        source TEXT DEFAULT 'llm',
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY(media_parent_id) REFERENCES media_parents(id) ON DELETE CASCADE,
        UNIQUE(media_parent_id, tag_type, tag_value)
    )
`);
db.exec('CREATE INDEX IF NOT EXISTS idx_media_tags_parent ON media_tags(media_parent_id)');
db.exec('CREATE INDEX IF NOT EXISTS idx_media_tags_type ON media_tags(tag_type, tag_value)');

// -- Reconcile Runs table (for LLM reconciliation tracking) --
db.exec(`
    CREATE TABLE IF NOT EXISTS reconcile_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        status TEXT DEFAULT 'running',
        started_at TEXT,
        finished_at TEXT,
        phase TEXT,
        progress_cursor TEXT,
        stats TEXT,
        diff_summary TEXT
    )
`);

// -- Sync Conflicts table (for MusicBrainz ID conflicts) --
db.exec(`
    CREATE TABLE IF NOT EXISTS sync_conflicts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        conflict_type TEXT NOT NULL,
        primary_id INTEGER,
        secondary_id INTEGER,
        external_id TEXT,
        status TEXT DEFAULT 'pending',
        resolution TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        resolved_at TEXT,
        UNIQUE(conflict_type, external_id, secondary_id)
    )
`);

// -- Discovered Media (cached from external APIs, not in collection) --
db.exec(`
    CREATE TABLE IF NOT EXISTS discovered_media (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        media_type TEXT NOT NULL,
        title TEXT NOT NULL,
        tmdb_id TEXT,
        imdb_id TEXT,
        tvdb_id TEXT,
        musicbrainz_id TEXT,
        release_year INTEGER,
        poster_url TEXT,
        overview TEXT,
        popularity REAL,
        vote_average REAL,
        source TEXT NOT NULL,
        fetched_at TEXT DEFAULT (datetime('now')),
        UNIQUE(media_type, tmdb_id),
        UNIQUE(media_type, musicbrainz_id)
    )
`);
db.exec('CREATE INDEX IF NOT EXISTS idx_discovered_media_type ON discovered_media(media_type)');

// -- Discovered Credits (links persons to discovered_media) --
db.exec(`
    CREATE TABLE IF NOT EXISTS discovered_credits (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        person_id INTEGER NOT NULL,
        discovered_media_id INTEGER NOT NULL,
        role_type TEXT NOT NULL,
        character_name TEXT,
        sort_order INTEGER DEFAULT 0,
        FOREIGN KEY(person_id) REFERENCES persons(id) ON DELETE CASCADE,
        FOREIGN KEY(discovered_media_id) REFERENCES discovered_media(id) ON DELETE CASCADE,
        UNIQUE(person_id, discovered_media_id, role_type, character_name)
    )
`);

// -- External Ratings (cached scores from Discogs, OMDb, TMDB, MusicBrainz) --
db.exec(`
    CREATE TABLE IF NOT EXISTS external_ratings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        media_parent_id INTEGER,
        media_child_id INTEGER,
        source TEXT NOT NULL,
        rating_type TEXT NOT NULL DEFAULT 'score',
        value REAL NOT NULL,
        vote_count INTEGER,
        raw_value TEXT,
        fetched_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY(media_parent_id) REFERENCES media_parents(id) ON DELETE CASCADE,
        FOREIGN KEY(media_child_id) REFERENCES media_children(id) ON DELETE CASCADE,
        UNIQUE(media_parent_id, media_child_id, source, rating_type)
    )
`);
db.exec('CREATE INDEX IF NOT EXISTS idx_external_ratings_parent ON external_ratings(media_parent_id)');
db.exec('CREATE INDEX IF NOT EXISTS idx_external_ratings_child ON external_ratings(media_child_id)');

// -- Activity Log (global event feed) --
db.exec(`
    CREATE TABLE IF NOT EXISTS activity_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        category TEXT NOT NULL,
        action TEXT NOT NULL,
        title TEXT NOT NULL,
        detail TEXT,
        icon TEXT,
        status TEXT DEFAULT 'info',
        read INTEGER DEFAULT 0,
        actionable INTEGER DEFAULT 0,
        action_type TEXT,
        action_data TEXT,
        created_at TEXT DEFAULT (datetime('now'))
    )
`);
db.exec('CREATE INDEX IF NOT EXISTS idx_activity_log_read ON activity_log(read)');

// -- Pipeline Run History --
db.exec(`
    CREATE TABLE IF NOT EXISTS pipeline_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        mode TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'running',
        started_at TEXT NOT NULL DEFAULT (datetime('now')),
        finished_at TEXT,
        duration_ms INTEGER,
        phase_results TEXT,
        summary TEXT
    )
`);
db.exec('CREATE INDEX IF NOT EXISTS idx_pipeline_runs_started ON pipeline_runs(started_at)');

// -- API Keys (Bearer token authentication for API access) --
db.exec(`
    CREATE TABLE IF NOT EXISTS api_keys (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        key_hash TEXT NOT NULL UNIQUE,
        key_prefix TEXT NOT NULL,
        permissions TEXT NOT NULL DEFAULT '[]',
        last_used_at TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        expires_at TEXT,
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    )
`);
db.exec('CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash)');

// -- One-time: fix jellyfin_sync timestamps that used premiere_date (movie release date) --
// These entries had timestamps like "2000-08-30" which is the movie's release date, not the play date.
// Note: timestamp column is NOT NULL, so we use '' as a sentinel for "unknown date".
{
    const badEntries = /** @type {any} */ (db.prepare(`
        SELECT COUNT(*) as c FROM playback_history ph
        JOIN media_children mc ON mc.id = ph.media_id
        WHERE ph.source = 'jellyfin_sync'
          AND ph.timestamp != ''
          AND mc.premiere_date IS NOT NULL
          AND ph.timestamp = mc.premiere_date
    `).get());
    if (badEntries?.c > 0) {
        db.prepare(`
            UPDATE playback_history SET timestamp = ''
            WHERE source = 'jellyfin_sync'
              AND timestamp != ''
              AND media_id IN (
                  SELECT mc.id FROM media_children mc
                  WHERE mc.premiere_date = playback_history.timestamp
              )
        `).run();
        console.log(`[db] Fixed ${badEntries.c} jellyfin_sync entries that used premiere_date as play timestamp`);
    }
    // Also fix the 1900-01-01 sentinel values
    const sentinel1900 = db.prepare(
        "UPDATE playback_history SET timestamp = '' WHERE source = 'jellyfin_sync' AND timestamp LIKE '1900-%'"
    ).run();
    if (sentinel1900.changes > 0) {
        console.log(`[db] Fixed ${sentinel1900.changes} jellyfin_sync entries with 1900-01-01 sentinel dates`);
    }
    // Also fix 1970 epoch values
    const sentinel1970 = db.prepare(
        "UPDATE playback_history SET timestamp = '' WHERE timestamp LIKE '1970-01-01%'"
    ).run();
    if (sentinel1970.changes > 0) {
        console.log(`[db] Fixed ${sentinel1970.changes} playback entries with 1970 epoch dates`);
    }

    // Remove synthetic jellyfin_sync entries when real play history exists from other sources
    const dedupSynthetic = db.prepare(`
        DELETE FROM playback_history
        WHERE source = 'jellyfin_sync'
          AND timestamp = ''
          AND media_id IN (
              SELECT media_id FROM playback_history
              WHERE source != 'jellyfin_sync' AND timestamp != ''
              GROUP BY media_id
          )
    `).run();
    if (dedupSynthetic.changes > 0) {
        console.log(`[db] Removed ${dedupSynthetic.changes} synthetic jellyfin_sync entries superseded by real history`);
    }
}

// -- One-time: strip /preview from Fanart.tv backdrop URLs (causes 404) --
{
    const fixPreview = db.prepare(
        "UPDATE media_parents SET backdrop_url = REPLACE(backdrop_url, '/preview', '') WHERE backdrop_url LIKE '%/preview'"
    ).run();
    if (fixPreview.changes > 0) {
        console.log(`[db] Fixed ${fixPreview.changes} Fanart.tv backdrop URLs (removed /preview suffix)`);
    }
}

// Initialize logger from DB settings
import { initLogging } from './logger.js';
initLogging(db);

export default db;
