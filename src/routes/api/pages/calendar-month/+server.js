import { json } from '@sveltejs/kit';
import db from '$lib/server/db.js';
import { getMonthCalendar } from '$lib/server/discovery-engine.js';

export async function GET({ url, locals }) {
    const userId = locals.user.id;
    const userRow = /** @type {any} */ (db.prepare('SELECT preferences FROM users WHERE id = ?').get(userId));
    let timezone = 'UTC';
    try {
        const prefs = userRow?.preferences ? JSON.parse(userRow.preferences) : {};
        if (prefs.timezone) timezone = prefs.timezone;
    } catch { /* empty */ }

    const year = parseInt(url.searchParams.get('year') || String(new Date().getFullYear()), 10);
    const month = parseInt(url.searchParams.get('month') || String(new Date().getMonth() + 1), 10);

    // Build default calendar types from DB settings
    const calSettings = /** @type {any} */ (db.prepare(
        'SELECT calendar_show_movies, calendar_show_shows, calendar_show_music FROM app_settings WHERE id = 1'
    ).get());
    const defaultTypes = [];
    if (calSettings?.calendar_show_movies !== 0) defaultTypes.push('movie');
    if (calSettings?.calendar_show_shows !== 0) defaultTypes.push('show');
    if (calSettings?.calendar_show_music !== 0) defaultTypes.push('artist');

    const calendarTypes = url.searchParams.has('calendarTypes')
        ? url.searchParams.get('calendarTypes').split(',').filter(Boolean)
        : defaultTypes;

    const days = await getMonthCalendar(year, month, calendarTypes, timezone);

    return json({ days });
}
