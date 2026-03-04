import db from '$lib/server/db.js';
import { error } from '@sveltejs/kit';

/** @type {import('./$types').PageServerLoad} */
export function load({ params, locals }) {
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

    // For TV shows, attach the actual episode count from media_children
    const episodeCountStmt = db.prepare('SELECT COUNT(*) as cnt FROM media_children WHERE parent_id = ? AND season_number > 0');
    for (const c of credits) {
        if (c.media_type === 'show') {
            c.total_episodes = /** @type {any} */ (episodeCountStmt.get(c.media_id))?.cnt || 0;
        }
    }
    const movies = credits.filter(c => c.media_type === 'movie');
    const shows = credits.filter(c => c.media_type === 'show');
    const artists = credits.filter(c => c.media_type === 'artist');

    // Stats
    const totalCredits = credits.length;
    const watchedMovies = movies.filter(m => m.watch_status === 'watched').length;
    const watchedShows = shows.filter(s => s.watch_status === 'watched' || s.play_count > 0).length;

    return {
        person: { ...person, photoUrl },
        movies,
        shows,
        artists,
        stats: {
            totalCredits,
            movieCount: movies.length,
            showCount: shows.length,
            artistCount: artists.length,
            watchedMovies,
            watchedShows
        },
        jellyfinUrl
    };
}
