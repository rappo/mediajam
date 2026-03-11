import { json } from '@sveltejs/kit';
import db from '$lib/server/db.js';
import { embed, isEmbeddingAvailable } from '$lib/server/llm.js';

/**
 * GET /api/search?q=... — Global search across media and history.
 * Returns categorized results: shows, movies, music, history.
 * @type {import('./$types').RequestHandler}
 */
export async function GET({ url, locals }) {
    const query = url.searchParams.get('q')?.trim();
    if (!query || query.length < 2) {
        return json({ results: [], query: '' });
    }

    const userId = locals.user?.id;
    const like = `%${query}%`;
    console.log(`[search] query="${query}" like="${like}" userId=${userId}`);

    // Search shows
    const shows = /** @type {any[]} */ (db.prepare(`
        SELECT mp.id, mp.title, mp.poster_url, mp.release_year,
               mp.collected_children as episode_count, 'show' as type
        FROM media_parents mp
        WHERE mp.media_type = 'show' AND mp.title LIKE ?
        ORDER BY mp.title
        LIMIT 5
    `).all(like));

    // Search movies
    const movies = /** @type {any[]} */ (db.prepare(`
        SELECT mp.id, mp.title, mp.poster_url, mp.release_year, 'movie' as type
        FROM media_parents mp
        WHERE mp.media_type = 'movie' AND mp.title LIKE ?
        ORDER BY mp.title
        LIMIT 5
    `).all(like));

    // Search music (artists)
    const music = /** @type {any[]} */ (db.prepare(`
        SELECT mp.id, mp.title, mp.poster_url,
               mp.collected_children as album_count, 'artist' as type
        FROM media_parents mp
        WHERE mp.media_type = 'artist' AND mp.title LIKE ?
        ORDER BY mp.title
        LIMIT 5
    `).all(like));

    // Search people (actors, directors, etc.)
    const people = /** @type {any[]} */ (db.prepare(`
        SELECT p.id, p.name as title, p.photo_url as poster_url,
               (SELECT COUNT(*) FROM person_credits pc WHERE pc.person_id = p.id) as credit_count,
               'person' as type
        FROM persons p
        WHERE p.name LIKE ?
        ORDER BY p.name
        LIMIT 5
    `).all(like));

    // Search episodes/tracks by title
    const children = /** @type {any[]} */ (db.prepare(`
        SELECT mc.id, mc.title as item_title, mc.season_number, mc.item_number,
               mp.title as parent_title, mp.media_type, mp.poster_url, mp.id as parent_id,
               'child' as type
        FROM media_children mc
        JOIN media_parents mp ON mc.parent_id = mp.id
        WHERE mc.title LIKE ? AND mp.media_type != 'artist'
        ORDER BY mp.title, mc.season_number, mc.item_number
        LIMIT 8
    `).all(like));

    // Search albums by name
    const albums = /** @type {any[]} */ (db.prepare(`
        SELECT mc.id, mc.title as item_title,
               mp.title as parent_title, mp.poster_url, mp.id as parent_id,
               'album' as type
        FROM media_children mc
        JOIN media_parents mp ON mc.parent_id = mp.id
        WHERE mp.media_type = 'artist' AND mc.title LIKE ?
        ORDER BY mc.title
        LIMIT 5
    `).all(like));

    // Search user's playback history
    const history = userId ? /** @type {any[]} */ (db.prepare(`
        SELECT ph.id, ph.timestamp, ph.completion_pct,
               mc.title as item_title, mc.season_number, mc.item_number,
               mp.title as parent_title, mp.media_type, mp.poster_url, mp.id as parent_id,
               'history' as type
        FROM playback_history ph
        JOIN media_children mc ON ph.media_id = mc.id
        JOIN media_parents mp ON mc.parent_id = mp.id
        WHERE ph.user_id = ? AND (mc.title LIKE ? OR mp.title LIKE ?)
        ORDER BY ph.timestamp DESC
        LIMIT 5
    `).all(userId, like, like)) : [];

    // Semantic search (when embeddings available)
    let semantic = [];
    if (isEmbeddingAvailable() && query.length >= 3) {
        try {
            const queryEmbedding = await embed(query);
            if (queryEmbedding) {
                semantic = /** @type {any[]} */ (db.prepare(`
                    SELECT mp.id, mp.title, mp.poster_url, mp.release_year, mp.media_type as type,
                           vec_distance_cosine(oe.overview_embedding, ?) as distance
                    FROM overview_embeddings oe
                    JOIN media_parents mp ON oe.media_parent_id = mp.id
                    WHERE distance < 0.5
                    ORDER BY distance
                    LIMIT 8
                `).all(JSON.stringify(queryEmbedding)));
                // Remove items already in keyword results
                const keywordIds = new Set([
                    ...shows.map((/** @type {any} */ s) => s.id),
                    ...movies.map((/** @type {any} */ m) => m.id),
                    ...music.map((/** @type {any} */ m) => m.id),
                ]);
                semantic = semantic.filter((/** @type {any} */ s) => !keywordIds.has(s.id));
            }
        } catch {
            // Embedding search failed — that's fine, return keyword results only
        }
    }

    const totalCount = shows.length + movies.length + music.length + albums.length + people.length + children.length + history.length + semantic.length;
    console.log(`[search] results: shows=${shows.length} movies=${movies.length} music=${music.length} albums=${albums.length} people=${people.length} children=${children.length} history=${history.length} semantic=${semantic.length} total=${totalCount}`);

    return json({
        query,
        results: {
            shows,
            movies,
            music,
            albums,
            people,
            children,
            history,
            semantic,
        },
        totalCount
    });
}
