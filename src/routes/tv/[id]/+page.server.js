import db from '$lib/server/db.js';
import { error } from '@sveltejs/kit';

export function load({ params }) {
    const showId = parseInt(params.id);
    const settings = db.prepare('SELECT include_specials, jellyfin_url, sonarr_url FROM app_settings WHERE id = 1').get();
    const includeSpecials = settings?.include_specials === 1;
    const jellyfinUrl = settings?.jellyfin_url || '';

    const show = db.prepare(`
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
            CASE WHEN mp.collected_children > 0
                THEN ROUND(CAST(mp.watched_children AS REAL) / mp.collected_children * 100, 1)
                ELSE 0 END as completion,
            CASE WHEN mp.total_released_children > 0
                THEN ROUND(CAST(mp.collected_children AS REAL) / mp.total_released_children * 100, 1)
                ELSE NULL END as collection_pct
        FROM media_parents mp
        WHERE mp.id = ? AND mp.media_type = 'show'
    `).get(showId);

    if (!show) throw error(404, 'Show not found');

    const episodes = db.prepare(`
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
            mc.premiere_date
        FROM media_children mc
        WHERE mc.parent_id = ?
        ORDER BY mc.season_number ASC, mc.item_number ASC
    `).all(showId);

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

    return {
        show,
        seasons: sortedSeasons,
        maxEpisodes,
        includeSpecials,
        jellyfinUrl,
        arrUrl: settings?.sonarr_url || '',
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
