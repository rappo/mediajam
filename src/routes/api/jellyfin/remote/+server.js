import { json } from '@sveltejs/kit';
import db from '$lib/server/db.js';
import { createJellyfinApi } from '$lib/server/jellyfin.js';
import { getSessionApi } from '@jellyfin/sdk/lib/utils/api/session-api.js';

/**
 * POST /api/jellyfin/remote — Send playback commands to a Jellyfin session
 *
 * Body: { sessionId, action, itemIds?, seekPositionTicks? }
 * Actions: play, play_next, queue, pause, unpause, stop, next, prev, seek
 *
 * @type {import('./$types').RequestHandler}
 */
export async function POST({ request, locals }) {
    if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

    const { sessionId, action, itemIds, seekPositionTicks } = await request.json();

    if (!sessionId || !action) {
        return json({ error: 'Missing sessionId or action' }, { status: 400 });
    }

    const settings = /** @type {any} */ (db.prepare('SELECT * FROM app_settings WHERE id = 1').get());
    const identity = /** @type {any} */ (db.prepare(
        "SELECT access_token FROM user_identities WHERE user_id = ? AND provider = 'jellyfin'"
    ).get(locals.user.id));

    if (!settings?.jellyfin_url || !identity?.access_token) {
        return json({ error: 'Jellyfin not configured' }, { status: 400 });
    }

    try {
        const api = createJellyfinApi(settings.jellyfin_url, identity.access_token);
        const sessionApi = getSessionApi(api);

        // Play commands — send items to a player
        if (['play', 'play_next', 'queue'].includes(action)) {
            if (!itemIds?.length) {
                return json({ error: 'itemIds required for play commands' }, { status: 400 });
            }
            const playCommandMap = /** @type {Record<string, string>} */ ({
                play: 'PlayNow',
                play_next: 'PlayNext',
                queue: 'PlayLast',
            });
            await sessionApi.play({
                sessionId,
                playCommand: /** @type {any} */ (playCommandMap[action]),
                itemIds,
            });
            return json({ success: true, action, sessionId });
        }

        // Playstate commands — control current playback
        const playstateMap = /** @type {Record<string, string>} */ ({
            pause: 'Pause',
            unpause: 'Unpause',
            stop: 'Stop',
            next: 'NextTrack',
            prev: 'PreviousTrack',
            seek: 'Seek',
        });

        if (playstateMap[action]) {
            await sessionApi.sendPlaystateCommand({
                sessionId,
                command: /** @type {any} */ (playstateMap[action]),
                ...(action === 'seek' && seekPositionTicks != null ? { seekPositionTicks } : {}),
            });
            return json({ success: true, action, sessionId });
        }

        return json({ error: `Unknown action: ${action}` }, { status: 400 });
    } catch (e) {
        console.error('[remote] Error sending command to Jellyfin:', e);
        const message = e instanceof Error ? e.message : String(e);
        return json({ error: message }, { status: 500 });
    }
}
