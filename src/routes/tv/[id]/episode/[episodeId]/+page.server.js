import db from '$lib/server/db.js';
import { error } from '@sveltejs/kit';

/** @type {import('./$types').PageServerLoad} */
export async function load({ params, locals }) {
    const showId = parseInt(params.id);
    const episodeId = parseInt(params.episodeId);
    const userId = locals.user?.id || 0;
    const settings = /** @type {any} */ (db.prepare('SELECT jellyfin_url, sonarr_url, tmdb_api_key FROM app_settings WHERE id = 1').get());
    const jellyfinUrl = settings?.jellyfin_url || '';

    // Load the episode (media_children row)
    const episode = /** @type {any} */ (db.prepare(`
        SELECT
            mc.id, mc.parent_id, mc.jellyfin_id, mc.title,
            mc.season_number, mc.item_number, mc.is_special,
            mc.is_collected, mc.watch_status, mc.play_count,
            mc.runtime_ticks, mc.premiere_date,
            ROUND(mc.runtime_ticks / 10000000.0 / 60, 0) as runtime_minutes
        FROM media_children mc
        WHERE mc.id = ? AND mc.parent_id = ?
    `).get(episodeId, showId));

    if (!episode) throw error(404, 'Episode not found');

    // Load the parent show
    const show = /** @type {any} */ (db.prepare(`
        SELECT id, title, jellyfin_id, poster_url, tmdb_id, imdb_id, tvdb_id, sonarr_id, arr_slug
        FROM media_parents WHERE id = ? AND media_type = 'show'
    `).get(showId));

    if (!show) throw error(404, 'Show not found');

    // Playback history for this episode
    const history = /** @type {any[]} */ (db.prepare(`
        SELECT ph.timestamp, ph.source, ph.duration_consumed_seconds, ph.completion_pct
        FROM playback_history ph
        WHERE ph.media_id = ? AND ph.user_id = ?
        ORDER BY ph.timestamp DESC
    `).all(episodeId, userId));

    const totalPlays = history.length;
    const firstWatched = history.length > 0 ? history[history.length - 1].timestamp : null;
    const lastWatched = history.length > 0 ? history[0].timestamp : null;

    // Adjacent episodes for navigation
    const prevEpisode = /** @type {any} */ (db.prepare(`
        SELECT id, title, season_number, item_number FROM media_children
        WHERE parent_id = ? AND (
            (season_number = ? AND item_number < ?) OR
            (season_number < ?)
        )
        ORDER BY season_number DESC, item_number DESC LIMIT 1
    `).get(showId, episode.season_number, episode.item_number, episode.season_number));

    const nextEpisode = /** @type {any} */ (db.prepare(`
        SELECT id, title, season_number, item_number FROM media_children
        WHERE parent_id = ? AND (
            (season_number = ? AND item_number > ?) OR
            (season_number > ?)
        )
        ORDER BY season_number ASC, item_number ASC LIMIT 1
    `).get(showId, episode.season_number, episode.item_number, episode.season_number));

    // Show-level cast & crew (from person_credits)
    const cast = /** @type {any[]} */ (db.prepare(`
        SELECT p.id, p.name, p.photo_url, p.tmdb_person_id,
               pc.role_type, pc.character_name, pc.sort_order
        FROM person_credits pc
        JOIN persons p ON pc.person_id = p.id
        WHERE pc.media_parent_id = ? AND pc.role_type = 'actor'
        ORDER BY pc.sort_order ASC
    `).all(showId));

    const crew = /** @type {any[]} */ (db.prepare(`
        SELECT p.id, p.name, p.photo_url, p.tmdb_person_id,
               pc.role_type, pc.character_name, pc.sort_order
        FROM person_credits pc
        JOIN persons p ON pc.person_id = p.id
        WHERE pc.media_parent_id = ? AND pc.role_type != 'actor'
        ORDER BY pc.sort_order ASC
    `).all(showId));

    // ── Jellyfin enrichment (synopsis, screenshot, guest stars, community rating) ──
    let jellyfinData = null;
    if (episode.jellyfin_id && jellyfinUrl) {
        const user = /** @type {any} */ (db.prepare('SELECT jellyfin_access_token, jellyfin_user_id FROM users LIMIT 1').get());
        if (user?.jellyfin_access_token) {
            try {
                const url = `${jellyfinUrl}/Users/${user.jellyfin_user_id}/Items/${episode.jellyfin_id}`;
                const res = await fetch(url, {
                    headers: { 'X-Emby-Token': user.jellyfin_access_token }
                });
                if (res.ok) {
                    const item = await res.json();
                    jellyfinData = {
                        overview: item.Overview || null,
                        communityRating: item.CommunityRating || null,
                        officialRating: item.OfficialRating || null,
                        screenshotUrl: item.ImageTags?.Primary
                            ? `${jellyfinUrl}/Items/${episode.jellyfin_id}/Images/Primary?maxWidth=800`
                            : null,
                        thumbUrl: item.ImageTags?.Thumb
                            ? `${jellyfinUrl}/Items/${episode.jellyfin_id}/Images/Thumb?maxWidth=800`
                            : null,
                        guestStars: (item.People || [])
                            .filter((/** @type {any} */ p) => p.Type === 'GuestStar' || p.Type === 'Actor')
                            .map((/** @type {any} */ p) => ({
                                name: p.Name,
                                role: p.Role || null,
                                photoUrl: p.PrimaryImageTag && p.Id
                                    ? `${jellyfinUrl}/Items/${p.Id}/Images/Primary?maxHeight=120`
                                    : null
                            })),
                        directors: (item.People || [])
                            .filter((/** @type {any} */ p) => p.Type === 'Director')
                            .map((/** @type {any} */ p) => p.Name),
                        writers: (item.People || [])
                            .filter((/** @type {any} */ p) => p.Type === 'Writer')
                            .map((/** @type {any} */ p) => p.Name),
                    };
                }
            } catch (e) {
                console.warn('[episode] Jellyfin fetch failed:', e instanceof Error ? e.message : e);
            }
        }
    }

    // If no Jellyfin data and we have TMDb, try TMDb for synopsis + guest stars
    if (!jellyfinData && show.tmdb_id && settings?.tmdb_api_key && episode.season_number > 0) {
        try {
            const url = `https://api.themoviedb.org/3/tv/${show.tmdb_id}/season/${episode.season_number}/episode/${episode.item_number}?api_key=${settings.tmdb_api_key}&append_to_response=credits`;
            const res = await fetch(url);
            if (res.ok) {
                const tmdbEp = await res.json();
                const guestStars = (tmdbEp.guest_stars || []).slice(0, 10).map((/** @type {any} */ g) => ({
                    name: g.name,
                    role: g.character || null,
                    photoUrl: g.profile_path ? `https://image.tmdb.org/t/p/w185${g.profile_path}` : null
                }));
                jellyfinData = {
                    overview: tmdbEp.overview || null,
                    communityRating: tmdbEp.vote_average || null,
                    officialRating: null,
                    screenshotUrl: tmdbEp.still_path ? `https://image.tmdb.org/t/p/w780${tmdbEp.still_path}` : null,
                    thumbUrl: null,
                    guestStars,
                    directors: (tmdbEp.crew || []).filter((/** @type {any} */ c) => c.job === 'Director').map((/** @type {any} */ c) => c.name),
                    writers: (tmdbEp.crew || []).filter((/** @type {any} */ c) => c.job === 'Writer').map((/** @type {any} */ c) => c.name),
                };
            }
        } catch { /* fallback: no TMDb data */ }
    }

    // Episode screenshot/thumbnail
    const screenshotUrl = jellyfinData?.screenshotUrl || jellyfinData?.thumbUrl || null;

    return {
        episode: {
            ...episode,
            watch_status: totalPlays > 0 ? 'watched' : episode.watch_status,
            play_count: Math.max(episode.play_count || 0, totalPlays),
        },
        show,
        jellyfinData,
        screenshotUrl,
        history,
        stats: { totalPlays, firstWatched, lastWatched },
        cast,
        crew,
        prevEpisode,
        nextEpisode,
        jellyfinUrl,
    };
}
