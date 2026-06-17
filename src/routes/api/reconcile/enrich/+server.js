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
                    type: 'enrich_progress',
                    log: `🏁 MBID phase complete: ${found} MBIDs found, ${notFound} not found out of ${artists.length} artists`,
                    logType: 'success',
                    stats: { total: artists.length, found, notFound }
                });

                // ── Phase 2: Sync band members for artists with MBIDs ──
                if (!enrichState.running) {
                    send({ type: 'enrich_complete', log: '⏹️ Stopped by user', logType: 'warning' });
                } else {
                    const { syncBandMembers, getBandsWithoutMembers } = await import('$lib/server/musicbrainz-members.js');
                    const bandsToSync = getBandsWithoutMembers();

                    if (bandsToSync > 0) {
                        send({ type: 'enrich_progress', log: `\n🎸 Phase 2: Syncing members for ${bandsToSync} bands...`, logType: 'info' });

                        const bandsWithMbids = /** @type {any[]} */ (db.prepare(`
                            SELECT mp.id, mp.title, mp.musicbrainz_id FROM media_parents mp
                            WHERE mp.media_type = 'artist'
                              AND mp.musicbrainz_id IS NOT NULL
                              AND NOT EXISTS (
                                  SELECT 1 FROM person_credits pc
                                  WHERE pc.media_parent_id = mp.id AND pc.role_type = 'member'
                              )
                            ORDER BY mp.title
                        `).all());

                        let synced = 0, skipped = 0;
                        for (let i = 0; i < bandsWithMbids.length; i++) {
                            if (!enrichState.running) {
                                send({ type: 'enrich_progress', log: '⏹️ Stopped by user', logType: 'warning' });
                                break;
                            }

                            const band = bandsWithMbids[i];
                            try {
                                const result = await syncBandMembers(band.id);
                                if (result.members.length > 0) {
                                    synced++;
                                    const memberNames = result.members.slice(0, 5).map((/** @type {any} */ m) => m.name).join(', ');
                                    send({
                                        type: 'enrich_progress',
                                        log: `✅ ${band.title}: ${result.members.length} members (${memberNames}${result.members.length > 5 ? '…' : ''})`,
                                        logType: 'success'
                                    });
                                } else {
                                    skipped++;
                                }
                            } catch (e) {
                                const msg = e instanceof Error ? e.message : String(e);
                                send({ type: 'enrich_progress', log: `❌ ${band.title}: ${msg}`, logType: 'error' });
                            }

                            if ((i + 1) % 10 === 0) {
                                send({
                                    type: 'enrich_progress',
                                    done: i + 1, total: bandsWithMbids.length,
                                    log: `🎸 ${i + 1}/${bandsWithMbids.length} — ${synced} synced, ${skipped} solo/unknown`,
                                    logType: 'info'
                                });
                            }

                            // Rate limit: syncBandMembers has internal delays but we add a buffer
                            await new Promise(r => setTimeout(r, 1100));
                        }

                        send({
                            type: 'enrich_progress',
                            log: `🏁 Member sync complete: ${synced} bands synced, ${skipped} solo/no members`,
                            logType: 'success'
                        });
                    } else {
                        send({ type: 'enrich_progress', log: '✅ All bands already have member data', logType: 'success' });
                    }

                    send({
                        type: 'enrich_complete',
                        log: `🎉 All enrichment phases complete`,
                        logType: 'success',
                        stats: { total: artists.length, found, notFound }
                    });
                }
            } catch (err) {
                send({ type: 'enrich_error', error: String(err), logType: 'error' });
            } finally {
                enrichState.running = false;
                try { controller.close(); } catch { /* */ }
            }
        },
        cancel() {
            enrichState.running = false;
        }
    });

    return new Response(stream, {
        headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache, no-transform',
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
