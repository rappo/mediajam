import db from '$lib/server/db.js';

/**
 * Normalize album titles for comparison.
 * Strips smart quotes, trims, lowercases, removes trailing " - Single", " - EP", etc.
 * @param {string} title
 * @returns {string}
 */
export function normalizeTitle(title) {
    if (!title) return '';
    return title
        // Smart quotes → ASCII
        .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
        .replace(/[\u201C\u201D\u201E\u201F\u2033\u2036]/g, '"')
        .replace(/[\u2013\u2014]/g, '-')
        .replace(/[\u2026]/g, '...')
        // Normalize whitespace
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase()
        // Remove common suffixes
        .replace(/\s*[-–—]\s*(single|ep|e\.p\.)$/i, '')
        .trim();
}

/**
 * Simple Levenshtein distance between two strings.
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
function levenshtein(a, b) {
    if (a === b) return 0;
    if (a.length === 0) return b.length;
    if (b.length === 0) return a.length;

    // Limit to avoid O(n*m) on very long strings
    if (Math.abs(a.length - b.length) > 10) return 999;

    const matrix = [];
    for (let i = 0; i <= b.length; i++) matrix[i] = [i];
    for (let j = 0; j <= a.length; j++) matrix[0][j] = j;

    for (let i = 1; i <= b.length; i++) {
        for (let j = 1; j <= a.length; j++) {
            const cost = b[i - 1] === a[j - 1] ? 0 : 1;
            matrix[i][j] = Math.min(
                matrix[i - 1][j] + 1,
                matrix[i][j - 1] + 1,
                matrix[i - 1][j - 1] + cost
            );
        }
    }
    return matrix[b.length][a.length];
}

/**
 * Compute match confidence between two album titles.
 * @param {string} unmatchedTitle
 * @param {string} matchedTitle
 * @returns {{ confidence: 'exact'|'high'|'medium'|'low'|'none', distance: number }}
 */
export function computeConfidence(unmatchedTitle, matchedTitle) {
    const normA = normalizeTitle(unmatchedTitle);
    const normB = normalizeTitle(matchedTitle);

    if (normA === normB) return { confidence: 'exact', distance: 0 };

    // Short titles (< 5 chars) must match exactly — fuzzy is too unreliable
    const maxLen = Math.max(normA.length, normB.length);
    if (maxLen < 5) return { confidence: 'none', distance: 999 };

    const dist = levenshtein(normA, normB);
    const ratio = dist / maxLen;

    // Reject if edit distance is more than 40% of the title length
    if (ratio > 0.4) return { confidence: 'none', distance: dist };

    if (dist <= 2) return { confidence: 'high', distance: dist };
    if (dist <= 5 && ratio < 0.15) return { confidence: 'medium', distance: dist };

    // Check containment (one is a substring of the other, but only if substring is meaningful)
    if (normA.length >= 4 && normB.length >= 4 && (normA.includes(normB) || normB.includes(normA))) {
        return { confidence: 'medium', distance: dist };
    }

    return { confidence: 'none', distance: dist };
}

/**
 * Generate match suggestions for unmatched albums.
 * Phase 1: Fast indexed exact matches (normalized title equality)
 * Phase 2: Fuzzy Levenshtein matches for remaining (limited to small candidate sets)
 * @param {{ artistId?: number, limit?: number, offset?: number }} options
 * @returns {{ suggestions: any[], totalSuggestions: number, stats: { totalUnmatched: number, withSuggestions: number, exactMatches: number, uniqueArtists: number } }}
 */
export function generateMatches({ artistId, limit = 50, offset = 0 } = {}) {
    // Get all unmatched albums (no jellyfin_id) under artist parents
    let unmatchedQuery = `
        SELECT mc.id, mc.title, mc.parent_id, mp.title as artist_name
        FROM media_children mc
        JOIN media_parents mp ON mc.parent_id = mp.id
        WHERE mp.media_type = 'artist' AND mc.jellyfin_id IS NULL
        AND COALESCE(mc.is_special, 0) = 0
    `;
    /** @type {any[]} */
    const params = [];
    if (artistId) {
        unmatchedQuery += ' AND mc.parent_id = ?';
        params.push(artistId);
    }
    unmatchedQuery += ' ORDER BY mp.title ASC, mc.title ASC';

    const unmatched = /** @type {any[]} */ (db.prepare(unmatchedQuery).all(...params));

    // Get all matched albums
    let matchedQuery = `
        SELECT mc.id, mc.title, mc.parent_id, mc.jellyfin_id
        FROM media_children mc
        JOIN media_parents mp ON mc.parent_id = mp.id
        WHERE mp.media_type = 'artist' AND mc.jellyfin_id IS NOT NULL
    `;
    if (artistId) {
        matchedQuery += ' AND mc.parent_id = ?';
    }
    const matched = /** @type {any[]} */ (db.prepare(matchedQuery).all(...(artistId ? [artistId] : [])));

    // ── Phase 1: Indexed exact match map ──
    // Key: parentId::normalizedTitle → matched album
    /** @type {Map<string, any>} */
    const matchIndex = new Map();
    /** @type {Map<number, any[]>} */
    const matchedByArtist = new Map();
    for (const m of matched) {
        const normKey = `${m.parent_id}::${normalizeTitle(m.title)}`;
        if (!matchIndex.has(normKey)) matchIndex.set(normKey, m);
        if (!matchedByArtist.has(m.parent_id)) matchedByArtist.set(m.parent_id, []);
        matchedByArtist.get(m.parent_id)?.push(m);
    }

    // Group unmatched by normalized key for dedup
    /** @type {Map<string, any[]>} */
    const unmatchedGroups = new Map();
    for (const u of unmatched) {
        const key = `${u.parent_id}::${normalizeTitle(u.title)}`;
        if (!unmatchedGroups.has(key)) unmatchedGroups.set(key, []);
        unmatchedGroups.get(key)?.push(u);
    }

    /** @type {any[]} */
    const suggestions = [];
    const processed = new Set();
    let exactCount = 0;

    // Phase 1: Exact normalized matches (instant via Map lookup)
    for (const u of unmatched) {
        if (processed.has(u.id)) continue;

        const normKey = `${u.parent_id}::${normalizeTitle(u.title)}`;
        const selfGroup = unmatchedGroups.get(normKey) || [];
        const exactMatch = matchIndex.get(normKey);

        if (exactMatch) {
            for (const sg of selfGroup) processed.add(sg.id);
            suggestions.push({
                unmatchedIds: selfGroup.map(s => s.id),
                unmatchedTitle: u.title,
                unmatchedVariants: [...new Set(selfGroup.map(s => s.title))],
                matchedId: exactMatch.id,
                matchedTitle: exactMatch.title,
                artistName: u.artist_name,
                artistId: u.parent_id,
                confidence: 'exact',
                distance: 0,
                duplicateCount: selfGroup.length
            });
            exactCount++;
        }
    }

    // Phase 2: Fuzzy matches for remaining (only for artists with ≤30 matched albums)
    for (const u of unmatched) {
        if (processed.has(u.id)) continue;

        const normKey = `${u.parent_id}::${normalizeTitle(u.title)}`;
        const selfGroup = unmatchedGroups.get(normKey) || [];
        const candidates = matchedByArtist.get(u.parent_id) || [];

        // Skip fuzzy matching for artists with huge catalogs
        if (candidates.length > 30) {
            for (const sg of selfGroup) processed.add(sg.id);
            continue;
        }

        let bestMatch = null;
        let bestConf = /** @type {{ confidence: string, distance: number }} */ ({ confidence: 'none', distance: 999 });

        for (const c of candidates) {
            const conf = computeConfidence(u.title, c.title);
            if (conf.confidence !== 'none' && conf.confidence !== 'exact' && conf.distance < bestConf.distance) {
                bestMatch = c;
                bestConf = conf;
            }
        }

        for (const sg of selfGroup) processed.add(sg.id);

        if (bestMatch) {
            suggestions.push({
                unmatchedIds: selfGroup.map(s => s.id),
                unmatchedTitle: u.title,
                unmatchedVariants: [...new Set(selfGroup.map(s => s.title))],
                matchedId: bestMatch.id,
                matchedTitle: bestMatch.title,
                artistName: u.artist_name,
                artistId: u.parent_id,
                confidence: bestConf.confidence,
                distance: bestConf.distance,
                duplicateCount: selfGroup.length
            });
        }
    }

    // Sort: exact first, then high, then medium
    /** @type {Record<string, number>} */
    const order = { exact: 0, high: 1, medium: 2 };
    suggestions.sort((a, b) => (order[a.confidence] ?? 99) - (order[b.confidence] ?? 99));

    const uniqueArtists = new Set(unmatched.map(u => u.parent_id));

    return {
        suggestions: suggestions.slice(offset, offset + limit),
        totalSuggestions: suggestions.length,
        stats: {
            totalUnmatched: unmatched.length,
            withSuggestions: suggestions.length,
            exactMatches: exactCount,
            uniqueArtists: uniqueArtists.size
        }
    };
}

/**
 * Merge an unmatched album into a matched one.
 * Migrates playback history, then deletes the unmatched album.
 * @param {number} unmatchedId
 * @param {number} matchedId
 * @returns {{ success: boolean, migratedPlays: number }}
 */
export function mergeAlbum(unmatchedId, matchedId) {
    const unmatched = /** @type {any} */ (db.prepare('SELECT id, title, parent_id FROM media_children WHERE id = ?').get(unmatchedId));
    const matched = /** @type {any} */ (db.prepare('SELECT id, title, parent_id FROM media_children WHERE id = ?').get(matchedId));

    if (!unmatched || !matched) return { success: false, migratedPlays: 0 };
    if (unmatched.parent_id !== matched.parent_id) return { success: false, migratedPlays: 0 };

    // Count plays to migrate
    const playCount = /** @type {any} */ (db.prepare('SELECT COUNT(*) as c FROM playback_history WHERE media_id = ?').get(unmatchedId))?.c || 0;

    const txn = db.transaction(() => {
        // Migrate playback history
        db.prepare('UPDATE playback_history SET media_id = ? WHERE media_id = ?').run(matchedId, unmatchedId);

        // Update play_count on matched album
        db.prepare(`
            UPDATE media_children SET play_count = (
                SELECT COUNT(DISTINCT CAST(strftime('%s', timestamp) / 300 AS INTEGER) || '::' || COALESCE(track_name, ''))
                FROM playback_history WHERE media_id = ?
            ) WHERE id = ?
        `).run(matchedId, matchedId);

        // Delete the unmatched album
        db.prepare('DELETE FROM media_children WHERE id = ?').run(unmatchedId);
    });

    txn();
    return { success: true, migratedPlays: playCount };
}

/**
 * Auto-merge all exact-confidence matches.
 * @param {{ artistId?: number }} options
 * @returns {{ merged: number, totalPlays: number }}
 */
export function autoMergeExact({ artistId } = {}) {
    const { suggestions } = generateMatches({ artistId, limit: 99999 });
    const exact = suggestions.filter(s => s.confidence === 'exact');

    let merged = 0;
    let totalPlays = 0;

    for (const s of exact) {
        for (const uid of s.unmatchedIds) {
            const result = mergeAlbum(uid, s.matchedId);
            if (result.success) {
                merged++;
                totalPlays += result.migratedPlays;
            }
        }
    }

    return { merged, totalPlays };
}
