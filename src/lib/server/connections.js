/**
 * Six Degrees of Separation — Graph Traversal Engine
 * 
 * Finds the shortest path between two people through shared media credits.
 * Uses BFS on the bipartite person ↔ media graph stored in person_credits.
 */
import db from '$lib/server/db.js';

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

/**
 * @typedef {{ personId: number, mediaId: number }} Edge
 * @typedef {{ degrees: number, path: Array<{ person: any, media: any, role: any }> }} PathResult
 */

/**
 * Find the shortest path between two people via shared media credits.
 * 
 * @param {number} fromPersonId 
 * @param {number} toPersonId 
 * @returns {PathResult}
 */
export function findShortestPath(fromPersonId, toPersonId) {
    // Same person = degree 0
    if (fromPersonId === toPersonId) {
        const person = getPersonDetails.get(fromPersonId);
        return {
            degrees: 0,
            path: [{ person, media: null, role: null }]
        };
    }

    // BFS: each "level" = one degree (person → media → person)
    // Track: which person was visited, and how we got there (parent person + connecting media)
    /** @type {Map<number, { parentPersonId: number, mediaId: number }>} */
    const visited = new Map(); // personId → { parentPersonId, mediaId }
    visited.set(fromPersonId, { parentPersonId: -1, mediaId: -1 });

    /** @type {number[]} */
    let frontier = [fromPersonId];

    for (let degree = 1; degree <= MAX_DEGREES; degree++) {
        /** @type {number[]} */
        const nextFrontier = [];

        for (const personId of frontier) {
            // Get all media this person appears in
            const mediaIds = /** @type {{ media_parent_id: number }[]} */ (
                getMediaForPerson.all(personId)
            ).map(r => r.media_parent_id);

            for (const mediaId of mediaIds) {
                // Get all other people in this media
                const coStarIds = /** @type {{ person_id: number }[]} */ (
                    getPersonsForMedia.all(mediaId)
                ).map(r => r.person_id);

                for (const coStarId of coStarIds) {
                    if (visited.has(coStarId)) continue;

                    visited.set(coStarId, { parentPersonId: personId, mediaId });

                    if (coStarId === toPersonId) {
                        // Found! Reconstruct the path
                        return reconstructPath(fromPersonId, toPersonId, visited);
                    }

                    nextFrontier.push(coStarId);
                }
            }
        }

        if (nextFrontier.length === 0) break; // No more nodes to explore
        frontier = nextFrontier;
    }

    // No connection found within MAX_DEGREES
    return { degrees: -1, path: [] };
}

/**
 * Reconstruct the path from BFS parent chain.
 * @param {number} fromId 
 * @param {number} toId 
 * @param {Map<number, { parentPersonId: number, mediaId: number }>} visited 
 * @returns {PathResult}
 */
function reconstructPath(fromId, toId, visited) {
    // Walk backwards from destination to source
    /** @type {Array<{ personId: number, mediaId: number }>} */
    const chain = [];
    let current = toId;

    while (current !== fromId) {
        const edge = visited.get(current);
        if (!edge) break;
        chain.unshift({ personId: current, mediaId: edge.mediaId });
        current = edge.parentPersonId;
    }

    // Build the rich path with details
    /** @type {Array<{ person: any, media: any, role: any }>} */
    const path = [];

    // Start person
    path.push({
        person: getPersonDetails.get(fromId),
        media: null,
        role: null
    });

    for (const { personId, mediaId } of chain) {
        const media = getMediaDetails.get(mediaId);
        // Role of the PREVIOUS person in this media
        const prevPersonId = path[path.length - 1].person.id;
        const prevRole = getCreditRole.get(prevPersonId, mediaId);
        // Role of the current person in this media
        const currentRole = getCreditRole.get(personId, mediaId);

        path.push({
            person: null,
            media,
            role: {
                from: prevRole || null,
                to: currentRole || null
            }
        });

        path.push({
            person: getPersonDetails.get(personId),
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
