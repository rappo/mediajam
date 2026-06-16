import db from './db.js';
import { broadcastActivity } from './arr-events.js';

/**
 * Log an activity event.
 * @param {{
 *   category: string,
 *   action: string,
 *   title: string,
 *   detail?: string | object,
 *   icon?: string,
 *   status?: 'info' | 'success' | 'warning' | 'error',
 *   actionable?: boolean,
 *   actionType?: string,
 *   actionData?: object
 * }} opts
 * @returns {number} inserted row id
 */
export function logActivity({ category, action, title, detail, icon, status = 'info', actionable = false, actionType, actionData }) {
    const stmt = db.prepare(`
        INSERT INTO activity_log (category, action, title, detail, icon, status, actionable, action_type, action_data)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const result = stmt.run(
        category,
        action,
        title,
        typeof detail === 'object' ? JSON.stringify(detail) : (detail ?? null),
        icon ?? null,
        status,
        actionable ? 1 : 0,
        actionType ?? null,
        actionData ? JSON.stringify(actionData) : null
    );

    // Auto-cleanup: keep last 500 rows
    db.prepare('DELETE FROM activity_log WHERE id NOT IN (SELECT id FROM activity_log ORDER BY id DESC LIMIT 500)').run();

    try {
        broadcastActivity({
            category,
            action,
            title,
            detail: typeof detail === 'object' ? JSON.stringify(detail) : detail,
            icon,
            status,
            created_at: new Date().toISOString()
        });
    } catch (e) {
        console.error('[activity-log] broadcast failed:', e);
    }

    return /** @type {number} */ (result.lastInsertRowid);
}

/**
 * Get recent activities.
 * @param {{ limit?: number, unreadOnly?: boolean }} opts
 */
export function getActivities({ limit = 50, unreadOnly = false } = {}) {
    const where = unreadOnly ? 'WHERE read = 0' : '';
    return db.prepare(`SELECT * FROM activity_log ${where} ORDER BY id DESC LIMIT ?`).all(limit);
}

/**
 * Get unread count.
 * @returns {number}
 */
export function getUnreadCount() {
    const row = /** @type {any} */ (db.prepare('SELECT COUNT(*) as c FROM activity_log WHERE read = 0').get());
    return row?.c || 0;
}

/**
 * Mark one or all activities as read.
 * @param {number | 'all'} id
 */
export function markRead(id) {
    if (id === 'all') {
        db.prepare('UPDATE activity_log SET read = 1 WHERE read = 0').run();
    } else {
        db.prepare('UPDATE activity_log SET read = 1 WHERE id = ?').run(id);
    }
}

/**
 * Delete all read activity entries.
 * @returns {number} number of deleted rows
 */
export function clearRead() {
    const result = db.prepare('DELETE FROM activity_log WHERE read = 1').run();
    return result.changes;
}

/**
 * Mark conflict-related activity entries as read.
 * @param {string} externalId — the MusicBrainz/TMDB/IMDb ID that was resolved
 */
export function markConflictsRead(externalId) {
    // Match by looking for the externalId in the detail JSON
    db.prepare(`UPDATE activity_log SET read = 1 WHERE action = 'conflict_detected' AND read = 0 AND detail LIKE ?`)
        .run(`%${externalId}%`);
}
