import db from '$lib/server/db.js';
import { invalidatePrecomputed } from '$lib/server/section-cache.js';

// ─── SSE Listeners ───────────────────────────────────────────────────────────
/** @type {Set<(data: any) => void>} */
const listeners = new Set();

function broadcast(data) {
    for (const listener of listeners) {
        try {
            listener(data);
        } catch {
            listeners.delete(listener);
        }
    }
}

/**
 * Subscribe to Now Playing events.
 * @param {(data: any) => void} callback
 * @returns {() => void} unsubscribe function
 */
export function addIngestListener(callback) {
    listeners.add(callback);
    return () => listeners.delete(callback);
}

// ─── Debounce Tracking (in-memory) ──────────────────────────────────────────
/**
 * Tracks the last progress update per session to debounce seek noise.
 * @type {Map<string, { lastUpdate: number, progressTicks: number }>}
 */
const sessionDebounce = new Map();

const DEBOUNCE_MS = 2000;

// ─── Prepared Statements ─────────────────────────────────────────────────────
const upsertSession = db.prepare(`
    INSERT INTO active_sessions (id, user_id, media_id, jellyfin_item_id, title, media_type, progress_ticks, runtime_ticks, started_at, last_update, is_paused)
    VALUES (@id, @userId, @mediaId, @jellyfinItemId, @title, @mediaType, @progressTicks, @runtimeTicks, datetime('now'), datetime('now'), 0)
    ON CONFLICT(id) DO UPDATE SET
        progress_ticks = @progressTicks,
        runtime_ticks = @runtimeTicks,
        last_update = datetime('now'),
        is_paused = 0
`);

const updateSessionProgress = db.prepare(`
    UPDATE active_sessions SET progress_ticks = ?, last_update = datetime('now'), is_paused = ? WHERE id = ?
`);

const deleteSession = db.prepare(`
    DELETE FROM active_sessions WHERE id = ?
`);

const insertHistory = db.prepare(`
    INSERT OR IGNORE INTO playback_history (user_id, media_id, source, timestamp, duration_consumed_seconds, completion_pct, external_event_id, track_name, track_id)
    VALUES (@userId, @mediaId, 'webhook', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), @durationSeconds, @completionPct, @externalEventId, @trackName, @trackId)
`);

const findMediaByJellyfinId = db.prepare(`
    SELECT mc.id, mp.media_type FROM media_children mc
    JOIN media_parents mp ON mc.parent_id = mp.id
    WHERE mc.jellyfin_id = ?
`);

const findMediaByParentJellyfinId = db.prepare(`
    SELECT mc.id, mp.media_type FROM media_children mc
    JOIN media_parents mp ON mc.parent_id = mp.id
    WHERE mp.jellyfin_id = ?
    LIMIT 1
`);

// Music track lookup — individual songs are in the tracks table, not media_children
const findTrackByJellyfinId = db.prepare(`
    SELECT t.id as track_id, t.album_id, t.title as track_title
    FROM tracks t WHERE t.jellyfin_id = ?
`);

const findUserByJellyfinId = db.prepare(`
    SELECT u.id FROM users u
    JOIN user_identities ui ON u.id = ui.user_id
    WHERE ui.provider = 'jellyfin' AND ui.provider_uid = ?
`);

// Also try the legacy column
const findUserByLegacyJellyfinId = db.prepare(`
    SELECT id FROM users WHERE jellyfin_user_id = ?
`);

const getActiveSessions = db.prepare(`
    SELECT * FROM active_sessions ORDER BY last_update DESC
`);

const cleanStaleSessions = db.prepare(`
    DELETE FROM active_sessions WHERE last_update < datetime('now', '-30 minutes')
`);

// ─── Item Mapping ────────────────────────────────────────────────────────────
/**
 * Resolve a Jellyfin webhook payload to a media_children.id + media type.
 * @param {any} payload - Jellyfin webhook payload
 * @returns {{ mediaId: number, mediaType: string } | null}
 */
function resolveMediaItem(payload) {
    const itemId = payload.ItemId || payload.Item?.Id;
    if (!itemId) return null;

    // Try direct match on media_children.jellyfin_id
    const direct = /** @type {any} */ (findMediaByJellyfinId.get(itemId));
    if (direct) return { mediaId: direct.id, mediaType: direct.media_type };

    // Try parent match (for movies where child ID = parent_id + '_child')
    const childId = itemId + '_child';
    const movieChild = /** @type {any} */ (findMediaByJellyfinId.get(childId));
    if (movieChild) return { mediaId: movieChild.id, mediaType: movieChild.media_type };

    // Try by parent jellyfin_id
    const parentMatch = /** @type {any} */ (findMediaByParentJellyfinId.get(itemId));
    if (parentMatch) return { mediaId: parentMatch.id, mediaType: parentMatch.media_type };

    // Music: individual tracks are stored in the tracks table, not media_children.
    // Look up by track jellyfin_id → album_id (which IS a media_children.id).
    const track = /** @type {any} */ (findTrackByJellyfinId.get(itemId));
    if (track) return { mediaId: track.album_id, mediaType: 'artist', trackTitle: track.track_title, trackId: track.track_id };

    return null;
}

/**
 * Resolve a Jellyfin user ID to a Mediajam user ID.
 * @param {string} jellyfinUserId
 * @returns {number | null}
 */
function resolveUser(jellyfinUserId) {
    if (!jellyfinUserId) return null;

    // Try user_identities first
    const identity = /** @type {any} */ (findUserByJellyfinId.get(jellyfinUserId));
    if (identity) return identity.id;

    // Fallback to legacy column
    const legacy = /** @type {any} */ (findUserByLegacyJellyfinId.get(jellyfinUserId));
    if (legacy) return legacy.id;

    return null;
}

// ─── Scrobble Logic ──────────────────────────────────────────────────────────
/**
 * Determine whether playback should be committed to history.
 * @param {string} mediaType - 'show', 'movie', 'artist'
 * @param {number} progressTicks - Current playback position in ticks
 * @param {number} runtimeTicks - Total duration in ticks
 * @returns {boolean}
 */
function shouldScrobble(mediaType, progressTicks, runtimeTicks) {
    if (!runtimeTicks || runtimeTicks <= 0) return false;

    const completionPct = (progressTicks / runtimeTicks) * 100;
    const durationSeconds = progressTicks / 10000000;

    if (mediaType === 'artist') {
        // Music: > 30 seconds AND (> 50% OR > 4 minutes)
        return durationSeconds > 30 && (completionPct > 50 || durationSeconds > 240);
    } else {
        // Video (show/movie): > 90% completion
        return completionPct > 90;
    }
}

// ─── Webhook Handlers ────────────────────────────────────────────────────────

/**
 * Handle a PlaybackStart event from Jellyfin.
 * @param {any} payload
 */
export function handlePlaybackStart(payload) {
    const sessionId = payload.Session?.Id || payload.SessionId || `unknown_${Date.now()}`;
    const jellyfinUserId = payload.User?.Id || payload.UserId;
    const userId = resolveUser(jellyfinUserId);
    const resolved = resolveMediaItem(payload);
    const itemId = payload.ItemId || payload.Item?.Id;

    const runtimeTicks = payload.Item?.RunTimeTicks || payload.RunTimeTicks || 0;
    const title = payload.Item?.Name || payload.Name || 'Unknown';
    const itemType = payload.Item?.Type || payload.ItemType || '';

    let mediaType = 'movie';
    if (itemType === 'Episode') mediaType = 'episode';
    else if (itemType === 'Audio') mediaType = 'track';

    // Clean stale sessions
    cleanStaleSessions.run();

    upsertSession.run({
        id: sessionId,
        userId: userId,
        mediaId: resolved?.mediaId || null,
        jellyfinItemId: itemId || null,
        title,
        mediaType,
        progressTicks: 0,
        runtimeTicks
    });

    // Init debounce tracker
    sessionDebounce.set(sessionId, { lastUpdate: Date.now(), progressTicks: 0 });

    broadcast({
        type: 'now_playing_start',
        sessionId,
        userId,
        title,
        mediaType,
        runtimeTicks
    });
}

/**
 * Handle a PlaybackProgress event from Jellyfin.
 * Debounces rapid updates (seek noise).
 * @param {any} payload
 */
export function handlePlaybackProgress(payload) {
    const sessionId = payload.Session?.Id || payload.SessionId;
    if (!sessionId) return;

    const progressTicks = payload.PlaybackPosition || payload.Item?.PlaybackPositionTicks || 0;
    const isPaused = payload.IsPaused || false;

    // Debounce: skip if less than DEBOUNCE_MS since last update
    const debounce = sessionDebounce.get(sessionId);
    const now = Date.now();
    if (debounce && (now - debounce.lastUpdate) < DEBOUNCE_MS) {
        return; // Skip — too soon
    }

    // Update debounce tracker
    sessionDebounce.set(sessionId, { lastUpdate: now, progressTicks });

    // Update session in DB
    updateSessionProgress.run(progressTicks, isPaused ? 1 : 0, sessionId);

    broadcast({
        type: 'now_playing_progress',
        sessionId,
        progressTicks,
        isPaused
    });
}

/**
 * Handle a PlaybackStop event from Jellyfin.
 * Evaluates scrobble threshold and commits to history if met.
 * @param {any} payload
 */
export function handlePlaybackStop(payload) {
    const sessionId = payload.Session?.Id || payload.SessionId;
    if (!sessionId) return;

    const progressTicks = payload.PlaybackPosition || payload.Item?.PlaybackPositionTicks || 0;
    const jellyfinUserId = payload.User?.Id || payload.UserId;
    const userId = resolveUser(jellyfinUserId);
    const resolved = resolveMediaItem(payload);
    const runtimeTicks = payload.Item?.RunTimeTicks || payload.RunTimeTicks || 0;

    // Evaluate scrobble threshold
    if (userId && resolved && shouldScrobble(resolved.mediaType, progressTicks, runtimeTicks)) {
        const completionPct = runtimeTicks > 0 ? Math.round((progressTicks / runtimeTicks) * 1000) / 10 : 0;
        const durationSeconds = Math.round(progressTicks / 10000000);
        const externalEventId = `webhook:${sessionId}:${Math.floor(Date.now() / 1000)}`;

        try {
            insertHistory.run({
                userId,
                mediaId: resolved.mediaId,
                durationSeconds,
                completionPct,
                externalEventId,
                trackName: resolved.trackTitle || payload.Item?.Name || null,
                trackId: resolved.trackId || null
            });

            // Invalidate music page cache so recent listening updates promptly
            if (resolved.mediaType === 'artist') {
                try { invalidatePrecomputed('music-smart'); } catch { /* non-fatal */ }
            }

            broadcast({
                type: 'scrobble',
                sessionId,
                userId,
                mediaId: resolved.mediaId,
                mediaType: resolved.mediaType,
                completionPct,
                durationSeconds
            });
        } catch (e) {
            console.error('[ingest] Failed to insert history:', e instanceof Error ? e.message : String(e));
        }
    }

    // Remove session
    deleteSession.run(sessionId);
    sessionDebounce.delete(sessionId);

    broadcast({
        type: 'now_playing_stop',
        sessionId
    });
}

// ─── Public Helpers ──────────────────────────────────────────────────────────

/**
 * Get all currently active playback sessions.
 * @returns {any[]}
 */
export function getActivePlaying() {
    cleanStaleSessions.run();
    return getActiveSessions.all();
}

/**
 * Parse a Jellyfin webhook payload and route to the appropriate handler.
 * @param {any} payload
 * @returns {{ handled: boolean, action: string }}
 */
export function processWebhook(payload) {
    const notificationType = payload.NotificationType || payload.Event || '';

    switch (notificationType) {
        case 'PlaybackStart':
            handlePlaybackStart(payload);
            return { handled: true, action: 'start' };

        case 'PlaybackProgress':
            handlePlaybackProgress(payload);
            return { handled: true, action: 'progress' };

        case 'PlaybackStop':
            handlePlaybackStop(payload);
            return { handled: true, action: 'stop' };

        default:
            // Unknown event type — log but don't error
            console.log(`[ingest] Ignoring event type: ${notificationType}`);
            return { handled: false, action: notificationType };
    }
}
