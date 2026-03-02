import { json } from '@sveltejs/kit';
import db from '$lib/server/db.js';

/**
 * GET /api/users/:userId/now-playing — Get active playback sessions for a user.
 * Unauthenticated endpoint for external widgets and home automation.
 * @type {import('./$types').RequestHandler}
 */
export async function GET({ params }) {
    const userId = parseInt(params.userId);

    // Clean stale sessions first
    db.prepare("DELETE FROM active_sessions WHERE last_update < datetime('now', '-30 minutes')").run();

    const sessions = db.prepare(`
        SELECT
            a.id as session_id,
            a.title,
            a.media_type,
            a.progress_ticks,
            a.runtime_ticks,
            a.started_at,
            a.last_update,
            a.is_paused,
            a.jellyfin_item_id,
            CASE WHEN a.runtime_ticks > 0
                THEN ROUND(CAST(a.progress_ticks AS REAL) / a.runtime_ticks * 100, 1)
                ELSE 0 END as progress_pct
        FROM active_sessions a
        WHERE a.user_id = ?
        ORDER BY a.last_update DESC
    `).all(userId);

    return json({
        userId,
        playing: sessions.length > 0,
        sessions
    });
}
