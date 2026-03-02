import { json } from '@sveltejs/kit';
import {
    backfillTrakt, backfillLastfm, backfillJellyfinPR, backfillLegacy,
    addBackfillListener, isBackfillRunning, stopBackfill
} from '$lib/server/backfill-engine.js';
import db from '$lib/server/db.js';

/**
 * POST /api/backfill/history — Trigger a backfill tier.
 * Body: { tier: 'trakt' | 'lastfm' | 'jellyfin' | 'legacy', config?: { dbPath?: string } }
 * @type {import('./$types').RequestHandler}
 */
export async function POST({ request }) {
    const { tier, config } = await request.json();

    if (isBackfillRunning()) {
        return json({ success: false, error: 'A backfill is already running.' }, { status: 409 });
    }

    // Get the first user (single-user app for now)
    const user = /** @type {any} */ (db.prepare('SELECT id FROM users LIMIT 1').get());
    if (!user) {
        return json({ success: false, error: 'No user found.' }, { status: 400 });
    }

    const userId = user.id;

    // Start backfill in the background (don't await)
    switch (tier) {
        case 'trakt':
            backfillTrakt(userId);
            return json({ success: true, message: 'Trakt backfill started.' });
        case 'lastfm':
            backfillLastfm(userId);
            return json({ success: true, message: 'Last.fm backfill started.' });
        case 'jellyfin': {
            const settings = /** @type {any} */ (db.prepare('SELECT jellyfin_pr_db_path FROM app_settings WHERE id = 1').get());
            const dbPath = config?.dbPath || settings?.jellyfin_pr_db_path;
            if (!dbPath) {
                return json({ success: false, error: 'No Jellyfin Playback Reporting DB path configured.' }, { status: 400 });
            }
            backfillJellyfinPR(userId, dbPath);
            return json({ success: true, message: 'Jellyfin PR backfill started.' });
        }
        case 'legacy':
            backfillLegacy(userId);
            return json({ success: true, message: 'Legacy backfill started.' });
        case 'stop':
            stopBackfill();
            return json({ success: true, message: 'Backfill stopped.' });
        default:
            return json({ success: false, error: `Unknown tier: ${tier}` }, { status: 400 });
    }
}

/**
 * GET /api/backfill/history — SSE stream for backfill progress.
 * @type {import('./$types').RequestHandler}
 */
export async function GET() {
    const stream = new ReadableStream({
        start(controller) {
            const encoder = new TextEncoder();

            const send = (data) => {
                try {
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
                } catch {
                    // Stream closed
                }
            };

            send({ type: 'connected', isRunning: isBackfillRunning() });

            const removeListener = addBackfillListener(send);

            const keepAlive = setInterval(() => {
                try {
                    controller.enqueue(encoder.encode(`: keepalive\n\n`));
                } catch {
                    clearInterval(keepAlive);
                }
            }, 15000);
        },
        cancel() { }
    });

    return new Response(stream, {
        headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive'
        }
    });
}
