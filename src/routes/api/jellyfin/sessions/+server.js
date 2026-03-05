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

    if (!settings?.jellyfin_url || !identity?.access_token) {
        return json({ sessions: [], error: 'Jellyfin not configured' });
    }

    try {
        const api = createJellyfinApi(settings.jellyfin_url, identity.access_token);
        const sessionApi = getSessionApi(api);
        const { data: sessions } = await sessionApi.getSessions();

        const all = (sessions || [])
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
            .sort((a, b) => {
                if (a.supportsMediaControl !== b.supportsMediaControl) return b.supportsMediaControl ? 1 : -1;
                return new Date(b.lastActivityDate || 0).getTime() - new Date(a.lastActivityDate || 0).getTime();
            });

        return json({ sessions: all });
    } catch (e) {
        console.error('[sessions] Error fetching Jellyfin sessions:', e);
        return json({ sessions: [], error: 'Failed to fetch sessions' });
    }
}
