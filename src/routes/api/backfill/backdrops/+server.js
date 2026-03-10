import db from '$lib/server/db.js';
import { fetchTmdbBackdrop, fetchFanartBackdrop } from '$lib/server/backdrop.js';
import { getTmdbKey } from '$lib/server/tmdb.js';

/** @type {import('./$types').RequestHandler} */
export async function POST() {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
        async start(controller) {
            /** @param {string} data */
            const send = (data) => {
                try { controller.enqueue(encoder.encode(`data: ${data}\n\n`)); } catch { /* closed */ }
            };

            try {
                // Check API keys
                const tmdbKey = getTmdbKey();
                const settings = /** @type {any} */ (db.prepare('SELECT fanart_api_key FROM app_settings WHERE id = 1').get());
                const hasFanart = !!settings?.fanart_api_key?.trim();

                if (!tmdbKey && !hasFanart) {
                    send(JSON.stringify({ type: 'error', message: 'No TMDB or Fanart.tv API key configured' }));
                    controller.close();
                    return;
                }

                // Find media parents without backdrops
                const items = /** @type {any[]} */ (db.prepare(`
                    SELECT id, title, media_type, tmdb_id, musicbrainz_id
                    FROM media_parents
                    WHERE backdrop_fetched_at IS NULL
                      AND (
                        (media_type IN ('movie', 'show') AND tmdb_id IS NOT NULL)
                        OR (media_type = 'artist' AND musicbrainz_id IS NOT NULL)
                      )
                    ORDER BY media_type, title
                `).all());

                send(JSON.stringify({ type: 'start', total: items.length }));

                if (items.length === 0) {
                    send(JSON.stringify({ type: 'complete', enriched: 0, total: 0 }));
                    controller.close();
                    return;
                }

                let enriched = 0;
                let errors = 0;

                for (let i = 0; i < items.length; i++) {
                    const item = items[i];
                    let url = null;

                    try {
                        if ((item.media_type === 'movie' || item.media_type === 'show') && item.tmdb_id && tmdbKey) {
                            const type = item.media_type === 'show' ? 'tv' : 'movie';
                            url = await fetchTmdbBackdrop(type, item.tmdb_id);
                        } else if (item.media_type === 'artist' && item.musicbrainz_id && hasFanart) {
                            url = await fetchFanartBackdrop(item.musicbrainz_id);
                        }

                        if (url) {
                            db.prepare('UPDATE media_parents SET backdrop_url = ?, backdrop_fetched_at = datetime(\'now\') WHERE id = ?').run(url, item.id);
                            enriched++;
                            send(JSON.stringify({ type: 'progress', index: i + 1, total: items.length, enriched, title: item.title, status: 'ok' }));
                        } else {
                            db.prepare('UPDATE media_parents SET backdrop_fetched_at = datetime(\'now\') WHERE id = ?').run(item.id);
                            send(JSON.stringify({ type: 'progress', index: i + 1, total: items.length, enriched, title: item.title, status: 'skip' }));
                        }
                    } catch (e) {
                        errors++;
                        const msg = e instanceof Error ? e.message : String(e);
                        send(JSON.stringify({ type: 'progress', index: i + 1, total: items.length, enriched, title: item.title, status: 'error', error: msg }));
                    }

                    // Rate limiting: 250ms between requests
                    if (i < items.length - 1) {
                        await new Promise(r => setTimeout(r, 250));
                    }
                }

                send(JSON.stringify({ type: 'complete', enriched, errors, total: items.length }));
            } catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                send(JSON.stringify({ type: 'error', message: msg }));
            }

            controller.close();
        }
    });

    return new Response(stream, {
        headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
        }
    });
}
