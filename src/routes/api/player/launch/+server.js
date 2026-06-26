import { json } from '@sveltejs/kit';
import db from '$lib/server/db.js';

/**
 * POST /api/player/launch — Launch Jellyfin on a remote device via Boiler Room
 *
 * Body: { playerId?: string }
 *   playerId — optional, defaults to the user's default player
 *
 * @type {import('./$types').RequestHandler}
 */
export async function POST({ request, locals }) {
    if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

    const body = await request.json().catch(() => ({}));
    const requestedId = body.playerId;

    // --- Load user preferences ---
    const userRow = /** @type {any} */ (db.prepare('SELECT preferences FROM users WHERE id = ?').get(locals.user.id));
    const prefs = userRow?.preferences ? JSON.parse(userRow.preferences) : {};
    const savedPlayers = prefs.savedPlayers || [];
    const defaultPlayerId = prefs.defaultPlayerId || '';

    const playerId = requestedId || defaultPlayerId;
    const player = savedPlayers.find((/** @type {any} */ p) => p.deviceId === playerId)
        || (savedPlayers.length === 1 ? savedPlayers[0] : null);

    if (!player) {
        return json({ status: 'error', message: 'Player not found' }, { status: 404 });
    }

    if (!player.boilerRoomUrl) {
        return json({ status: 'error', message: 'Player has no Boiler Room URL configured' }, { status: 400 });
    }

    const jellyfinAppId = player.jellyfinAppId || 'org.jellyfin.JellyfinDesktop';

    try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 10_000);

        const res = await fetch(`${player.boilerRoomUrl}/api/v1/launch`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: 'app', appid: jellyfinAppId }),
            signal: controller.signal,
        });
        clearTimeout(timer);

        if (!res.ok) {
            const detail = await res.text().catch(() => '');
            return json({
                status: 'error',
                message: `Boiler Room returned HTTP ${res.status}: ${detail}`,
            }, { status: 502 });
        }

        return json({ status: 'launching' });
    } catch (/** @type {any} */ e) {
        console.error('[player/launch] Error launching via Boiler Room:', e?.message || e);
        const message = e?.name === 'AbortError'
            ? 'Boiler Room request timed out (10s)'
            : (e?.message || String(e));
        return json({ status: 'error', message }, { status: 502 });
    }
}
