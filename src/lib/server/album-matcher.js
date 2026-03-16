import db from '$lib/server/db.js';

/**
 * Normalize album titles for comparison.
 * Strips smart quotes, punctuation, common edition/remaster suffixes,
 * trims, lowercases, and removes trailing " - Single", " - EP", etc.
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
        .trim()
        .toLowerCase()
        // Remove common suffixes: "- Single", "- EP"
        .replace(/\s*[-–—]\s*(single|ep|e\.p\.)$/i, '')
        // Remove edition/remaster suffixes in parens or brackets
        .replace(/\s*[\(\[](remaster(ed)?|deluxe(\s+edition)?|super\s+deluxe|expanded(\s+edition)?|anniversary(\s+edition)?|\d{4}\s+remaster(ed)?|\d+th\s+anniversary.*|bonus\s+track.*|special\s+edition|limited\s+edition)[\)\]]/gi, '')
        // Strip all remaining punctuation (periods, commas, colons, etc.)
        .replace(/[^\w\s]/g, '')
        // Normalize whitespace
        .replace(/\s+/g, ' ')
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
 * Fuzzy-compare two strings: returns true if they match exactly after normalization,
 * or within Levenshtein distance ≤ 2 (or ≤ 15% of length).
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
function fuzzyMatch(a, b) {
    const na = normalizeTitle(a);
    const nb = normalizeTitle(b);
    if (na === nb) return true;
    if (na.length < 2 || nb.length < 2) return false;
    const dist = levenshtein(na, nb);
    const maxLen = Math.max(na.length, nb.length);
    return dist <= 2 || (dist / maxLen) <= 0.15;
}

/**
 * Generate match suggestions for unmatched albums.
 *
 * Pipeline (all within same artist):
 *   Tier 1: Track-based matching — compare track names from the unmatched album's
 *           playback_history against Jellyfin tracks for each candidate album.
 *           Uses fuzzy comparison for track name matching.
 *   Tier 2: Album title matching — exact normalized title, then fuzzy Levenshtein.
 *
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

    // Get all matched albums (Jellyfin albums) — include artist name for cross-parent matching
    let matchedQuery = `
        SELECT mc.id, mc.title, mc.parent_id, mc.jellyfin_id, mp.title as artist_name
        FROM media_children mc
        JOIN media_parents mp ON mc.parent_id = mp.id
        WHERE mp.media_type = 'artist' AND mc.jellyfin_id IS NOT NULL
    `;
    const matchedParams = [];
    if (artistId) {
        // If filtering by a specific external artist, find Jellyfin artists with same name
        const extArtist = /** @type {any} */ (db.prepare('SELECT title FROM media_parents WHERE id = ?').get(artistId));
        if (extArtist) {
            matchedQuery += ' AND LOWER(mp.title) = LOWER(?)';
            matchedParams.push(extArtist.title);
        }
    }
    const matched = /** @type {any[]} */ (db.prepare(matchedQuery).all(...matchedParams));

    // ── Build indexes (keyed by normalized artist name for cross-parent matching) ──

    // Key: normalizedArtistName::normalizedAlbumTitle → matched album
    /** @type {Map<string, any>} */
    const matchIndex = new Map();
    // All matched albums grouped by normalized artist name
    /** @type {Map<string, any[]>} */
    const matchedByArtistName = new Map();
    for (const m of matched) {
        const normArtist = normalizeTitle(m.artist_name);
        const normKey = `${normArtist}::${normalizeTitle(m.title)}`;
        if (!matchIndex.has(normKey)) matchIndex.set(normKey, m);
        if (!matchedByArtistName.has(normArtist)) matchedByArtistName.set(normArtist, []);
        matchedByArtistName.get(normArtist)?.push(m);
    }

    // Pre-load Jellyfin tracks indexed by album_id
    /** @type {Map<number, string[]>} */
    const tracksByAlbum = new Map();
    const allTracks = /** @type {any[]} */ (db.prepare(`
        SELECT t.album_id, t.title FROM tracks t
        JOIN media_children mc ON t.album_id = mc.id
        WHERE mc.jellyfin_id IS NOT NULL
    `).all());
    for (const t of allTracks) {
        if (!tracksByAlbum.has(t.album_id)) tracksByAlbum.set(t.album_id, []);
        tracksByAlbum.get(t.album_id)?.push(t.title);
    }

    // Pre-load played track names for unmatched albums
    /** @type {Map<number, string[]>} */
    const playedTracksByAlbum = new Map();
    const playedTracks = /** @type {any[]} */ (db.prepare(`
        SELECT DISTINCT ph.media_id, ph.track_name
        FROM playback_history ph
        JOIN media_children mc ON ph.media_id = mc.id
        WHERE mc.jellyfin_id IS NULL AND ph.track_name IS NOT NULL AND ph.track_name != ''
    `).all());
    for (const pt of playedTracks) {
        if (!playedTracksByAlbum.has(pt.media_id)) playedTracksByAlbum.set(pt.media_id, []);
        playedTracksByAlbum.get(pt.media_id)?.push(pt.track_name);
    }

    // Group unmatched by normalized artist+album key for dedup
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

    for (const u of unmatched) {
        if (processed.has(u.id)) continue;

        const normArtist = normalizeTitle(u.artist_name);
        const groupKey = `${u.parent_id}::${normalizeTitle(u.title)}`;
        const normKey = `${normArtist}::${normalizeTitle(u.title)}`;
        const selfGroup = unmatchedGroups.get(groupKey) || [];
        const candidates = matchedByArtistName.get(normArtist) || [];

        // Mark all variants as processed
        for (const sg of selfGroup) processed.add(sg.id);

        if (candidates.length === 0) continue;

        // ── Tier 1: Track-based matching ──
        // Gather all played track names across all unmatched variants in this group
        /** @type {string[]} */
        let allPlayedTracks = [];
        for (const sg of selfGroup) {
            const tracks = playedTracksByAlbum.get(sg.id) || [];
            allPlayedTracks.push(...tracks);
        }
        // Deduplicate
        allPlayedTracks = [...new Set(allPlayedTracks)];

        let bestTrackMatch = /** @type {any} */ (null);
        let bestTrackOverlap = 0;
        let bestTrackTotal = 0;
        let bestTrackMatched = 0;

        if (allPlayedTracks.length > 0) {
            for (const candidate of candidates) {
                const jellyfinTracks = tracksByAlbum.get(candidate.id) || [];
                if (jellyfinTracks.length === 0) continue;

                // Count how many played tracks fuzzy-match a Jellyfin track
                let matchedCount = 0;
                for (const playedTrack of allPlayedTracks) {
                    const hasMatch = jellyfinTracks.some(jt => fuzzyMatch(playedTrack, jt));
                    if (hasMatch) matchedCount++;
                }

                if (matchedCount > 0 && matchedCount > bestTrackMatched) {
                    bestTrackMatch = candidate;
                    bestTrackMatched = matchedCount;
                    bestTrackTotal = allPlayedTracks.length;
                    bestTrackOverlap = matchedCount / allPlayedTracks.length;
                }
            }
        }

        if (bestTrackMatch && bestTrackOverlap > 0) {
            // Determine confidence from track overlap
            let confidence;
            if (bestTrackOverlap >= 0.8) confidence = 'exact';
            else if (bestTrackOverlap >= 0.5) confidence = 'high';
            else if (bestTrackOverlap >= 0.3 || bestTrackMatched >= 2) confidence = 'medium';
            else confidence = 'medium'; // at least 1 track matched

            if (confidence === 'exact') exactCount++;

            suggestions.push({
                unmatchedIds: selfGroup.map(s => s.id),
                unmatchedTitle: u.title,
                unmatchedVariants: [...new Set(selfGroup.map(s => s.title))],
                matchedId: bestTrackMatch.id,
                matchedTitle: bestTrackMatch.title,
                artistName: u.artist_name,
                artistId: u.parent_id,
                confidence,
                distance: 0,
                duplicateCount: selfGroup.length,
                matchType: 'track',
                trackOverlap: `${bestTrackMatched}/${bestTrackTotal}`
            });
            continue;
        }

        // ── Tier 2: Album title matching ──
        // First check exact normalized title match
        const exactMatch = matchIndex.get(normKey);
        if (exactMatch) {
            exactCount++;
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
                duplicateCount: selfGroup.length,
                matchType: 'title'
            });
            continue;
        }

        // Fuzzy album title matching
        if (candidates.length > 30) continue; // Skip for huge catalogs

        let bestMatch = null;
        let bestConf = /** @type {{ confidence: string, distance: number }} */ ({ confidence: 'none', distance: 999 });

        for (const c of candidates) {
            const conf = computeConfidence(u.title, c.title);
            if (conf.confidence !== 'none' && conf.distance < bestConf.distance) {
                bestMatch = c;
                bestConf = conf;
            }
        }

        if (bestMatch) {
            if (bestConf.confidence === 'exact') exactCount++;
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
                duplicateCount: selfGroup.length,
                matchType: 'title'
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
    const unmatched = /** @type {any} */ (db.prepare(`
        SELECT mc.id, mc.title, mc.parent_id, mp.title as artist_name
        FROM media_children mc JOIN media_parents mp ON mc.parent_id = mp.id WHERE mc.id = ?
    `).get(unmatchedId));
    const matched = /** @type {any} */ (db.prepare(`
        SELECT mc.id, mc.title, mc.parent_id, mp.title as artist_name
        FROM media_children mc JOIN media_parents mp ON mc.parent_id = mp.id WHERE mc.id = ?
    `).get(matchedId));

    if (!unmatched || !matched) return { success: false, migratedPlays: 0 };
    // Allow cross-parent merge if artist names match (normalize smart quotes etc.)
    if (normalizeTitle(unmatched.artist_name) !== normalizeTitle(matched.artist_name)) {
        return { success: false, migratedPlays: 0 };
    }

    // Count plays to migrate
    const playCount = /** @type {any} */ (db.prepare('SELECT COUNT(*) as c FROM playback_history WHERE media_id = ?').get(unmatchedId))?.c || 0;

    const txn = db.transaction(() => {
        // Migrate playback history to matched album
        db.prepare('UPDATE playback_history SET media_id = ? WHERE media_id = ?').run(matchedId, unmatchedId);

        // Link track_id by matching track_name to tracks.title on the target album
        db.prepare(`
            UPDATE playback_history SET track_id = (
                SELECT t.id FROM tracks t
                WHERE t.album_id = ?
                AND LOWER(TRIM(t.title)) = LOWER(TRIM(playback_history.track_name))
                LIMIT 1
            )
            WHERE media_id = ? AND track_id IS NULL AND track_name IS NOT NULL
        `).run(matchedId, matchedId);

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

/**
 * Auto-merge all matches with medium confidence or stronger (exact, high, medium).
 * @param {{ artistId?: number }} options
 * @returns {{ merged: number, totalPlays: number }}
 */
export function autoMergeMediumPlus({ artistId } = {}) {
    const { suggestions } = generateMatches({ artistId, limit: 99999 });
    const qualifying = suggestions.filter(s => ['exact', 'high', 'medium'].includes(s.confidence));

    let merged = 0;
    let totalPlays = 0;

    for (const s of qualifying) {
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

/**
 * Smart-merge compilation/best-of albums by routing each play to the correct
 * studio album based on track name matching against Jellyfin tracks.
 *
 * For each unmatched album:
 *   1. Get all its playback_history entries with track names
 *   2. For each track, fuzzy-match against Jellyfin tracks on the same artist's matched albums
 *   3. If ALL tracks match existing albums → route each play to the correct album, delete unmatched
 *   4. If not all match → skip (needs manual review or is unique content)
 *
 * @param {{ artistId?: number, dryRun?: boolean }} options
 * @returns {{ merged: number, playsRouted: number, skipped: number, details: any[] }}
 */
export function smartMergeCompilations({ artistId, dryRun = false } = {}) {
    // Get all unmatched albums with playback history
    let query = `
        SELECT mc.id, mc.title, mc.parent_id, mp.title as artist_name
        FROM media_children mc
        JOIN media_parents mp ON mc.parent_id = mp.id
        WHERE mp.media_type = 'artist' AND mc.jellyfin_id IS NULL
        AND COALESCE(mc.is_special, 0) = 0
    `;
    /** @type {any[]} */
    const params = [];
    if (artistId) {
        query += ' AND mc.parent_id = ?';
        params.push(artistId);
    }
    const unmatchedAlbums = /** @type {any[]} */ (db.prepare(query).all(...params));

    // Pre-load all Jellyfin tracks indexed by artist name → album_id → track titles
    /** @type {Map<string, Map<number, {albumTitle: string, tracks: string[]}>>} */
    const tracksByArtist = new Map();
    const allTracks = /** @type {any[]} */ (db.prepare(`
        SELECT t.album_id, t.title as track_title, mc.title as album_title,
               mc.parent_id, mp.title as artist_name
        FROM tracks t
        JOIN media_children mc ON t.album_id = mc.id
        JOIN media_parents mp ON mc.parent_id = mp.id
        WHERE mc.jellyfin_id IS NOT NULL AND mp.media_type = 'artist'
    `).all());
    for (const t of allTracks) {
        const normArtist = normalizeTitle(t.artist_name);
        if (!tracksByArtist.has(normArtist)) tracksByArtist.set(normArtist, new Map());
        const artistMap = tracksByArtist.get(normArtist);
        if (artistMap) {
            if (!artistMap.has(t.album_id)) artistMap.set(t.album_id, { albumTitle: t.album_title, tracks: [] });
            artistMap.get(t.album_id)?.tracks.push(t.track_title);
        }
    }

    let merged = 0;
    let playsRouted = 0;
    let skipped = 0;
    /** @type {any[]} */
    const details = [];

    for (const album of unmatchedAlbums) {
        const normArtist = normalizeTitle(album.artist_name);
        const artistTracks = tracksByArtist.get(normArtist);
        if (!artistTracks) {
            skipped++;
            continue;
        }

        // Get all playback_history entries for this unmatched album
        const plays = /** @type {any[]} */ (db.prepare(`
            SELECT id, track_name FROM playback_history
            WHERE media_id = ? AND track_name IS NOT NULL AND track_name != ''
        `).all(album.id));

        if (plays.length === 0) {
            skipped++;
            continue;
        }

        // For each play, find which matched album it belongs to
        /** @type {Map<number, {albumTitle: string, playIds: number[]}>} */
        const routeMap = new Map();
        let unmatchedPlays = 0;

        for (const play of plays) {
            let bestAlbumId = null;
            let bestAlbumTitle = '';

            for (const [albumId, albumData] of artistTracks) {
                const hasMatch = albumData.tracks.some(jt => fuzzyMatch(play.track_name, jt));
                if (hasMatch) {
                    bestAlbumId = albumId;
                    bestAlbumTitle = albumData.albumTitle;
                    break;
                }
            }

            if (bestAlbumId !== null) {
                if (!routeMap.has(bestAlbumId)) routeMap.set(bestAlbumId, { albumTitle: bestAlbumTitle, playIds: [] });
                routeMap.get(bestAlbumId)?.playIds.push(play.id);
            } else {
                unmatchedPlays++;
            }
        }

        // Only auto-merge if ALL tracks matched (it's a pure compilation)
        if (unmatchedPlays > 0) {
            skipped++;
            details.push({
                action: 'skipped',
                albumTitle: album.title,
                artistName: album.artist_name,
                reason: `${unmatchedPlays}/${plays.length} tracks unmatched — likely unique content`,
                totalPlays: plays.length
            });
            continue;
        }

        // Route plays and delete the unmatched album
        if (!dryRun) {
            db.transaction(() => {
                for (const [targetAlbumId, routeData] of routeMap) {
                    for (const playId of routeData.playIds) {
                        db.prepare('UPDATE playback_history SET media_id = ? WHERE id = ?').run(targetAlbumId, playId);
                    }

                    // Link track_id by matching track_name to tracks.title on the target album
                    db.prepare(`
                        UPDATE playback_history SET track_id = (
                            SELECT t.id FROM tracks t
                            WHERE t.album_id = ?
                            AND LOWER(TRIM(t.title)) = LOWER(TRIM(playback_history.track_name))
                            LIMIT 1
                        )
                        WHERE media_id = ? AND track_id IS NULL AND track_name IS NOT NULL
                    `).run(targetAlbumId, targetAlbumId);

                    // Update play_count on target album
                    db.prepare(`
                        UPDATE media_children SET play_count = (
                            SELECT COUNT(DISTINCT CAST(strftime('%s', timestamp) / 300 AS INTEGER) || '::' || COALESCE(track_name, ''))
                            FROM playback_history WHERE media_id = ?
                        ) WHERE id = ?
                    `).run(targetAlbumId, targetAlbumId);
                }

                // Delete the unmatched album
                db.prepare('DELETE FROM media_children WHERE id = ?').run(album.id);
            })();
        }

        const routeDetails = [...routeMap.entries()].map(([id, d]) => `${d.playIds.length} plays → ${d.albumTitle}`);
        merged++;
        playsRouted += plays.length;
        details.push({
            action: dryRun ? 'would_merge' : 'merged',
            albumTitle: album.title,
            artistName: album.artist_name,
            totalPlays: plays.length,
            routing: routeDetails
        });

        if (!dryRun) {
            console.log(`[smart-merge] Merged "${album.title}" (${album.artist_name}): ${routeDetails.join(', ')}`);
        }
    }

    return { merged, playsRouted, skipped, details };
}

const MB_API = 'https://musicbrainz.org/ws/2';
const MB_USER_AGENT = 'MediaJam/1.0 (https://github.com/mediajam)';
const MB_RATE_MS = 1100; // slightly over 1s to stay safe

/**
 * Enrich remaining unmatched albums with MusicBrainz metadata + cover art.
 * For each unmatched album without a musicbrainz_id, searches MusicBrainz
 * by artist MBID + album title, and if found, fills in:
 *   - musicbrainz_id (release group ID)
 *   - item_number (release year)
 *   - poster_url (from Cover Art Archive)
 *   - title correction if MusicBrainz has a different canonical title
 *
 * @param {{ artistId?: number, dryRun?: boolean }} options
 * @returns {Promise<{ enriched: number, notFound: number, details: any[] }>}
 */
export async function enrichUnmatchedAlbums({ artistId, dryRun = false } = {}) {
    // Get unmatched albums without musicbrainz_id, for artists that HAVE a musicbrainz_id
    let query = `
        SELECT mc.id, mc.title, mc.parent_id, mc.musicbrainz_id as album_mb_id,
               mp.title as artist_name, mp.musicbrainz_id as artist_mb_id
        FROM media_children mc
        JOIN media_parents mp ON mc.parent_id = mp.id
        WHERE mp.media_type = 'artist' AND mc.jellyfin_id IS NULL
        AND mc.musicbrainz_id IS NULL
        AND mp.musicbrainz_id IS NOT NULL AND mp.musicbrainz_id != ''
        AND COALESCE(mc.is_special, 0) = 0
    `;
    /** @type {any[]} */
    const params = [];
    if (artistId) {
        query += ' AND mc.parent_id = ?';
        params.push(artistId);
    }
    const albums = /** @type {any[]} */ (db.prepare(query).all(...params));

    let enriched = 0;
    let notFound = 0;
    /** @type {any[]} */
    const details = [];

    for (const album of albums) {
        // Search MusicBrainz release-groups by artist MBID
        const searchTitle = encodeURIComponent(album.title.replace(/[()[\]{}]/g, ''));
        const url = `${MB_API}/release-group?query=releasegroup:"${searchTitle}" AND arid:${album.artist_mb_id}&fmt=json&limit=5`;

        try {
            const res = await fetch(url, {
                headers: { 'User-Agent': MB_USER_AGENT, 'Accept': 'application/json' },
                signal: AbortSignal.timeout(15000)
            });

            if (res.status === 503 || res.status === 429) {
                console.log(`[enrich] Rate limited, waiting 3s...`);
                await new Promise(r => setTimeout(r, 3000));
                // Skip this one, will catch on next run
                continue;
            }

            if (!res.ok) {
                notFound++;
                continue;
            }

            const data = await res.json();
            await new Promise(r => setTimeout(r, MB_RATE_MS)); // Rate limit

            if (!data['release-groups'] || data['release-groups'].length === 0) {
                notFound++;
                details.push({ action: 'not_found', albumTitle: album.title, artistName: album.artist_name });
                continue;
            }

            // Find the best match — prefer exact title match, then highest score
            const normalizedAlbumTitle = album.title.toLowerCase().replace(/[^a-z0-9]/g, '');
            let bestMatch = null;
            for (const rg of data['release-groups']) {
                const normalizedRgTitle = (rg.title || '').toLowerCase().replace(/[^a-z0-9]/g, '');
                if (normalizedRgTitle === normalizedAlbumTitle) {
                    bestMatch = rg;
                    break;
                }
            }
            // Fallback: pick highest score if no exact match
            if (!bestMatch && data['release-groups'][0].score >= 80) {
                bestMatch = data['release-groups'][0];
            }

            if (!bestMatch) {
                notFound++;
                details.push({ action: 'not_found', albumTitle: album.title, artistName: album.artist_name });
                continue;
            }

            // Extract metadata
            const mbId = bestMatch.id;
            const year = bestMatch['first-release-date'] ? parseInt(bestMatch['first-release-date'].substring(0, 4)) : null;
            const canonicalTitle = bestMatch.title;
            const rgType = bestMatch['primary-type'] || null;
            const secondaryTypes = (bestMatch['secondary-types'] || []).join(', ');

            // Try to get cover art from Cover Art Archive
            let coverUrl = null;
            try {
                const coverRes = await fetch(`https://coverartarchive.org/release-group/${mbId}/front-250`, {
                    redirect: 'follow',
                    signal: AbortSignal.timeout(10000)
                });
                if (coverRes.ok) {
                    coverUrl = coverRes.url; // follows redirect to actual image URL
                }
            } catch {
                // No cover art available, not a problem
            }

            if (!dryRun) {
                const updates = [];
                const updateParams = [];

                updates.push('musicbrainz_id = ?');
                updateParams.push(mbId);

                if (year) {
                    updates.push('item_number = ?');
                    updateParams.push(year);
                }

                if (coverUrl) {
                    updates.push('poster_url = ?');
                    updateParams.push(coverUrl);
                }

                // Update title if MusicBrainz has a meaningfully different canonical form
                if (canonicalTitle && canonicalTitle !== album.title) {
                    updates.push('title = ?');
                    updateParams.push(canonicalTitle);
                }

                updateParams.push(album.id);
                db.prepare(`UPDATE media_children SET ${updates.join(', ')} WHERE id = ?`).run(...updateParams);
            }

            enriched++;
            details.push({
                action: dryRun ? 'would_enrich' : 'enriched',
                albumTitle: album.title,
                canonicalTitle,
                artistName: album.artist_name,
                mbId,
                year,
                type: secondaryTypes ? `${rgType} (${secondaryTypes})` : rgType,
                hasCover: !!coverUrl
            });

            console.log(`[enrich] ${album.title} → MB: ${mbId}, year: ${year}, type: ${rgType}${secondaryTypes ? ` (${secondaryTypes})` : ''}, cover: ${coverUrl ? 'yes' : 'no'}`);

        } catch (err) {
            console.error(`[enrich] Error processing "${album.title}":`, err instanceof Error ? err.message : err);
            notFound++;
        }
    }

    return { enriched, notFound, details };
}

/**
 * Backfill original release years from MusicBrainz for all albums.
 * Jellyfin's ProductionYear often reflects the remaster/reissue year.
 * MusicBrainz release-group's `first-release-date` gives the original year.
 *
 * @param {{ dryRun?: boolean }} options
 * @returns {Promise<{ updated: number, skipped: number, errors: number, details: any[] }>}
 */
export async function backfillOriginalYears({ dryRun = false } = {}) {
    // Get all albums with a musicbrainz_id (release group ID)
    const albums = /** @type {any[]} */ (db.prepare(`
        SELECT mc.id, mc.title, mc.musicbrainz_id, mc.item_number as current_year,
               mp.title as artist_name
        FROM media_children mc
        JOIN media_parents mp ON mc.parent_id = mp.id
        WHERE mp.media_type = 'artist'
          AND mc.musicbrainz_id IS NOT NULL AND mc.musicbrainz_id != ''
        ORDER BY mp.title, mc.title
    `).all());

    let updated = 0;
    let skipped = 0;
    let errors = 0;
    /** @type {any[]} */
    const details = [];

    console.log(`[backfill-years] Checking ${albums.length} albums with MusicBrainz IDs...`);

    for (const album of albums) {
        const mbId = album.musicbrainz_id;

        try {
            const res = await fetch(`${MB_API}/release-group/${mbId}?fmt=json`, {
                headers: { 'User-Agent': MB_USER_AGENT, 'Accept': 'application/json' },
                signal: AbortSignal.timeout(15000)
            });

            if (res.status === 503 || res.status === 429) {
                console.log(`[backfill-years] Rate limited, waiting 3s...`);
                await new Promise(r => setTimeout(r, 3000));
                skipped++;
                continue;
            }

            if (!res.ok) {
                errors++;
                continue;
            }

            const data = await res.json();
            await new Promise(r => setTimeout(r, MB_RATE_MS));

            const firstReleaseDate = data['first-release-date'];
            if (!firstReleaseDate) {
                skipped++;
                continue;
            }

            const originalYear = parseInt(firstReleaseDate.substring(0, 4));
            if (isNaN(originalYear) || originalYear < 1900) {
                skipped++;
                continue;
            }

            // Skip if already correct
            if (album.current_year === originalYear) {
                skipped++;
                continue;
            }

            if (!dryRun) {
                db.prepare('UPDATE media_children SET item_number = ? WHERE id = ?')
                    .run(originalYear, album.id);
            }

            updated++;
            details.push({
                action: dryRun ? 'would_update' : 'updated',
                albumTitle: album.title,
                artistName: album.artist_name,
                oldYear: album.current_year,
                newYear: originalYear
            });

            if (album.current_year !== originalYear) {
                console.log(`[backfill-years] ${album.artist_name} — ${album.title}: ${album.current_year || '?'} → ${originalYear}`);
            }

        } catch (err) {
            console.error(`[backfill-years] Error for "${album.title}":`, err instanceof Error ? err.message : err);
            errors++;
        }
    }

    console.log(`[backfill-years] Done: ${updated} updated, ${skipped} skipped, ${errors} errors`);
    return { updated, skipped, errors, details };
}
