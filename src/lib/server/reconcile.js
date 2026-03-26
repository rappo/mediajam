import db from '$lib/server/db.js';
import { slugify, ensureUniqueSlug } from '$lib/server/slugify.js';

/**
 * Reconcile external media_children (created by Last.fm/Trakt) with Jellyfin-synced entries.
 * Finds duplicates where same parent + same title exists with and without jellyfin_id,
 * migrates playback_history references from the orphan to the Jellyfin entry, then deletes the orphan.
 * @returns {{ merged: number, deleted: number }}
 */
export function reconcileExternalMedia() {
    // Find duplicate media_children: same parent_id + title (case-insensitive),
    // where one has a jellyfin_id and the other doesn't
    const duplicates = /** @type {any[]} */ (db.prepare(`
        SELECT
            orphan.id AS orphan_id,
            jf.id AS jellyfin_child_id,
            orphan.title,
            orphan.parent_id
        FROM media_children orphan
        JOIN media_children jf
            ON jf.parent_id = orphan.parent_id
            AND jf.title = orphan.title COLLATE NOCASE
            AND jf.jellyfin_id IS NOT NULL
        WHERE orphan.jellyfin_id IS NULL
        AND orphan.id != jf.id
    `).all());

    if (duplicates.length === 0) return { merged: 0, deleted: 0 };

    let merged = 0;
    let deleted = 0;

    const migrateHistory = db.prepare(
        'UPDATE playback_history SET media_id = ? WHERE media_id = ?'
    );
    const deleteChild = db.prepare(
        'DELETE FROM media_children WHERE id = ?'
    );

    const deleteOrphanHistory = db.prepare(
        'DELETE FROM playback_history WHERE media_id = ?'
    );

    db.transaction(() => {
        for (const dup of duplicates) {
            // Move all playback_history refs from orphan to jellyfin entry
            const result = migrateHistory.run(dup.jellyfin_child_id, dup.orphan_id);
            merged += result.changes;

            // Delete any remaining history that couldn't be migrated
            // (e.g. duplicate external_event_id prevents the UPDATE)
            deleteOrphanHistory.run(dup.orphan_id);

            // Delete the orphan media_children entry
            deleteChild.run(dup.orphan_id);
            deleted++;
        }
    })();

    if (merged > 0 || deleted > 0) {
        console.log(`[reconcile] Merged ${merged} playback_history refs, deleted ${deleted} orphan media_children`);
    }

    return { merged, deleted };
}

/**
/**
 * Deduplicate media_parents that share the same external ID (tmdb_id, musicbrainz_id, or imdb_id).
 * This happens when a movie/show/artist is re-added, or the reconciler creates externals
 * with slightly different titles but matching external IDs.
 * Keeps the best entry (jellyfin_id first, then highest id), migrates playback_history
 * and person_credits from stale entries, then deletes the stale parents and their children.
 * @returns {{ deduped: number, historyMoved: number, creditsMoved: number }}
 */
export function deduplicateParents() {
    // Find duplicate groups by each external ID type
    const idColumns = ['tmdb_id', 'musicbrainz_id', 'imdb_id'];
    /** @type {Array<{idCol: string, idVal: string, ids: string}>} */
    const allDupeGroups = [];

    for (const col of idColumns) {
        const groups = /** @type {any[]} */ (db.prepare(`
            SELECT '${col}' as idCol, ${col} as idVal, GROUP_CONCAT(id) as ids
            FROM media_parents
            WHERE ${col} IS NOT NULL AND ${col} != ''
            GROUP BY ${col}, media_type
            HAVING COUNT(*) > 1
        `).all());
        allDupeGroups.push(...groups);
    }

    if (allDupeGroups.length === 0) return { deduped: 0, historyMoved: 0, creditsMoved: 0 };

    // Track already-deleted IDs to avoid processing a parent twice
    const deletedIds = new Set();

    let deduped = 0;
    let historyMoved = 0;
    let creditsMoved = 0;

    db.transaction(() => {
        for (const group of allDupeGroups) {
            const ids = group.ids.split(',').map(Number).filter((/** @type {number} */ id) => !deletedIds.has(id));
            if (ids.length <= 1) continue;

            // Prefer the entry with jellyfin_id, then highest id
            const rows = /** @type {any[]} */ (db.prepare(
                `SELECT id, jellyfin_id FROM media_parents WHERE id IN (${ids.join(',')})`
            ).all());
            rows.sort((a, b) => {
                const aHasJf = a.jellyfin_id ? 1 : 0;
                const bHasJf = b.jellyfin_id ? 1 : 0;
                if (aHasJf !== bHasJf) return bHasJf - aHasJf;
                return b.id - a.id;
            });

            const keepId = rows[0].id;
            // Only merge orphan entries (no jellyfin_id) — never delete entries
            // that have their own jellyfin_id, since those are legitimate separate items
            // that happen to share an external ID (e.g. "Isis" and "Isis & Aereogramme"
            // both share a MusicBrainz ID but are different Jellyfin entries)
            const staleIds = rows.slice(1)
                .filter((/** @type {any} */ r) => !r.jellyfin_id)
                .map((/** @type {any} */ r) => r.id);

            for (const staleId of staleIds) {
                const keepChild = /** @type {any} */ (db.prepare(
                    'SELECT id FROM media_children WHERE parent_id = ? LIMIT 1'
                ).get(keepId));

                const staleChildren = /** @type {any[]} */ (db.prepare(
                    'SELECT id FROM media_children WHERE parent_id = ?'
                ).all(staleId));

                if (keepChild) {
                    for (const sc of staleChildren) {
                        const result = db.prepare(
                            'UPDATE playback_history SET media_id = ? WHERE media_id = ?'
                        ).run(keepChild.id, sc.id);
                        historyMoved += result.changes;
                    }
                }

                // Migrate person_credits (avoid duplicates)
                const existingCredits = /** @type {any[]} */ (db.prepare(
                    'SELECT person_id, role_type FROM person_credits WHERE media_parent_id = ?'
                ).all(keepId));
                const existingSet = new Set(existingCredits.map(c => `${c.person_id}:${c.role_type}`));

                const staleCredits = /** @type {any[]} */ (db.prepare(
                    'SELECT * FROM person_credits WHERE media_parent_id = ?'
                ).all(staleId));

                for (const credit of staleCredits) {
                    const key = `${credit.person_id}:${credit.role_type}`;
                    if (!existingSet.has(key)) {
                        db.prepare(
                            'UPDATE person_credits SET media_parent_id = ? WHERE id = ?'
                        ).run(keepId, credit.id);
                        creditsMoved++;
                    }
                }

                db.prepare('DELETE FROM person_credits WHERE media_parent_id = ?').run(staleId);
                db.prepare('DELETE FROM media_children WHERE parent_id = ?').run(staleId);
                // Adopt slug from deleted entry before removing it
                const staleSlug = /** @type {any} */ (db.prepare('SELECT slug FROM media_parents WHERE id = ?').get(staleId));
                if (staleSlug?.slug) {
                    const keepSlug = /** @type {any} */ (db.prepare('SELECT slug FROM media_parents WHERE id = ?').get(keepId));
                    if (!keepSlug?.slug || keepSlug.slug.startsWith('untitled')) {
                        db.prepare('UPDATE media_parents SET slug = ? WHERE id = ?').run(staleSlug.slug, keepId);
                    }
                }
                db.prepare('DELETE FROM media_parents WHERE id = ?').run(staleId);
                deletedIds.add(staleId);
                deduped++;
            }
        }
    })();

    if (deduped > 0) {
        console.log(`[dedupe] Merged ${deduped} duplicate parents (by external ID), moved ${historyMoved} history entries and ${creditsMoved} credits`);
    }

    return { deduped, historyMoved, creditsMoved };
}

/**
 * Deduplicate media_children that share the same parent_id + season_number + item_number.
 * This happens when episodes are re-added to Jellyfin (new jellyfin_id) or when
 * a "TBA" placeholder gets replaced by the actual episode.
 * Keeps the best entry (collected > uncollected, then highest id), migrates playback_history.
 * Skips S0E0 groups (multiple specials can legitimately share that slot).
 * @returns {{ deduped: number, historyMoved: number }}
 */
export function deduplicateChildren() {
    // Find duplicate groups (skip S0E0 — specials can be legitimately duplicated)
    const dupeGroups = /** @type {any[]} */ (db.prepare(`
        SELECT parent_id, season_number, item_number, GROUP_CONCAT(id) as ids
        FROM media_children
        WHERE season_number IS NOT NULL
        AND NOT (season_number = 0 AND item_number = 0)
        GROUP BY parent_id, season_number, item_number
        HAVING COUNT(*) > 1
    `).all());

    if (dupeGroups.length === 0) return { deduped: 0, historyMoved: 0 };

    let deduped = 0;
    let historyMoved = 0;

    db.transaction(() => {
        for (const group of dupeGroups) {
            const ids = group.ids.split(',').map(Number);
            // Fetch all entries to pick the best one
            const entries = /** @type {any[]} */ (db.prepare(
                `SELECT id, is_collected, jellyfin_id FROM media_children WHERE id IN (${ids.join(',')})`
            ).all());

            // Prefer collected entries, then highest id
            entries.sort((a, b) => {
                if (a.is_collected !== b.is_collected) return b.is_collected - a.is_collected;
                return b.id - a.id;
            });

            const keepId = entries[0].id;
            const staleIds = entries.slice(1).map(e => e.id);

            for (const staleId of staleIds) {
                // Migrate playback_history
                const result = db.prepare(
                    'UPDATE playback_history SET media_id = ? WHERE media_id = ?'
                ).run(keepId, staleId);
                historyMoved += result.changes;

                // Delete stale child
                db.prepare('DELETE FROM media_children WHERE id = ?').run(staleId);
                deduped++;
            }
        }
    })();

    if (deduped > 0) {
        console.log(`[dedupe] Removed ${deduped} duplicate children, moved ${historyMoved} history entries`);
    }

    return { deduped, historyMoved };
}

/**
 * Deduplicate media_parents by title: merge orphan parents (no jellyfin_id)
 * into canonical ones (with jellyfin_id) when they share the same title + type.
 * Also normalizes Unicode hyphens/dashes for matching.
 * @returns {{ deduped: number, historyMoved: number, creditsMoved: number }}
 */
export function deduplicateParentsByTitle() {
    // Find orphan parents that have a canonical match (same title+type, with jellyfin_id)
    const orphans = /** @type {any[]} */ (db.prepare(`
        SELECT orphan.id AS orphan_id, canonical.id AS keep_id, orphan.title
        FROM media_parents orphan
        JOIN media_parents canonical
            ON canonical.title = orphan.title COLLATE NOCASE
            AND canonical.media_type = orphan.media_type
            AND canonical.jellyfin_id IS NOT NULL
        WHERE orphan.jellyfin_id IS NULL
        AND orphan.id != canonical.id
    `).all());

    if (orphans.length === 0) return { deduped: 0, historyMoved: 0, creditsMoved: 0 };

    let deduped = 0;
    let historyMoved = 0;
    let creditsMoved = 0;

    db.transaction(() => {
        for (const { orphan_id, keep_id } of orphans) {
            // ── Copy external IDs the keeper is missing ──
            // This prevents the orphan from being re-created on next reconcile
            const orphanParent = /** @type {any} */ (db.prepare(
                'SELECT musicbrainz_id, tmdb_id, imdb_id FROM media_parents WHERE id = ?'
            ).get(orphan_id));
            const keepParent = /** @type {any} */ (db.prepare(
                'SELECT musicbrainz_id, tmdb_id, imdb_id FROM media_parents WHERE id = ?'
            ).get(keep_id));

            if (orphanParent && keepParent) {
                for (const col of ['musicbrainz_id', 'tmdb_id', 'imdb_id']) {
                    if (orphanParent[col] && !keepParent[col]) {
                        try {
                            db.prepare(`UPDATE media_parents SET ${col} = ? WHERE id = ?`).run(orphanParent[col], keep_id);
                            keepParent[col] = orphanParent[col]; // update local ref
                        } catch (e) {
                            // UNIQUE constraint — another entry already has this ID, skip it
                            console.log(`[dedupe] Skipping ${col} copy for "${orphanParent[col]}" — UNIQUE constraint`);
                        }
                    }
                }
            }

            // Migrate children
            const children = /** @type {any[]} */ (db.prepare(
                'SELECT id FROM media_children WHERE parent_id = ?'
            ).all(orphan_id));

            for (const child of children) {
                // Check if keeper already has a child with the same title
                const keeperChild = /** @type {any} */ (db.prepare(
                    'SELECT id FROM media_children WHERE parent_id = ? AND title = (SELECT title FROM media_children WHERE id = ?) COLLATE NOCASE LIMIT 1'
                ).get(keep_id, child.id));

                if (keeperChild) {
                    // Migrate history to keeper's child, then delete orphan child
                    const r = db.prepare('UPDATE playback_history SET media_id = ? WHERE media_id = ?').run(keeperChild.id, child.id);
                    historyMoved += r.changes;
                    db.prepare('DELETE FROM media_children WHERE id = ?').run(child.id);
                } else {
                    // Move child to keeper parent
                    db.prepare('UPDATE media_children SET parent_id = ? WHERE id = ?').run(keep_id, child.id);
                }
            }

            // Migrate person_credits
            const existingCredits = new Set(
                /** @type {any[]} */(db.prepare(
                'SELECT person_id || \':\' || role_type as key FROM person_credits WHERE media_parent_id = ?'
            ).all(keep_id)).map(r => r.key)
            );
            const staleCredits = /** @type {any[]} */ (db.prepare(
                'SELECT * FROM person_credits WHERE media_parent_id = ?'
            ).all(orphan_id));

            for (const credit of staleCredits) {
                if (!existingCredits.has(`${credit.person_id}:${credit.role_type}`)) {
                    db.prepare('UPDATE person_credits SET media_parent_id = ? WHERE id = ?').run(keep_id, credit.id);
                    creditsMoved++;
                }
            }
            db.prepare('DELETE FROM person_credits WHERE media_parent_id = ?').run(orphan_id);

            // Delete orphan parent (only if no children remain)
            const remaining = /** @type {any} */ (db.prepare(
                'SELECT COUNT(*) as c FROM media_children WHERE parent_id = ?'
            ).get(orphan_id));
            if (!remaining || remaining.c === 0) {
                db.prepare('DELETE FROM media_parents WHERE id = ?').run(orphan_id);
                deduped++;
            }
        }
    })();

    if (deduped > 0) {
        console.log(`[dedupe] Merged ${deduped} title-duplicate parents, moved ${historyMoved} history entries and ${creditsMoved} credits`);
    }

    return { deduped, historyMoved, creditsMoved };
}

/**
 * Deduplicate playback_history entries.
 * 1) Music: pause/resume re-scrobbles — same media_id + track_name within windowMinutes.
 * 2) Movies/Episodes: same media_id on the same calendar day from different sources
 *    (e.g., Trakt + Jellyfin both record the same watch).
 * @param {number} [windowMinutes=30] - max gap for music dedup
 * @returns {{ removed: number }}
 */
export function deduplicatePlaybackHistory(windowMinutes = 30) {
    let removed = 0;
    const deleteStmt = db.prepare('DELETE FROM playback_history WHERE id = ?');

    // ── Pass 1: Music — same track within time window ──
    const musicDupes = /** @type {any[]} */ (db.prepare(`
        WITH ordered AS (
            SELECT
                id,
                media_id,
                track_name,
                timestamp,
                LAG(timestamp) OVER (
                    PARTITION BY media_id, track_name
                    ORDER BY timestamp
                ) AS prev_ts
            FROM playback_history
            WHERE track_name IS NOT NULL
        )
        SELECT id, media_id, track_name, timestamp, prev_ts,
               ROUND((julianday(timestamp) - julianday(prev_ts)) * 24 * 60, 1) AS gap_minutes
        FROM ordered
        WHERE prev_ts IS NOT NULL
          AND (julianday(timestamp) - julianday(prev_ts)) * 24 * 60 < ?
        ORDER BY timestamp DESC
    `).all(windowMinutes));

    // ── Pass 2: Movies/Episodes — same media_id on same day, different sources ──
    // Keeps the earliest entry per media_id per day, removes later duplicates.
    const videoDupes = /** @type {any[]} */ (db.prepare(`
        WITH ranked AS (
            SELECT
                id,
                media_id,
                source,
                timestamp,
                date(timestamp) as play_date,
                ROW_NUMBER() OVER (
                    PARTITION BY media_id, date(timestamp)
                    ORDER BY timestamp ASC
                ) AS rn
            FROM playback_history
            WHERE track_name IS NULL
        )
        SELECT id FROM ranked WHERE rn > 1
    `).all());

    const allDupeIds = new Set([
        ...musicDupes.map(d => d.id),
        ...videoDupes.map(d => d.id)
    ]);

    if (allDupeIds.size === 0) return { removed: 0 };

    db.transaction(() => {
        for (const id of allDupeIds) {
            deleteStmt.run(id);
            removed++;
        }
    })();

    if (removed > 0) {
        const musicCount = musicDupes.length;
        const videoCount = videoDupes.length;
        console.log(`[dedupe] Removed ${removed} duplicate plays (${musicCount} music re-scrobbles, ${videoCount} video same-day dupes)`);
    }

    return { removed };
}

/**
 * Normalize title for cross-matching: lowercase, collapse whitespace,
 * normalize Unicode hyphens/dashes/quotes to ASCII equivalents.
 * @param {string} s
 * @returns {string}
 */
function normalizeForMatch(s) {
    return s
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
        .replace(/[\u201C\u201D\u201E\u201F\u2033\u2036]/g, '"')
        .replace(/[\u2010\u2011\u2012\u2013\u2014\u2015\uFE58\uFE63\uFF0D]/g, '-')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Merge orphan "artist" parents (no jellyfin_id/musicbrainz_id) into matching
 * child albums under other artists. This handles the case where playback history
 * created a stub artist that is actually a child album under a different artist.
 *
 * E.g. "General Patton vs. The X-Ecutioners" was created as a parent artist from
 * Last.fm, but it's actually a child album under "Mike Patton" in Jellyfin.
 *
 * @returns {{ merged: number, historyMoved: number }}
 */
export function mergeOrphanArtistsIntoAlbums() {
    // Find orphan artist parents with no external IDs
    const orphans = /** @type {any[]} */ (db.prepare(`
        SELECT id, title FROM media_parents
        WHERE media_type = 'artist'
        AND jellyfin_id IS NULL
        AND (musicbrainz_id IS NULL OR musicbrainz_id = '')
    `).all());

    if (orphans.length === 0) return { merged: 0, historyMoved: 0 };

    // Pre-fetch all child albums with their parent info for matching
    const albums = /** @type {any[]} */ (db.prepare(`
        SELECT mc.id, mc.title, mc.parent_id, mp.jellyfin_id
        FROM media_children mc
        JOIN media_parents mp ON mc.parent_id = mp.id
        WHERE mp.media_type = 'artist'
        AND mp.jellyfin_id IS NOT NULL
    `).all());

    // Build normalized lookup
    /** @type {Map<string, any[]>} */
    const albumsByNormTitle = new Map();
    for (const a of albums) {
        const nt = normalizeForMatch(a.title);
        if (!albumsByNormTitle.has(nt)) albumsByNormTitle.set(nt, []);
        albumsByNormTitle.get(nt)?.push(a);
    }

    let merged = 0;
    let historyMoved = 0;

    db.transaction(() => {
        for (const orphan of orphans) {
            const normalizedOrphan = normalizeForMatch(orphan.title);

            // Skip very short/generic titles to avoid false positives
            // (e.g. "Failure", "X", "Seven" matching unrelated albums)
            const wordCount = normalizedOrphan.split(/\s+/).length;
            if (wordCount < 2 && normalizedOrphan.length < 10) continue;

            const matchingAlbums = albumsByNormTitle.get(normalizedOrphan);
            if (!matchingAlbums || matchingAlbums.length === 0) continue;

            // Use the first match (prefer one with jellyfin_id on parent)
            const target = matchingAlbums[0];

            // Migrate playback history from orphan's children to the target child album
            const orphanChildren = /** @type {any[]} */ (db.prepare(
                'SELECT id FROM media_children WHERE parent_id = ?'
            ).all(orphan.id));

            for (const oc of orphanChildren) {
                const r = db.prepare(
                    'UPDATE playback_history SET media_id = ? WHERE media_id = ?'
                ).run(target.id, oc.id);
                historyMoved += r.changes;
            }

            // Delete orphan children and parent
            db.prepare('DELETE FROM person_credits WHERE media_parent_id = ?').run(orphan.id);
            db.prepare('DELETE FROM media_children WHERE parent_id = ?').run(orphan.id);
            db.prepare('DELETE FROM media_parents WHERE id = ?').run(orphan.id);
            merged++;

            console.log(`[dedupe] Merged orphan artist "${orphan.title}" (${orphan.id}) → album child ${target.id} under parent ${target.parent_id}`);
        }
    })();

    if (merged > 0) {
        console.log(`[dedupe] Merged ${merged} orphan artists into matching albums, moved ${historyMoved} history entries`);
    }

    return { merged, historyMoved };
}

/**
 * Deduplicate external music albums (no jellyfin_id) under the same artist
 * by normalizing titles. "Vol. 4", "Vol 4", "vol.4" → same entry.
 * Migrates playback history from duplicates to the kept entry (oldest id wins).
 * @returns {{ deduped: number, historyMoved: number }}
 */
export function deduplicateExternalAlbums() {
    const normalize = (/** @type {string} */ t) => t.toLowerCase()
        .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
        .replace(/[\u201C\u201D\u201E\u201F\u2033\u2036]/g, '"')
        .replace(/[\u2013\u2014]/g, '-')
        .replace(/[^\w\s]/g, '')  // strip all punctuation
        .replace(/\s+/g, ' ').trim();

    // Get all external music albums (no jellyfin_id) grouped by artist
    const externalAlbums = /** @type {any[]} */ (db.prepare(`
        SELECT mc.id, mc.title, mc.parent_id
        FROM media_children mc
        JOIN media_parents mp ON mc.parent_id = mp.id
        WHERE mp.media_type = 'artist'
        AND mc.jellyfin_id IS NULL
        ORDER BY mc.parent_id, mc.id ASC
    `).all());

    // Group by artist + normalized title
    /** @type {Map<string, any[]>} */
    const groups = new Map();
    for (const album of externalAlbums) {
        const key = `${album.parent_id}::${normalize(album.title)}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)?.push(album);
    }

    let deduped = 0;
    let historyMoved = 0;

    db.transaction(() => {
        for (const [, albums] of groups) {
            if (albums.length <= 1) continue;

            // Keep the first (oldest id), remove the rest
            const keepId = albums[0].id;
            const staleAlbums = albums.slice(1);

            for (const stale of staleAlbums) {
                // Migrate playback_history
                const result = db.prepare(
                    'UPDATE playback_history SET media_id = ? WHERE media_id = ?'
                ).run(keepId, stale.id);
                historyMoved += result.changes;

                // Delete stale child
                db.prepare('DELETE FROM media_children WHERE id = ?').run(stale.id);
                deduped++;
            }
        }
    })();

    if (deduped > 0) {
        console.log(`[dedupe] Removed ${deduped} duplicate external albums, moved ${historyMoved} history entries`);
    }

    return { deduped, historyMoved };
}

/**
 * Strip parenthetical suffixes, edition tags, and 'Live' from album titles
 * to produce a "base" title for fuzzy matching.
 * E.g. "Patient Number 9 (feat. Jeff Beck)" → "patient number 9"
 *      "Colors (2020 Remix / Remaster)" → "colors"
 *      "Blizzard Of Ozz (Expanded Edition)" → "blizzard of ozz"
 *      "The Great Misdirect Live" → "the great misdirect"
 * @param {string} title
 * @returns {string}
 */
function stripAlbumSuffix(title) {
    return title
        // Remove anything in parentheses at the end: (feat. X), (Expanded Edition), (Bonus Track Version), etc.
        .replace(/\s*\([^)]*\)\s*$/g, '')
        // Remove trailing " Live" (common live album suffix)
        .replace(/\s+Live$/i, '')
        // Normalize using existing helper
        .toLowerCase()
        .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
        .replace(/[\u201C\u201D\u201E\u201F\u2033\u2036]/g, '"')
        .replace(/[\u2010\u2011\u2012\u2013\u2014\u2015\uFE58\uFE63\uFF0D]/g, '-')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Reconcile orphan album children (no jellyfin_id) with Jellyfin-sourced siblings
 * using fuzzy title matching. Strips parenthetical suffixes (feat., edition, remix)
 * and matches base titles.
 *
 * This complements reconcileExternalMedia() (exact title match) by handling cases
 * like "Patient Number 9 (feat. Jeff Beck)" → "Patient Number 9".
 *
 * Existing dedup functions and their roles:
 * - reconcileExternalMedia(): exact title match orphan→Jellyfin children
 * - deduplicateParents(): by external ID (tmdb_id, musicbrainz_id, imdb_id)
 * - deduplicateChildren(): by season_number + item_number
 * - deduplicateParentsByTitle(): orphan parents → canonical parents by exact title
 * - mergeOrphanArtistsIntoAlbums(): orphan artist parents → album children
 * - deduplicateExternalAlbums(): orphan-to-orphan albums by normalized title
 *
 * This function fills the remaining gap: orphan albums → Jellyfin albums by fuzzy title.
 *
 * @returns {{ merged: number, historyMoved: number }}
 */
export function reconcileFuzzyAlbums() {
    // Find orphan album children (no jellyfin_id) under artist parents
    const orphans = /** @type {any[]} */ (db.prepare(`
        SELECT mc.id, mc.title, mc.parent_id, mc.play_count
        FROM media_children mc
        JOIN media_parents mp ON mc.parent_id = mp.id
        WHERE mp.media_type = 'artist'
        AND mc.jellyfin_id IS NULL
        ORDER BY mc.parent_id, mc.id
    `).all());

    if (orphans.length === 0) return { merged: 0, historyMoved: 0 };

    // Build a lookup of Jellyfin-sourced albums by parent_id + stripped base title
    const jellyfinAlbums = /** @type {any[]} */ (db.prepare(`
        SELECT mc.id, mc.title, mc.parent_id
        FROM media_children mc
        JOIN media_parents mp ON mc.parent_id = mp.id
        WHERE mp.media_type = 'artist'
        AND mc.jellyfin_id IS NOT NULL
    `).all());

    /** @type {Map<string, any>} */
    const jfByBaseTitle = new Map();
    for (const a of jellyfinAlbums) {
        const key = `${a.parent_id}::${stripAlbumSuffix(a.title)}`;
        if (!jfByBaseTitle.has(key)) jfByBaseTitle.set(key, a);
    }

    let merged = 0;
    let historyMoved = 0;

    const migrateHistory = db.prepare(
        'UPDATE playback_history SET media_id = ? WHERE media_id = ?'
    );
    const migrateTracks = db.prepare(
        'UPDATE OR IGNORE tracks SET album_id = ? WHERE album_id = ?'
    );
    const deleteTracks = db.prepare(
        'DELETE FROM tracks WHERE album_id = ?'
    );
    const deleteChild = db.prepare(
        'DELETE FROM media_children WHERE id = ?'
    );

    db.transaction(() => {
        for (const orphan of orphans) {
            const orphanBase = stripAlbumSuffix(orphan.title);
            // Skip very short base titles to avoid false matches (e.g. "X", "II")
            if (orphanBase.length < 3) continue;

            const key = `${orphan.parent_id}::${orphanBase}`;
            const jfMatch = jfByBaseTitle.get(key);

            if (!jfMatch || jfMatch.id === orphan.id) continue;

            // Also check reverse: maybe the Jellyfin title is the longer one
            // e.g. JF has "Blizzard of Ozz (Expanded Edition)", orphan has "Blizzard of Ozz"
            // The forward lookup already handles this since we strip both sides' titles

            // Migrate playback_history from orphan to Jellyfin entry
            const histResult = migrateHistory.run(jfMatch.id, orphan.id);
            historyMoved += histResult.changes;

            // Migrate tracks (if any)
            migrateTracks.run(jfMatch.id, orphan.id);
            deleteTracks.run(orphan.id); // clean up any that couldn't move due to UNIQUE

            // Delete the orphan album
            deleteChild.run(orphan.id);
            merged++;

            console.log(`[dedupe] Fuzzy-merged album "${orphan.title}" (${orphan.id}) → "${jfMatch.title}" (${jfMatch.id})`);
        }
    })();

    if (merged > 0) {
        console.log(`[dedupe] Fuzzy-merged ${merged} orphan albums into Jellyfin siblings, moved ${historyMoved} history entries`);
    }

    return { merged, historyMoved };
}

/**
 * Merge duplicate person rows — same name (case-insensitive) but separate IDs
 * (e.g. one from Jellyfin sync, another from TMDB enrichment).
 * Keeps the best entry (tmdb_person_id > jellyfin_id > most credits),
 * reassigns all references, merges metadata, deletes duplicates.
 * @returns {{ merged: number, creditsMoved: number }}
 */
export function mergePersonDuplicates() {
    // Find names that appear more than once (case-insensitive)
    const dupeGroups = /** @type {any[]} */ (db.prepare(`
        SELECT LOWER(name) as norm_name, GROUP_CONCAT(id) as ids, COUNT(*) as cnt
        FROM persons
        GROUP BY LOWER(name)
        HAVING cnt > 1
    `).all());

    if (dupeGroups.length === 0) return { merged: 0, creditsMoved: 0 };

    let merged = 0;
    let creditsMoved = 0;

    const countCredits = db.prepare('SELECT COUNT(*) as c FROM person_credits WHERE person_id = ?');

    db.transaction(() => {
        for (const group of dupeGroups) {
            const ids = group.ids.split(',').map(Number);

            // Fetch all person rows in this group
            const persons = /** @type {any[]} */ (db.prepare(
                `SELECT * FROM persons WHERE id IN (${ids.join(',')})`
            ).all());

            // Sort: prefer tmdb_person_id, then jellyfin_id, then most credits, then lowest id
            persons.sort((a, b) => {
                const aScore = (a.tmdb_person_id ? 100 : 0) + (a.jellyfin_id ? 50 : 0);
                const bScore = (b.tmdb_person_id ? 100 : 0) + (b.jellyfin_id ? 50 : 0);
                if (aScore !== bScore) return bScore - aScore;
                const aCreds = /** @type {any} */ (countCredits.get(a.id))?.c || 0;
                const bCreds = /** @type {any} */ (countCredits.get(b.id))?.c || 0;
                if (aCreds !== bCreds) return bCreds - aCreds;
                return a.id - b.id;
            });

            const keeper = persons[0];
            const dupes = persons.slice(1);

            for (const dupe of dupes) {
                // Merge metadata from duplicate into keeper (fill in blanks)
                const metaCols = ['tmdb_person_id', 'jellyfin_id', 'musicbrainz_artist_id',
                    'imdb_person_id', 'photo_url', 'bio', 'bio_tmdb', 'bio_jellyfin',
                    'birth_date', 'death_date', 'birth_place', 'wikipedia_summary',
                    'wikipedia_url'];
                for (const col of metaCols) {
                    if (dupe[col] && !keeper[col]) {
                        try {
                            db.prepare(`UPDATE persons SET ${col} = ? WHERE id = ?`).run(dupe[col], keeper.id);
                            keeper[col] = dupe[col];
                        } catch {
                            // UNIQUE constraint (e.g. tmdb_person_id) — skip
                        }
                    }
                }

                // Reassign person_credits (skip if exact credit already exists on keeper)
                const dupeCredits = /** @type {any[]} */ (db.prepare(
                    'SELECT * FROM person_credits WHERE person_id = ?'
                ).all(dupe.id));

                for (const credit of dupeCredits) {
                    try {
                        db.prepare(
                            'UPDATE person_credits SET person_id = ? WHERE id = ?'
                        ).run(keeper.id, credit.id);
                        creditsMoved++;
                    } catch {
                        // UNIQUE constraint — keeper already has this exact credit
                        db.prepare('DELETE FROM person_credits WHERE id = ?').run(credit.id);
                    }
                }

                // Reassign external_ids
                const dupeExtIds = /** @type {any[]} */ (db.prepare(
                    'SELECT * FROM external_ids WHERE person_id = ?'
                ).all(dupe.id));
                for (const ext of dupeExtIds) {
                    try {
                        db.prepare('UPDATE external_ids SET person_id = ? WHERE person_id = ? AND source = ?')
                            .run(keeper.id, dupe.id, ext.source);
                    } catch {
                        db.prepare('DELETE FROM external_ids WHERE person_id = ? AND source = ?')
                            .run(dupe.id, ext.source);
                    }
                }

                // Reassign person_discoveries (if table exists)
                try {
                    db.prepare('UPDATE person_discoveries SET person_id = ? WHERE person_id = ?')
                        .run(keeper.id, dupe.id);
                } catch {
                    // Table might not exist or UNIQUE constraint
                    try {
                        db.prepare('DELETE FROM person_discoveries WHERE person_id = ?').run(dupe.id);
                    } catch { /* table doesn't exist, fine */ }
                }

                // Delete the duplicate person row
                db.prepare('DELETE FROM persons WHERE id = ?').run(dupe.id);
                merged++;
            }
        }
    })();

    if (merged > 0) {
        console.log(`[dedupe] Merged ${merged} duplicate persons, moved ${creditsMoved} credits`);
    }

    return { merged, creditsMoved };
}
