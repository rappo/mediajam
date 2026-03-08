import Database from 'better-sqlite3';
import { resolve, dirname } from 'path';
import { mkdirSync } from 'fs';

const DB_PATH = process.env.DATABASE_PATH || resolve(process.cwd(), 'mediajam.sqlite');

// Ensure the directory exists (important for /app/data/ in Docker)
mkdirSync(dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);

// Enable WAL mode for better concurrent performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

/** @type {Array<{type: 'warning' | 'error', message: string, detail?: string}>} */
const bootWarnings = [];

// Load sqlite-vec extension for vector search (optional — graceful fallback)
try {
    const sqliteVec = await import('sqlite-vec');
    const loader = sqliteVec.default ?? sqliteVec;
    loader.load(db);
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

-- 12. Persons (cross-media: actors, directors, musicians, writers, producers)
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
];
for (const [col, type] of arrParentCols) {
    if (!mediaParentsCols.has(col)) {
        db.exec(`ALTER TABLE media_parents ADD COLUMN ${col} ${type}`);
    }
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

// -- Migrate existing Jellyfin user IDs into user_identities --
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

// Initialize logger from DB settings
import { initLogging } from './logger.js';
initLogging(db);

export default db;
