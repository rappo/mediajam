import Database from 'better-sqlite3';
import { resolve } from 'path';

const DB_PATH = resolve(process.cwd(), 'mediajam.sqlite');

const db = new Database(DB_PATH);

// Enable WAL mode for better concurrent performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

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
    ['jellyfin_sync_check', 'INTEGER DEFAULT 1']
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

export default db;
