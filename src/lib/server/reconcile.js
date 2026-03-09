import db from '$lib/server/db.js';

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

    db.transaction(() => {
        for (const dup of duplicates) {
            // Move all playback_history refs from orphan to jellyfin entry
            const result = migrateHistory.run(dup.jellyfin_child_id, dup.orphan_id);
            merged += result.changes;

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
                        db.prepare(`UPDATE media_parents SET ${col} = ? WHERE id = ?`).run(orphanParent[col], keep_id);
                        keepParent[col] = orphanParent[col]; // update local ref
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
 * Deduplicate playback_history entries caused by pause/resume re-scrobbles.
 * When the same track (same media_id + track_name) is played back-to-back
 * within `windowMinutes`, keeps the earliest entry and removes the rest.
 * @param {number} [windowMinutes=30] - max gap (in minutes) between plays to consider a duplicate
 * @returns {{ removed: number }}
 */
export function deduplicatePlaybackHistory(windowMinutes = 30) {
    // Find consecutive plays of the same track within the window
    const dupes = /** @type {any[]} */ (db.prepare(`
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

    if (dupes.length === 0) return { removed: 0 };

    const deleteStmt = db.prepare('DELETE FROM playback_history WHERE id = ?');
    let removed = 0;

    db.transaction(() => {
        for (const dup of dupes) {
            deleteStmt.run(dup.id);
            removed++;
        }
    })();

    if (removed > 0) {
        console.log(`[dedupe] Removed ${removed} pause/resume duplicate plays (window: ${windowMinutes}min)`);
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
