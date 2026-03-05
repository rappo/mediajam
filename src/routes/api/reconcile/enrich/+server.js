import { json } from '@sveltejs/kit';
import db from '$lib/server/db.js';
import { logInfo, logWarn } from '$lib/server/logger.js';

/**
 * POST /api/reconcile/enrich — Enrich unmatched external items with MusicBrainz IDs.
 * Streams progress via SSE. DELETE to stop.
 */

let enrichState = { running: false };

/**
 * Look up a MusicBrainz artist by name. Returns MBID or null.
 * @param {string} artistName
 * @returns {Promise<{ mbid: string, name: string, score: number } | null>}
 */
async function lookupMusicBrainzArtist(artistName) {
    const url = `https://musicbrainz.org/ws/2/artist?query=artist:${encodeURIComponent(`"${artistName}"`)}&fmt=json&limit=5`;
    try {
        const res = await fetch(url, {
            headers: {
                'User-Agent': 'Mediajam/1.0 (https://github.com/mediajam)',
                'Accept': 'application/json',
            }
        });
        if (!res.ok) return null;

        const data = await res.json();
        if (!data.artists || data.artists.length === 0) return null;

        // Find the best match — require score ≥ 90 for auto-match
        const best = data.artists[0];
        if (best.score >= 90) {
            return { mbid: best.id, name: best.name, score: best.score };
        }
        // Also check for exact name match (case-insensitive) in top 5
        const exactMatch = data.artists.find(
            /** @param {any} a */(a) => a.name.toLowerCase() === artistName.toLowerCase() && a.score >= 70
        );
        return exactMatch ? { mbid: exactMatch.id, name: exactMatch.name, score: exactMatch.score } : null;
    } catch {
        return null;
    }
}

const updateMBID = db.prepare(
    `UPDATE media_parents SET musicbrainz_id = ? WHERE id = ?`
);

export async function POST({ locals }) {
    if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
    if (enrichState.running) return json({ error: 'Enrichment already running' }, { status: 409 });

    enrichState.running = true;
    const encoder = new TextEncoder();

    const stream = new ReadableStream({
        async start(controller) {
            /** @param {any} data */
            const send = (data) => {
                try {
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
                } catch { /* stream closed */ }
            };

            try {
                // Get unmatched music artists without MBIDs
                const artists = /** @type {any[]} */ (db.prepare(`
                    SELECT mp.id, mp.title,
                        (SELECT COUNT(*) FROM playback_history ph
                         JOIN media_children mc ON ph.media_id = mc.id
                         WHERE mc.parent_id = mp.id) AS play_count
                    FROM media_parents mp
                    WHERE mp.jellyfin_id IS NULL
                      AND mp.media_type = 'artist'
                      AND mp.musicbrainz_id IS NULL
                    ORDER BY play_count DESC
                `).all());

                send({ type: 'enrich_progress', log: `🔍 Found ${artists.length} unmatched artists without MBIDs`, logType: 'info' });
                await new Promise(r => setTimeout(r, 0));

                let found = 0, notFound = 0;

                for (let i = 0; i < artists.length; i++) {
                    if (!enrichState.running) {
                        send({ type: 'enrich_progress', log: '⏹️ Stopped by user', logType: 'warning' });
                        break;
                    }

                    const artist = artists[i];
                    const result = await lookupMusicBrainzArtist(artist.title);

                    if (result) {
                        updateMBID.run(result.mbid, artist.id);
                        found++;
                        send({
                            type: 'enrich_progress',
                            log: `✅ ${artist.title} → ${result.name} (MBID: ${result.mbid.slice(0, 8)}…, score: ${result.score})`,
                            logType: 'success'
                        });
                    } else {
                        notFound++;
                        if (artist.play_count > 10) {
                            // Only log misses for artists with significant plays
                            send({
                                type: 'enrich_progress',
                                log: `❌ ${artist.title} — no MB match (${artist.play_count} plays)`,
                                logType: 'info'
                            });
                        }
                    }

                    // Progress update every 25
                    if ((i + 1) % 25 === 0 || i === artists.length - 1) {
                        send({
                            type: 'enrich_progress',
                            done: i + 1, total: artists.length,
                            log: `🔍 ${i + 1}/${artists.length} — ${found} matched, ${notFound} not found`,
                            logType: 'info'
                        });
                    }

                    // MusicBrainz rate limit: 1 req/sec
                    await new Promise(r => setTimeout(r, 1100));
                }

                send({
                    type: 'enrich_complete',
                    log: `🏁 Enrichment complete: ${found} MBIDs found, ${notFound} not found out of ${artists.length} artists`,
                    logType: 'success',
                    stats: { total: artists.length, found, notFound }
                });
            } catch (err) {
                send({ type: 'enrich_error', error: String(err), logType: 'error' });
            } finally {
                enrichState.running = false;
                try { controller.close(); } catch { /* */ }
            }
        }
    });

    return new Response(stream, {
        headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'X-Accel-Buffering': 'no'
        }
    });
}

export async function DELETE({ locals }) {
    if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
    enrichState.running = false;
    return json({ success: true });
}
