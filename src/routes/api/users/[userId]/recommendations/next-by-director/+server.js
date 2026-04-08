import { json } from '@sveltejs/kit';
import db from '$lib/server/db.js';

const VALID_ROLES = ['director', 'actor', 'writer', 'producer', 'composer', 'any'];

/**
 * GET /api/users/:userId/recommendations/next-by-director
 *
 * Returns unwatched, owned movies by a given person, sorted by Rotten Tomatoes score.
 *
 * Query params:
 *   person   — fuzzy name search (e.g. ?person=kurosawa)
 *   personId — exact person ID
 *   role     — director (default), actor, writer, producer, composer, any
 *   limit    — max results (default 5, max 25)
 *
 * If neither person nor personId is given, auto-detects from last watched movie's director.
 *
 * @type {import('./$types').RequestHandler}
 */
export async function GET({ params, url, locals }) {
    const userId = parseInt(params.userId);
    const requestingUser = locals.user;

    // Auth: must be the user themselves or an admin
    if (!requestingUser || (requestingUser.id !== userId && !requestingUser.isAdmin)) {
        return json({ error: 'Unauthorized' }, { status: 401 });
    }

    const personParam = url.searchParams.get('person')?.trim() || '';
    const personIdParam = url.searchParams.get('personId')?.trim() || '';
    const role = url.searchParams.get('role')?.trim().toLowerCase() || 'director';
    const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '5'), 1), 25);

    if (!VALID_ROLES.includes(role)) {
        return json({ error: `Invalid role. Must be one of: ${VALID_ROLES.join(', ')}` }, { status: 400 });
    }

    const settings = /** @type {any} */ (db.prepare('SELECT jellyfin_url FROM app_settings WHERE id = 1').get());
    const jellyfinUrl = settings?.jellyfin_url || '';

    // ── Resolve Person ──────────────────────────────────────────────────────

    /** @type {{ id: number, name: string, resolvedRole: string } | null} */
    let person = null;

    /** @type {{ title: string, release_year: number|null, watchedAt: string|null } | null} */
    let lastWatched = null;

    if (personIdParam) {
        // Exact ID lookup
        const row = /** @type {any} */ (db.prepare('SELECT id, name FROM persons WHERE id = ?').get(parseInt(personIdParam)));
        if (row) {
            person = { id: row.id, name: row.name, resolvedRole: role };
        }
    } else if (personParam) {
        // Fuzzy name search — find person with credits matching the requested role
        const roleFilter = role === 'any' ? '' : "AND pc.role_type = ?";
        const queryParams = role === 'any'
            ? [`%${personParam}%`]
            : [`%${personParam}%`, role];

        const row = /** @type {any} */ (db.prepare(`
            SELECT DISTINCT p.id, p.name, pc.role_type
            FROM persons p
            JOIN person_credits pc ON pc.person_id = p.id
            WHERE p.name LIKE ? ${roleFilter}
            ORDER BY p.name ASC
            LIMIT 1
        `).get(...queryParams));

        if (row) {
            person = { id: row.id, name: row.name, resolvedRole: row.role_type };
        }
    } else {
        // Auto-detect: find the director of the last watched movie
        const roleForAutoDetect = role === 'any' ? 'director' : role;
        const lastRow = /** @type {any} */ (db.prepare(`
            SELECT p.id as person_id, p.name as person_name,
                   mp.title, mp.release_year,
                   ph.timestamp,
                   pc.role_type
            FROM playback_history ph
            JOIN media_children mc ON ph.media_id = mc.id
            JOIN media_parents mp ON mc.parent_id = mp.id
            JOIN person_credits pc ON pc.media_parent_id = mp.id AND pc.role_type = ?
            JOIN persons p ON pc.person_id = p.id
            WHERE ph.user_id = ? AND mp.media_type = 'movie'
            ORDER BY ph.timestamp DESC
            LIMIT 1
        `).get(roleForAutoDetect, userId));

        if (lastRow) {
            person = { id: lastRow.person_id, name: lastRow.person_name, resolvedRole: lastRow.role_type };
            lastWatched = {
                title: lastRow.title,
                release_year: lastRow.release_year,
                watchedAt: lastRow.timestamp,
            };
        }
    }

    if (!person) {
        return json({
            error: personParam
                ? `No person found matching "${personParam}" with role "${role}"`
                : personIdParam
                    ? `Person with ID ${personIdParam} not found`
                    : `No watched movies with a credited ${role} found`,
            person: null,
            lastWatched: null,
            results: [],
            totalUnwatched: 0,
        });
    }

    // ── Fetch lastWatched if we resolved by name/ID (not auto-detect) ────

    if (!lastWatched) {
        const lw = /** @type {any} */ (db.prepare(`
            SELECT mp.title, mp.release_year, MAX(ph.timestamp) as watchedAt
            FROM playback_history ph
            JOIN media_children mc ON ph.media_id = mc.id
            JOIN media_parents mp ON mc.parent_id = mp.id
            JOIN person_credits pc ON pc.media_parent_id = mp.id
            WHERE ph.user_id = ? AND pc.person_id = ? AND mp.media_type = 'movie'
            ORDER BY ph.timestamp DESC
            LIMIT 1
        `).get(userId, person.id));

        if (lw?.title) {
            lastWatched = {
                title: lw.title,
                release_year: lw.release_year,
                watchedAt: lw.watchedAt,
            };
        }
    }

    // ── Build role filter for recommendations ───────────────────────────────

    const roleCondition = role === 'any' ? '' : 'AND pc.role_type = ?';
    const roleParams = role === 'any' ? [] : [role];

    // ── Query: unwatched, owned movies by this person ───────────────────────

    const results = /** @type {any[]} */ (db.prepare(`
        SELECT
            mp.id,
            mp.title,
            mp.release_year,
            mp.poster_url,
            mp.slug,
            mp.jellyfin_id,
            mp.collection_status,
            mp.arr_has_file,
            pc.role_type,
            er.value as rt_score,
            er.raw_value as rt_raw
        FROM person_credits pc
        JOIN media_parents mp ON pc.media_parent_id = mp.id
        LEFT JOIN external_ratings er
            ON er.media_parent_id = mp.id AND er.source = 'omdb_rt'
        WHERE pc.person_id = ?
          ${roleCondition}
          AND mp.media_type = 'movie'
          AND (mp.jellyfin_id IS NOT NULL OR mp.arr_has_file = 1)
          AND mp.id NOT IN (
              SELECT DISTINCT mc2.parent_id
              FROM playback_history ph2
              JOIN media_children mc2 ON ph2.media_id = mc2.id
              WHERE ph2.user_id = ?
          )
        ORDER BY er.value DESC NULLS LAST, mp.release_year DESC
        LIMIT ?
    `).all(person.id, ...roleParams, userId, limit));

    // Count total unwatched (without limit)
    const countRow = /** @type {any} */ (db.prepare(`
        SELECT COUNT(DISTINCT mp.id) as count
        FROM person_credits pc
        JOIN media_parents mp ON pc.media_parent_id = mp.id
        WHERE pc.person_id = ?
          ${roleCondition}
          AND mp.media_type = 'movie'
          AND (mp.jellyfin_id IS NOT NULL OR mp.arr_has_file = 1)
          AND mp.id NOT IN (
              SELECT DISTINCT mc2.parent_id
              FROM playback_history ph2
              JOIN media_children mc2 ON ph2.media_id = mc2.id
              WHERE ph2.user_id = ?
          )
    `).get(person.id, ...roleParams, userId));

    // ── Format response ────────────────────────────────────────────────────

    const formatted = results.map((r) => {
        const posterUrl = r.jellyfin_id
            ? `${jellyfinUrl}/Items/${r.jellyfin_id}/Images/Primary?maxHeight=400`
            : r.poster_url;

        return {
            title: r.title,
            release_year: r.release_year,
            rt_score: r.rt_score ?? null,
            rt_raw: r.rt_raw ?? null,
            poster_url: posterUrl,
            slug: r.slug,
            href: `/movies/${r.slug || r.id}`,
            role: r.role_type,
            reason: `Unwatched ${person.name} film in your library`,
        };
    });

    return json({
        person: {
            id: person.id,
            name: person.name,
            role: person.resolvedRole,
        },
        lastWatched,
        results: formatted,
        totalUnwatched: countRow?.count || 0,
    });
}
