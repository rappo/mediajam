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
