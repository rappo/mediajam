import db from '$lib/server/db.js';
import { error } from '@sveltejs/kit';
import { checkJellyfinFavorite } from '$lib/server/jellyfin-favorites.js';

/** @type {import('./$types').PageServerLoad} */
export async function load({ params, locals }) {
    const personId = parseInt(params.id);
    const userId = locals.user?.id || 0;
    const settings = /** @type {any} */ (db.prepare('SELECT jellyfin_url FROM app_settings WHERE id = 1').get());
    const jellyfinUrl = settings?.jellyfin_url || '';

    const person = /** @type {any} */ (db.prepare(`
        SELECT * FROM persons WHERE id = ?
    `).get(personId));

    if (!person) throw error(404, 'Person not found');

    // Photo URL
    const photoUrl = person.photo_url || null;

    // All credits grouped by media type
    const rawCredits = /** @type {any[]} */ (db.prepare(`
        SELECT
            pc.role_type,
            pc.character_name,
            pc.sort_order,
            mp.id as media_id,
            mp.title,
            mp.media_type,
            mp.release_year,
            mp.poster_url,
            mp.jellyfin_id,
            mp.tmdb_id,
            mp.imdb_id,
            mp.collection_status,
            mp.arr_has_file,
            mp.arr_status,
            mp.unplayed_count,
            mp.jellyfin_child_count,
            mc.watch_status,
            mc.play_count
        FROM person_credits pc
        JOIN media_parents mp ON pc.media_parent_id = mp.id
        LEFT JOIN media_children mc ON mc.parent_id = mp.id AND mc.item_number = 1
        WHERE pc.person_id = ?
        ORDER BY mp.release_year DESC NULLS LAST, mp.title ASC, pc.sort_order ASC
    `).all(personId));

    // Group credits by media_id — combine multiple roles on the same title into one entry
    // Deduplicates identical role+character pairs
    /** @type {Map<number, any>} */
    const grouped = new Map();
    for (const c of rawCredits) {
        if (!grouped.has(c.media_id)) {
            grouped.set(c.media_id, {
                ...c,
                roles: [{ role_type: c.role_type, character_name: c.character_name }],
                _roleKeys: new Set([`${c.role_type}::${c.character_name || ''}`])
            });
        } else {
            const entry = grouped.get(c.media_id);
            const key = `${c.role_type}::${c.character_name || ''}`;
            if (!entry._roleKeys.has(key)) {
                entry.roles.push({ role_type: c.role_type, character_name: c.character_name });
                entry._roleKeys.add(key);
            }
        }
    }
    for (const entry of grouped.values()) delete entry._roleKeys;
    const credits = [...grouped.values()];

    // For TV shows, compute real episode stats from media_children
    // (unplayed_count from Jellyfin is unreliable — it only counts files on disk)
    const episodeStatsStmt = db.prepare(`
        SELECT
            COUNT(*) as total_count,
            SUM(CASE WHEN is_collected = 1 THEN 1 ELSE 0 END) as collected_count,
            SUM(CASE WHEN watch_status = 'watched' THEN 1 ELSE 0 END) as watched_count,
            SUM(CASE WHEN watch_status = 'in_progress' THEN 1 ELSE 0 END) as progress_count,
            SUM(CASE WHEN is_collected = 0 AND (premiere_date IS NULL OR premiere_date < date('now')) THEN 1 ELSE 0 END) as missing_count,
            SUM(CASE WHEN premiere_date > date('now') THEN 1 ELSE 0 END) as upcoming_count
        FROM media_children WHERE parent_id = ? AND season_number > 0
    `);
    for (const c of credits) {
        if (c.media_type === 'show') {
            const stats = /** @type {any} */ (episodeStatsStmt.get(c.media_id));
            c.total_episodes = stats?.total_count || 0;
            c.collected_count = stats?.collected_count || 0;
            c.watched_count = stats?.watched_count || 0;
            c.progress_count = stats?.progress_count || 0;
            c.missing_count = stats?.missing_count || 0;
            c.upcoming_count = stats?.upcoming_count || 0;
        }
    }
    const movies = credits.filter(c => c.media_type === 'movie');
    const shows = credits.filter(c => c.media_type === 'show');
    const artists = credits.filter(c => c.media_type === 'artist');

    // Stats
    const totalCredits = credits.length;
    const watchedMovies = movies.filter(m => m.watch_status === 'watched' || m.play_count > 0).length;
    const watchedShows = shows.filter(s => s.total_episodes > 0 && s.watched_count === s.total_episodes).length;

    // External links from external_ids table (MusicBrainz relations, scraped links, etc.)
    const externalIds = /** @type {any[]} */ (db.prepare(`
        SELECT source, external_id FROM external_ids WHERE person_id = ? ORDER BY source
    `).all(personId));

    // Live Jellyfin favorite check
    const liveFavorite = await checkJellyfinFavorite(person.jellyfin_id, 'persons', person.id);

    // Tiered bio: Wikipedia → TMDB → Jellyfin → legacy
    const displayBio = person.wikipedia_summary || person.bio_tmdb || person.bio_jellyfin || person.bio || null;
    const bioSource = person.wikipedia_summary ? 'wikipedia'
        : person.bio_tmdb ? 'tmdb'
        : person.bio_jellyfin ? 'jellyfin'
        : person.bio ? 'legacy'
        : null;
    // If we have a TMDB ID but no bio from any source, UI should lazy-fetch
    const needsBioFetch = !displayBio && !!person.tmdb_person_id;
    // Broader: auto-enrich if any key data is missing
    const needsEnrichment = !displayBio || !person.birth_date || !person.tmdb_person_id;

    // Backdrop: pick the best credit with a jellyfin_id (prefer watched, then newest)
    const backdropCredit = [...movies, ...shows]
        .filter(c => c.jellyfin_id)
        .sort((a, b) => {
            // Prefer watched items
            const aWatched = (a.watch_status === 'watched' || a.play_count > 0) ? 1 : 0;
            const bWatched = (b.watch_status === 'watched' || b.play_count > 0) ? 1 : 0;
            if (bWatched !== aWatched) return bWatched - aWatched;
            // Then by release year (newest first)
            return (b.release_year || 0) - (a.release_year || 0);
        })[0];
    const backdropUrl = backdropCredit
        ? `${jellyfinUrl}/Items/${backdropCredit.jellyfin_id}/Images/Backdrop?maxWidth=1200`
        : null;

    return {
        person: { ...person, photoUrl, is_favorite: liveFavorite ?? person.is_favorite, displayBio, bioSource, needsBioFetch, needsEnrichment },
        movies,
        shows,
        artists,
        externalIds,
        stats: {
            totalCredits,
            movieCount: movies.length,
            showCount: shows.length,
            artistCount: artists.length,
            watchedMovies,
            watchedShows
        },
        jellyfinUrl,
        backdropUrl
    };
}
