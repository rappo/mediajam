import { json } from '@sveltejs/kit';
import db from '$lib/server/db.js';
import { createJellyfinApi } from '$lib/server/jellyfin.js';
import { getSessionApi } from '@jellyfin/sdk/lib/utils/api/session-api.js';

/**
 * POST /api/player/play — One-click play: launch Jellyfin if needed, poll for session, send play command
 *
 * Body: { jellyfinId: string, action?: 'play' | 'queue' }
 *
 * @type {import('./$types').RequestHandler}
 */
export async function POST({ request, locals }) {
    if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

    const body = await request.json().catch(() => ({}));
    const { jellyfinId, action = 'play' } = body;

    if (!jellyfinId) {
        return json({ error: 'Missing jellyfinId' }, { status: 400 });
    }

    // --- Load user preferences ---
    const userRow = /** @type {any} */ (db.prepare('SELECT preferences FROM users WHERE id = ?').get(locals.user.id));
    const prefs = userRow?.preferences ? JSON.parse(userRow.preferences) : {};
    const savedPlayers = prefs.savedPlayers || [];
    const defaultPlayerId = prefs.defaultPlayerId || '';

    const player = savedPlayers.find((/** @type {any} */ p) => p.deviceId === defaultPlayerId)
        || (savedPlayers.length === 1 ? savedPlayers[0] : null);
    if (!player) {
        return json({ error: 'No default player configured' }, { status: 400 });
    }

    // --- Setup Jellyfin API ---
    const settings = /** @type {any} */ (db.prepare('SELECT * FROM app_settings WHERE id = 1').get());
    const identity = /** @type {any} */ (db.prepare(
        "SELECT access_token FROM user_identities WHERE user_id = ? AND provider = 'jellyfin'"
    ).get(locals.user.id));

    if (!settings?.jellyfin_url || !identity?.access_token) {
        return json({ error: 'Jellyfin not configured' }, { status: 400 });
    }

    const api = createJellyfinApi(settings.jellyfin_url, identity.access_token);
    const sessionApi = getSessionApi(api);

    /**
     * Find a Jellyfin session matching the default player
     * @returns {Promise<any>}
     */
    async function findSession() {
        try {
            const result = /** @type {any} */ (await sessionApi.getSessions());
            const sessions = result?.data || [];
            return sessions.find(
                (/** @type {any} */ s) =>
                    s.DeviceName === player.deviceName && s.Client === player.client
            ) || null;
        } catch {
            return null;
        }
    }

    /**
     * Send play command to a session
     * @param {any} session
     */
    async function sendPlayCommand(session) {
        const playCommandMap = /** @type {Record<string, string>} */ ({
            play: 'PlayNow',
            queue: 'PlayLast',
        });
        await sessionApi.play({
            sessionId: session.Id,
            playCommand: /** @type {any} */ (playCommandMap[action] || 'PlayNow'),
            itemIds: [jellyfinId],
        });
    }

    /**
     * Wait for delay ms
     * @param {number} ms
     */
    function sleep(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    try {
        // Step 1: Check for an existing session
        let session = await findSession();

        if (session) {
            // Session already exists — send play command immediately
            await sendPlayCommand(session);
            return json({ success: true, action });
        }

        // Step 2: No session — try to launch Jellyfin via Boiler Room
        if (!player.boilerRoomUrl) {
            return json({ error: 'Player not available' }, { status: 404 });
        }

        const appId = player.jellyfinAppId || 'org.jellyfin.JellyfinDesktop';

        try {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 10_000);

            const launchRes = await fetch(`${player.boilerRoomUrl}/api/v1/launch`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ type: 'app', appid: appId }),
                signal: controller.signal,
            });
            clearTimeout(timer);

            if (!launchRes.ok) {
                const detail = await launchRes.text().catch(() => '');
                return json({
                    error: `Failed to launch Jellyfin: HTTP ${launchRes.status} ${detail}`.trim(),
                }, { status: 502 });
            }
        } catch (/** @type {any} */ e) {
            const message = e?.name === 'AbortError'
                ? 'Boiler Room launch request timed out'
                : (e?.message || String(e));
            return json({ error: `Failed to launch Jellyfin: ${message}` }, { status: 502 });
        }

        // Step 3: Poll for the session to appear (2s interval, up to 8 attempts = 16s)
        const maxAttempts = 8;
        const pollInterval = 2000;

        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            await sleep(pollInterval);
            session = await findSession();
            if (session) {
                await sendPlayCommand(session);
                return json({ success: true, action });
            }
        }

        // Session never appeared
        return json({
            error: 'Jellyfin was launched but the player session did not appear within 16 seconds',
        }, { status: 504 });
    } catch (/** @type {any} */ e) {
        console.error('[player/play] Error:', e?.message || e);
        return json({ error: e?.message || String(e) }, { status: 500 });
    }
}
