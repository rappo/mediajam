import { json } from '@sveltejs/kit';
import { getActivities, getUnreadCount, markRead, clearRead } from '$lib/server/activity-log.js';

/**
 * GET /api/activity
 * Returns recent activities and unread count.
 * Query params: ?limit=50&unreadOnly=false
 */
export async function GET({ url }) {
    const limit = parseInt(url.searchParams.get('limit') || '50');
    const unreadOnly = url.searchParams.get('unreadOnly') === 'true';
    const activities = getActivities({ limit, unreadOnly });
    const unreadCount = getUnreadCount();
    return json({ activities, unreadCount });
}

/**
 * PUT /api/activity
 * Mark activity as read.
 * Body: { id: number | 'all' }
 */
export async function PUT({ request }) {
    const { id } = await request.json();
    if (id === undefined) {
        return json({ error: 'id required' }, { status: 400 });
    }
    markRead(id);
    const unreadCount = getUnreadCount();
    return json({ success: true, unreadCount });
}

/**
 * DELETE /api/activity
 * Remove all read entries from the activity log.
 */
export async function DELETE() {
    const deleted = clearRead();
    const activities = getActivities();
    const unreadCount = getUnreadCount();
    return json({ success: true, deleted, activities, unreadCount });
}
