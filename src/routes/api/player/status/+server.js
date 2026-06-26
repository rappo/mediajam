import { json } from '@sveltejs/kit';
import db from '$lib/server/db.js';
import { createJellyfinApi } from '$lib/server/jellyfin.js';
import { getSessionApi } from '@jellyfin/sdk/lib/utils/api/session-api.js';

// Server-side cache to prevent repeated calls from multiple tabs
/** @type {{ data: any, timestamp: number } | null} */
let statusCache = null;
const CACHE_TTL_MS = 15_000;

/**
 * GET /api/player/status — Returns the default player's current status
 * Combines Boiler Room device state and Jellyfin session data.
 * Results are cached server-side for 15 seconds.
 * @type {import('./$types').RequestHandler}
 */
export async function GET({ locals }) {
    if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

    // Return cached result if still fresh
    if (statusCache && Date.now() - statusCache.timestamp < CACHE_TTL_MS) {
        return json(statusCache.data);
    }

    // --- Load user preferences ---
    const userRow = /** @type {any} */ (db.prepare('SELECT preferences FROM users WHERE id = ?').get(locals.user.id));
    const prefs = userRow?.preferences ? JSON.parse(userRow.preferences) : {};
    const savedPlayers = prefs.savedPlayers || [];
    const defaultPlayerId = prefs.defaultPlayerId || '';

    const player = savedPlayers.find((/** @type {any} */ p) => p.deviceId === defaultPlayerId);
    if (!player) {
        const result = { status: 'offline', error: 'No default player configured' };
        statusCache = { data: result, timestamp: Date.now() };
        return json(result);
    }

    // --- Fetch Boiler Room status (if configured) ---
    /** @type {any} */
    let boilerRoom = null;
    if (player.boilerRoomUrl) {
        try {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 5000);
            const res = await fetch(`${player.boilerRoomUrl}/api/v1/status`, {
                signal: controller.signal,
            });
            clearTimeout(timer);
            if (res.ok) {
                boilerRoom = await res.json();
            }
        } catch {
            // Boiler Room unreachable — leave null
        }
    }

    // --- Fetch Jellyfin sessions ---
    /** @type {any} */
    let matchedSession = null;

    const settings = /** @type {any} */ (db.prepare('SELECT * FROM app_settings WHERE id = 1').get());
    const identity = /** @type {any} */ (db.prepare(
        "SELECT access_token FROM user_identities WHERE user_id = ? AND provider = 'jellyfin'"
    ).get(locals.user.id));
    const accessToken = identity?.access_token || settings?.jellyfin_access_token;

    if (settings?.jellyfin_url && accessToken) {
        try {
            const api = createJellyfinApi(settings.jellyfin_url, accessToken);
            const sessionApi = getSessionApi(api);

            const timeoutMs = 5000;
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), timeoutMs);

            /** @type {any} */
            let sessionsResult;
            try {
                sessionsResult = await Promise.race([
                    sessionApi.getSessions(),
                    new Promise((_, reject) =>
                        controller.signal.addEventListener('abort', () =>
                            reject(new Error('Jellyfin request timed out'))
                        )
                    ),
                ]);
            } finally {
                clearTimeout(timer);
            }

            const sessions = sessionsResult?.data || [];
            matchedSession = sessions.find(
                (/** @type {any} */ s) =>
                    s.DeviceName === player.deviceName && s.Client === player.client
            );
        } catch {
            // Jellyfin unreachable — leave null
        }
    }

    // --- Determine status ---
    let status = 'offline';
    let currentApp = boilerRoom?.current_app || null;
    const hasNowPlaying = !!matchedSession?.NowPlayingItem;

    if (player.boilerRoomUrl) {
        if (!boilerRoom && !matchedSession) {
            status = 'offline';
        } else if (boilerRoom?.state === 'idle' && matchedSession && hasNowPlaying) {
            status = 'playing';
        } else if (boilerRoom?.state === 'idle' && matchedSession && !hasNowPlaying) {
            status = 'idle';
        } else if (boilerRoom?.state === 'idle' && !matchedSession) {
            status = 'online';
        } else if (boilerRoom?.state === 'running' && currentApp?.toLowerCase().includes('jellyfin')) {
            status = hasNowPlaying ? 'playing' : 'idle';
        } else if (boilerRoom?.state === 'running') {
            status = 'busy';
        } else if (boilerRoom?.state === 'playing') {
            status = 'busy';
        }
    } else {
        // No Boiler Room URL configured
        if (matchedSession && hasNowPlaying) {
            status = 'playing';
        } else if (matchedSession && !hasNowPlaying) {
            status = 'idle';
        } else {
            status = 'offline';
        }
    }

    const result = {
        status,
        deviceName: player.deviceName || null,
        currentApp,
        nowPlaying: matchedSession?.NowPlayingItem
            ? {
                name: matchedSession.NowPlayingItem.Name,
                type: matchedSession.NowPlayingItem.Type,
                seriesName: matchedSession.NowPlayingItem.SeriesName || null,
            }
            : null,
        sessionId: matchedSession?.Id || null,
        canLaunch: !!player.boilerRoomUrl,
        playState: matchedSession?.PlayState
            ? { isPaused: matchedSession.PlayState.IsPaused }
            : null,
    };

    statusCache = { data: result, timestamp: Date.now() };
    return json(result);
}
