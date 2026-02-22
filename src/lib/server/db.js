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

-- Indexes for Dashboard Performance
CREATE INDEX IF NOT EXISTS idx_media_parents_type ON media_parents(media_type);
CREATE INDEX IF NOT EXISTS idx_media_parents_library ON media_parents(library_id);
CREATE INDEX IF NOT EXISTS idx_media_children_parent ON media_children(parent_id);
CREATE INDEX IF NOT EXISTS idx_media_children_status ON media_children(watch_status, is_collected);

-- Initialize singleton rows if not present
INSERT OR IGNORE INTO app_settings (id) VALUES (1);
INSERT OR IGNORE INTO sync_state (id) VALUES (1);
`);

export default db;
