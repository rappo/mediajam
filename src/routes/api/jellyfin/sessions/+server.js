import { json } from '@sveltejs/kit';
import db from '$lib/server/db.js';
import { createJellyfinApi } from '$lib/server/jellyfin.js';
import { getSessionApi } from '@jellyfin/sdk/lib/utils/api/session-api.js';

/**
 * GET /api/jellyfin/sessions — List active controllable Jellyfin players
 * @type {import('./$types').RequestHandler}
 */
export async function GET({ locals }) {
    if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

    const settings = /** @type {any} */ (db.prepare('SELECT * FROM app_settings WHERE id = 1').get());
    const identity = /** @type {any} */ (db.prepare(
        "SELECT access_token FROM user_identities WHERE user_id = ? AND provider = 'jellyfin'"
    ).get(locals.user.id));

    // Use user's token first, fall back to admin token from app_settings
    const accessToken = identity?.access_token || settings?.jellyfin_access_token;

    if (!settings?.jellyfin_url || !accessToken) {
        return json({ sessions: [], error: 'Jellyfin not configured. Set it up in System Settings.' });
    }

    try {
        const api = createJellyfinApi(settings.jellyfin_url, accessToken);
        const sessionApi = getSessionApi(api);

        // Add timeout so we don't hang when Jellyfin is unreachable
        const timeoutMs = 10000;
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

        const all = sessions
            .map((/** @type {any} */ s) => ({
                id: s.Id,
                deviceName: s.DeviceName,
                deviceId: s.DeviceId,
                client: s.Client,
                userName: s.UserName,
                supportsMediaControl: !!s.SupportsMediaControl,
                lastActivityDate: s.LastActivityDate,
                nowPlaying: s.NowPlayingItem ? {
                    name: s.NowPlayingItem.Name,
                    type: s.NowPlayingItem.Type,
                    id: s.NowPlayingItem.Id,
                    seriesName: s.NowPlayingItem.SeriesName,
                    seasonName: s.NowPlayingItem.SeasonName,
                } : null,
                playState: s.PlayState ? {
                    isPaused: s.PlayState.IsPaused,
                    positionTicks: s.PlayState.PositionTicks,
                } : null,
            }))
            // Sort: controllable first, then by last activity
            .sort((/** @type {any} */ a, /** @type {any} */ b) => {
                if (a.supportsMediaControl !== b.supportsMediaControl) return b.supportsMediaControl ? 1 : -1;
                return new Date(b.lastActivityDate || 0).getTime() - new Date(a.lastActivityDate || 0).getTime();
            });

        return json({ sessions: all });
    } catch (/** @type {any} */ e) {
        const status = e?.response?.status;
        const detail = e?.response?.data?.Message || e?.response?.data || e?.message || String(e);
        console.error(`[sessions] Error fetching Jellyfin sessions (${settings.jellyfin_url}):`, status || '', detail);

        let userMessage = 'Failed to fetch sessions';
        if (e?.message?.includes('timed out')) {
            userMessage = `Cannot reach Jellyfin server at ${settings.jellyfin_url} (timed out after 10s). Is it running?`;
        } else if (status === 401 || status === 403) {
            userMessage = 'Jellyfin auth token is invalid or expired. Try reconnecting in System Settings.';
        } else if (e?.code === 'ECONNREFUSED' || e?.code === 'ENOTFOUND') {
            userMessage = `Cannot reach Jellyfin server at ${settings.jellyfin_url}. Is it running?`;
        } else if (status) {
            userMessage = `Jellyfin returned HTTP ${status}: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`;
        } else if (e?.message) {
            userMessage = `Jellyfin error: ${e.message}`;
        }
        return json({ sessions: [], error: userMessage });
    }
}

