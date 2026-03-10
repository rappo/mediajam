import db from '$lib/server/db.js';
import { normalizeTitle } from '$lib/server/album-matcher.js';
import { logInfo, logWarn, logError } from '$lib/server/logger.js';
import fs from 'node:fs';
import path from 'node:path';

// ─── State ───────────────────────────────────────────────────────────────────

/** @type {Set<(data: any) => void>} */
const listeners = new Set();
let reconcileState = { running: false, phase: '', runId: 0 };

/** @param {(data: any) => void} cb */
export function addReconcileListener(cb) { listeners.add(cb); return () => listeners.delete(cb); }
export function isReconcileRunning() { return reconcileState.running; }
export function getReconcileState() { return { ...reconcileState }; }

// ─── Startup: clean up stale runs from previous server crashes ───────────────
try {
    const stale = db.prepare(
        `UPDATE reconcile_runs SET status = 'failed', finished_at = datetime('now') WHERE status = 'running'`
    ).run();
    if (stale.changes > 0) {
        logWarn('reconcile', `Cleaned up ${stale.changes} stale reconciliation run(s) from previous crash`);
    }
} catch { /* DB may not be ready yet */ }

// ─── Persistent Log File ─────────────────────────────────────────────────────

const logsDir = path.resolve('logs');
/** @type {fs.WriteStream | null} */
let logStream = null;

/** Start a new log file for a reconciliation run
 * @param {number} runId */
function openLogFile(runId) {
    try {
        if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
        const logPath = path.join(logsDir, `reconcile-${runId}.log`);
        logStream = fs.createWriteStream(logPath, { flags: 'w' });
        logStream.write(`# Reconciliation Run ${runId} — ${new Date().toISOString()}\n\n`);
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        logWarn('reconcile', `Could not open log file: ${msg}`);
        logStream = null;
    }
}

/** Close the current log file */
function closeLogFile() {
    if (logStream) {
        logStream.write(`\n# Finished — ${new Date().toISOString()}\n`);
        logStream.end();
        logStream = null;
    }
}

/** @param {any} data */
function broadcast(data) {
    for (const cb of listeners) { try { cb(data); } catch { /* */ } }
    // Persist log lines to file
    if (logStream && data.log) {
        const ts = new Date().toLocaleTimeString();
        logStream.write(`[${ts}] ${data.log}\n`);
    }
}

// ─── Title Normalization (extends album-matcher's normalizeTitle) ─────────────

/**
 * Aggressive normalization for matching: lowercase, strip articles, punctuation,
 * diacritics, unicode hyphens, extra whitespace.
 * @param {string} title
 * @returns {string}
 */
function aggressiveNormalize(title) {
    if (!title) return '';
    return title
        // Unicode normalize (NFD to decompose diacritics, then strip combining marks)
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        // Smart quotes / hyphens → ASCII
        .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
        .replace(/[\u201C\u201D\u201E\u201F\u2033\u2036]/g, '"')
        .replace(/[\u2010\u2011\u2012\u2013\u2014\u2015\uFE58\uFE63\uFF0D]/g, '-')
        .replace(/[\u2026]/g, '...')
        // Lowercase
        .toLowerCase()
        // Strip leading articles
        .replace(/^(the|a|an|les|la|le|der|die|das)\s+/i, '')
        // Strip common suffixes
        .replace(/\s*[-–—]\s*(single|ep|e\.p\.|deluxe|remaster(ed)?|bonus\s*track(s)?|expanded|anniversary|edition)$/i, '')
        // Collapse punctuation to nothing
        .replace(/['".,!?;:()[\]{}&]/g, '')
        // Collapse whitespace
        .replace(/\s+/g, ' ')
        .trim();
}



// ─── Tiered Matchers ────────────────────────────────────────────────────────

/**
 * Match an artist from Last.fm to a local media_parent.
 * Uses T0 (MusicBrainz ID), T1 (exact title), T2 (normalized title).
 * @param {string} artistName
 * @param {string} [mbid] - MusicBrainz ID
 * @returns {Promise<{matchedId: number, confidence: string, tier: number, matchedTitle: string} | null>}
 */
export async function matchArtist(artistName, mbid) {
    // Tier 0: MusicBrainz ID
    if (mbid) {
        const match = /** @type {any} */ (db.prepare(
            `SELECT id, title FROM media_parents WHERE musicbrainz_id = ? AND media_type = 'artist' LIMIT 1`
        ).get(mbid));
        if (match) return { matchedId: match.id, confidence: 'exact', tier: 0, matchedTitle: match.title };
    }

    // Tier 1: Exact title (case-insensitive) — match any known item (Jellyfin, *arr, or external)
    {
        const match = /** @type {any} */ (db.prepare(
            `SELECT id, title FROM media_parents WHERE title = ? COLLATE NOCASE AND media_type = 'artist' LIMIT 1`
        ).get(artistName));
        if (match) return { matchedId: match.id, confidence: 'exact', tier: 1, matchedTitle: match.title };
    }

    // Tier 2: Normalized title match
    const normalizedQuery = aggressiveNormalize(artistName);
    if (normalizedQuery.length > 0) {
        const candidates = /** @type {any[]} */ (db.prepare(
            `SELECT id, title FROM media_parents WHERE media_type = 'artist'`
        ).all());
        for (const c of candidates) {
            if (aggressiveNormalize(c.title) === normalizedQuery) {
                return { matchedId: c.id, confidence: 'high', tier: 2, matchedTitle: c.title };
            }
        }
    }

    return null;
}

/**
 * Match a movie from Trakt to a local media_parent.
 * Uses T0 (external IDs), T1 (exact title+year), T2 (normalized title+year±1).
 * @param {string} title
 * @param {number} [year]
 * @param {string} [tmdbId]
 * @param {string} [imdbId]
 * @returns {Promise<{matchedId: number, confidence: string, tier: number, matchedTitle: string} | null>}
 */
export async function matchMovie(title, year, tmdbId, imdbId) {
    // Tier 0: External IDs
    if (tmdbId) {
        const match = /** @type {any} */ (db.prepare(
            `SELECT id, title FROM media_parents WHERE tmdb_id = ? AND media_type = 'movie' LIMIT 1`
        ).get(String(tmdbId)));
        if (match) return { matchedId: match.id, confidence: 'exact', tier: 0, matchedTitle: match.title };
    }
    if (imdbId) {
        const match = /** @type {any} */ (db.prepare(
            `SELECT id, title FROM media_parents WHERE imdb_id = ? AND media_type = 'movie' LIMIT 1`
        ).get(String(imdbId)));
        if (match) return { matchedId: match.id, confidence: 'exact', tier: 0, matchedTitle: match.title };
    }

    // Tier 1: Exact title + year — match any known item
    if (year) {
        const match = /** @type {any} */ (db.prepare(
            `SELECT id, title FROM media_parents WHERE title = ? COLLATE NOCASE AND media_type = 'movie' AND release_year = ? LIMIT 1`
        ).get(title, year));
        if (match) return { matchedId: match.id, confidence: 'exact', tier: 1, matchedTitle: match.title };
    }

    // Tier 2: Normalized title + year ± 1
    const normalizedQuery = aggressiveNormalize(title);
    if (normalizedQuery.length > 0) {
        const yearMin = year ? year - 1 : 0;
        const yearMax = year ? year + 1 : 9999;
        const candidates = /** @type {any[]} */ (db.prepare(
            `SELECT id, title, release_year FROM media_parents WHERE media_type = 'movie' AND release_year BETWEEN ? AND ?`
        ).all(yearMin, yearMax));
        for (const c of candidates) {
            if (aggressiveNormalize(c.title) === normalizedQuery) {
                return { matchedId: c.id, confidence: 'high', tier: 2, matchedTitle: c.title };
            }
        }
    }

    return null;
}

/**
 * Match a show from Trakt to a local media_parent.
 * Uses T0 (external IDs), T1 (exact title), T2 (normalized title).
 * @param {string} showTitle
 * @param {string} [tmdbId]
 * @param {string} [imdbId]
 * @returns {Promise<{matchedId: number, confidence: string, tier: number, matchedTitle: string} | null>}
 */
export async function matchShow(showTitle, tmdbId, imdbId) {
    // Tier 0: External IDs
    if (tmdbId) {
        const match = /** @type {any} */ (db.prepare(
            `SELECT id, title FROM media_parents WHERE tmdb_id = ? AND media_type = 'show' LIMIT 1`
        ).get(String(tmdbId)));
        if (match) return { matchedId: match.id, confidence: 'exact', tier: 0, matchedTitle: match.title };
    }
    if (imdbId) {
        const match = /** @type {any} */ (db.prepare(
            `SELECT id, title FROM media_parents WHERE imdb_id = ? AND media_type = 'show' LIMIT 1`
        ).get(String(imdbId)));
        if (match) return { matchedId: match.id, confidence: 'exact', tier: 0, matchedTitle: match.title };
    }

    // Tier 1: Exact title — match any known item
    {
        const match = /** @type {any} */ (db.prepare(
            `SELECT id, title FROM media_parents WHERE title = ? COLLATE NOCASE AND media_type = 'show' LIMIT 1`
        ).get(showTitle));
        if (match) return { matchedId: match.id, confidence: 'exact', tier: 1, matchedTitle: match.title };
    }

    // Tier 2: Normalized
    const normalizedQuery = aggressiveNormalize(showTitle);
    if (normalizedQuery.length > 0) {
        const candidates = /** @type {any[]} */ (db.prepare(
            `SELECT id, title FROM media_parents WHERE media_type = 'show'`
        ).all());
        for (const c of candidates) {
            if (aggressiveNormalize(c.title) === normalizedQuery) {
                return { matchedId: c.id, confidence: 'high', tier: 2, matchedTitle: c.title };
            }
        }
    }

    return null;
}

// ─── Album/Child Matching ───────────────────────────────────────────────────

/**
 * Strip parenthetical/bracket suffixes and common edition tags for looser matching.
 * "Enter The Wu-Tang Clan - 36 Chambers (Deluxe Version)" → "enter wu-tang clan 36 chambers"
 * @param {string} s
 * @returns {string}
 */
function stripEditionTags(s) {
    return s
        // Remove anything in parens/brackets: (Deluxe), [Explicit], (Expanded Edition), etc.
        .replace(/\s*[\(\[][^\)\]]*[\)\]]\s*/g, ' ')
        // Remove common trailing tags after dash
        .replace(/\s*[-–—]\s*(single|ep|e\.p\.|deluxe|remaster(ed)?|bonus\s*track(s)?|expanded|anniversary|edition|explicit|clean|censored|version|vol(\.|ume)?\s*\d*)$/i, '')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Compute Jaccard similarity between two strings split into word tokens.
 * @param {string} a
 * @param {string} b
 * @returns {number} 0–1
 */
function tokenSimilarity(a, b) {
    const tokensA = new Set(a.split(/\s+/).filter(t => t.length > 0));
    const tokensB = new Set(b.split(/\s+/).filter(t => t.length > 0));
    if (tokensA.size === 0 || tokensB.size === 0) return 0;
    let intersection = 0;
    for (const t of tokensA) { if (tokensB.has(t)) intersection++; }
    return intersection / Math.max(tokensA.size, tokensB.size);
}

/**
 * Match a scrobble to a specific media_child under a matched parent.
 * Uses 7 tiers of increasingly fuzzy matching:
 *  0. Global MusicBrainz ID lookup (cross-artist, highest priority)
 *  1. Exact title (case-insensitive)
 *  2. Normalized title (aggressiveNormalize)
 *  3. Stripped edition tags (remove parentheticals, "[Explicit]", etc.)
 *  4. Containment (one title contains the other)
 *  5. Token overlap (Jaccard ≥ 0.6 on word tokens)
 *  6. Track name match (find album by track title)
 * @param {number} parentId
 * @param {string} albumName
 * @param {string} [trackName]
 * @param {string} [albumMbid] - MusicBrainz release group ID for global lookup
 * @returns {number | null} media_child.id
 */
function matchChild(parentId, albumName, trackName, albumMbid) {
    // Tier 0: Global MusicBrainz ID match (cross-artist)
    if (albumMbid) {
        const mbidMatch = /** @type {any} */ (db.prepare(
            `SELECT id FROM media_children WHERE musicbrainz_id = ? LIMIT 1`
        ).get(albumMbid));
        if (mbidMatch) return mbidMatch.id;
    }

    if (!albumName) {
        // No album name — only match if parent has exactly one child
        const only = /** @type {any} */ (db.prepare(
            `SELECT id FROM media_children WHERE parent_id = ? LIMIT 1`
        ).get(parentId));
        return only ? only.id : null;
    }

    // 1. Exact album title match
    const exact = /** @type {any} */ (db.prepare(
        `SELECT id FROM media_children WHERE parent_id = ? AND title = ? COLLATE NOCASE LIMIT 1`
    ).get(parentId, albumName));
    if (exact) return exact.id;

    // Fetch all local children for fuzzy comparison
    const children = /** @type {any[]} */ (db.prepare(
        `SELECT id, title FROM media_children WHERE parent_id = ?`
    ).all(parentId));
    if (children.length === 0) return null;

    const normalizedAlbum = aggressiveNormalize(albumName);
    const strippedAlbum = aggressiveNormalize(stripEditionTags(albumName));

    // Pre-compute normalizations for children
    const childData = children.map(c => ({
        id: c.id,
        title: c.title,
        normalized: aggressiveNormalize(c.title),
        stripped: aggressiveNormalize(stripEditionTags(c.title)),
    }));

    // 2. Normalized title match
    for (const c of childData) {
        if (c.normalized === normalizedAlbum) return c.id;
    }

    // 3. Stripped edition tags match
    if (strippedAlbum) {
        for (const c of childData) {
            if (c.stripped === strippedAlbum) return c.id;
        }
    }

    // 4. Containment match (one contains the other)
    if (strippedAlbum && strippedAlbum.length >= 3) {
        for (const c of childData) {
            if (c.stripped.length >= 3) {
                if (c.stripped.includes(strippedAlbum) || strippedAlbum.includes(c.stripped)) {
                    return c.id;
                }
            }
        }
    }

    // 5. Token overlap — pick best match above threshold
    let bestId = null;
    let bestScore = 0;
    const THRESHOLD = 0.6;
    for (const c of childData) {
        const score = tokenSimilarity(strippedAlbum, c.stripped);
        if (score >= THRESHOLD && score > bestScore) {
            bestScore = score;
            bestId = c.id;
        }
    }
    if (bestId) return bestId;

    // 6. Track name match — find which local album contains this track
    if (trackName) {
        const normalizedTrack = aggressiveNormalize(trackName);
        if (normalizedTrack) {
            // Look up tracks across all local albums under this parent
            const tracks = /** @type {any[]} */ (db.prepare(`
                SELECT t.album_id, t.title FROM tracks t
                JOIN media_children mc ON mc.id = t.album_id
                WHERE mc.parent_id = ?
            `).all(parentId));
            // Exact track title
            for (const t of tracks) {
                if (aggressiveNormalize(t.title) === normalizedTrack) return t.album_id;
            }
            // Containment (handles "Track Name [Live]" ≈ "Track Name")
            for (const t of tracks) {
                const nt = aggressiveNormalize(t.title);
                if (nt.length >= 3 && normalizedTrack.length >= 3) {
                    if (nt.includes(normalizedTrack) || normalizedTrack.includes(nt)) {
                        return t.album_id;
                    }
                }
            }
        }
    }

    return null;
}

/**
 * Match an episode to a media_child under a show parent.
 * @param {number} parentId
 * @param {number} [season]
 * @param {number} [episode]
 * @param {string} [episodeTitle]
 * @returns {number | null}
 */
function matchEpisode(parentId, season, episode, episodeTitle) {
    // Season + episode number
    if (season != null && episode != null) {
        const match = /** @type {any} */ (db.prepare(
            `SELECT id FROM media_children WHERE parent_id = ? AND season_number = ? AND item_number = ? LIMIT 1`
        ).get(parentId, season, episode));
        if (match) return match.id;
    }

    // Title match
    if (episodeTitle) {
        const match = /** @type {any} */ (db.prepare(
            `SELECT id FROM media_children WHERE parent_id = ? AND title = ? COLLATE NOCASE LIMIT 1`
        ).get(parentId, episodeTitle));
        if (match) return match.id;
    }

    // Fallback: first child
    const fallback = /** @type {any} */ (db.prepare(
        `SELECT id FROM media_children WHERE parent_id = ? LIMIT 1`
    ).get(parentId));
    return fallback ? fallback.id : null;
}

// ─── External Media Helper ──────────────────────────────────────────────────

/**
 * Find or create an external media_parent + media_child.
 * @param {{ mediaType: string, parentTitle: string, childTitle?: string, releaseYear?: number, tmdbId?: string, imdbId?: string, musicbrainzId?: string, seasonNumber?: number, itemNumber?: number, collectionStatus?: string, parentId?: number }} info
 * @returns {number} media_child.id
 */
function findOrCreateExternal(info) {
    const { mediaType, parentTitle, childTitle, releaseYear,
        tmdbId, musicbrainzId, imdbId, seasonNumber, itemNumber,
        collectionStatus = 'watched_not_owned', parentId: existingParentId } = info;

    // Use existing parent if provided
    let parent = existingParentId ? { id: existingParentId } : null;

    // Try matching by external IDs first (most reliable — prevents case-difference dupes)
    if (!parent && musicbrainzId) {
        parent = /** @type {any} */ (db.prepare(
            `SELECT id FROM media_parents WHERE musicbrainz_id = ? AND media_type = ? ORDER BY jellyfin_id IS NOT NULL DESC, id ASC LIMIT 1`
        ).get(musicbrainzId, mediaType));
    }
    if (!parent && tmdbId) {
        parent = /** @type {any} */ (db.prepare(
            `SELECT id FROM media_parents WHERE tmdb_id = ? AND media_type = ? ORDER BY jellyfin_id IS NOT NULL DESC, id ASC LIMIT 1`
        ).get(String(tmdbId), mediaType));
    }
    if (!parent && imdbId) {
        parent = /** @type {any} */ (db.prepare(
            `SELECT id FROM media_parents WHERE imdb_id = ? AND media_type = ? ORDER BY jellyfin_id IS NOT NULL DESC, id ASC LIMIT 1`
        ).get(String(imdbId), mediaType));
    }

    // Fall back to title match
    if (!parent) {
        parent = /** @type {any} */ (db.prepare(
            `SELECT id FROM media_parents WHERE title = ? AND media_type = ? ORDER BY jellyfin_id IS NOT NULL DESC, id ASC LIMIT 1`
        ).get(parentTitle, mediaType));
    }

    if (!parent) {
        const result = db.prepare(`
            INSERT INTO media_parents (title, media_type, collection_status, release_year, tmdb_id, musicbrainz_id, imdb_id)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(parentTitle, mediaType, collectionStatus, releaseYear || null,
            tmdbId || null, musicbrainzId || null, imdbId || null);
        parent = { id: Number(result.lastInsertRowid) };
    }

    // Find or create child
    const parentId = /** @type {number} */ (parent.id);
    const effectiveChildTitle = childTitle || parentTitle;
    let child = /** @type {any} */ (db.prepare(
        `SELECT id FROM media_children WHERE parent_id = ? AND title = ? AND COALESCE(season_number, 0) = ? AND COALESCE(item_number, 0) = ?`
    ).get(parentId, effectiveChildTitle, seasonNumber || 0, itemNumber || 0));

    if (!child) {
        const result = db.prepare(`
            INSERT INTO media_children (parent_id, title, is_collected, season_number, item_number)
            VALUES (?, ?, 0, ?, ?)
        `).run(parentId, effectiveChildTitle, seasonNumber || null, itemNumber || null);
        child = { id: result.lastInsertRowid };
    }

    return /** @type {number} */ (child.id);
}

// ─── Session Consolidation ──────────────────────────────────────────────────

/** @type {Map<number, number>} mediaId → last imported timestamp (for Trakt) */
const sessionTracker = new Map();

/** @type {Map<string, number>} "artist::track" → last imported timestamp (for Last.fm) */
const trackSessionTracker = new Map();

/**
 * Check if a Trakt watch is within the same session as the previous one.
 * Uses a 4-hour window on mediaId (episode/movie level).
 * @param {number} mediaId
 * @param {number} timestampMs
 * @returns {boolean}
 */
function isWithinSession(mediaId, timestampMs) {
    const last = sessionTracker.get(mediaId);
    if (last === undefined) return false;
    return (timestampMs - last) < 4 * 60 * 60 * 1000;
}

/**
 * Check if a Last.fm scrobble is a duplicate (same track within 10 min).
 * Handles the "paused in car, resumed" scenario without blocking genuine replays.
 * @param {string} artistName
 * @param {string} trackName
 * @param {number} timestampMs
 * @returns {boolean}
 */
function isTrackDuplicate(artistName, trackName, timestampMs) {
    const key = `${artistName}::${trackName}`;
    const last = trackSessionTracker.get(key);
    if (last === undefined) return false;
    // 10 minute window — covers pause/resume but allows genuine replays
    return Math.abs(timestampMs - last) < 10 * 60 * 1000;
}

// ─── Prepared Statements ────────────────────────────────────────────────────

const insertHistory = db.prepare(`
    INSERT OR IGNORE INTO playback_history
        (user_id, media_id, source, timestamp, duration_consumed_seconds, completion_pct, external_event_id, track_name)
    VALUES (@userId, @mediaId, @source, @timestamp, @durationSeconds, @completionPct, @externalEventId, @trackName)
`);

// ─── Full Reconciliation Pipeline ───────────────────────────────────────────

/**
 * Run the complete reconciliation pipeline:
 * 1. Snapshot current playback_history
 * 2. Clear lastfm/trakt from playback_history
 * 3. Clean up external-only media_parents
 * 4. Build embedding index
 * 5. Re-match all scrobbles/history
 * 6. Generate diff report
 *
 * @param {number} userId
 * @param {{skipPhases?: string[]}} [options]
 * @returns {Promise<{success: boolean, stats: any, diff: any}>}
 */
export async function runFullReconciliation(userId, options = {}) {
    const { skipPhases = [] } = options;
    const shouldSkip = (/** @type {string} */ phase) => skipPhases.includes(phase);
    if (reconcileState.running) {
        throw new Error('Reconciliation already running');
    }

    reconcileState = { running: true, phase: 'init', runId: 0 };
    const startedAt = new Date().toISOString();
    sessionTracker.clear();
    trackSessionTracker.clear();

    // Create run record
    const runResult = db.prepare(
        `INSERT INTO reconcile_runs (user_id, status, started_at, phase) VALUES (?, 'running', ?, 'init')`
    ).run(userId, startedAt);
    const runId = Number(runResult.lastInsertRowid);
    reconcileState.runId = runId;
    openLogFile(runId);

    const stats = {
        lastfm: { total: 0, matched: 0, external: 0, skipped: 0, consolidated: 0, tier0: 0, tier1: 0, tier2: 0 },
        trakt: { total: 0, matched: 0, external: 0, skipped: 0, consolidated: 0, tier0: 0, tier1: 0, tier2: 0 },
        diff: { changed: 0, improved: 0, degraded: 0, newMatches: 0 }
    };

    try {
        // ── Phase 1: Snapshot ────────────────────────────────────────────
        reconcileState.phase = 'snapshot';
        broadcast({ type: 'reconcile_progress', phase: 'snapshot', log: '📸 Creating snapshot of current playback_history...', logType: 'info' });

        db.exec(`DROP TABLE IF EXISTS _reconcile_snapshot`);
        db.exec(`CREATE TEMP TABLE _reconcile_snapshot AS
            SELECT ph.id, ph.media_id, ph.source, ph.external_event_id, ph.track_name,
                   mc.parent_id, mp.title as parent_title, mc.title as child_title,
                   CASE WHEN mp.jellyfin_id IS NOT NULL THEN 1 ELSE 0 END AS is_local
            FROM playback_history ph
            JOIN media_children mc ON ph.media_id = mc.id
            JOIN media_parents mp ON mc.parent_id = mp.id
            WHERE ph.source IN ('lastfm', 'trakt') AND ph.user_id = ${userId}
        `);
        db.exec(`CREATE INDEX _idx_snap_event_id ON _reconcile_snapshot(external_event_id)`);
        db.exec(`CREATE INDEX _idx_snap_parent_id ON _reconcile_snapshot(parent_id)`);

        const snapshotCount = /** @type {any} */ (db.prepare('SELECT COUNT(*) as c FROM _reconcile_snapshot').get())?.c || 0;
        broadcast({ type: 'reconcile_progress', phase: 'snapshot', log: `📸 Snapshot: ${snapshotCount} records`, logType: 'info' });

        updateRun(runId, 'running', 'snapshot', stats);

        // ── Phase 2: Clear (with backup for recovery) ────────────────────
        reconcileState.phase = 'clearing';
        broadcast({ type: 'reconcile_progress', phase: 'clearing', log: '🗑️ Backing up and clearing existing lastfm/trakt from playback_history...', logType: 'info' });

        // Create a real (non-temp) backup table so it survives errors
        db.exec(`DROP TABLE IF EXISTS _reconcile_backup`);
        db.exec(`CREATE TABLE _reconcile_backup AS
            SELECT * FROM playback_history
            WHERE source IN ('lastfm', 'trakt') AND user_id = ${userId}
        `);
        const backupCount = /** @type {any} */ (db.prepare('SELECT COUNT(*) as c FROM _reconcile_backup').get())?.c || 0;
        broadcast({ type: 'reconcile_progress', phase: 'clearing', log: `💾 Backed up ${backupCount} rows before clearing`, logType: 'info' });

        const deletedLastfm = db.prepare(`DELETE FROM playback_history WHERE source = 'lastfm' AND user_id = ?`).run(userId);
        const deletedTrakt = db.prepare(`DELETE FROM playback_history WHERE source = 'trakt' AND user_id = ?`).run(userId);
        broadcast({
            type: 'reconcile_progress', phase: 'clearing',
            log: `🗑️ Cleared ${deletedLastfm.changes} lastfm + ${deletedTrakt.changes} trakt entries`, logType: 'info'
        });

        // Clean up orphan external parents (no jellyfin_id, no children with history)
        const externalsDeleted = db.prepare(`
            DELETE FROM media_parents WHERE jellyfin_id IS NULL AND collection_status IN ('external', 'watched_not_owned')
            AND radarr_id IS NULL AND sonarr_id IS NULL AND lidarr_id IS NULL
            AND id NOT IN (SELECT DISTINCT mc.parent_id FROM media_children mc JOIN playback_history ph ON ph.media_id = mc.id)
        `).run();
        // Also clean children of deleted parents
        db.prepare(`DELETE FROM media_children WHERE parent_id NOT IN (SELECT id FROM media_parents)`).run();
        // Clean up stale external children (no jellyfin_id, no playback_history) under ANY parent
        const staleChildren = db.prepare(`
            DELETE FROM media_children WHERE jellyfin_id IS NULL
            AND id NOT IN (SELECT DISTINCT media_id FROM playback_history WHERE media_id IS NOT NULL)
            AND parent_id NOT IN (SELECT id FROM media_parents WHERE radarr_id IS NOT NULL OR sonarr_id IS NOT NULL OR lidarr_id IS NOT NULL)
        `).run();

        broadcast({
            type: 'reconcile_progress', phase: 'clearing',
            log: `🗑️ Cleaned ${externalsDeleted.changes} orphan external parents, ${staleChildren.changes} stale external children`, logType: 'info'
        });

        updateRun(runId, 'running', 'clearing', stats);

        // ── Phase 4: Re-match Last.fm ───────────────────────────────────
        if (shouldSkip('matching_lastfm')) {
            broadcast({ type: 'reconcile_progress', phase: 'matching_lastfm', log: `⏭️ Last.fm matching skipped by user`, logType: 'info' });
        } else {
            reconcileState.phase = 'matching_lastfm';
            const scrobbles = /** @type {any[]} */ (db.prepare(
                `SELECT * FROM lastfm_scrobbles WHERE user_id = ? ORDER BY timestamp_uts ASC`
            ).all(userId));
            stats.lastfm.total = scrobbles.length;

            broadcast({
                type: 'reconcile_progress', phase: 'matching_lastfm',
                log: `🎵 Matching ${scrobbles.length} Last.fm scrobbles...`, logType: 'info'
            });

            // Cache artist matches to avoid re-querying (artist name → match result)
            /** @type {Map<string, Awaited<ReturnType<typeof matchArtist>>>} */
            const artistCache = new Map();
            // Cache child matches to avoid re-querying (parentId::album → media_child id)
            /** @type {Map<string, number | null>} */
            const childCache = new Map();

            for (let i = 0; i < scrobbles.length; i++) {
                const s = scrobbles[i];
                const cacheKey = `${s.artist_name}::${s.artist_mbid || ''}`;
                let artistMatch = artistCache.get(cacheKey);

                if (artistMatch === undefined) {
                    artistMatch = await matchArtist(s.artist_name, s.artist_mbid);
                    artistCache.set(cacheKey, artistMatch);
                }

                let mediaId = null;
                if (artistMatch) {
                    // Check child cache first
                    const childKey = `${artistMatch.matchedId}::${s.album_name || ''}::${s.track_name || ''}::${s.album_mbid || ''}`;
                    if (childCache.has(childKey)) {
                        mediaId = childCache.get(childKey) ?? null;
                    } else {
                        mediaId = matchChild(artistMatch.matchedId, s.album_name, s.track_name, s.album_mbid || undefined);
                        childCache.set(childKey, mediaId);
                    }
                    if (mediaId) {
                        stats.lastfm[`tier${artistMatch.tier}`]++;
                        stats.lastfm.matched++;
                    }
                }

                // No match → create external
                if (!mediaId) {
                    try {
                        mediaId = findOrCreateExternal({
                            mediaType: 'artist',
                            parentTitle: s.artist_name,
                            childTitle: s.album_name || s.track_name || s.artist_name,
                            musicbrainzId: s.artist_mbid || undefined,
                            parentId: artistMatch ? artistMatch.matchedId : undefined
                        });
                        stats.lastfm.external++;
                    } catch { /* skip */ }
                }

                if (!mediaId) {
                    stats.lastfm.skipped++;
                    continue;
                }

                // Track-level dedup: same artist + track within 10 min = pause/resume duplicate
                const timestampMs = s.timestamp_uts * 1000;
                if (isTrackDuplicate(s.artist_name, s.track_name || '', timestampMs)) {
                    stats.lastfm.consolidated++;
                    continue;
                }

                const externalEventId = `lastfm:${s.artist_name}:${s.track_name}:${s.timestamp_uts}`;
                const result = insertHistory.run({
                    userId, mediaId, source: 'lastfm',
                    timestamp: s.timestamp,
                    durationSeconds: null, completionPct: 100,
                    externalEventId, trackName: s.track_name || null
                });

                if (result.changes > 0) {
                    trackSessionTracker.set(`${s.artist_name}::${s.track_name || ''}`, timestampMs);
                }

                // Progress updates every 2500
                if ((i + 1) % 2500 === 0 || i === scrobbles.length - 1) {
                    broadcast({
                        type: 'reconcile_progress', phase: 'matching_lastfm',
                        done: i + 1, total: scrobbles.length,
                        log: `🎵 ${i + 1}/${scrobbles.length} scrobbles — ${stats.lastfm.matched} matched, ${stats.lastfm.external} external`,
                        logType: 'info', stats: { ...stats.lastfm }
                    });
                    updateRun(runId, 'running', 'matching_lastfm', stats, JSON.stringify({ lastProcessedIndex: i }));
                }

                // Yield event loop every 500 iterations so SSE events can flush
                if ((i + 1) % 500 === 0) {
                    await new Promise(r => setTimeout(r, 0));
                    // Check for stop request
                    if (!reconcileState.running) {
                        broadcast({ type: 'reconcile_progress', log: '⏹️ Stopped by user', logType: 'warning' });
                        break;
                    }
                }
            }

            await new Promise(r => setTimeout(r, 0)); // flush final Last.fm progress
            broadcast({
                type: 'reconcile_progress', phase: 'matching_lastfm',
                log: `✅ Last.fm: ${stats.lastfm.matched} matched (T0:${stats.lastfm.tier0} T1:${stats.lastfm.tier1} T2:${stats.lastfm.tier2}), ${stats.lastfm.external} external, ${stats.lastfm.consolidated} consolidated`,
                logType: 'success'
            });
        } // end if !shouldSkip('matching_lastfm')

        // ── Phase 5: Re-match Trakt ─────────────────────────────────────
        if (shouldSkip('matching_trakt')) {
            broadcast({ type: 'reconcile_progress', phase: 'matching_trakt', log: `⏭️ Trakt matching skipped by user`, logType: 'info' });
        } else {
            reconcileState.phase = 'matching_trakt';
            sessionTracker.clear();
            const traktHistory = /** @type {any[]} */ (db.prepare(
                `SELECT * FROM trakt_history WHERE user_id = ? ORDER BY watched_at ASC`
            ).all(userId));
            stats.trakt.total = traktHistory.length;

            broadcast({
                type: 'reconcile_progress', phase: 'matching_trakt',
                log: `🎬 Matching ${traktHistory.length} Trakt history records...`, logType: 'info'
            });

            for (let i = 0; i < traktHistory.length; i++) {
                const row = traktHistory[i];
                let mediaId = null;

                if (row.type === 'movie') {
                    const movieMatch = await matchMovie(row.title, row.year, row.tmdb_id, row.imdb_id);
                    if (movieMatch) {
                        mediaId = matchChild(movieMatch.matchedId, row.title);
                        if (mediaId) {
                            stats.trakt[`tier${movieMatch.tier}`]++;
                            stats.trakt.matched++;
                        }
                    }
                    if (!mediaId) {
                        try {
                            mediaId = findOrCreateExternal({
                                mediaType: 'movie', parentTitle: row.title || 'Unknown Movie',
                                releaseYear: row.year, tmdbId: row.tmdb_id, imdbId: row.imdb_id
                            });
                            stats.trakt.external++;
                        } catch { /* */ }
                    }
                } else if (row.type === 'episode') {
                    const showMatch = await matchShow(row.show_title, row.tmdb_id, row.imdb_id);
                    if (showMatch) {
                        mediaId = matchEpisode(showMatch.matchedId, row.season_number, row.episode_number, row.title);
                        if (mediaId) {
                            stats.trakt[`tier${showMatch.tier}`]++;
                            stats.trakt.matched++;
                        }
                    }
                    if (!mediaId) {
                        try {
                            mediaId = findOrCreateExternal({
                                mediaType: 'show', parentTitle: row.show_title || 'Unknown Show',
                                childTitle: row.title || `S${row.season_number}E${row.episode_number}`,
                                tmdbId: row.tmdb_id, imdbId: row.imdb_id,
                                seasonNumber: row.season_number, itemNumber: row.episode_number
                            });
                            stats.trakt.external++;
                        } catch { /* */ }
                    }
                }

                if (!mediaId) {
                    stats.trakt.skipped++;
                    continue;
                }

                // Session consolidation
                const watchedAt = new Date(row.watched_at).getTime();
                if (isWithinSession(mediaId, watchedAt)) {
                    stats.trakt.consolidated++;
                    continue;
                }

                const result = insertHistory.run({
                    userId, mediaId, source: 'trakt',
                    timestamp: row.watched_at,
                    durationSeconds: null, completionPct: 100,
                    externalEventId: `trakt:${row.trakt_id}`,
                    trackName: row.title || null
                });

                if (result.changes > 0) {
                    sessionTracker.set(mediaId, watchedAt);
                }

                // Progress every 500
                if ((i + 1) % 500 === 0 || i === traktHistory.length - 1) {
                    broadcast({
                        type: 'reconcile_progress', phase: 'matching_trakt',
                        done: i + 1, total: traktHistory.length,
                        log: `🎬 ${i + 1}/${traktHistory.length} — ${stats.trakt.matched} matched, ${stats.trakt.external} external`,
                        logType: 'info', stats: { ...stats.trakt }
                    });
                    updateRun(runId, 'running', 'matching_trakt', stats, JSON.stringify({ lastProcessedIndex: i }));
                }

                // Yield event loop every 100 iterations so SSE events can flush
                if ((i + 1) % 100 === 0) {
                    await new Promise(r => setTimeout(r, 0));
                    if (!reconcileState.running) {
                        broadcast({ type: 'reconcile_progress', log: '⏹️ Stopped by user', logType: 'warning' });
                        break;
                    }
                }
            }

            await new Promise(r => setTimeout(r, 0)); // flush final Trakt progress
            broadcast({
                type: 'reconcile_progress', phase: 'matching_trakt',
                log: `✅ Trakt: ${stats.trakt.matched} matched (T0:${stats.trakt.tier0} T1:${stats.trakt.tier1} T2:${stats.trakt.tier2}), ${stats.trakt.external} external, ${stats.trakt.consolidated} consolidated`,
                logType: 'success'
            });

        } // end if !shouldSkip('matching_trakt')

        // ── Phase 6: Reclassify externals ────────────────────────────────
        await new Promise(r => setTimeout(r, 0)); // yield so Trakt results flush
        if (shouldSkip('reclassifying')) {
            broadcast({ type: 'reconcile_progress', phase: 'reclassifying', log: `⏭️ Reclassify skipped by user`, logType: 'info' });
        } else {
            reconcileState.phase = 'reclassifying';
            const reclassified = db.prepare(`
            UPDATE media_parents SET collection_status = 'watched_not_owned'
            WHERE jellyfin_id IS NULL AND collection_status = 'external'
        `).run();
            broadcast({
                type: 'reconcile_progress', phase: 'reclassifying',
                log: `🏷️ Reclassified ${reclassified.changes} external items to 'watched_not_owned'`, logType: 'info'
            });

            // Dedup passes (external-ID, title, children, playback history)
            const { deduplicateParents, deduplicateParentsByTitle, deduplicateChildren, deduplicatePlaybackHistory, mergeOrphanArtistsIntoAlbums } = await import('$lib/server/reconcile.js');
            const dedupResult = deduplicateParents();
            const titleDedup = deduplicateParentsByTitle();
            const childDedup = deduplicateChildren();
            const historyDedup = deduplicatePlaybackHistory();
            const orphanMerge = mergeOrphanArtistsIntoAlbums();
            const totalDeduped = dedupResult.deduped + titleDedup.deduped;
            const totalHistMoved = dedupResult.historyMoved + titleDedup.historyMoved + childDedup.historyMoved + orphanMerge.historyMoved;
            broadcast({
                type: 'reconcile_progress', phase: 'reclassifying',
                log: `🧹 Dedupe: ${totalDeduped} parents merged, ${childDedup.deduped} children merged, ${orphanMerge.merged} orphan artists→albums, ${historyDedup.removed} duplicate plays removed, ${totalHistMoved} history entries migrated`,
                logType: totalDeduped > 0 || childDedup.deduped > 0 || orphanMerge.merged > 0 ? 'success' : 'info'
            });

        } // end if !shouldSkip('reclassifying')

        // ── Phase 7b: *arr Sync ─────────────────────────────────────────
        await new Promise(r => setTimeout(r, 0)); // yield so reclassify results flush
        if (shouldSkip('arr_sync')) {
            broadcast({ type: 'reconcile_progress', phase: 'arr_sync', log: `⏭️ *arr sync skipped by user`, logType: 'info' });
        } else {
            reconcileState.phase = 'arr_sync';
            broadcast({ type: 'reconcile_progress', phase: 'arr_sync', log: '📥 Syncing *arr services...', logType: 'info' });

            try {
                const { syncAllArr } = await import('$lib/server/arr-sync.js');
                const arrResult = await syncAllArr();
                const arrParts = [];
                for (const [svc, r] of Object.entries(arrResult.results)) {
                    arrParts.push(`${svc}: ${r.matched} matched${r.created ? ` + ${r.created} created` : ''} / ${r.total}`);
                }
                if (arrParts.length > 0) {
                    broadcast({ type: 'reconcile_progress', phase: 'arr_sync', log: `📥 *arr: ${arrParts.join(', ')}`, logType: 'success' });
                } else {
                    broadcast({ type: 'reconcile_progress', phase: 'arr_sync', log: '📥 No *arr services configured — skipping', logType: 'info' });
                }
            } catch (arrErr) {
                const arrMsg = arrErr instanceof Error ? arrErr.message : String(arrErr);
                broadcast({ type: 'reconcile_progress', phase: 'arr_sync', log: `⚠️ *arr sync error: ${arrMsg}`, logType: 'warning' });
                logError('reconcile', `arr-sync failed: ${arrMsg}`);
            }
        } // end if !shouldSkip('arr_sync')
        await new Promise(r => setTimeout(r, 0)); // yield so reclassify results flush
        reconcileState.phase = 'diffing';
        broadcast({ type: 'reconcile_progress', phase: 'diffing', log: '📊 Generating diff report...', logType: 'info' });
        await new Promise(r => setTimeout(r, 0)); // yield so "Generating..." message flushes

        const diff = generateDiffReport(userId);
        stats.diff = diff;

        broadcast({ type: 'reconcile_diff', ...diff });
        broadcast({
            type: 'reconcile_progress', phase: 'diffing',
            log: `📊 Diff: ${diff.changed} changed, ${diff.improved} improved, ${diff.degraded} degraded, ${diff.newMatches} new, ${diff.consolidatedAway} session-consolidated`,
            logType: 'info'
        });

        // ── Complete ────────────────────────────────────────────────────
        const finishedAt = new Date().toISOString();
        db.prepare(`UPDATE reconcile_runs SET status = 'completed', finished_at = ?, stats = ?, diff_summary = ? WHERE id = ?`)
            .run(finishedAt, JSON.stringify(stats), JSON.stringify(diff), runId);

        db.exec(`DROP TABLE IF EXISTS _reconcile_snapshot`);
        db.exec(`DROP TABLE IF EXISTS _reconcile_backup`);

        broadcast({ type: 'reconcile_complete', stats, diff, duration: finishedAt });
        logInfo('reconcile', `Complete: LFM ${stats.lastfm.matched}/${stats.lastfm.total} matched, Trakt ${stats.trakt.matched}/${stats.trakt.total} matched`);

        reconcileState = { running: false, phase: '', runId: 0 };
        closeLogFile();
        return { success: true, stats, diff };

    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        logError('reconcile', `Failed: ${msg}`);

        // Attempt to restore from backup if it exists
        try {
            const hasBackup = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='_reconcile_backup'").get();
            if (hasBackup) {
                const restored = db.prepare(`INSERT OR IGNORE INTO playback_history SELECT * FROM _reconcile_backup`).run();
                console.log(`[reconcile] Restored ${restored.changes} playback_history rows from backup after failure`);
                broadcast({ type: 'reconcile_progress', phase: 'recovery', log: `🔄 Restored ${restored.changes} playback_history rows from backup`, logType: 'warning' });
            }
        } catch (restoreErr) {
            console.error('[reconcile] Failed to restore backup:', restoreErr instanceof Error ? restoreErr.message : String(restoreErr));
        }

        db.prepare(`UPDATE reconcile_runs SET status = 'failed', finished_at = ?, stats = ? WHERE id = ?`)
            .run(new Date().toISOString(), JSON.stringify({ ...stats, error: msg }), runId);
        db.exec(`DROP TABLE IF EXISTS _reconcile_snapshot`);
        db.exec(`DROP TABLE IF EXISTS _reconcile_backup`);
        reconcileState = { running: false, phase: '', runId: 0 };
        closeLogFile();
        broadcast({ type: 'reconcile_error', error: msg });
        throw e;
    }
}

// ─── Diff Report ────────────────────────────────────────────────────────────

/**
 * Compare current playback_history against the snapshot.
 * @param {number} userId
 * @returns {{ changed: number, improved: number, degraded: number, newMatches: number, consolidatedAway: number, details: any[] }}
 */
function generateDiffReport(userId) {
    // Find records where the matched parent actually changed.
    // Include old is_local from snapshot so we don't need per-row lookups.
    const changes = /** @type {any[]} */ (db.prepare(`
        SELECT
            snap.external_event_id,
            snap.parent_title AS old_parent,
            snap.child_title AS old_child,
            snap.parent_id AS old_parent_id,
            snap.is_local AS old_is_local,
            new_mp.title AS new_parent,
            new_mc.title AS new_child,
            new_mc.parent_id AS new_parent_id,
            CASE WHEN new_mp.jellyfin_id IS NOT NULL THEN 1 ELSE 0 END AS new_is_local
        FROM _reconcile_snapshot snap
        INNER JOIN playback_history ph ON ph.external_event_id = snap.external_event_id AND ph.user_id = ${userId}
        INNER JOIN media_children new_mc ON ph.media_id = new_mc.id
        INNER JOIN media_parents new_mp ON new_mc.parent_id = new_mp.id
        WHERE snap.parent_id != new_mc.parent_id
    `).all());

    // Count records that were in snapshot but NOT in new playback_history
    const consolidatedAway = /** @type {any} */ (db.prepare(`
        SELECT COUNT(*) as c FROM _reconcile_snapshot snap
        WHERE NOT EXISTS (
            SELECT 1 FROM playback_history ph
            WHERE ph.external_event_id = snap.external_event_id AND ph.user_id = ${userId}
        )
    `).get())?.c || 0;

    let improved = 0, degraded = 0;
    const details = [];

    for (const c of changes) {
        const oldIsLocal = !!c.old_is_local;
        const newIsLocal = !!c.new_is_local;

        let direction = 'changed';
        if (!oldIsLocal && newIsLocal) { direction = 'improved'; improved++; }
        else if (oldIsLocal && !newIsLocal) { direction = 'degraded'; degraded++; }

        details.push({
            eventId: c.external_event_id,
            oldParent: c.old_parent,
            newParent: c.new_parent || '(unmatched)',
            direction
        });
    }

    // New matches: records in new playback_history that weren't in snapshot
    const newMatchCount = /** @type {any} */ (db.prepare(`
        SELECT COUNT(*) as c FROM playback_history ph
        WHERE ph.user_id = ${userId} AND ph.source IN ('lastfm', 'trakt')
        AND NOT EXISTS (SELECT 1 FROM _reconcile_snapshot snap WHERE snap.external_event_id = ph.external_event_id)
    `).get())?.c || 0;

    return { changed: changes.length, improved, degraded, newMatches: newMatchCount, consolidatedAway, details };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * @param {number} runId
 * @param {string} status
 * @param {string} phase
 * @param {any} stats
 * @param {string} [cursor]
 */
function updateRun(runId, status, phase, stats, cursor) {
    db.prepare(`UPDATE reconcile_runs SET status = ?, phase = ?, stats = ?, progress_cursor = ? WHERE id = ?`)
        .run(status, phase, JSON.stringify(stats), cursor || null, runId);
}

/**
 * Get the latest reconcile run for a user.
 * @param {number} userId
 * @returns {any}
 */
export function getLatestRun(userId) {
    const run = /** @type {any} */ (db.prepare(
        `SELECT * FROM reconcile_runs WHERE user_id = ? ORDER BY id DESC LIMIT 1`
    ).get(userId));
    if (run?.stats) {
        try { run.stats = JSON.parse(run.stats); } catch { /* */ }
    }
    if (run?.diff_summary) {
        try { run.diff_summary = JSON.parse(run.diff_summary); } catch { /* */ }
    }
    return run || null;
}

/**
 * Stop a running reconciliation (will take effect at next progress check).
 */
export function stopReconciliation() {
    if (reconcileState.running) {
        reconcileState.running = false;
        closeLogFile();
        broadcast({ type: 'reconcile_stopped', log: '⏹️ Reconciliation stopped by user', logType: 'warn' });
    }
}
