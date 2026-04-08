/**
 * Six Degrees of Separation — Graph Traversal Engine
 * 
 * Finds the shortest path between two people through shared media credits.
 * Uses BFS on the bipartite person ↔ media graph stored in person_credits.
 */
import db from '$lib/server/db.js';

/** Fisher-Yates shuffle (in-place) @param {any[]} arr @returns {any[]} */
function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

// ── Prepared statements ────────────────────────────────────────────────────────

/** Get all media IDs a person appears in */
const getMediaForPerson = db.prepare(`
    SELECT DISTINCT pc.media_parent_id
    FROM person_credits pc
    WHERE pc.person_id = ?
`);

/** Get all person IDs that appear in a given media item */
const getPersonsForMedia = db.prepare(`
    SELECT DISTINCT pc.person_id
    FROM person_credits pc
    WHERE pc.media_parent_id = ?
`);

/** Fetch person details for path display */
const getPersonDetails = db.prepare(`
    SELECT id, name, photo_url, slug
    FROM persons WHERE id = ?
`);

/** Fetch media details for path display */
const getMediaDetails = db.prepare(`
    SELECT id, title, poster_url, media_type, release_year, slug
    FROM media_parents WHERE id = ?
`);

/** Get the role connecting a person to a media item */
const getCreditRole = db.prepare(`
    SELECT role_type, character_name
    FROM person_credits
    WHERE person_id = ? AND media_parent_id = ?
    ORDER BY sort_order ASC
    LIMIT 1
`);

// ── BFS ────────────────────────────────────────────────────────────────────────

const MAX_DEGREES = 6;

/** Get all parent media IDs that have at least one play in history */
const getWatchedParentIds = db.prepare(`
    SELECT DISTINCT mc.parent_id
    FROM media_children mc
    JOIN playback_history ph ON ph.media_id = mc.id
`);

/**
 * Build a Set of watched parent media IDs.
 * @returns {Set<number>}
 */
export function getWatchedMediaIds() {
    return new Set(
        /** @type {{ parent_id: number }[]} */ (getWatchedParentIds.all())
            .map(r => r.parent_id)
    );
}

/**
 * @typedef {{ personId: number, mediaId: number }} Edge
 * @typedef {{ degrees: number, path: Array<{ person: any, media: any, role: any }> }} PathResult
 */

/**
 * Find the shortest path between two people via shared media credits.
 * Randomizes exploration order so each search discovers a different valid path.
 * 
 * @param {number} fromPersonId 
 * @param {number} toPersonId 
 * @param {Set<number>} [excludeMedia] - media IDs to skip (for alternate routes)
 * @param {Set<number>} [watchedMedia] - if set, only traverse these media IDs
 * @returns {PathResult}
 */
export function findShortestPath(fromPersonId, toPersonId, excludeMedia, watchedMedia) {
    // Same person = degree 0
    if (fromPersonId === toPersonId) {
        const person = getPersonDetails.get(fromPersonId);
        return {
            degrees: 0,
            path: [{ person, media: null, role: null }]
        };
    }

    /** @type {Map<number, { parentPersonId: number, mediaId: number }>} */
    const visited = new Map();
    visited.set(fromPersonId, { parentPersonId: -1, mediaId: -1 });

    /** @type {number[]} */
    let frontier = [fromPersonId];

    for (let degree = 1; degree <= MAX_DEGREES; degree++) {
        /** @type {number[]} */
        const nextFrontier = [];

        // Shuffle frontier for randomized exploration
        shuffle(frontier);

        for (const personId of frontier) {
            // Get all media this person appears in — shuffled
            const mediaIds = shuffle(/** @type {{ media_parent_id: number }[]} */ (
                getMediaForPerson.all(personId)
            ).map(r => r.media_parent_id));

            for (const mediaId of mediaIds) {
                // Skip excluded media
                if (excludeMedia && excludeMedia.has(mediaId)) continue;
                // Skip non-watched media if filter is active
                if (watchedMedia && !watchedMedia.has(mediaId)) continue;

                const coStarIds = shuffle(/** @type {{ person_id: number }[]} */ (
                    getPersonsForMedia.all(mediaId)
                ).map(r => r.person_id));

                for (const coStarId of coStarIds) {
                    if (visited.has(coStarId)) continue;

                    visited.set(coStarId, { parentPersonId: personId, mediaId });

                    if (coStarId === toPersonId) {
                        return reconstructPath(fromPersonId, toPersonId, visited);
                    }

                    nextFrontier.push(coStarId);
                }
            }
        }

        if (nextFrontier.length === 0) break;
        frontier = nextFrontier;
    }

    return { degrees: -1, path: [] };
}

/**
 * Find multiple unique paths between two people.
 * Each subsequent path excludes media used in all previous paths.
 * 
 * @param {number} fromPersonId 
 * @param {number} toPersonId 
 * @param {number} count - how many paths to find
 * @param {Set<number>} [initialExcludes] - media IDs to always skip
 * @param {Set<number>} [watchedMedia] - if set, only traverse these media IDs
 * @returns {PathResult[]}
 */
export function findMultiplePaths(fromPersonId, toPersonId, count = 3, initialExcludes, watchedMedia) {
    /** @type {PathResult[]} */
    const paths = [];
    /** @type {Set<number>} */
    const usedMedia = new Set(initialExcludes || []);

    for (let i = 0; i < count; i++) {
        const result = findShortestPath(fromPersonId, toPersonId, usedMedia.size > 0 ? usedMedia : undefined, watchedMedia);
        if (result.degrees < 0) break; // No more paths

        paths.push(result);

        // Collect media IDs from this path to exclude next time
        for (const node of result.path) {
            if (node.media) {
                usedMedia.add(node.media.id);
            }
        }
    }

    return paths;
}

/**
 * Reconstruct the path from BFS parent chain.
 * Now includes person names in the role objects for clearer attribution.
 * @param {number} fromId 
 * @param {number} toId 
 * @param {Map<number, { parentPersonId: number, mediaId: number }>} visited 
 * @returns {PathResult}
 */
function reconstructPath(fromId, toId, visited) {
    /** @type {Array<{ personId: number, mediaId: number }>} */
    const chain = [];
    let current = toId;

    while (current !== fromId) {
        const edge = visited.get(current);
        if (!edge) break;
        chain.unshift({ personId: current, mediaId: edge.mediaId });
        current = edge.parentPersonId;
    }

    /** @type {Array<{ person: any, media: any, role: any }>} */
    const path = [];

    // Start person
    const startPerson = getPersonDetails.get(fromId);
    path.push({
        person: startPerson,
        media: null,
        role: null
    });

    for (const { personId, mediaId } of chain) {
        const media = getMediaDetails.get(mediaId);
        const prevPerson = path[path.length - 1].person;
        const prevRole = getCreditRole.get(prevPerson.id, mediaId);
        const nextPerson = getPersonDetails.get(personId);
        const currentRole = getCreditRole.get(personId, mediaId);

        path.push({
            person: null,
            media,
            role: {
                from: prevRole ? { ...prevRole, person_name: prevPerson.name } : null,
                to: currentRole ? { ...currentRole, person_name: nextPerson.name } : null
            }
        });

        path.push({
            person: nextPerson,
            media: null,
            role: null
        });
    }

    return {
        degrees: chain.length,
        path
    };
}

/**
 * Search for people by name (for the autocomplete).
 * @param {string} query 
 * @param {number} limit 
 * @returns {Array<{ id: number, name: string, photo_url: string|null, slug: string|null, credit_count: number }>}
 */
export function searchPeople(query, limit = 10) {
    return /** @type {any[]} */ (db.prepare(`
        SELECT p.id, p.name, p.photo_url, p.slug,
               COUNT(pc.id) as credit_count
        FROM persons p
        LEFT JOIN person_credits pc ON pc.person_id = p.id
        WHERE p.name LIKE ?
        GROUP BY p.id
        HAVING credit_count > 0
        ORDER BY credit_count DESC
        LIMIT ?
    `).all(`%${query}%`, limit));
}
