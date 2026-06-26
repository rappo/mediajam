/**
 * Generate a URL-safe slug from a title.
 * @param {string} title
 * @param {number|string|null} [year] - Optional year for disambiguation
 * @returns {string}
 */
export function slugify(title, year = null) {
    let slug = title
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // strip diacritics
        .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
        .replace(/[\u201C\u201D\u201E\u201F\u2033\u2036]/g, '"')
        .replace(/[\u2010\u2011\u2012\u2013\u2014\u2015\uFE58\uFE63\uFF0D]/g, '-')
        .replace(/&/g, 'and')
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '') // strip non-alphanumeric
        .replace(/\s+/g, '-')         // spaces to hyphens
        .replace(/-+/g, '-')          // collapse multiple hyphens
        .replace(/^-+|-+$/g, '');     // trim leading/trailing hyphens

    if (!slug) slug = 'untitled';
    if (year) slug += `-${year}`;
    return slug;
}

/**
 * Ensure a slug is unique within a table by appending -2, -3, etc.
 * @param {import('better-sqlite3').Database} db
 * @param {string} table - Table name ('media_parents', 'media_children', 'persons')
 * @param {string} baseSlug
 * @param {number|null} [excludeId] - ID to exclude (for updates)
 * @returns {string}
 */
export function ensureUniqueSlug(db, table, baseSlug, excludeId = null) {
    let slug = baseSlug;
    let suffix = 2;
    // eslint-disable-next-line no-constant-condition
    while (true) {
        const existing = excludeId
            ? db.prepare(`SELECT id FROM ${table} WHERE slug = ? AND id != ?`).get(slug, excludeId)
            : db.prepare(`SELECT id FROM ${table} WHERE slug = ?`).get(slug);
        if (!existing) return slug;
        slug = `${baseSlug}-${suffix++}`;
    }
}

/**
 * Resolve a slug parameter to a media_parents row ID.
 * 1. Exact slug match
 * 2. Fuzzy match: extract potential year from slug tail, search by title+year
 * 3. Generate & persist slug for the matched row so future lookups are exact
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} paramSlug
 * @param {string} mediaType — 'movie' | 'show' | 'artist'
 * @param {string} routePrefix — '/movies' | '/tv' | '/music'
 * @returns {{ id: number, redirect?: string } | null}
 */
export function resolveSlug(db, paramSlug, mediaType, routePrefix) {
    // 1. Exact slug match
    const exact = /** @type {any} */ (
        db.prepare('SELECT id FROM media_parents WHERE slug = ? AND media_type = ?').get(paramSlug, mediaType)
    );
    if (exact) return { id: exact.id };

    // 2. Fuzzy: try to extract year from slug and match by title
    //    Slug format: "some-title-2024" → title words = "some title", year = 2024
    const yearMatch = paramSlug.match(/-(\d{4})$/);
    const year = yearMatch ? parseInt(yearMatch[1]) : null;
    const titlePart = yearMatch ? paramSlug.slice(0, -5) : paramSlug; // strip "-YYYY"
    const titleWords = titlePart.replace(/-/g, ' ').trim();

    if (titleWords) {
        // Try title+year match
        let fuzzy;
        if (year) {
            fuzzy = /** @type {any} */ (db.prepare(
                `SELECT id, title, release_year, slug FROM media_parents
                 WHERE media_type = ? AND release_year = ?
                 AND LOWER(REPLACE(title, '''', '')) LIKE ?
                 LIMIT 1`
            ).get(mediaType, year, `%${titleWords.split(' ')[0]}%`));
        }
        // Fallback: just title match without year
        if (!fuzzy) {
            fuzzy = /** @type {any} */ (db.prepare(
                `SELECT id, title, release_year, slug FROM media_parents
                 WHERE media_type = ?
                 AND LOWER(REPLACE(title, '''', '')) LIKE ?
                 ${year ? 'AND release_year = ?' : ''}
                 LIMIT 1`
            ).get(...(year
                ? [mediaType, `%${titleWords.split(' ')[0]}%`, year]
                : [mediaType, `%${titleWords.split(' ')[0]}%`]
            )));
        }

        if (fuzzy) {
            // If the matched row has a slug, redirect to the canonical URL
            if (fuzzy.slug && fuzzy.slug !== paramSlug) {
                return { id: fuzzy.id, redirect: `${routePrefix}/${fuzzy.slug}` };
            }
            // Generate and persist slug if missing
            if (!fuzzy.slug) {
                const base = slugify(fuzzy.title || 'untitled', fuzzy.release_year);
                const newSlug = ensureUniqueSlug(db, 'media_parents', base, fuzzy.id);
                db.prepare('UPDATE media_parents SET slug = ? WHERE id = ?').run(newSlug, fuzzy.id);
                return { id: fuzzy.id, redirect: `${routePrefix}/${newSlug}` };
            }
            return { id: fuzzy.id };
        }
    }

    return null;
}

/**
 * Generate a stable episode slug: s01e05 or s01e05-episode-title.
 * The s##e## prefix is the canonical identifier; the title suffix is cosmetic.
 * @param {number} seasonNumber
 * @param {number} itemNumber
 * @param {string} [title] - Optional episode title to append
 * @returns {string}
 */
export function episodeSlug(seasonNumber, itemNumber, title = '') {
    const prefix = `s${String(seasonNumber).padStart(2, '0')}e${String(itemNumber).padStart(2, '0')}`;
    if (!title || title.toLowerCase() === 'tba' || title.toLowerCase() === 'episode' || !title.trim()) {
        return prefix;
    }
    const titlePart = slugify(title);
    if (!titlePart || titlePart === 'untitled') return prefix;
    return `${prefix}-${titlePart}`;
}

