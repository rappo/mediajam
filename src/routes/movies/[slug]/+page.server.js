import db from '$lib/server/db.js';
import { error, redirect } from '@sveltejs/kit';
import { checkJellyfinFavorite } from '$lib/server/jellyfin-favorites.js';
import { resolveBackdrop } from '$lib/server/backdrop.js';
import { tmdbFetch, getTmdbKey } from '$lib/server/tmdb.js';
import { slugify, ensureUniqueSlug } from '$lib/server/slugify.js';

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
        if (!row) throw error(404, 'Movie not found');
        movieId = row.id;
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
        LEFT JOIN media_children mc ON mc.parent_id = mp.id
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

    // Playback history for this movie
    const rawHistory = /** @type {any[]} */ (db.prepare(`
        SELECT ph.id, ph.timestamp, ph.source, ph.duration_consumed_seconds, ph.completion_pct
        FROM playback_history ph
        WHERE ph.media_id = ? AND ph.user_id = ?
        ORDER BY ph.timestamp IS NULL, ph.timestamp DESC
    `).all(movie.child_id || 0, userId));

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

    // Backdrop: prefer TMDB textless backdrop (cached in DB), fallback to Jellyfin
    let backdropUrl = movie.backdrop_url;
    if (!backdropUrl && movie.jellyfin_id) {
        backdropUrl = `${jellyfinUrl}/Items/${movie.jellyfin_id}/Images/Backdrop?maxWidth=1200`;
    }
    // Fetch TMDB backdrop if not yet cached (await so it shows on first visit)
    if (!movie.backdrop_url && movie.tmdb_id) {
        try {
            const resolved = await resolveBackdrop(movieId);
            if (resolved) backdropUrl = resolved;
        } catch { /* non-fatal */ }
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

    // Deduplicate cast by name (same actor may exist as separate person rows
    // from Jellyfin vs TMDB syncs, so p.id alone isn't enough)
    const castMap = new Map();
    for (const c of castRaw) {
        const key = c.name.toLowerCase();
        const existing = castMap.get(key);
        if (existing) {
            // Keep the better character name (non-empty, non-duplicate)
            if (c.character_name && !existing.character_name) {
                existing.character_name = c.character_name;
            }
            // Keep the lower sort_order (higher billing)
            if (c.sort_order < existing.sort_order) {
                existing.sort_order = c.sort_order;
            }
            // Prefer entry with photo and tmdb_person_id
            if (c.photo_url && !existing.photo_url) existing.photo_url = c.photo_url;
            if (c.tmdb_person_id && !existing.tmdb_person_id) existing.tmdb_person_id = c.tmdb_person_id;
        } else {
            castMap.set(key, { ...c });
        }
    }
    const cast = [...castMap.values()].sort((a, b) => a.sort_order - b.sort_order);

    const crewRaw = /** @type {any[]} */ (db.prepare(`
        SELECT p.id, p.name, p.photo_url, p.tmdb_person_id,
               pc.role_type, pc.character_name, pc.sort_order
        FROM person_credits pc
        JOIN persons p ON pc.person_id = p.id
        WHERE pc.media_parent_id = ? AND pc.role_type != 'actor'
        ORDER BY pc.sort_order ASC
    `).all(movieId));

    // Combine crew members with multiple roles (e.g. "Director, Writer")
    // Keyed by name to catch duplicate person rows
    const crewMap = new Map();
    for (const c of crewRaw) {
        const key = c.name.toLowerCase();
        const existing = crewMap.get(key);
        if (existing) {
            if (!existing.role_type.includes(c.role_type)) {
                existing.role_type += ', ' + c.role_type;
            }
            if (c.photo_url && !existing.photo_url) existing.photo_url = c.photo_url;
            if (c.tmdb_person_id && !existing.tmdb_person_id) existing.tmdb_person_id = c.tmdb_person_id;
        } else {
            crewMap.set(key, { ...c });
        }
    }
    const crew = [...crewMap.values()];

    // External ratings
    const externalRatings = /** @type {any[]} */ (db.prepare(`
        SELECT source, rating_type, value, vote_count, raw_value, fetched_at
        FROM external_ratings WHERE media_parent_id = ? ORDER BY source
    `).all(movieId));

    // Live Jellyfin favorite check
    const liveFavorite = await checkJellyfinFavorite(movie.jellyfin_id, 'media_parents', movie.id);

    // Runtime: prefer local (from file) over external (from TMDB)
    const runtime_minutes = movie.local_runtime_minutes || movie.external_runtime_minutes || null;
    const needsRuntimeFetch = !runtime_minutes && !!movie.tmdb_id;

    // Watchlist status
    const inWatchlist = !!db.prepare(
        'SELECT 1 FROM watchlist WHERE user_id = ? AND media_parent_id = ?'
    ).get(userId, movieId);

    // ── Similar Items (TMDB Recommendations) ─────────────────────────────────
    /** @type {any[]} */
    let similarInLibrary = [];
    /** @type {any[]} */
    let similarYouMightLike = [];

    if (movie.tmdb_id && getTmdbKey()) {
        try {
            const res = await tmdbFetch(`/movie/${movie.tmdb_id}/recommendations`);
            if (res.ok) {
                const data = await res.json();
                const recs = (data.results || []).slice(0, 20);

                // Batch lookup: which tmdb_ids are in our library?
                if (recs.length > 0) {
                    // IMPORTANT: tmdb_id is stored as TEXT — must convert to strings for IN match
                    const tmdbIds = recs.map(/** @param {any} r */ (r) => String(r.id));
                    const placeholders = tmdbIds.map(() => '?').join(',');
                    const inLib = /** @type {any[]} */ (db.prepare(
                        `SELECT id, slug, tmdb_id, title, poster_url, release_year, jellyfin_id, collection_status, arr_has_file
                         FROM media_parents
                         WHERE tmdb_id IN (${placeholders}) AND media_type = 'movie'`
                    ).all(...tmdbIds));

                    const libByTmdb = new Map(inLib.map(m => [String(m.tmdb_id), m]));

                    // Prepared statements for stub check/create (partial unique index doesn't support ON CONFLICT)
                    const findStub = db.prepare(`SELECT id, poster_url FROM media_parents WHERE tmdb_id = ? AND media_type = 'movie'`);
                    const insertStub = db.prepare(`
                        INSERT INTO media_parents (tmdb_id, title, media_type, release_year, poster_url, overview, collection_status)
                        VALUES (@tmdbId, @title, 'movie', @releaseYear, @posterUrl, @overview, 'external')
                    `);
                    const updateStub = db.prepare(`
                        UPDATE media_parents SET
                            title = COALESCE(@title, title),
                            release_year = COALESCE(@releaseYear, release_year),
                            poster_url = COALESCE(@posterUrl, poster_url),
                            overview = COALESCE(@overview, overview)
                        WHERE tmdb_id = @tmdbId AND media_type = 'movie'
                    `);

                    for (const rec of recs) {
                        const localMatch = libByTmdb.get(String(rec.id));
                        if (localMatch) {
                            const pUrl = localMatch.jellyfin_id
                                ? `${jellyfinUrl}/Items/${localMatch.jellyfin_id}/Images/Primary?maxHeight=400`
                                : localMatch.poster_url;
                            const item = {
                                href: `/movies/${localMatch.slug || localMatch.id}`,
                                poster_url: pUrl,
                                title: localMatch.title,
                                subtitle: localMatch.release_year ? String(localMatch.release_year) : '',
                            };
                            // Engaged = jellyfin_id, wanted, or arr_has_file
                            if (localMatch.jellyfin_id || localMatch.collection_status === 'wanted' || localMatch.arr_has_file === 1) {
                                similarInLibrary.push(item);
                            } else {
                                similarYouMightLike.push(item);
                            }
                        } else {
                            // Create or update a local stub so the item is browsable
                            const posterUrl = rec.poster_path
                                ? `https://image.tmdb.org/t/p/w300${rec.poster_path}`
                                : null;
                            try {
                                const stubParams = {
                                    tmdbId: String(rec.id),
                                    title: rec.title || rec.original_title || 'Unknown',
                                    releaseYear: rec.release_date ? parseInt(rec.release_date.slice(0, 4)) : null,
                                    posterUrl,
                                    overview: rec.overview || null,
                                };
                                let existing = /** @type {any} */ (findStub.get(stubParams.tmdbId));
                                if (existing) {
                                    updateStub.run(stubParams);
                                } else {
                                    insertStub.run(stubParams);
                                    existing = /** @type {any} */ (findStub.get(stubParams.tmdbId));
                                }
                                if (existing) {
                                    similarYouMightLike.push({
                                        href: `/movies/${existing.slug || existing.id}`,
                                        poster_url: existing.poster_url || posterUrl,
                                        title: stubParams.title,
                                        subtitle: rec.release_date ? rec.release_date.slice(0, 4) : '',
                                    });
                                }
                            } catch {
                                // If stub creation fails, still show with TMDB poster
                                similarYouMightLike.push({
                                    href: `https://www.themoviedb.org/movie/${rec.id}`,
                                    poster_url: posterUrl,
                                    title: rec.title || rec.original_title || 'Unknown',
                                    subtitle: rec.release_date ? rec.release_date.slice(0, 4) : '',
                                    external: true,
                                });
                            }
                        }
                    }
                }
            }
        } catch (e) {
            console.warn('[similar] Failed to fetch TMDB recommendations:', e instanceof Error ? e.message : e);
        }
    }

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
        similarInLibrary,
        similarYouMightLike,
    };
}
