import db from '$lib/server/db.js';
import { error, redirect } from '@sveltejs/kit';
import { checkJellyfinFavorite } from '$lib/server/jellyfin-favorites.js';
import { resolveBackdrop } from '$lib/server/backdrop.js';
import { tmdbFetch, getTmdbKey } from '$lib/server/tmdb.js';
import { slugify, ensureUniqueSlug, resolveSlug } from '$lib/server/slugify.js';
import { getSimilarItems } from '$lib/server/similar-items.js';
import { dedupCast, dedupCrew } from '$lib/server/credit-dedup.js';

/** @type {import('./$types').PageServerLoad} */
export async function load({ params, locals }) {
    const paramSlug = params.slug;
    const userId = locals.user?.id || 0;
    const settings = /** @type {any} */ (db.prepare('SELECT jellyfin_url, radarr_url, radarr_external_url FROM app_settings WHERE id = 1').get());
    const jellyfinUrl = settings?.jellyfin_url || '';

    // Slug lookup with numeric ID fallback
    let movieId;
    if (/^\d+$/.test(paramSlug)) {
        // Numeric param — look up by ID, redirect to slug
        const row = /** @type {any} */ (db.prepare('SELECT id, slug FROM media_parents WHERE id = ? AND media_type = \'movie\'').get(parseInt(paramSlug)));
        if (!row) throw error(404, 'Movie not found');
        if (row.slug) throw redirect(301, `/movies/${row.slug}`);
        // Generate slug on the fly if missing (shouldn't happen after migration)
        const mp = /** @type {any} */ (db.prepare('SELECT title, release_year FROM media_parents WHERE id = ?').get(row.id));
        const base = slugify(mp.title || 'untitled', mp.release_year);
        const slug = ensureUniqueSlug(db, 'media_parents', base, row.id);
        db.prepare('UPDATE media_parents SET slug = ? WHERE id = ?').run(slug, row.id);
        throw redirect(301, `/movies/${slug}`);
    } else {
        const row = /** @type {any} */ (db.prepare('SELECT id FROM media_parents WHERE slug = ? AND media_type = \'movie\'').get(paramSlug));
        if (row) {
            movieId = row.id;
        } else {
            // Fuzzy fallback: try title+year matching for client-generated slugs
            const resolved = resolveSlug(db, paramSlug, 'movie', '/movies');
            if (resolved?.redirect) throw redirect(301, resolved.redirect);
            if (resolved) movieId = resolved.id;
            else throw error(404, 'Movie not found');
        }
    }

    // Movie parent + child info
    const movie = /** @type {any} */ (db.prepare(`
        SELECT
            mp.id,
            mp.title,
            mp.release_year,
            mp.poster_url,
            mp.overview,
            mp.tmdb_id,
            mp.imdb_id,
            mp.tvdb_id,
            mp.musicbrainz_id,
            mp.jellyfin_id,
            mp.collection_status,
            mp.jellyfin_user_rating,
            mp.is_favorite,
            mp.wikipedia_url,
            mp.backdrop_url,
            mp.radarr_id,
            mp.arr_slug,
            mp.arr_monitored,
            mp.arr_quality_profile,
            mp.arr_has_file,
            mp.arr_status,
            mc.id as child_id,
            mc.watch_status,
            mc.play_count,
            mc.runtime_ticks,
            ROUND(mc.runtime_ticks / 10000000.0 / 60, 0) as local_runtime_minutes,
            mp.runtime_minutes as external_runtime_minutes,
            (SELECT th.trakt_slug FROM trakt_history th WHERE th.tmdb_id = mp.tmdb_id AND th.type = 'movie' AND th.trakt_slug != '' LIMIT 1) as trakt_slug
        FROM media_parents mp
        LEFT JOIN media_children mc ON mc.id = (
            SELECT id FROM media_children
            WHERE parent_id = mp.id
            ORDER BY CASE watch_status WHEN 'watched' THEN 0 WHEN 'in_progress' THEN 1 ELSE 2 END,
                     play_count DESC, id ASC
            LIMIT 1
        )
        WHERE mp.id = ? AND mp.media_type = 'movie'
    `).get(movieId));

    if (!movie) throw error(404, 'Movie not found');

    // ── Auto-enrich external stubs from TMDB ────────────────────────────────
    if (!movie.jellyfin_id && movie.tmdb_id && getTmdbKey() && (!movie.overview || !movie.imdb_id)) {
        try {
            const detailRes = await tmdbFetch(`/movie/${movie.tmdb_id}`);
            if (detailRes.ok) {
                const detail = await detailRes.json();
                db.prepare(`
                    UPDATE media_parents SET
                        overview = COALESCE(?, overview),
                        release_year = COALESCE(?, release_year),
                        poster_url = COALESCE(?, poster_url),
                        backdrop_url = COALESCE(?, backdrop_url),
                        runtime_minutes = COALESCE(?, runtime_minutes),
                        imdb_id = COALESCE(?, imdb_id)
                    WHERE id = ?
                `).run(
                    detail.overview || null,
                    detail.release_date ? parseInt(detail.release_date.slice(0, 4)) : null,
                    detail.poster_path ? `https://image.tmdb.org/t/p/w300${detail.poster_path}` : null,
                    detail.backdrop_path ? `https://image.tmdb.org/t/p/w1280${detail.backdrop_path}` : null,
                    detail.runtime || null,
                    detail.imdb_id || null,
                    movieId
                );
                // Refresh in-memory data
                if (detail.overview) movie.overview = detail.overview;
                if (detail.poster_path && !movie.poster_url) movie.poster_url = `https://image.tmdb.org/t/p/w300${detail.poster_path}`;
                if (detail.backdrop_path && !movie.backdrop_url) movie.backdrop_url = `https://image.tmdb.org/t/p/w1280${detail.backdrop_path}`;
                if (detail.runtime) movie.external_runtime_minutes = detail.runtime;
                if (detail.imdb_id) movie.imdb_id = detail.imdb_id;
            }

            // Fetch cast/crew
            const creditsRes = await tmdbFetch(`/movie/${movie.tmdb_id}/credits`);
            if (creditsRes.ok) {
                const creditsData = await creditsRes.json();
                const cast = (creditsData.cast || []).slice(0, 20);
                const crewMembers = (creditsData.crew || []).filter(
                    /** @param {any} c */ (c) => ['Director', 'Writer', 'Screenplay', 'Producer', 'Original Music Composer'].includes(c.job)
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
                            : c.job === 'Producer' ? 'producer' : 'composer',
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
                        upsertCredit.run(personId, movieId, p.role, p.char, p.order);
                    }
                })();
            }
        } catch (e) {
            console.warn('[movie-enrich] TMDB enrichment failed:', e instanceof Error ? e.message : e);
        }
    }

    // Playback history for this movie (query ALL children of this parent,
    // not just the one from the LEFT JOIN — handles dedup merges and re-imports)
    const rawHistory = /** @type {any[]} */ (db.prepare(`
        SELECT ph.id, ph.timestamp, ph.source, ph.duration_consumed_seconds, ph.completion_pct
        FROM playback_history ph
        WHERE ph.media_id IN (SELECT id FROM media_children WHERE parent_id = ?) AND ph.user_id = ?
        ORDER BY ph.timestamp IS NULL, ph.timestamp DESC
    `).all(movieId, userId));

    // Dedup: merge plays of the same item within a 12-hour window from different sources
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
                // Merge sources
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
    const datedHistory = history.filter(h => h.timestamp);
    const firstWatched = datedHistory.length > 0 ? datedHistory[datedHistory.length - 1].timestamp : null;
    const lastWatched = datedHistory.length > 0 ? datedHistory[0].timestamp : null;

    // Poster URL from Jellyfin if available
    const posterUrl = movie.jellyfin_id
        ? `${jellyfinUrl}/Items/${movie.jellyfin_id}/Images/Primary?maxHeight=400`
        : movie.poster_url;

    // Independent async work: Jellyfin favorite check, TMDB backdrop resolve
    // (await so it shows on first visit), and similar-items recommendations
    const [liveFavorite, resolvedBackdrop, similar] = await Promise.all([
        checkJellyfinFavorite(movie.jellyfin_id, 'media_parents', movie.id),
        (!movie.backdrop_url && movie.tmdb_id)
            ? resolveBackdrop(movieId).catch(() => null)
            : Promise.resolve(null),
        getSimilarItems(movie.tmdb_id, 'movie', jellyfinUrl),
    ]);

    // Backdrop: prefer TMDB textless backdrop (cached in DB), fallback to Jellyfin
    let backdropUrl = movie.backdrop_url || resolvedBackdrop;
    if (!backdropUrl && movie.jellyfin_id) {
        backdropUrl = `${jellyfinUrl}/Items/${movie.jellyfin_id}/Images/Backdrop?maxWidth=1200`;
    }

    // Cast & Crew
    const castRaw = /** @type {any[]} */ (db.prepare(`
        SELECT p.id, p.name, p.photo_url, p.tmdb_person_id,
               pc.role_type, pc.character_name, pc.sort_order
        FROM person_credits pc
        JOIN persons p ON pc.person_id = p.id
        WHERE pc.media_parent_id = ? AND pc.role_type = 'actor'
        ORDER BY pc.sort_order ASC
    `).all(movieId));

    const cast = dedupCast(castRaw);

    const crewRaw = /** @type {any[]} */ (db.prepare(`
        SELECT p.id, p.name, p.photo_url, p.tmdb_person_id,
               pc.role_type, pc.character_name, pc.sort_order
        FROM person_credits pc
        JOIN persons p ON pc.person_id = p.id
        WHERE pc.media_parent_id = ? AND pc.role_type != 'actor'
        ORDER BY pc.sort_order ASC
    `).all(movieId));

    // Combine crew members with multiple roles (e.g. "Director, Writer"),
    // keyed by name to catch duplicate person rows
    const crew = dedupCrew(crewRaw);

    // External ratings
    const externalRatings = /** @type {any[]} */ (db.prepare(`
        SELECT source, rating_type, value, vote_count, raw_value, fetched_at
        FROM external_ratings WHERE media_parent_id = ? ORDER BY source
    `).all(movieId));

    // Runtime: prefer local (from file) over external (from TMDB)
    const runtime_minutes = movie.local_runtime_minutes || movie.external_runtime_minutes || null;
    const needsRuntimeFetch = !runtime_minutes && !!movie.tmdb_id;

    // Watchlist status
    const inWatchlist = !!db.prepare(
        'SELECT 1 FROM watchlist WHERE user_id = ? AND media_parent_id = ?'
    ).get(userId, movieId);

    return {
        movie: {
            ...movie,
            runtime_minutes,
            needsRuntimeFetch,
            is_favorite: liveFavorite ?? movie.is_favorite,
            // Effective watch status: if we have play history, it's watched regardless of Jellyfin
            watch_status: totalPlays > 0 ? 'watched' : movie.watch_status,
            play_count: Math.max(movie.play_count || 0, totalPlays),
            posterUrl,
            backdropUrl,
            // Auto-enrich when key data is missing
            needsEnrichment: !movie.overview && (!!movie.jellyfin_id || !!movie.tmdb_id),
        },
        history,
        stats: {
            totalPlays,
            firstWatched,
            lastWatched,
        },
        cast,
        crew,
        externalRatings,
        jellyfinUrl,
        arrUrl: (settings?.radarr_external_url || settings?.radarr_url || '').replace(/\/+$/, ''),
        arrService: 'radarr',
        inWatchlist,
        similarInLibrary: similar.similarInLibrary,
        similarYouMightLike: similar.similarYouMightLike,
    };
}
