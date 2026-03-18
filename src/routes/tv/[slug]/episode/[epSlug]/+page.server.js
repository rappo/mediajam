import db from '$lib/server/db.js';
import { error, redirect } from '@sveltejs/kit';
import { resolveBackdrop } from '$lib/server/backdrop.js';
import { slugify, ensureUniqueSlug } from '$lib/server/slugify.js';

/** @type {import('./$types').PageServerLoad} */
export async function load({ params, locals }) {
    const userId = locals.user?.id || 0;
    const settings = /** @type {any} */ (db.prepare('SELECT jellyfin_url, sonarr_url, tmdb_api_key FROM app_settings WHERE id = 1').get());
    const jellyfinUrl = settings?.jellyfin_url || '';

    // Resolve show via slug or numeric ID
    let showId;
    const showParam = params.slug;
    if (/^\d+$/.test(showParam)) {
        const row = /** @type {any} */ (db.prepare('SELECT id, slug FROM media_parents WHERE id = ? AND media_type = \'show\'').get(parseInt(showParam)));
        if (!row) throw error(404, 'Show not found');
        showId = row.id;
    } else {
        const row = /** @type {any} */ (db.prepare('SELECT id FROM media_parents WHERE slug = ? AND media_type = \'show\'').get(showParam));
        if (!row) throw error(404, 'Show not found');
        showId = row.id;
    }

    // Resolve episode via slug or numeric ID
    let episodeId;
    const epParam = params.epSlug;
    if (/^\d+$/.test(epParam)) {
        const row = /** @type {any} */ (db.prepare('SELECT id, slug FROM media_children WHERE id = ? AND parent_id = ?').get(parseInt(epParam), showId));
        if (!row) throw error(404, 'Episode not found');
        const showRow = /** @type {any} */ (db.prepare('SELECT slug FROM media_parents WHERE id = ?').get(showId));
        const showSlug = showRow?.slug || showId;
        if (row.slug) throw redirect(301, `/tv/${showSlug}/episode/${row.slug}`);
        const ep = /** @type {any} */ (db.prepare('SELECT title, season_number, item_number FROM media_children WHERE id = ?').get(row.id));
        const base = slugify(ep.title || `s${ep.season_number}e${ep.item_number}`);
        const slug = ensureUniqueSlug(db, 'media_children', base, row.id);
        db.prepare('UPDATE media_children SET slug = ? WHERE id = ?').run(slug, row.id);
        throw redirect(301, `/tv/${showSlug}/episode/${slug}`);
    } else {
        const row = /** @type {any} */ (db.prepare('SELECT id FROM media_children WHERE slug = ? AND parent_id = ?').get(epParam, showId));
        if (!row) throw error(404, 'Episode not found');
        episodeId = row.id;
    }

    // Also redirect if show param was numeric
    if (/^\d+$/.test(showParam)) {
        const showRow = /** @type {any} */ (db.prepare('SELECT slug FROM media_parents WHERE id = ?').get(showId));
        const epRow = /** @type {any} */ (db.prepare('SELECT slug FROM media_children WHERE id = ?').get(episodeId));
        if (showRow?.slug && epRow?.slug) throw redirect(301, `/tv/${showRow.slug}/episode/${epRow.slug}`);
    }

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
        SELECT id, title, jellyfin_id, poster_url, backdrop_url, tmdb_id, imdb_id, tvdb_id,
               sonarr_id, arr_slug, release_year, overview
        FROM media_parents WHERE id = ? AND media_type = 'show'
    `).get(showId));

    if (!show) throw error(404, 'Show not found');

    // Playback history for this episode
    const rawHistory = /** @type {any[]} */ (db.prepare(`
        SELECT ph.timestamp, ph.source, ph.duration_consumed_seconds, ph.completion_pct
        FROM playback_history ph
        WHERE ph.media_id = ? AND ph.user_id = ?
        ORDER BY ph.timestamp DESC
    `).all(episodeId, userId));

    // Dedup: merge plays within a 12-hour window from different sources
    const DEDUP_WINDOW_MS = 12 * 60 * 60 * 1000;
    /** @type {any[]} */
    const history = [];
    /** @type {any|null} */
    let lastEntry = null;
    for (const entry of rawHistory) {
        if (lastEntry) {
            const lastTime = new Date(lastEntry.timestamp).getTime();
            const entryTime = new Date(entry.timestamp).getTime();
            if (Math.abs(lastTime - entryTime) <= DEDUP_WINDOW_MS) {
                const sources = new Set((lastEntry.source || '').split(' + '));
                sources.add(entry.source);
                lastEntry.source = [...sources].join(' + ');
                if (!lastEntry.duration_consumed_seconds && entry.duration_consumed_seconds) {
                    lastEntry.duration_consumed_seconds = entry.duration_consumed_seconds;
                }
                if (!lastEntry.completion_pct && entry.completion_pct) {
                    lastEntry.completion_pct = entry.completion_pct;
                }
                continue;
            }
        }
        history.push(entry);
        lastEntry = entry;
    }

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

    // Show-level cast & crew (from person_credits), deduplicated by person
    const cast = /** @type {any[]} */ (db.prepare(`
        SELECT p.id, p.name, p.photo_url, p.tmdb_person_id, p.slug,
               pc.role_type,
               GROUP_CONCAT(DISTINCT pc.character_name) as character_name,
               MIN(pc.sort_order) as sort_order
        FROM person_credits pc
        JOIN persons p ON pc.person_id = p.id
        WHERE pc.media_parent_id = ? AND pc.role_type IN ('actor', 'guest')
        GROUP BY p.id
        ORDER BY MIN(pc.sort_order) ASC
    `).all(showId));

    const crew = /** @type {any[]} */ (db.prepare(`
        SELECT p.id, p.name, p.photo_url, p.tmdb_person_id, p.slug,
               pc.role_type,
               GROUP_CONCAT(DISTINCT pc.character_name) as character_name,
               MIN(pc.sort_order) as sort_order
        FROM person_credits pc
        JOIN persons p ON pc.person_id = p.id
        WHERE pc.media_parent_id = ? AND pc.role_type NOT IN ('actor', 'guest')
        GROUP BY p.id, pc.role_type
        ORDER BY MIN(pc.sort_order) ASC
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
                            .map((/** @type {any} */ p) => {
                                const local = /** @type {any} */ (db.prepare('SELECT id, slug FROM persons WHERE name = ? LIMIT 1').get(p.Name));
                                return {
                                    name: p.Name,
                                    role: p.Role || null,
                                    personId: local?.id || null,
                                    personSlug: local?.slug || null,
                                    photoUrl: p.PrimaryImageTag && p.Id
                                        ? `${jellyfinUrl}/Items/${p.Id}/Images/Primary?maxHeight=120`
                                        : null
                                };
                            }),
                        directors: (item.People || [])
                            .filter((/** @type {any} */ p) => p.Type === 'Director')
                            .map((/** @type {any} */ p) => p.Name),
                        writers: (item.People || [])
                            .filter((/** @type {any} */ p) => p.Type === 'Writer')
                            .map((/** @type {any} */ p) => p.Name),
                    };
                    // Persist community rating to DB for heatmap view
                    if (jellyfinData.communityRating) {
                        db.prepare('UPDATE media_children SET community_rating = ? WHERE id = ?')
                            .run(jellyfinData.communityRating, episodeId);
                    }

                    // Persist guest star credits to person_credits so they appear on people pages
                    const upsertGuestCredit = db.prepare(`
                        INSERT OR IGNORE INTO person_credits (person_id, media_parent_id, role_type, character_name, sort_order)
                        VALUES (?, ?, 'guest', ?, 999)
                    `);
                    for (const person of (item.People || [])) {
                        if (person.Type !== 'GuestStar' || !person.Name) continue;
                        try {
                            // Find existing person by Jellyfin ID first, then by name
                            let personRow = person.Id
                                ? /** @type {any} */ (db.prepare('SELECT id FROM persons WHERE jellyfin_id = ?').get(person.Id))
                                : null;
                            if (!personRow) {
                                personRow = /** @type {any} */ (db.prepare('SELECT id FROM persons WHERE name = ? LIMIT 1').get(person.Name));
                            }
                            if (!personRow && person.Id) {
                                // Create a minimal person record
                                const photoUrl = person.PrimaryImageTag
                                    ? `${jellyfinUrl}/Items/${person.Id}/Images/Primary`
                                    : null;
                                db.prepare(
                                    'INSERT OR IGNORE INTO persons (name, jellyfin_id, photo_url) VALUES (?, ?, ?)'
                                ).run(person.Name, person.Id, photoUrl);
                                personRow = /** @type {any} */ (db.prepare('SELECT id FROM persons WHERE jellyfin_id = ?').get(person.Id));
                            }
                            if (personRow) {
                                upsertGuestCredit.run(personRow.id, showId, person.Role || null);
                            }
                        } catch { /* non-fatal */ }
                    }
                }
            } catch (e) {
                console.warn('[episode] Jellyfin fetch failed:', e instanceof Error ? e.message : e);
            }
        }
    }

    // If no Jellyfin data and we have TMDb, try TMDb for synopsis + guest stars
    if (!jellyfinData && show.tmdb_id && settings?.tmdb_api_key && episode.season_number > 0) {
        try {
            const { tmdbFetch } = await import('$lib/server/tmdb.js');
            const res = await tmdbFetch(
                `/tv/${show.tmdb_id}/season/${episode.season_number}/episode/${episode.item_number}`,
                { append_to_response: 'credits' }
            );
            if (res.ok) {
                const tmdbEp = await res.json();
                const guestStars = (tmdbEp.guest_stars || []).slice(0, 10).map((/** @type {any} */ g) => {
                    const local = /** @type {any} */ (db.prepare('SELECT id, slug FROM persons WHERE name = ? LIMIT 1').get(g.name));
                    return {
                        name: g.name,
                        role: g.character || null,
                        personId: local?.id || null,
                        personSlug: local?.slug || null,
                        photoUrl: g.profile_path ? `https://image.tmdb.org/t/p/w185${g.profile_path}` : null
                    };
                });
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
                // Persist community rating to DB for heatmap view
                if (jellyfinData.communityRating) {
                    db.prepare('UPDATE media_children SET community_rating = ? WHERE id = ?')
                        .run(jellyfinData.communityRating, episodeId);
                }

                // Persist TMDb guest star credits to person_credits
                const upsertTmdbGuestCredit = db.prepare(`
                    INSERT OR IGNORE INTO person_credits (person_id, media_parent_id, role_type, character_name, sort_order)
                    VALUES (?, ?, 'guest', ?, 999)
                `);
                for (const g of guestStars) {
                    if (g.personId) {
                        try { upsertTmdbGuestCredit.run(g.personId, showId, g.role); } catch { /* non-fatal */ }
                    }
                }
            }
        } catch { /* fallback: no TMDb data */ }
    }

    // Episode screenshot/thumbnail
    const screenshotUrl = jellyfinData?.screenshotUrl || jellyfinData?.thumbUrl || null;

    // ── Resolve poster & backdrop the same way as the series page ──
    // Poster: prefer Jellyfin Primary image, fall back to DB poster_url
    const posterUrl = show.jellyfin_id
        ? `${jellyfinUrl}/Items/${show.jellyfin_id}/Images/Primary?maxHeight=400`
        : show.poster_url;

    // Backdrop: prefer DB backdrop_url, fall back to Jellyfin Backdrop, then resolveBackdrop()
    let backdropUrl = show.backdrop_url;
    if (!backdropUrl && show.jellyfin_id) {
        backdropUrl = `${jellyfinUrl}/Items/${show.jellyfin_id}/Images/Backdrop?maxWidth=1200`;
    }
    if (!show.backdrop_url && show.tmdb_id) {
        try {
            const resolved = await resolveBackdrop(show.id);
            if (resolved) backdropUrl = resolved;
        } catch { /* non-fatal */ }
    }

    return {
        episode: {
            ...episode,
            watch_status: totalPlays > 0 ? 'watched' : episode.watch_status,
            play_count: Math.max(episode.play_count || 0, totalPlays),
        },
        show,
        jellyfinData,
        screenshotUrl,
        posterUrl,
        backdropUrl,
        history,
        stats: { totalPlays, firstWatched, lastWatched },
        cast,
        crew,
        prevEpisode,
        nextEpisode,
        jellyfinUrl,
    };
}
