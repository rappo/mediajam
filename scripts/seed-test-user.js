import Database from 'better-sqlite3';
import { resolve } from 'path';
import { randomInt } from 'crypto';
import bcrypt from 'bcryptjs';

const DB_PATH = resolve(process.cwd(), 'mediajam.sqlite');
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const TEST_USERNAME = 'testuser';
const TEST_PASSWORD = 'testuser';
const DAYS_BACK = 30;

// ─── Create Test User ────────────────────────────────────────────────────────
const existingUser = /** @type {any} */ (db.prepare('SELECT * FROM users WHERE username = ?').get(TEST_USERNAME));

let testUserId;
if (existingUser) {
    testUserId = existingUser.id;
    console.log(`♻️  Test user "${TEST_USERNAME}" already exists (id: ${testUserId}), clearing old history...`);
    db.prepare('DELETE FROM playback_history WHERE user_id = ?').run(testUserId);
} else {
    const passwordHash = bcrypt.hashSync(TEST_PASSWORD, 10);
    const result = db.prepare(
        `INSERT INTO users (username, password_hash, is_admin, created_at) VALUES (?, ?, 0, datetime('now', '-30 days'))`
    ).run(TEST_USERNAME, passwordHash);
    testUserId = result.lastInsertRowid;
    console.log(`✅ Created test user "${TEST_USERNAME}" (id: ${testUserId}) with password "${TEST_PASSWORD}"`);
}

// ─── Gather Available Media ──────────────────────────────────────────────────
const episodes = /** @type {any[]} */ (db.prepare(`
    SELECT mc.id, mc.runtime_ticks, mp.media_type, mp.title as parent_title
    FROM media_children mc
    JOIN media_parents mp ON mc.parent_id = mp.id
    WHERE mp.media_type = 'show'
    ORDER BY RANDOM()
    LIMIT 600
`).all());

const movies = /** @type {any[]} */ (db.prepare(`
    SELECT mc.id, mc.runtime_ticks, mp.media_type, mp.title as parent_title
    FROM media_children mc
    JOIN media_parents mp ON mc.parent_id = mp.id
    WHERE mp.media_type = 'movie'
    ORDER BY RANDOM()
    LIMIT 100
`).all());

const tracks = /** @type {any[]} */ (db.prepare(`
    SELECT mc.id, mc.runtime_ticks, mp.media_type, mp.title as parent_title
    FROM media_children mc
    JOIN media_parents mp ON mc.parent_id = mp.id
    WHERE mp.media_type = 'artist'
    ORDER BY RANDOM()
    LIMIT 1500
`).all());

console.log(`📊 Available media: ${episodes.length} episodes, ${movies.length} movies, ${tracks.length} tracks`);

// ─── Generate Fake History ───────────────────────────────────────────────────
const insertHistory = db.prepare(`
    INSERT OR IGNORE INTO playback_history (user_id, media_id, source, timestamp, duration_consumed_seconds, completion_pct, external_event_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)
`);

const now = Date.now();
const msPerDay = 86400000;
let totalInserted = 0;
let eventCounter = 0;

const insertAll = db.transaction(() => {
    for (let dayOffset = 0; dayOffset < DAYS_BACK; dayOffset++) {
        const dayStart = now - (dayOffset * msPerDay);

        // ── TV: 2-6 episodes per day ──
        const episodesToday = randomInt(2, 7);
        for (let i = 0; i < episodesToday && episodes.length > 0; i++) {
            const ep = episodes[randomInt(0, episodes.length)];
            const runtimeSec = ep.runtime_ticks ? Math.round(ep.runtime_ticks / 10000000) : randomInt(1200, 3600);
            const watchedPct = Math.random() > 0.15 ? 100 : randomInt(20, 90); // 85% fully watched
            const durationConsumed = Math.round(runtimeSec * (watchedPct / 100));
            const timestamp = new Date(dayStart - randomInt(0, msPerDay)).toISOString();

            insertHistory.run(
                testUserId, ep.id, 'seed',
                timestamp, durationConsumed, watchedPct,
                `seed:tv:${eventCounter++}`
            );
            totalInserted++;
        }

        // ── Movies: 0-2 per day (avg ~0.7) ──
        const movieChance = Math.random();
        const moviesToday = movieChance < 0.4 ? 0 : movieChance < 0.8 ? 1 : 2;
        for (let i = 0; i < moviesToday && movies.length > 0; i++) {
            const movie = movies[randomInt(0, movies.length)];
            const runtimeSec = movie.runtime_ticks ? Math.round(movie.runtime_ticks / 10000000) : randomInt(4800, 9000);
            const watchedPct = Math.random() > 0.1 ? 100 : randomInt(15, 80);
            const durationConsumed = Math.round(runtimeSec * (watchedPct / 100));
            const timestamp = new Date(dayStart - randomInt(0, msPerDay)).toISOString();

            insertHistory.run(
                testUserId, movie.id, 'seed',
                timestamp, durationConsumed, watchedPct,
                `seed:movie:${eventCounter++}`
            );
            totalInserted++;
        }

        // ── Music: 5-30 tracks per day ──
        const tracksToday = randomInt(5, 31);
        for (let i = 0; i < tracksToday && tracks.length > 0; i++) {
            const track = tracks[randomInt(0, tracks.length)];
            const runtimeSec = track.runtime_ticks ? Math.round(track.runtime_ticks / 10000000) : randomInt(120, 360);
            const watchedPct = Math.random() > 0.2 ? 100 : randomInt(30, 95);
            const durationConsumed = Math.round(runtimeSec * (watchedPct / 100));
            const timestamp = new Date(dayStart - randomInt(0, msPerDay)).toISOString();

            insertHistory.run(
                testUserId, track.id, 'seed',
                timestamp, durationConsumed, watchedPct,
                `seed:music:${eventCounter++}`
            );
            totalInserted++;
        }
    }
});

insertAll();

// ─── Summary ─────────────────────────────────────────────────────────────────
const verifyCount = /** @type {any} */ (db.prepare('SELECT COUNT(*) as count FROM playback_history WHERE user_id = ?').get(testUserId));
const dateRange = /** @type {any} */ (db.prepare('SELECT MIN(timestamp) as earliest, MAX(timestamp) as latest FROM playback_history WHERE user_id = ?').get(testUserId));

console.log(`\n🎉 Done! Seeded ${verifyCount.count} playback events for "${TEST_USERNAME}"`);
console.log(`   Date range: ${dateRange.earliest?.substring(0, 10)} → ${dateRange.latest?.substring(0, 10)}`);

const bySource = /** @type {any[]} */ (db.prepare(`
    SELECT 
        CASE 
            WHEN external_event_id LIKE 'seed:tv:%' THEN 'TV Episodes'
            WHEN external_event_id LIKE 'seed:movie:%' THEN 'Movies'
            WHEN external_event_id LIKE 'seed:music:%' THEN 'Music Tracks'
        END as category,
        COUNT(*) as count
    FROM playback_history 
    WHERE user_id = ?
    GROUP BY category
`).all(testUserId));

for (const row of bySource) {
    console.log(`   ${row.category}: ${row.count}`);
}

db.close();
