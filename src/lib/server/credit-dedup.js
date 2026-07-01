/**
 * Cast/crew deduplication for detail pages.
 *
 * The same actor may exist as separate person rows (Jellyfin vs TMDB syncs),
 * so rows must be merged by name, not person id.
 */

/**
 * Merge cast rows by lowercase name, keeping the best data from each duplicate.
 * @param {any[]} castRaw - rows with name, photo_url, tmdb_person_id, character_name, sort_order
 * @returns {any[]} deduped cast, sorted by billing (sort_order)
 */
export function dedupCast(castRaw) {
    const castMap = new Map();
    for (const c of castRaw) {
        const key = c.name.toLowerCase();
        const existing = castMap.get(key);
        if (existing) {
            // Keep the better character name (non-empty)
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
    return [...castMap.values()].sort((a, b) => a.sort_order - b.sort_order);
}

/**
 * Merge crew rows by lowercase name, combining multiple roles into one entry
 * (e.g. "Director, Writer").
 * @param {any[]} crewRaw - rows with name, photo_url, tmdb_person_id, role_type
 * @returns {any[]} deduped crew
 */
export function dedupCrew(crewRaw) {
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
    return [...crewMap.values()];
}
