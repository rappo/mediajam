import db from '$lib/server/db.js';

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
 * Subscribe to *arr webhook events.
 * @param {(data: any) => void} callback
 * @returns {() => void} unsubscribe function
 */
export function addArrEventListener(callback) {
    listeners.add(callback);
    return () => listeners.delete(callback);
}

// ─── Prepared Statements ─────────────────────────────────────────────────────
const insertEvent = db.prepare(`
    INSERT INTO arr_events (service, event_type, title, detail)
    VALUES (@service, @eventType, @title, @detail)
`);

const selectRecentEvents = db.prepare(`
    SELECT * FROM arr_events ORDER BY created_at DESC LIMIT ?
`);

// ─── Service Detection ───────────────────────────────────────────────────────
/**
 * Auto-detect which *arr service sent the payload based on payload shape.
 * @param {any} payload
 * @returns {string}
 */
function detectService(payload) {
    if (payload.movie || payload.remoteMovie) return 'radarr';
    if (payload.series || payload.episodes) return 'sonarr';
    if (payload.artist || payload.album) return 'lidarr';
    return 'unknown';
}

// ─── Event Normalization ─────────────────────────────────────────────────────
/**
 * Build a human-readable quality + indexer string for Grab events.
 * @param {any} payload
 * @returns {string | null}
 */
function grabDetail(payload) {
    const parts = [];
    const quality = payload.release?.quality || payload.release?.qualityVersion;
    if (quality) parts.push(typeof quality === 'string' ? quality : quality.quality?.name || '');
    if (payload.release?.releaseTitle) {
        // Extract quality from release title as fallback
        if (parts.length === 0 || parts[0] === '') {
            const match = payload.release.releaseTitle.match(/(WEBDL|WEB-DL|HDTV|Bluray|BluRay|Remux|WEBRip|FLAC|MP3)[-.]?(\d{3,4}p?)?/i);
            if (match) parts[0] = match[0].replace(/\./g, '-');
        }
    }
    if (payload.release?.indexer) parts.push(`via ${payload.release.indexer}`);
    return parts.filter(Boolean).join(' ') || null;
}

/**
 * Build Sonarr episode info string like `S02E05 "Episode Title"`.
 * @param {any} payload
 * @returns {string | null}
 */
function sonarrEpisodeInfo(payload) {
    const episodes = payload.episodes;
    if (!Array.isArray(episodes) || episodes.length === 0) return null;
    const ep = episodes[0];
    const season = String(ep.seasonNumber ?? '').padStart(2, '0');
    const episode = String(ep.episodeNumber ?? '').padStart(2, '0');
    const tag = `S${season}E${episode}`;
    return ep.title ? `${tag} "${ep.title}"` : tag;
}

/**
 * Normalize an *arr webhook payload into a consistent event format.
 * @param {any} payload
 * @param {string} service
 * @returns {{ service: string, eventType: string, title: string, detail: string | null }}
 */
function normalizeEvent(payload, service) {
    const eventType = payload.eventType || 'Unknown';
    /** @type {string} */
    let title = 'Unknown';
    /** @type {string | null} */
    let detail = null;

    switch (eventType) {
        case 'Grab': {
            if (service === 'radarr') {
                title = payload.movie?.title || payload.remoteMovie?.title || 'Unknown Movie';
            } else if (service === 'sonarr') {
                title = payload.series?.title || 'Unknown Series';
                const epInfo = sonarrEpisodeInfo(payload);
                if (epInfo) title = `${title} — ${epInfo}`;
            } else if (service === 'lidarr') {
                title = payload.artist?.artistName || payload.artist?.name || 'Unknown Artist';
            }
            detail = grabDetail(payload);
            break;
        }

        case 'Download': {
            if (service === 'radarr') {
                title = payload.movie?.title || payload.remoteMovie?.title || 'Unknown Movie';
                detail = payload.movieFile?.relativePath || payload.movieFile?.quality?.quality?.name || null;
            } else if (service === 'sonarr') {
                title = payload.series?.title || 'Unknown Series';
                const epInfo = sonarrEpisodeInfo(payload);
                const quality = payload.episodeFile?.quality?.quality?.name || null;
                detail = [epInfo, quality].filter(Boolean).join(' — ') || null;
            } else if (service === 'lidarr') {
                title = payload.artist?.artistName || payload.artist?.name || 'Unknown Artist';
                detail = payload.trackFile?.path || payload.trackFile?.quality?.quality?.name || null;
            }
            break;
        }

        case 'MovieAdded': {
            title = payload.movie?.title || 'Unknown Movie';
            detail = payload.movie?.year ? String(payload.movie.year) : null;
            break;
        }

        case 'SeriesAdd': {
            title = payload.series?.title || 'Unknown Series';
            detail = payload.series?.year ? String(payload.series.year) : null;
            break;
        }

        case 'AlbumAdded': {
            title = payload.artist?.artistName || payload.artist?.name || 'Unknown Artist';
            detail = payload.album?.title || null;
            break;
        }

        case 'MovieDelete':
        case 'SeriesDelete': {
            title = payload.movie?.title || payload.series?.title || 'Unknown';
            detail = null;
            break;
        }

        case 'ArtistDelete': {
            title = payload.artist?.artistName || payload.artist?.name || 'Unknown Artist';
            detail = null;
            break;
        }

        case 'MovieFileDelete': {
            title = payload.movie?.title || 'Unknown Movie';
            detail = payload.movieFile?.relativePath || null;
            break;
        }

        case 'EpisodeFileDelete': {
            title = payload.series?.title || 'Unknown Series';
            detail = payload.episodeFile?.relativePath || null;
            break;
        }

        case 'Rename': {
            title = payload.movie?.title || payload.series?.title || payload.artist?.artistName || payload.artist?.name || 'Unknown';
            detail = null;
            break;
        }

        case 'Health': {
            title = 'Health Check';
            detail = payload.message || null;
            break;
        }

        case 'Test': {
            title = 'Connection Test';
            detail = service !== 'unknown' ? service : null;
            break;
        }

        default: {
            // Unknown event type — extract whatever title we can
            title = payload.movie?.title || payload.series?.title || payload.artist?.artistName || payload.artist?.name || eventType;
            detail = null;
            break;
        }
    }

    return { service, eventType, title, detail };
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Process an incoming *arr webhook payload.
 * Normalizes the event, inserts into DB, and broadcasts via SSE.
 * @param {any} payload
 * @param {string | null} service — optional, auto-detected if null
 * @returns {{ service: string, eventType: string, title: string, detail: string | null }}
 */

/**
 * Handle *arr delete events by updating the MediaJam library.
 * - For 'wanted' stubs: delete the row entirely (it was only an arr placeholder)
 * - For collected items: clear the arr fields but keep the library entry
 * @param {any} payload
 * @param {string} service
 * @param {string} eventType
 */
function handleDeleteEvent(payload, service, eventType) {
    try {
        /** @type {{ idColumn: string, tmdbId?: number, imdbId?: string, tvdbId?: number, mbId?: string, arrId?: number }} */
        const match = { idColumn: '' };

        if (eventType === 'MovieDelete' && service === 'radarr') {
            match.idColumn = 'radarr_id';
            match.tmdbId = payload.movie?.tmdbId;
            match.imdbId = payload.movie?.imdbId;
            match.arrId = payload.movie?.id;
        } else if (eventType === 'SeriesDelete' && service === 'sonarr') {
            match.idColumn = 'sonarr_id';
            match.tvdbId = payload.series?.tvdbId;
            match.imdbId = payload.series?.imdbId;
            match.arrId = payload.series?.id;
        } else if (eventType === 'ArtistDelete' && service === 'lidarr') {
            match.idColumn = 'lidarr_id';
            match.mbId = payload.artist?.foreignArtistId;
            match.arrId = payload.artist?.id;
        } else {
            return; // Not a recognized delete event
        }

        // Find matching media_parents row(s) by external IDs or arr internal ID
        const conditions = [];
        const params = [];

        if (match.arrId) {
            conditions.push(`${match.idColumn} = ?`);
            params.push(match.arrId);
        }
        if (match.tmdbId) {
            conditions.push('tmdb_id = ?');
            params.push(String(match.tmdbId));
        }
        if (match.imdbId) {
            conditions.push('imdb_id = ?');
            params.push(match.imdbId);
        }
        if (match.tvdbId) {
            conditions.push('tvdb_id = ?');
            params.push(String(match.tvdbId));
        }
        if (match.mbId) {
            conditions.push('musicbrainz_id = ?');
            params.push(match.mbId);
        }

        if (conditions.length === 0) {
            console.log(`[arr-webhook] ⚠️ Delete event has no matchable IDs, skipping library update`);
            return;
        }

        const rows = /** @type {any[]} */ (db.prepare(
            `SELECT id, collection_status, title FROM media_parents WHERE ${conditions.join(' OR ')}`
        ).all(...params));

        if (rows.length === 0) {
            console.log(`[arr-webhook] ℹ️ No matching library entry found for delete event`);
            return;
        }

        for (const row of rows) {
            if (row.collection_status === 'wanted') {
                // Delete the wanted stub entirely — it was only created by arr sync
                // First delete child rows
                db.prepare('DELETE FROM media_children WHERE parent_id = ?').run(row.id);
                db.prepare('DELETE FROM person_credits WHERE media_parent_id = ?').run(row.id);
                db.prepare('DELETE FROM media_parents WHERE id = ?').run(row.id);
                console.log(`[arr-webhook] 🗑️ Removed wanted stub: "${row.title}" (id=${row.id})`);
            } else {
                // Clear arr fields but keep the library entry
                db.prepare(`
                    UPDATE media_parents SET
                        ${match.idColumn} = NULL,
                        arr_monitored = NULL,
                        arr_has_file = NULL,
                        arr_quality_profile = NULL,
                        arr_status = NULL,
                        arr_slug = NULL
                    WHERE id = ?
                `).run(row.id);
                console.log(`[arr-webhook] 🔄 Cleared arr fields for: "${row.title}" (id=${row.id}, status=${row.collection_status})`);
            }
        }
    } catch (e) {
        console.error('[arr-webhook] Delete handling error:', e instanceof Error ? e.message : String(e));
    }
}

export function processArrWebhook(payload, service) {
    const resolvedService = service || detectService(payload);
    const event = normalizeEvent(payload, resolvedService);

    console.log(`[arr-webhook] 📡 ${event.service}/${event.eventType}: ${event.title}${event.detail ? ` (${event.detail})` : ''}`);

    // Persist to DB
    try {
        insertEvent.run({
            service: event.service,
            eventType: event.eventType,
            title: event.title,
            detail: event.detail,
        });
    } catch (e) {
        console.error('[arr-webhook] DB insert error:', e instanceof Error ? e.message : String(e));
    }

    // Handle delete events — update library immediately
    if (['MovieDelete', 'SeriesDelete', 'ArtistDelete'].includes(event.eventType)) {
        handleDeleteEvent(payload, resolvedService, event.eventType);
    }

    // Broadcast to SSE listeners
    broadcast({
        type: 'arr_event',
        ...event,
        timestamp: new Date().toISOString(),
    });

    return event;
}

/**
 * Get recent *arr webhook events from the database.
 * @param {number} [limit=20]
 * @returns {any[]}
 */
export function getRecentEvents(limit = 20) {
    return /** @type {any[]} */ (selectRecentEvents.all(limit));
}

/**
 * Broadcast a general activity log event to all connected SSE clients.
 * @param {any} activity
 */
export function broadcastActivity(activity) {
    broadcast({
        type: 'activity_log',
        ...activity,
    });
}
