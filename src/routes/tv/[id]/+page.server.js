import db from '$lib/server/db.js';
import { error } from '@sveltejs/kit';
import { checkJellyfinFavorite } from '$lib/server/jellyfin-favorites.js';
import { resolveBackdrop } from '$lib/server/backdrop.js';

export async function load({ params }) {
    const showId = parseInt(params.id);
    const settings = /** @type {any} */ (db.prepare('SELECT include_specials, jellyfin_url, sonarr_url, sonarr_external_url FROM app_settings WHERE id = 1').get());
    const includeSpecials = settings?.include_specials === 1;
    const jellyfinUrl = settings?.jellyfin_url || '';

    const show = /** @type {any} */ (db.prepare(`
        SELECT
            mp.id,
            mp.jellyfin_id,
            mp.title,
            mp.release_year,
            mp.poster_url,
            mp.overview,
            mp.collected_children,
            mp.watched_children,
            mp.total_released_children,
            mp.tvdb_id,
            mp.tmdb_id,
            mp.imdb_id,
            mp.is_favorite,
            mp.sonarr_id,
            mp.arr_slug,
            mp.arr_monitored,
            mp.arr_quality_profile,
            mp.arr_has_file,
            mp.arr_status,
            mp.wikipedia_url,
            mp.backdrop_url,
            CASE WHEN mp.collected_children > 0
                THEN ROUND(CAST(mp.watched_children AS REAL) / mp.collected_children * 100, 1)
                ELSE 0 END as completion,
            CASE WHEN mp.total_released_children > 0
                THEN ROUND(CAST(mp.collected_children AS REAL) / mp.total_released_children * 100, 1)
                ELSE NULL END as collection_pct,
            (SELECT th.trakt_slug FROM trakt_history th WHERE th.tmdb_id = mp.tmdb_id AND th.type = 'episode' AND th.trakt_slug != '' LIMIT 1) as trakt_slug
        FROM media_parents mp
        WHERE mp.id = ? AND mp.media_type = 'show'
    `).get(showId));

    if (!show) throw error(404, 'Show not found');

    // Check if ratings need backfill (any episode with NULL community_rating)
    const missingRatings = /** @type {any} */ (db.prepare(
        'SELECT COUNT(*) as c FROM media_children WHERE parent_id = ? AND community_rating IS NULL AND is_collected = 1'
    ).get(showId))?.c || 0;

    if (missingRatings > 0 && show.jellyfin_id && jellyfinUrl) {
        // Batch-fetch episode ratings from Jellyfin
        const user = /** @type {any} */ (db.prepare('SELECT jellyfin_access_token, jellyfin_user_id FROM users LIMIT 1').get());
        if (user?.jellyfin_access_token) {
            try {
                const url = `${jellyfinUrl}/Shows/${show.jellyfin_id}/Episodes?userId=${user.jellyfin_user_id}&Fields=Overview`;
                const res = await fetch(url, {
                    headers: { 'X-Emby-Token': user.jellyfin_access_token }
                });
                if (res.ok) {
                    const data = await res.json();
                    const updateRating = db.prepare('UPDATE media_children SET community_rating = ? WHERE jellyfin_id = ? AND community_rating IS NULL');
                    const updateMany = db.transaction((/** @type {any[]} */ items) => {
                        for (const item of items) {
                            if (item.CommunityRating) {
                                updateRating.run(item.CommunityRating, item.Id);
                            }
                        }
                    });
                    updateMany(data.Items || []);
                }
            } catch (e) {
                console.warn('[tv] Rating backfill failed:', e instanceof Error ? e.message : e);
            }
        }
    }

    const episodes = /** @type {any[]} */ (db.prepare(`
        SELECT
            mc.id,
            mc.title,
            mc.season_number,
            mc.item_number,
            mc.is_special,
            mc.is_collected,
            mc.watch_status,
            mc.play_count,
            mc.runtime_ticks,
            mc.premiere_date,
            mc.community_rating
        FROM media_children mc
        WHERE mc.parent_id = ?
        ORDER BY mc.season_number ASC, mc.item_number ASC
    `).all(showId));

    // Filter out specials if setting is off
    const filteredEpisodes = includeSpecials
        ? episodes
        : episodes.filter(ep => ep.season_number !== 0 && ep.is_special !== 1);

    // Group episodes by season
    const seasons = {};
    const now = new Date().toISOString();
    for (const ep of filteredEpisodes) {
        const sn = ep.season_number ?? 0;
        if (!seasons[sn]) {
            seasons[sn] = {
                number: sn,
                episodes: [],
                watched: 0,
                collected: 0,
                missing: 0,
                upcoming: 0,
                total: 0
            };
        }
        seasons[sn].episodes.push(ep);
        seasons[sn].total++;
        if (ep.watch_status === 'watched') seasons[sn].watched++;
        if (ep.is_collected === 1) {
            seasons[sn].collected++;
        } else {
            // Split uncollected into missing vs upcoming
            if (ep.premiere_date && ep.premiere_date > now) {
                seasons[sn].upcoming++;
            } else {
                seasons[sn].missing++;
            }
        }
    }

    // Sort seasons and calculate stats
    const sortedSeasons = Object.values(seasons)
        .sort((a, b) => a.number - b.number);

    // Max episodes per season (for grid alignment)
    const maxEpisodes = Math.max(...sortedSeasons.map(s => s.episodes.length), 1);

    const totalCollected = filteredEpisodes.filter(e => e.is_collected === 1).length;
    const totalMissing = filteredEpisodes.filter(e => e.is_collected === 0 && (!e.premiere_date || e.premiere_date <= now)).length;
    const totalUpcoming = filteredEpisodes.filter(e => e.is_collected === 0 && e.premiere_date && e.premiere_date > now).length;

    // Cast & Crew
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

    // External ratings
    const externalRatings = /** @type {any[]} */ (db.prepare(`
        SELECT source, rating_type, value, vote_count, raw_value, fetched_at
        FROM external_ratings WHERE media_parent_id = ? ORDER BY source
    `).all(showId));

    // Live Jellyfin favorite check
    const liveFavorite = await checkJellyfinFavorite(show.jellyfin_id, 'media_parents', show.id);

    // Backdrop: prefer TMDB textless backdrop (cached in DB), fallback to Jellyfin
    let backdropUrl = show.backdrop_url;
    if (!backdropUrl && show.jellyfin_id) {
        backdropUrl = `${jellyfinUrl}/Items/${show.jellyfin_id}/Images/Backdrop?maxWidth=1200`;
    }
    // Lazy-fetch TMDB backdrop if not yet cached
    if (!show.backdrop_url && show.tmdb_id) {
        resolveBackdrop(showId).catch(() => {});
    }

    // Poster URL from Jellyfin if available
    const posterUrl = show.jellyfin_id
        ? `${jellyfinUrl}/Items/${show.jellyfin_id}/Images/Primary?maxHeight=400`
        : show.poster_url;

    return {
        show: {
            ...show,
            is_favorite: liveFavorite ?? show.is_favorite,
            posterUrl,
            backdropUrl,
            wikipedia_url: show.wikipedia_url || null,
            needsEnrichment: !show.overview && (!!show.jellyfin_id || !!show.tmdb_id),
        },
        seasons: sortedSeasons,
        maxEpisodes,
        includeSpecials,
        jellyfinUrl,
        arrUrl: (settings?.sonarr_external_url || settings?.sonarr_url || '').replace(/\/+$/, ''),
        arrService: 'sonarr',
        totalEpisodes: totalCollected,
        totalMissing,
        totalUpcoming,
        totalWatched: filteredEpisodes.filter(e => e.watch_status === 'watched').length,
        totalInProgress: filteredEpisodes.filter(e => e.watch_status === 'in_progress').length,
        cast,
        crew,
        externalRatings
    };
}
