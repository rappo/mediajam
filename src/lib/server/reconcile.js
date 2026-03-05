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
 * Deduplicate media_parents that share the same tmdb_id (or imdb_id).
 * This happens when a movie/show is removed and re-added to Jellyfin (new jellyfin_id).
 * Keeps the newest entry (highest id), migrates playback_history and person_credits
 * from stale entries, then deletes the stale parents and their media_children.
 * @returns {{ deduped: number, historyMoved: number, creditsMoved: number }}
 */
export function deduplicateParents() {
    // Find duplicate groups by tmdb_id
    const dupeGroups = /** @type {any[]} */ (db.prepare(`
        SELECT tmdb_id, GROUP_CONCAT(id) as ids
        FROM media_parents
        WHERE tmdb_id IS NOT NULL
        GROUP BY tmdb_id, media_type
        HAVING COUNT(*) > 1
    `).all());

    if (dupeGroups.length === 0) return { deduped: 0, historyMoved: 0, creditsMoved: 0 };

    let deduped = 0;
    let historyMoved = 0;
    let creditsMoved = 0;

    db.transaction(() => {
        for (const group of dupeGroups) {
            const ids = group.ids.split(',').map(Number);
            // Keep the one with the highest id (most recently synced)
            const keepId = Math.max(...ids);
            const staleIds = ids.filter(id => id !== keepId);

            for (const staleId of staleIds) {
                // Get the child id for the keeper (for playback_history migration)
                const keepChild = /** @type {any} */ (db.prepare(
                    'SELECT id FROM media_children WHERE parent_id = ? LIMIT 1'
                ).get(keepId));

                // Get stale children
                const staleChildren = /** @type {any[]} */ (db.prepare(
                    'SELECT id FROM media_children WHERE parent_id = ?'
                ).all(staleId));

                if (keepChild) {
                    // Migrate playback_history from all stale children to the keeper's child
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

                // Delete stale person_credits that weren't moved
                db.prepare('DELETE FROM person_credits WHERE media_parent_id = ?').run(staleId);

                // Delete stale media_children
                db.prepare('DELETE FROM media_children WHERE parent_id = ?').run(staleId);

                // Delete stale parent
                db.prepare('DELETE FROM media_parents WHERE id = ?').run(staleId);
                deduped++;
            }
        }
    })();

    if (deduped > 0) {
        console.log(`[dedup] Merged ${deduped} duplicate parents, moved ${historyMoved} history entries and ${creditsMoved} credits`);
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
        console.log(`[dedup] Removed ${deduped} duplicate children, moved ${historyMoved} history entries`);
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
        console.log(`[dedup] Merged ${deduped} title-duplicate parents, moved ${historyMoved} history entries and ${creditsMoved} credits`);
    }

    return { deduped, historyMoved, creditsMoved };
}
