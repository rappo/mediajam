import db from '$lib/server/db.js';
import { error, redirect } from '@sveltejs/kit';
import { checkJellyfinFavorite } from '$lib/server/jellyfin-favorites.js';
import { resolveBackdrop } from '$lib/server/backdrop.js';
import { tmdbFetch, getTmdbKey } from '$lib/server/tmdb.js';
import { slugify, ensureUniqueSlug, resolveSlug } from '$lib/server/slugify.js';
import { getSimilarItems } from '$lib/server/similar-items.js';
import { dedupCast, dedupCrew } from '$lib/server/credit-dedup.js';

export async function load({ params }) {
    const paramSlug = params.slug;
    const settings = /** @type {any} */ (db.prepare('SELECT include_specials, jellyfin_url, sonarr_url, sonarr_external_url FROM app_settings WHERE id = 1').get());
    const includeSpecials = settings?.include_specials === 1;
    const jellyfinUrl = settings?.jellyfin_url || '';

    // Slug lookup with numeric ID fallback
    let showId;
    if (/^\d+$/.test(paramSlug)) {
        const row = /** @type {any} */ (db.prepare('SELECT id, slug FROM media_parents WHERE id = ? AND media_type = \'show\'').get(parseInt(paramSlug)));
        if (!row) throw error(404, 'Show not found');
        if (row.slug) throw redirect(301, `/tv/${row.slug}`);
        const mp = /** @type {any} */ (db.prepare('SELECT title, release_year FROM media_parents WHERE id = ?').get(row.id));
        const base = slugify(mp.title || 'untitled', mp.release_year);
        const slug = ensureUniqueSlug(db, 'media_parents', base, row.id);
        db.prepare('UPDATE media_parents SET slug = ? WHERE id = ?').run(slug, row.id);
        throw redirect(301, `/tv/${slug}`);
    } else {
        const row = /** @type {any} */ (db.prepare('SELECT id FROM media_parents WHERE slug = ? AND media_type = \'show\'').get(paramSlug));
        if (row) {
            showId = row.id;
        } else {
            const resolved = resolveSlug(db, paramSlug, 'show', '/tv');
            if (resolved?.redirect) throw redirect(301, resolved.redirect);
            if (resolved) showId = resolved.id;
            else throw error(404, 'Show not found');
        }
    }

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
            mp.is_dashboard_hidden,
            mp.collection_status,
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

    // ── Auto-enrich external stubs from TMDB ────────────────────────────────
    const episodesExist = /** @type {any} */ (db.prepare(
        'SELECT COUNT(*) as c FROM media_children WHERE parent_id = ?'
    ).get(showId))?.c || 0;

    if (episodesExist === 0 && show.tmdb_id && getTmdbKey() && !show.jellyfin_id) {
        try {
            // Fetch full show details with seasons
            const detailRes = await tmdbFetch(`/tv/${show.tmdb_id}`);
            if (detailRes.ok) {
                const detail = await detailRes.json();

                // Update parent with enriched data
                db.prepare(`
                    UPDATE media_parents SET
                        overview = COALESCE(?, overview),
                        release_year = COALESCE(?, release_year),
                        poster_url = COALESCE(?, poster_url),
                        backdrop_url = COALESCE(?, backdrop_url)
                    WHERE id = ?
                `).run(
                    detail.overview || null,
                    detail.first_air_date ? parseInt(detail.first_air_date.slice(0, 4)) : null,
                    detail.poster_path ? `https://image.tmdb.org/t/p/w300${detail.poster_path}` : null,
                    detail.backdrop_path ? `https://image.tmdb.org/t/p/w1280${detail.backdrop_path}` : null,
                    showId
                );

                // Reload show data after enrichment
                if (detail.overview && !show.overview) show.overview = detail.overview;
                if (detail.poster_path && !show.poster_url) show.poster_url = `https://image.tmdb.org/t/p/w300${detail.poster_path}`;
                if (detail.backdrop_path && !show.backdrop_url) show.backdrop_url = `https://image.tmdb.org/t/p/w1280${detail.backdrop_path}`;

                // Fetch episodes for each season
                // Use upsert pattern: update existing episodes with TMDB metadata, only insert truly new ones
                const findExisting = db.prepare(
                    'SELECT id, jellyfin_id FROM media_children WHERE parent_id = ? AND season_number = ? AND item_number = ? LIMIT 1'
                );
                const updateExisting = db.prepare(`
                    UPDATE media_children SET
                        overview = COALESCE(overview, ?),
                        premiere_date = COALESCE(premiere_date, ?),
                        community_rating = COALESCE(community_rating, ?),
                        title = CASE WHEN title LIKE 'Episode %' THEN ? ELSE title END
                    WHERE id = ?
                `);
                const insertEp = db.prepare(`
                    INSERT INTO media_children
                    (parent_id, title, season_number, item_number, is_collected, watch_status, overview, premiere_date, community_rating)
                    VALUES (?, ?, ?, ?, 0, 'unwatched', ?, ?, ?)
                `);

                const seasonNumbers = (detail.seasons || []).map((/** @type {any} */ s) => s.season_number);
                for (const sn of seasonNumbers) {
                    try {
                        const seasonRes = await tmdbFetch(`/tv/${show.tmdb_id}/season/${sn}`);
                        if (seasonRes.ok) {
                            const seasonData = await seasonRes.json();
                            db.transaction(() => {
                                for (const ep of (seasonData.episodes || [])) {
                                    const existing = /** @type {any} */ (findExisting.get(showId, sn, ep.episode_number));
                                    if (existing) {
                                        // Update existing episode with TMDB metadata
                                        updateExisting.run(
                                            ep.overview || null,
                                            ep.air_date || null,
                                            ep.vote_average || null,
                                            ep.name || `Episode ${ep.episode_number}`,
                                            existing.id
                                        );
                                    } else {
                                        // No existing episode — insert new uncollected entry
                                        insertEp.run(
                                            showId,
                                            ep.name || `Episode ${ep.episode_number}`,
                                            sn,
                                            ep.episode_number,
                                            ep.overview || null,
                                            ep.air_date || null,
                                            ep.vote_average || null
                                        );
                                    }
                                }
                            })();
                        }
                        // Rate limit TMDB requests
                        await new Promise(r => setTimeout(r, 250));
                    } catch {
                        console.warn(`[tv-enrich] Failed to fetch season ${sn} for tmdb ${show.tmdb_id}`);
                    }
                }

                // Update episode counts on parent
                const stats = /** @type {any} */ (db.prepare(`
                    SELECT COUNT(*) as total,
                           SUM(CASE WHEN is_collected = 1 THEN 1 ELSE 0 END) as collected
                    FROM media_children WHERE parent_id = ?
                `).get(showId));
                if (stats) {
                    db.prepare('UPDATE media_parents SET total_released_children = ?, collected_children = ? WHERE id = ?')
                        .run(stats.total, stats.collected || 0, showId);
                }
            }

            // Fetch cast/crew
            const creditsRes = await tmdbFetch(`/tv/${show.tmdb_id}/credits`);
            if (creditsRes.ok) {
                const creditsData = await creditsRes.json();
                const cast = (creditsData.cast || []).slice(0, 20);
                const crewMembers = (creditsData.crew || []).filter(
                    /** @param {any} c */ (c) => ['Director', 'Writer', 'Screenplay', 'Producer', 'Original Music Composer', 'Creator'].includes(c.job)
                ).slice(0, 10);

                const findByTmdb = db.prepare('SELECT id FROM persons WHERE tmdb_person_id = ?');
                const findByName = db.prepare('SELECT id FROM persons WHERE name = ? LIMIT 1');
                const insertPerson = db.prepare('INSERT INTO persons (name, tmdb_person_id, photo_url) VALUES (?, ?, ?)');
                const updatePhoto = db.prepare('UPDATE persons SET photo_url = COALESCE(?, photo_url) WHERE id = ?');
                const upsertCredit = db.prepare(
                    'INSERT OR IGNORE INTO person_credits (person_id, media_parent_id, role_type, character_name, sort_order) VALUES (?, ?, ?, ?, ?)'
                );

                const people = [
                    ...cast.map(/** @param {any} c @param {number} i */ (c, i) => ({
                        tmdb_id: String(c.id), name: c.name,
                        photo: c.profile_path ? `https://image.tmdb.org/t/p/w185${c.profile_path}` : null,
                        role: 'actor', char: c.character || null, order: i
                    })),
                    ...crewMembers.map(/** @param {any} c @param {number} i */ (c, i) => ({
                        tmdb_id: String(c.id), name: c.name,
                        photo: c.profile_path ? `https://image.tmdb.org/t/p/w185${c.profile_path}` : null,
                        role: c.job === 'Director' ? 'director' : c.job === 'Writer' || c.job === 'Screenplay' ? 'writer'
                            : c.job === 'Producer' ? 'producer' : c.job === 'Original Music Composer' ? 'composer' : 'creator',
                        char: null, order: 100 + i
                    }))
                ];

                db.transaction(() => {
                    for (const p of people) {
                        let personId;
                        const ex = /** @type {any} */ (findByTmdb.get(p.tmdb_id));
                        if (ex) {
                            personId = ex.id;
                            if (p.photo) updatePhoto.run(p.photo, personId);
                        } else {
                            const byName = /** @type {any} */ (findByName.get(p.name));
                            if (byName) {
                                personId = byName.id;
                                db.prepare('UPDATE persons SET tmdb_person_id = COALESCE(tmdb_person_id, ?) WHERE id = ?').run(p.tmdb_id, personId);
                                if (p.photo) updatePhoto.run(p.photo, personId);
                            } else {
                                personId = insertPerson.run(p.name, p.tmdb_id, p.photo).lastInsertRowid;
                            }
                        }
                        upsertCredit.run(personId, showId, p.role, p.char, p.order);
                    }
                })();
            }
        } catch (e) {
            console.warn('[tv-enrich] TMDB enrichment failed:', e instanceof Error ? e.message : e);
        }
    }

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
                    headers: { 'X-Emby-Token': user.jellyfin_access_token },
                    signal: AbortSignal.timeout(4000),
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

    // ── Dedup: remove duplicate episodes with same season/episode number ──────
    // Case 1 (is_tmdb=1): TMDB-only row (no jellyfin_id) + Jellyfin row → keep Jellyfin row
    // Case 2 (is_tmdb=0): Two Jellyfin rows, one collected + one missing → keep collected
    const allDuplicates = /** @type {any[]} */ (db.prepare(`
        SELECT mc1.id AS orphan_id, mc2.id AS keeper_id,
               (mc1.jellyfin_id IS NULL) AS is_tmdb
        FROM media_children mc1
        JOIN media_children mc2
            ON mc1.parent_id = mc2.parent_id
            AND mc1.season_number = mc2.season_number
            AND mc1.item_number = mc2.item_number
            AND mc1.id != mc2.id
        WHERE mc1.parent_id = ?
            AND mc2.jellyfin_id IS NOT NULL
            AND (
                mc1.jellyfin_id IS NULL
                OR (mc1.is_collected = 0 AND mc2.is_collected = 1)
            )
    `).all(showId));

    if (allDuplicates.length > 0) {
        db.transaction(() => {
            for (const dup of allDuplicates) {
                // Move any useful metadata from orphan to keeper before deleting
                const orphanRow = /** @type {any} */ (db.prepare('SELECT overview, premiere_date, community_rating FROM media_children WHERE id = ?').get(dup.orphan_id));
                if (orphanRow) {
                    db.prepare(`
                        UPDATE media_children SET
                            overview = COALESCE(overview, ?),
                            premiere_date = COALESCE(premiere_date, ?),
                            community_rating = COALESCE(community_rating, ?)
                        WHERE id = ?
                    `).run(orphanRow.overview, orphanRow.premiere_date, orphanRow.community_rating, dup.keeper_id);
                }
                db.prepare('DELETE FROM media_children WHERE id = ?').run(dup.orphan_id);
            }
        })();
        const tmdbCount = allDuplicates.filter(d => d.is_tmdb).length;
        console.log(`[tv] Deduped ${allDuplicates.length} duplicate episodes for show ${showId} (${tmdbCount} TMDB + ${allDuplicates.length - tmdbCount} Jellyfin virtual)`);
    }

    const episodes = /** @type {any[]} */ (db.prepare(`
        SELECT
            mc.id,
            mc.title,
            mc.jellyfin_id,
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
    const castRaw = /** @type {any[]} */ (db.prepare(`
        SELECT p.id, p.name, p.photo_url, p.tmdb_person_id,
               pc.role_type,
               GROUP_CONCAT(DISTINCT pc.character_name) as character_name,
               MIN(pc.sort_order) as sort_order
        FROM person_credits pc
        JOIN persons p ON pc.person_id = p.id
        WHERE pc.media_parent_id = ? AND pc.role_type = 'actor'
        GROUP BY p.id
        ORDER BY sort_order ASC
    `).all(showId));

    // Merge duplicate person rows by name (same actor may exist twice
    // from Jellyfin vs TMDB syncs, so p.id alone isn't enough)
    const cast = dedupCast(castRaw);

    const crewRaw = /** @type {any[]} */ (db.prepare(`
        SELECT p.id, p.name, p.photo_url, p.tmdb_person_id,
               pc.role_type, pc.character_name, pc.sort_order
        FROM person_credits pc
        JOIN persons p ON pc.person_id = p.id
        WHERE pc.media_parent_id = ? AND pc.role_type != 'actor'
        ORDER BY pc.sort_order ASC
    `).all(showId));

    // Combine crew members with multiple roles (e.g. "Director, Writer"),
    // keyed by name to catch duplicate person rows
    const crew = dedupCrew(crewRaw);

    // External ratings
    const externalRatings = /** @type {any[]} */ (db.prepare(`
        SELECT source, rating_type, value, vote_count, raw_value, fetched_at
        FROM external_ratings WHERE media_parent_id = ? ORDER BY source
    `).all(showId));

    // Independent async work: Jellyfin favorite check, TMDB backdrop resolve
    // (await so it shows on first visit), and similar-items recommendations
    const [liveFavorite, resolvedBackdrop, similar] = await Promise.all([
        checkJellyfinFavorite(show.jellyfin_id, 'media_parents', show.id),
        (!show.backdrop_url && show.tmdb_id)
            ? resolveBackdrop(showId).catch(() => null)
            : Promise.resolve(null),
        getSimilarItems(show.tmdb_id, 'show', jellyfinUrl),
    ]);

    // Backdrop: prefer TMDB textless backdrop (cached in DB), fallback to Jellyfin
    let backdropUrl = show.backdrop_url || resolvedBackdrop;
    if (!backdropUrl && show.jellyfin_id) {
        backdropUrl = `${jellyfinUrl}/Items/${show.jellyfin_id}/Images/Backdrop?maxWidth=1200`;
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
        externalRatings,
        similarInLibrary: similar.similarInLibrary,
        similarYouMightLike: similar.similarYouMightLike,
    };
}
