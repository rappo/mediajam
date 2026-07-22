/**
 * Backfill playback_history.duration_consumed_seconds from known runtimes.
 *
 * A watched item's duration IS its runtime (× completion when partial), but the
 * importers historically stored null because the source events (Last.fm
 * scrobbles, Trakt history, Jellyfin played-flags) don't carry a duration.
 * The runtimes are local: tracks.runtime_ticks for music scrobbles matched to a
 * track, media_children.runtime_ticks for movies/episodes.
 *
 * Idempotent — only touches rows where duration is still null and a real
 * runtime exists. Music scrobbles without a track match are left null on
 * purpose: media_id points at the album, and one scrobble ≠ one album.
 */
import db from '$lib/server/db.js';

export function backfillDurations() {
    // Music scrobbles matched to a track → track runtime
    const music = db.prepare(`
        UPDATE playback_history SET duration_consumed_seconds = (
            SELECT CAST(t.runtime_ticks / 10000000 AS INTEGER)
            FROM tracks t WHERE t.id = playback_history.track_id
        )
        WHERE duration_consumed_seconds IS NULL
          AND track_id IS NOT NULL
          AND EXISTS (
              SELECT 1 FROM tracks t
              WHERE t.id = playback_history.track_id AND t.runtime_ticks > 0
          )
    `).run();

    // Movies/episodes → file runtime × completion%
    const video = db.prepare(`
        UPDATE playback_history SET duration_consumed_seconds = (
            SELECT CAST(mc.runtime_ticks / 10000000.0
                        * COALESCE(NULLIF(playback_history.completion_pct, 0), 100) / 100.0 AS INTEGER)
            FROM media_children mc WHERE mc.id = playback_history.media_id
        )
        WHERE duration_consumed_seconds IS NULL
          AND track_id IS NULL
          AND EXISTS (
              SELECT 1 FROM media_children mc
              JOIN media_parents mp ON mp.id = mc.parent_id
              WHERE mc.id = playback_history.media_id
                AND mc.runtime_ticks > 0
                AND mp.media_type != 'artist'
          )
    `).run();

    const filled = music.changes + video.changes;
    if (filled > 0) {
        console.log(`[duration-backfill] Filled ${filled} durations (${music.changes} music, ${video.changes} video)`);
    }
    return { filled, music: music.changes, video: video.changes };
}
