/**
 * Discovery engine — powers the unified Dashboard page.
 * Combines local library data with TMDB trending content,
 * scored by user genre affinity.
 */
import db from '$lib/server/db.js';
import { tmdbFetch } from '$lib/server/tmdb.js';

// ── TMDB genre ID → name maps ───────────────────────────────────────────────

const MOVIE_GENRES = {
    28: 'action', 12: 'adventure', 16: 'animation', 35: 'comedy', 80: 'crime',
    99: 'documentary', 18: 'drama', 10751: 'family', 14: 'fantasy', 36: 'history',
    27: 'horror', 10402: 'music', 9648: 'mystery', 10749: 'romance',
    878: 'science fiction', 10770: 'tv movie', 53: 'thriller', 10752: 'war', 37: 'western'
};

const TV_GENRES = {
    10759: 'action & adventure', 16: 'animation', 35: 'comedy', 80: 'crime',
    99: 'documentary', 18: 'drama', 10751: 'family', 10762: 'kids', 9648: 'mystery',
    10763: 'news', 10764: 'reality', 10765: 'sci-fi & fantasy', 10766: 'soap',
    10767: 'talk', 10768: 'war & politics', 37: 'western'
};

// ── Daily seed (same as homepage-engine) ────────────────────────────────────

function dailySeed() {
    const d = new Date();
    return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Score a TMDB item by how many of its genres overlap with the user's top genres.
 * @param {number[]} genreIds - TMDB genre_ids array
 * @param {Record<number, string>} genreMap - TMDB genre ID→name mapping
 * @param {string[]} userGenres - user's top genre names (lowercase)
 * @returns {number} score 0–1
 */
function scoreByGenreAffinity(genreIds, genreMap, userGenres) {
    if (!genreIds || genreIds.length === 0 || userGenres.length === 0) return 0;
    const itemGenres = genreIds
        .map(id => genreMap[id])
        .filter(Boolean)
        .map(g => g.toLowerCase());
    if (itemGenres.length === 0) return 0;
    const matches = itemGenres.filter(g => userGenres.includes(g)).length;
    return matches / itemGenres.length;
}

// ── Exported functions ──────────────────────────────────────────────────────

/**
 * Build a genre affinity map from the user's playback history + media tags.
 * @param {number} userId
 * @returns {{ genre: string, freq: number }[]}
 */
export function getUserGenreProfile(userId) {
    try {
        return /** @type {any[]} */ (db.prepare(`
            SELECT mt.tag_value as genre, COUNT(*) as freq
            FROM media_tags mt
            JOIN media_parents mp ON mt.media_parent_id = mp.id
            JOIN media_children mc ON mc.parent_id = mp.id
            JOIN playback_history ph ON ph.media_id = mc.id
            WHERE ph.user_id = ? AND mt.tag_type = 'genre'
            GROUP BY mt.tag_value ORDER BY freq DESC LIMIT 20
        `).all(userId));
    } catch {
        return [];
    }
}

/**
 * Get trending movies from TMDB, scored by user genre affinity.
 * @param {{ genre: string, freq: number }[]} userGenres
 * @param {number} limit
 * @param {number} page
 */
export async function getTrendingMovies(userGenres, limit = 20, page = 1) {
    try {
        const res = await tmdbFetch(`/trending/movie/week`, { page: String(page) });
        const data = await res.json();
        if (!data?.results) return { items: [], totalPages: 0, page };

        const userGenreNames = userGenres.map(g => g.genre.toLowerCase());

        const items = data.results.map(item => {
            const affinityScore = scoreByGenreAffinity(item.genre_ids, MOVIE_GENRES, userGenreNames);

            // Check if in local library
            let in_library = false;
            let library_slug = null;
            try {
                const local = db.prepare(
                    `SELECT slug, play_count FROM media_parents WHERE tmdb_id = ? AND media_type = 'movie' LIMIT 1`
                ).get(item.id);
                if (local) {
                    in_library = true;
                    library_slug = local.slug;
                }
            } catch { /* ignore */ }

            return {
                tmdb_id: item.id,
                title: item.title,
                poster_url: item.poster_path ? `https://image.tmdb.org/t/p/w500${item.poster_path}` : null,
                backdrop_url: item.backdrop_path ? `https://image.tmdb.org/t/p/w1280${item.backdrop_path}` : null,
                release_year: item.release_date?.substring(0, 4),
                vote_average: item.vote_average,
                overview: item.overview,
                genre_ids: item.genre_ids,
                media_type: 'movie',
                affinity_score: affinityScore,
                in_library,
                library_slug,
                watch_status: local?.play_count > 0 ? 'watched' : null,
            };
        });

        // Sort by affinity score DESC, then popularity (vote_average) DESC
        items.sort((a, b) => {
            if (b.affinity_score !== a.affinity_score) return b.affinity_score - a.affinity_score;
            return (b.vote_average || 0) - (a.vote_average || 0);
        });

        return {
            items: items.slice(0, limit),
            totalPages: data.total_pages || 1,
            page,
        };
    } catch (err) {
        console.error('[discovery-engine] getTrendingMovies error:', err?.message || err);
        return { items: [], totalPages: 0, page };
    }
}

/**
 * Get trending TV shows from TMDB, scored by user genre affinity.
 * @param {{ genre: string, freq: number }[]} userGenres
 * @param {number} limit
 * @param {number} page
 */
export async function getTrendingShows(userGenres, limit = 20, page = 1) {
    try {
        const res = await tmdbFetch(`/trending/tv/week`, { page: String(page) });
        const data = await res.json();
        if (!data?.results) return { items: [], totalPages: 0, page };

        const userGenreNames = userGenres.map(g => g.genre.toLowerCase());

        const items = data.results.map(item => {
            const affinityScore = scoreByGenreAffinity(item.genre_ids, TV_GENRES, userGenreNames);

            // Check if in local library
            let in_library = false;
            let library_slug = null;
            try {
                const local = db.prepare(
                    `SELECT slug, play_count FROM media_parents WHERE tmdb_id = ? AND media_type = 'show' LIMIT 1`
                ).get(item.id);
                if (local) {
                    in_library = true;
                    library_slug = local.slug;
                }
            } catch { /* ignore */ }

            return {
                tmdb_id: item.id,
                title: item.name,
                poster_url: item.poster_path ? `https://image.tmdb.org/t/p/w500${item.poster_path}` : null,
                backdrop_url: item.backdrop_path ? `https://image.tmdb.org/t/p/w1280${item.backdrop_path}` : null,
                release_year: item.first_air_date?.substring(0, 4),
                vote_average: item.vote_average,
                overview: item.overview,
                genre_ids: item.genre_ids,
                media_type: 'show',
                affinity_score: affinityScore,
                in_library,
                library_slug,
                watch_status: local?.play_count > 0 ? 'watched' : null,
            };
        });

        // Sort by affinity score DESC, then popularity DESC
        items.sort((a, b) => {
            if (b.affinity_score !== a.affinity_score) return b.affinity_score - a.affinity_score;
            return (b.vote_average || 0) - (a.vote_average || 0);
        });

        return {
            items: items.slice(0, limit),
            totalPages: data.total_pages || 1,
            page,
        };
    } catch (err) {
        console.error('[discovery-engine] getTrendingShows error:', err?.message || err);
        return { items: [], totalPages: 0, page };
    }
}

/**
 * Actor deep-dive — pick a top actor (daily rotation) and show their unwatched films.
 * @param {number} userId
 */
export function getActorDeepDive(userId) {
    try {
        const topActors = /** @type {any[]} */ (db.prepare(`
            SELECT p.id, p.name, p.photo_url, p.tmdb_person_id, p.slug,
                   COUNT(DISTINCT mp.id) as watched_count
            FROM persons p
            JOIN person_credits pc ON pc.person_id = p.id
            JOIN media_parents mp ON pc.media_parent_id = mp.id
            JOIN media_children mc ON mc.parent_id = mp.id
            JOIN playback_history ph ON ph.media_id = mc.id
            WHERE ph.user_id = ? AND pc.role_type = 'actor' AND mp.media_type = 'movie'
            GROUP BY p.id
            HAVING watched_count >= 3
            ORDER BY watched_count DESC
        `).all(userId));

        if (topActors.length === 0) return null;

        // Daily rotation: pick from top 10
        const pool = topActors.slice(0, 10);
        const seed = dailySeed();
        const idx = seed % pool.length;
        const actor = pool[idx];

        // Get unwatched films by this actor (check both watch_status AND playback_history)
        const unwatched = /** @type {any[]} */ (db.prepare(`
            SELECT DISTINCT mp.id, mp.title, mp.poster_url, mp.release_year, mp.slug, mp.tmdb_id
            FROM person_credits pc
            JOIN media_parents mp ON pc.media_parent_id = mp.id
            WHERE pc.person_id = ? AND pc.role_type = 'actor' AND mp.media_type = 'movie'
              AND NOT EXISTS (
                SELECT 1 FROM media_children mc2
                WHERE mc2.parent_id = mp.id AND mc2.watch_status = 'watched'
              )
              AND NOT EXISTS (
                SELECT 1 FROM media_children mc3
                JOIN playback_history ph ON ph.media_id = mc3.id
                WHERE mc3.parent_id = mp.id AND ph.user_id = ?
              )
            ORDER BY mp.release_year DESC
        `).all(actor.id, userId));

        // Total films count for this actor
        const totalRow = db.prepare(`
            SELECT COUNT(DISTINCT mp.id) as total
            FROM person_credits pc
            JOIN media_parents mp ON pc.media_parent_id = mp.id
            WHERE pc.person_id = ? AND pc.role_type = 'actor' AND mp.media_type = 'movie'
        `).get(actor.id);

        return {
            person: {
                id: actor.id,
                name: actor.name,
                profile_url: actor.photo_url,
                slug: actor.slug,
            },
            watchedCount: actor.watched_count,
            totalCount: totalRow?.total || 0,
            unwatched: unwatched.map(m => ({
                id: m.id,
                title: m.title,
                poster_url: m.poster_url,
                release_year: m.release_year,
                slug: m.slug,
                href: `/movies/${m.slug}`,
            })),
        };
    } catch (err) {
        console.error('[discovery-engine] getActorDeepDive error:', err?.message || err);
        return null;
    }
}

/**
 * Recently added items to the library.
 * @param {number} limit
 */
export function getRecentlyAdded(limit = 20) {
    try {
        const rows = /** @type {any[]} */ (db.prepare(`
            SELECT mp.id, mp.title, mp.poster_url, mp.media_type, mp.slug, mp.release_year,
                   mp.date_last_modified, mp.play_count
            FROM media_parents mp
            WHERE mp.collection_status = 'collected'
            ORDER BY mp.date_last_modified DESC
            LIMIT ?
        `).all(limit));

        return rows.map(mp => ({
            href: `/${mp.media_type === 'artist' ? 'music' : mp.media_type === 'show' ? 'tv' : 'movies'}/${mp.slug}`,
            title: mp.title,
            poster_url: mp.poster_url,
            subtitle: mp.release_year,
            media_type: mp.media_type,
            icon: mp.media_type === 'movie' ? '🎬' : mp.media_type === 'show' ? '📺' : '🎵',
            badge: mp.play_count > 0 ? '✓ Watched' : null,
        }));
    } catch (err) {
        console.error('[discovery-engine] getRecentlyAdded error:', err?.message || err);
        return [];
    }
}

/**
 * Get user's watchlist items with media details.
 * @param {number} userId
 * @param {number} limit
 */
export function getWatchlistItems(userId, limit = 10) {
    try {
        return /** @type {any[]} */ (db.prepare(`
            SELECT mp.id, mp.title, mp.poster_url, mp.backdrop_url, mp.media_type, mp.slug,
                   mp.release_year, mp.overview
            FROM watchlist w
            JOIN media_parents mp ON w.media_parent_id = mp.id
            WHERE w.user_id = ?
            ORDER BY w.added_at DESC
            LIMIT ?
        `).all(userId, limit));
    } catch (err) {
        console.error('[discovery-engine] getWatchlistItems error:', err?.message || err);
        return [];
    }
}

/**
 * Helper: fetch arr calendar with fallback — race primary + external URLs, first success wins.
 * Defined at module level so both getUpcomingDays and getMonthCalendar can use it.
 */
async function arrCalendarFetch(primaryUrl, externalUrl, apiKey, path, apiVersion = 'v3') {
    const candidates = [primaryUrl, externalUrl].filter(Boolean);
    if (candidates.length === 0) return null;

    try {
        return await Promise.any(candidates.map(async (baseUrl) => {
            const url = `${baseUrl.replace(/\/+$/, '')}/api/${apiVersion}/${path}`;
            const res = await fetch(url, {
                headers: { 'X-Api-Key': apiKey },
                signal: AbortSignal.timeout(4000),
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return res.json();
        }));
    } catch {
        return null;
    }
}

/**
 * Upcoming releases for the next N days, grouped by date.
 * Fetches LIVE data from Sonarr/Radarr/Lidarr calendar APIs,
 * falling back to local DB data.
 * @param {number} days
 * @param {string[]} types - e.g. ['movie', 'show', 'artist']
 */
export async function getUpcomingDays(days = 7, types = ['movie', 'show', 'artist']) {
    try {
        const today = new Date();
        const currentHour = today.getHours();
        const isEarlyMorning = currentHour < 5;

        const endDate = new Date(today);
        endDate.setDate(today.getDate() + days - 1);

        // Use local date strings
        const localISO = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
        /** Convert a UTC datetime string (e.g. '2026-06-12T00:00:00Z') to local YYYY-MM-DD */
        const toLocalDate = (s) => { if (!s) return ''; return localISO(new Date(s)); };
        const todayISO = localISO(today);
        const endISO = localISO(endDate);

        // Extend API fetch window ±1 day to handle timezone edge cases
        const fetchStart = new Date(today);
        fetchStart.setDate(fetchStart.getDate() - 1);
        const fetchEnd = new Date(endDate);
        fetchEnd.setDate(fetchEnd.getDate() + 1);
        const fetchStartISO = localISO(fetchStart);
        const fetchEndISO = localISO(fetchEnd);

        const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

        /** @type {Record<string, any[]>} */
        const byDate = {};

        // If early morning, include the previous day (and show one fewer future day to keep total = days)
        const displayDays = isEarlyMorning ? days - 1 : days;
        if (isEarlyMorning) {
            const yesterday = new Date(today);
            yesterday.setDate(yesterday.getDate() - 1);
            byDate[localISO(yesterday)] = [];
        }

        // Pre-populate days
        for (let i = 0; i < displayDays; i++) {
            const d = new Date(today);
            d.setDate(today.getDate() + i);
            byDate[localISO(d)] = [];
        }

        // Get arr connection info (internal + external URLs for fallback)
        const settings = /** @type {any} */ (db.prepare(
            'SELECT sonarr_url, sonarr_api_key, sonarr_external_url, radarr_url, radarr_api_key, radarr_external_url, lidarr_url, lidarr_api_key, lidarr_external_url FROM app_settings WHERE id = 1'
        ).get());

        // Build local slug lookup maps for linking
        const localShowSlugs = new Map();
        try {
            /** @type {any[]} */ (db.prepare(
                "SELECT tvdb_id, tmdb_id, slug FROM media_parents WHERE media_type = 'show' AND slug IS NOT NULL"
            ).all()).forEach(r => {
                if (r.tvdb_id) localShowSlugs.set('tvdb:' + r.tvdb_id, r.slug);
                if (r.tmdb_id) localShowSlugs.set('tmdb:' + r.tmdb_id, r.slug);
            });
        } catch { /* optional */ }

        const localMovieSlugs = new Map();
        try {
            /** @type {any[]} */ (db.prepare(
                "SELECT tmdb_id, slug FROM media_parents WHERE media_type = 'movie' AND slug IS NOT NULL"
            ).all()).forEach(r => {
                if (r.tmdb_id) localMovieSlugs.set(String(r.tmdb_id), r.slug);
            });
        } catch { /* optional */ }

        const fetches = [];

        // ── Sonarr calendar ────────────────────────────────────
        if (types.includes('show') && settings?.sonarr_api_key) {
            fetches.push((async () => {
                try {
                    const episodes = await arrCalendarFetch(
                        settings.sonarr_url, settings.sonarr_external_url, settings.sonarr_api_key,
                        `calendar?start=${fetchStartISO}&end=${fetchEndISO}&includeSeries=true&includeEpisodeFile=true&unmonitored=true`
                    );
                    if (!episodes) return;
                    for (const ep of episodes) {
                        const dateKey = ep.airDate || (ep.airDateUtc ? toLocalDate(ep.airDateUtc) : null);
                        if (!dateKey || !byDate[dateKey]) continue;

                        const series = ep.series || {};
                        const tvdbId = series.tvdbId;
                        const slug = localShowSlugs.get('tvdb:' + tvdbId) || series.titleSlug || '';
                        const posterImage = (series.images || []).find(i => i.coverType === 'poster');
                        const posterUrl = posterImage?.remoteUrl || posterImage?.url || '';

                        byDate[dateKey].push({
                            title: series.title || 'Unknown',
                            episode_title: ep.title || 'TBA',
                            media_type: 'show',
                            season_number: ep.seasonNumber,
                            item_number: ep.episodeNumber,
                            poster_url: posterUrl,
                            display_poster: posterUrl,
                            href: slug ? `/tv/${slug}` : '/calendar',
                            subtitle: `S${String(ep.seasonNumber).padStart(2,'0')}E${String(ep.episodeNumber).padStart(2,'0')}`,
                            hasFile: ep.hasFile || false,
                            airTime: ep.airDateUtc ? new Date(ep.airDateUtc).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '',
                        });
                    }
                } catch (err) {
                    console.error('[discovery-engine] Sonarr calendar error:', err?.message);
                }
            })());
        }

        // ── Radarr calendar ────────────────────────────────────
        if (types.includes('movie') && settings?.radarr_api_key) {
            fetches.push((async () => {
                try {
                    const movies = await arrCalendarFetch(
                        settings.radarr_url, settings.radarr_external_url, settings.radarr_api_key,
                        `calendar?start=${fetchStartISO}&end=${fetchEndISO}&unmonitored=true`
                    );
                    if (!movies) return;
                    for (const movie of movies) {
                        const releaseDate = toLocalDate(movie.digitalRelease || movie.physicalRelease || movie.inCinemas || '');
                        if (!releaseDate || !byDate[releaseDate]) continue;

                        const tmdbId = String(movie.tmdbId || '');
                        const slug = localMovieSlugs.get(tmdbId) || movie.titleSlug || '';
                        const posterImage = (movie.images || []).find(i => i.coverType === 'poster');
                        const posterUrl = posterImage?.remoteUrl || posterImage?.url || '';

                        byDate[releaseDate].push({
                            title: movie.title || 'Unknown',
                            episode_title: '',
                            media_type: 'movie',
                            poster_url: posterUrl,
                            display_poster: posterUrl,
                            href: slug ? `/movies/${slug}` : '/calendar',
                            subtitle: String(movie.year || ''),
                            hasFile: movie.hasFile || false,
                        });
                    }
                } catch (err) {
                    console.error('[discovery-engine] Radarr calendar error:', err?.message);
                }
            })());
        }

        // ── Lidarr calendar ────────────────────────────────────
        if (types.includes('artist') && settings?.lidarr_api_key) {
            fetches.push((async () => {
                try {
                    const albums = await arrCalendarFetch(
                        settings.lidarr_url, settings.lidarr_external_url, settings.lidarr_api_key,
                        `calendar?start=${fetchStartISO}&end=${fetchEndISO}&includeArtist=true&unmonitored=true`, 'v1'
                    );
                    if (!albums) return;
                    for (const album of albums) {
                        const releaseDate = toLocalDate(album.releaseDate || '');
                        if (!releaseDate || !byDate[releaseDate]) continue;

                        const artist = album.artist || {};
                        const coverImage = (album.images || []).find(i => i.coverType === 'cover') ||
                                           (artist.images || []).find(i => i.coverType === 'poster');
                        let posterUrl = coverImage?.remoteUrl || '';
                        // Fallback: construct full URL from Lidarr base + relative path
                        if (!posterUrl && coverImage?.url) {
                            const lidarrBase = (settings.lidarr_external_url || settings.lidarr_url || '').replace(/\/$/, '');
                            if (lidarrBase && coverImage.url.startsWith('/')) {
                                posterUrl = `${lidarrBase}${coverImage.url}`;
                            }
                        }

                        byDate[releaseDate].push({
                            title: artist.artistName || 'Unknown',
                            episode_title: '',
                            media_type: 'artist',
                            poster_url: posterUrl,
                            display_poster: posterUrl,
                            href: `/music/${artist.foreignArtistId || ''}`,
                            subtitle: album.title || '',
                            hasFile: album.grabbed || false,
                        });
                    }
                } catch (err) {
                    console.error('[discovery-engine] Lidarr calendar error:', err?.message);
                }
            })());
        }

        // Fetch all in parallel
        if (fetches.length > 0) {
            await Promise.all(fetches);
        }

        // Fallback: also merge local DB data for items not from arr APIs
        try {
            const placeholders = types.map(() => '?').join(',');
            const localRows = /** @type {any[]} */ (db.prepare(`
                SELECT mc.id, mc.title as episode_title, mc.premiere_date,
                       mp.id as parent_id, mp.title, mp.poster_url, mp.media_type, mp.slug,
                       mc.season_number, mc.item_number, mc.poster_url as episode_poster
                FROM media_children mc
                JOIN media_parents mp ON mc.parent_id = mp.id
                WHERE substr(mc.premiere_date, 1, 10) BETWEEN ? AND ?
                  AND mp.media_type IN (${placeholders})
                ORDER BY mc.premiere_date ASC
            `).all(fetchStartISO, fetchEndISO, ...types));

            for (const row of localRows) {
                const dateKey = row.premiere_date?.split('T')[0] || row.premiere_date;
                if (!byDate[dateKey]) continue;

                // Skip if already have this from arr API
                const isDuplicate = byDate[dateKey].some(existing =>
                    existing.title === row.title &&
                    existing.season_number === row.season_number &&
                    existing.item_number === row.item_number
                );
                if (isDuplicate) continue;

                let href = '/calendar';
                let subtitle = '';
                if (row.media_type === 'show') {
                    href = `/tv/${row.slug || row.parent_id}`;
                    if (row.season_number != null && row.item_number != null) {
                        subtitle = `S${String(row.season_number).padStart(2, '0')}E${String(row.item_number).padStart(2, '0')}`;
                    }
                } else if (row.media_type === 'movie') {
                    href = `/movies/${row.slug || row.parent_id}`;
                } else if (row.media_type === 'artist') {
                    href = `/music/${row.slug || row.parent_id}`;
                }

                byDate[dateKey].push({
                    ...row,
                    href,
                    subtitle,
                    display_poster: row.episode_poster || row.poster_url,
                });
            }
        } catch { /* local fallback is optional */ }

        // ── Group items from the same series/artist per day ───
        for (const [dateKey, items] of Object.entries(byDate)) {
            /** @type {Map<string, any>} */
            const groups = new Map();
            for (const item of items) {
                const groupKey = `${item.media_type}::${item.title}`;
                if (groups.has(groupKey)) {
                    const existing = groups.get(groupKey);
                    existing._children.push(item);
                } else {
                    groups.set(groupKey, { ...item, _children: [item] });
                }
            }
            // Build merged items
            byDate[dateKey] = [...groups.values()].map(g => {
                if (g._children.length <= 1) {
                    const { _children, ...rest } = g;
                    return rest;
                }
                const children = g._children;
                if (g.media_type === 'show') {
                    // Combine episodes: "S05E01–E07 · 7 episodes"
                    const eps = children
                        .map(c => c.item_number)
                        .filter(n => n != null)
                        .sort((a, b) => a - b);
                    const season = children[0].season_number;
                    const sLabel = season != null ? `S${String(season).padStart(2, '0')}` : '';
                    let epRange = '';
                    if (eps.length > 0) {
                        epRange = eps.length === 1
                            ? `${sLabel}E${String(eps[0]).padStart(2, '0')}`
                            : `${sLabel}E${String(eps[0]).padStart(2, '0')}–E${String(eps[eps.length - 1]).padStart(2, '0')}`;
                    }
                    return {
                        ...children[0],
                        subtitle: epRange ? `${epRange} · ${children.length} episodes` : `${children.length} episodes`,
                        episode_title: '',
                    };
                } else if (g.media_type === 'artist') {
                    // Combine albums: "3 albums"
                    const albumNames = children.map(c => c.subtitle || c.episode_title).filter(Boolean);
                    return {
                        ...children[0],
                        subtitle: albumNames.length > 1
                            ? `${albumNames[0]} +${albumNames.length - 1} more`
                            : albumNames[0] || '',
                        episode_title: '',
                    };
                }
                // Movies rarely group, but just in case
                return { ...children[0] };
            });
        }

        return Object.entries(byDate).map(([date, items]) => {
            const d = new Date(date + 'T12:00:00');
            return {
                date,
                dayName: dayNames[d.getDay()],
                dayNum: d.getDate(),
                isToday: date === todayISO,
                items,
            };
        });
    } catch (err) {
        console.error('[discovery-engine] getUpcomingDays error:', err?.message || err);
        return [];
    }
}

/**
 * Fetch calendar data for a specific month (used by /calendar page).
 * Returns the same shape as getUpcomingDays but for an entire month.
 * @param {number} year
 * @param {number} month - 1-indexed (1=Jan, 12=Dec)
 * @param {string[]} types
 */
export async function getMonthCalendar(year, month, types = ['movie', 'show', 'artist']) {
    try {
        const firstDay = new Date(year, month - 1, 1);
        const lastDay = new Date(year, month, 0);
        const daysInMonth = lastDay.getDate();

        const localISO = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
        const toLocalDate = (s) => { if (!s) return ''; return localISO(new Date(s)); };

        const todayISO = localISO(new Date());
        const startISO = localISO(firstDay);
        const endISO = localISO(lastDay);

        // Extend fetch range ±1 day for timezone edge cases
        const fetchStart = new Date(firstDay);
        fetchStart.setDate(fetchStart.getDate() - 1);
        const fetchEnd = new Date(lastDay);
        fetchEnd.setDate(fetchEnd.getDate() + 1);
        const fetchStartISO = localISO(fetchStart);
        const fetchEndISO = localISO(fetchEnd);

        const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

        /** @type {Record<string, any[]>} */
        const byDate = {};
        for (let d = 1; d <= daysInMonth; d++) {
            const dt = new Date(year, month - 1, d);
            byDate[localISO(dt)] = [];
        }

        // Get arr connection info
        const settings = /** @type {any} */ (db.prepare(
            'SELECT sonarr_url, sonarr_api_key, sonarr_external_url, radarr_url, radarr_api_key, radarr_external_url, lidarr_url, lidarr_api_key, lidarr_external_url FROM app_settings WHERE id = 1'
        ).get());

        const fetches = [];

        // ── Sonarr ────────────────────────────────────
        if (types.includes('show') && settings?.sonarr_api_key) {
            fetches.push((async () => {
                try {
                    const episodes = await arrCalendarFetch(
                        settings.sonarr_url, settings.sonarr_external_url, settings.sonarr_api_key,
                        `calendar?start=${fetchStartISO}&end=${fetchEndISO}&includeSeries=true&includeEpisodeFile=true&unmonitored=true`
                    );
                    if (!episodes) return;
                    for (const ep of episodes) {
                        const dateKey = ep.airDate || (ep.airDateUtc ? toLocalDate(ep.airDateUtc) : null);
                        if (!dateKey || !byDate[dateKey]) continue;

                        const series = ep.series || {};
                        const tvdbId = series.tvdbId;
                        const localParent = tvdbId
                            ? /** @type {any} */ (db.prepare('SELECT id, slug, poster_url FROM media_parents WHERE tvdb_id = ?').get(tvdbId))
                            : null;

                        byDate[dateKey].push({
                            title: series.title || ep.title || 'Unknown',
                            subtitle: `S${String(ep.seasonNumber).padStart(2,'0')}E${String(ep.episodeNumber).padStart(2,'0')}`,
                            episode_title: ep.title || '',
                            poster_url: localParent?.poster_url || (series.images?.find(i => i.coverType === 'poster')?.remoteUrl) || '',
                            display_poster: localParent?.poster_url || '',
                            media_type: 'show',
                            href: localParent ? `/tv/${localParent.slug}` : null,
                            premiere_date: ep.airDateUtc || dateKey,
                            season_number: ep.seasonNumber,
                            episode_number: ep.episodeNumber,
                        });
                    }
                } catch { /* silent */ }
            })());
        }

        // ── Radarr ────────────────────────────────────
        if (types.includes('movie') && settings?.radarr_api_key) {
            fetches.push((async () => {
                try {
                    const movies = await arrCalendarFetch(
                        settings.radarr_url, settings.radarr_external_url, settings.radarr_api_key,
                        `calendar?start=${fetchStartISO}&end=${fetchEndISO}&unmonitored=true`
                    );
                    if (!movies) return;
                    for (const movie of movies) {
                        const releaseDate = toLocalDate(movie.digitalRelease || movie.physicalRelease || movie.inCinemas || '');
                        if (!releaseDate || !byDate[releaseDate]) continue;

                        const tmdbId = movie.tmdbId;
                        const localParent = tmdbId
                            ? /** @type {any} */ (db.prepare('SELECT id, slug, poster_url FROM media_parents WHERE tmdb_id = ?').get(tmdbId))
                            : null;

                        byDate[releaseDate].push({
                            title: movie.title || 'Unknown Movie',
                            subtitle: movie.year ? String(movie.year) : '',
                            episode_title: '',
                            poster_url: localParent?.poster_url || (movie.images?.find(i => i.coverType === 'poster')?.remoteUrl) || '',
                            display_poster: localParent?.poster_url || '',
                            media_type: 'movie',
                            href: localParent ? `/movies/${localParent.slug}` : null,
                            premiere_date: releaseDate,
                        });
                    }
                } catch { /* silent */ }
            })());
        }

        // ── Lidarr ────────────────────────────────────
        if (types.includes('artist') && settings?.lidarr_api_key) {
            fetches.push((async () => {
                try {
                    const albums = await arrCalendarFetch(
                        settings.lidarr_url, settings.lidarr_external_url, settings.lidarr_api_key,
                        `calendar?start=${fetchStartISO}&end=${fetchEndISO}&includeArtist=true&unmonitored=true`, 'v1'
                    );
                    if (!albums) return;
                    for (const album of albums) {
                        const releaseDate = toLocalDate(album.releaseDate || '');
                        if (!releaseDate || !byDate[releaseDate]) continue;

                        const artist = album.artist || {};
                        const localArtist = artist.foreignArtistId
                            ? /** @type {any} */ (db.prepare('SELECT id, slug, poster_url FROM media_parents WHERE musicbrainz_id = ?').get(artist.foreignArtistId))
                            : null;

                        const coverImg = album.images?.find(i => i.coverType === 'cover')?.remoteUrl || '';

                        byDate[releaseDate].push({
                            title: artist.artistName || 'Unknown Artist',
                            subtitle: album.title || '',
                            episode_title: album.title || '',
                            poster_url: coverImg || localArtist?.poster_url || '',
                            display_poster: coverImg || localArtist?.poster_url || '',
                            media_type: 'artist',
                            href: localArtist ? `/music/${localArtist.slug}` : null,
                            premiere_date: releaseDate,
                        });
                    }
                } catch { /* silent */ }
            })());
        }

        await Promise.all(fetches);

        // Fallback: local DB data
        try {
            const placeholders = types.map(() => '?').join(',');
            const localRows = /** @type {any[]} */ (db.prepare(`
                SELECT mc.id, mc.title as episode_title, mc.premiere_date,
                       mp.id as parent_id, mp.title, mp.poster_url, mp.media_type, mp.slug,
                       mc.season_number, mc.item_number, mc.poster_url as episode_poster
                FROM media_children mc
                JOIN media_parents mp ON mc.parent_id = mp.id
                WHERE substr(mc.premiere_date, 1, 10) BETWEEN ? AND ?
                  AND mp.media_type IN (${placeholders})
                ORDER BY mc.premiere_date ASC
            `).all(fetchStartISO, fetchEndISO, ...types));

            for (const row of localRows) {
                const dateKey = row.premiere_date?.split('T')[0] || row.premiere_date;
                if (!byDate[dateKey]) continue;
                const isDuplicate = byDate[dateKey].some(e =>
                    e.title === row.title && (e.season_number === row.season_number || e.media_type !== 'show')
                );
                if (isDuplicate) continue;
                byDate[dateKey].push({
                    title: row.title,
                    subtitle: row.media_type === 'show' ? `S${String(row.season_number||0).padStart(2,'0')}E${String(row.item_number||0).padStart(2,'0')}` : '',
                    episode_title: row.episode_title || '',
                    poster_url: row.poster_url || '',
                    display_poster: row.episode_poster || row.poster_url || '',
                    media_type: row.media_type,
                    href: `/${row.media_type === 'movie' ? 'movies' : row.media_type === 'show' ? 'tv' : 'music'}/${row.slug}`,
                    premiere_date: row.premiere_date,
                    season_number: row.season_number,
                    episode_number: row.item_number,
                });
            }
        } catch { /* silent */ }

        return Object.entries(byDate).map(([date, items]) => {
            const d = new Date(date + 'T12:00:00');
            return {
                date,
                dayName: dayNames[d.getDay()],
                dayNum: d.getDate(),
                isToday: date === todayISO,
                items,
            };
        });
    } catch (err) {
        console.error('[discovery-engine] getMonthCalendar error:', err?.message || err);
        return [];
    }
}

/**
 * Library statistics: counts of media types + total watch hours.
 */
export function getLibraryStats() {
    try {
        // Media type counts
        const typeCounts = /** @type {any[]} */ (db.prepare(`
            SELECT media_type, COUNT(*) as count
            FROM media_parents
            WHERE collection_status = 'collected'
            GROUP BY media_type
        `).all());

        const counts = { movies: 0, shows: 0, artists: 0 };
        for (const row of typeCounts) {
            if (row.media_type === 'movie') counts.movies = row.count;
            else if (row.media_type === 'show') counts.shows = row.count;
            else if (row.media_type === 'artist') counts.artists = row.count;
        }

        // Episode count
        const epRow = db.prepare(`
            SELECT COUNT(*) as count FROM media_children
            WHERE parent_id IN (SELECT id FROM media_parents WHERE media_type = 'show')
        `).get();
        const episodes = epRow?.count || 0;

        // Album count
        const albumRow = db.prepare(`
            SELECT COUNT(*) as count FROM media_children
            WHERE parent_id IN (SELECT id FROM media_parents WHERE media_type = 'artist')
        `).get();
        const albums = albumRow?.count || 0;

        // Watch hours
        const hoursRow = db.prepare(`
            SELECT COALESCE(SUM(duration_consumed_seconds), 0) / 3600.0 as hours
            FROM playback_history
        `).get();
        const watchHours = Math.round(hoursRow?.hours || 0);

        return { movies: counts.movies, shows: counts.shows, artists: counts.artists, albums, episodes, watchHours };
    } catch (err) {
        console.error('[discovery-engine] getLibraryStats error:', err?.message || err);
        return { movies: 0, shows: 0, artists: 0, albums: 0, episodes: 0, watchHours: 0 };
    }
}

// ── Library sizes cache ─────────────────────────────────────────────────────
let _sizesCache = null;
let _sizesCacheAt = 0;
const SIZES_CACHE_TTL = 60 * 60 * 1000; // 1 hour

/**
 * Fetch total sizeOnDisk (in GB) from each Arr service.
 * Results are cached in memory for 1 hour to avoid slow API calls on every dashboard load.
 */
export async function getLibrarySizes() {
    // Return cached data if still fresh
    if (_sizesCache && (Date.now() - _sizesCacheAt) < SIZES_CACHE_TTL) {
        return _sizesCache;
    }

    const settings = /** @type {any} */ (db.prepare(
        'SELECT radarr_url, radarr_api_key, radarr_external_url, sonarr_url, sonarr_api_key, sonarr_external_url, lidarr_url, lidarr_api_key, lidarr_external_url FROM app_settings WHERE id = 1'
    ).get());

    async function arrFetchAll(primaryUrl, externalUrl, apiKey, path, apiVersion = 'v3') {
        const candidates = [primaryUrl, externalUrl].filter(Boolean);
        if (candidates.length === 0) return null;
        try {
            return await Promise.any(candidates.map(async (baseUrl) => {
                const url = `${baseUrl.replace(/\/+$/, '')}/api/${apiVersion}/${path}`;
                const res = await fetch(url, {
                    headers: { 'X-Api-Key': apiKey },
                    signal: AbortSignal.timeout(4000),
                });
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                return res.json();
            }));
        } catch { return null; }
    }

    const toGB = (bytes) => Math.round((bytes || 0) / 1073741824);

    const [movies, series, artists] = await Promise.all([
        settings?.radarr_api_key
            ? arrFetchAll(settings.radarr_url, settings.radarr_external_url, settings.radarr_api_key, 'movie')
            : null,
        settings?.sonarr_api_key
            ? arrFetchAll(settings.sonarr_url, settings.sonarr_external_url, settings.sonarr_api_key, 'series')
            : null,
        settings?.lidarr_api_key
            ? arrFetchAll(settings.lidarr_url, settings.lidarr_external_url, settings.lidarr_api_key, 'artist', 'v1')
            : null,
    ]);

    const movieGB = movies ? toGB(movies.reduce((a, m) => a + (m.sizeOnDisk || 0), 0)) : 0;
    const showGB = series ? toGB(series.reduce((a, s) => a + (s.statistics?.sizeOnDisk || 0), 0)) : 0;
    const musicGB = artists ? toGB(artists.reduce((a, ar) => a + (ar.statistics?.sizeOnDisk || 0), 0)) : 0;

    const result = { movieGB, showGB, musicGB };

    // Store in cache
    _sizesCache = result;
    _sizesCacheAt = Date.now();

    return result;
}

/**
 * Force-refresh the library sizes cache (bypasses TTL).
 * Called by the nightly pipeline after syncs complete.
 */
export async function refreshLibrarySizes() {
    _sizesCache = null;
    _sizesCacheAt = 0;
    return getLibrarySizes();
}

/**
 * Time-of-day greeting.
 */
export function getGreeting() {
    const hour = new Date().getHours();
    if (hour >= 5 && hour < 12) return 'Good morning';
    if (hour >= 12 && hour < 17) return 'Good afternoon';
    if (hour >= 17 && hour < 21) return 'Good evening';
    return 'Good night';
}

/**
 * Smart recommendations — TMDB-powered.
 * Finds recently watched/highly rated movies with TMDB IDs, fetches TMDB's
 * recommendations for each, then matches against unwatched titles in the local library.
 * Each result includes "Because you watched X" context.
 * @param {number} userId
 * @param {number} limit
 */
export async function getSmartRecommendations(userId, limit = 20) {
    try {
        // Step 1: Get user's recently watched movies with TMDB IDs
        const seedMovies = /** @type {any[]} */ (db.prepare(`
            SELECT DISTINCT mp.id, mp.title, mp.tmdb_id, mp.poster_url,
                   MAX(ph.timestamp) as last_watched
            FROM playback_history ph
            JOIN media_children mc ON ph.media_id = mc.id
            JOIN media_parents mp ON mc.parent_id = mp.id
            WHERE mp.media_type = 'movie' AND ph.user_id = ?
              AND mp.tmdb_id IS NOT NULL AND mp.tmdb_id != ''
            GROUP BY mp.id
            ORDER BY last_watched DESC
            LIMIT 10
        `).all(userId));

        if (seedMovies.length === 0) return [];

        // Step 2: Get all unwatched movie TMDB IDs in library for fast lookup
        const unwatchedInLibrary = new Map();
        /** @type {any[]} */ (db.prepare(`
            SELECT mp.id, mp.title, mp.tmdb_id, mp.poster_url, mp.slug, mp.release_year
            FROM media_parents mp
            JOIN media_children mc ON mc.parent_id = mp.id
            WHERE mp.media_type = 'movie'
              AND mp.tmdb_id IS NOT NULL AND mp.tmdb_id != ''
              AND mc.watch_status != 'watched'
              AND mp.poster_url IS NOT NULL
              AND mp.collection_status != 'wanted'
              AND NOT EXISTS (
                  SELECT 1 FROM playback_history ph WHERE ph.media_id = mc.id AND ph.user_id = ?
              )
        `).all(userId)).forEach(m => {
            unwatchedInLibrary.set(String(m.tmdb_id), m);
        });

        if (unwatchedInLibrary.size === 0) return [];

        // Step 3: Fetch TMDB recommendations for each seed (in parallel, max 5)
        const dailyOffset = dailySeed() % seedMovies.length;
        const seeds = [...seedMovies.slice(dailyOffset), ...seedMovies.slice(0, dailyOffset)].slice(0, 5);

        /** @type {Map<string, { movie: any, reasons: string[] }>} */
        const candidates = new Map();

        const fetches = seeds.map(async (seed) => {
            try {
                const res = await tmdbFetch(`/movie/${seed.tmdb_id}/recommendations`);
                if (!res.ok) return;
                const data = await res.json();
                for (const rec of (data.results || [])) {
                    const tmdbId = String(rec.id);
                    const local = unwatchedInLibrary.get(tmdbId);
                    if (!local) continue; // Not in library or already watched

                    if (candidates.has(tmdbId)) {
                        candidates.get(tmdbId).reasons.push(seed.title);
                    } else {
                        candidates.set(tmdbId, {
                            movie: local,
                            reasons: [seed.title],
                        });
                    }
                }
            } catch {
                // Silently skip failed TMDB calls
            }
        });

        await Promise.all(fetches);

        if (candidates.size === 0) return [];

        // Step 4: Sort by number of seed matches (more seeds = stronger recommendation)
        const sorted = [...candidates.values()]
            .sort((a, b) => b.reasons.length - a.reasons.length)
            .slice(0, limit);

        return sorted.map(({ movie, reasons }) => ({
            id: movie.id,
            title: movie.title,
            poster_url: movie.poster_url,
            release_year: movie.release_year,
            slug: movie.slug,
            reason: reasons.length > 1
                ? `Because you watched ${reasons.slice(0, 2).join(' & ')}${reasons.length > 2 ? ` +${reasons.length - 2} more` : ''}`
                : `Because you watched ${reasons[0]}`,
            match_strength: reasons.length,
        }));
    } catch (err) {
        console.error('[discovery-engine] getSmartRecommendations error:', err?.message || err);
        return [];
    }
}
