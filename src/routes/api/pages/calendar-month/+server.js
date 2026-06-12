import { json } from '@sveltejs/kit';
import db from '$lib/server/db.js';
import { getMonthCalendar } from '$lib/server/discovery-engine.js';

export async function GET({ url }) {
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

    const days = await getMonthCalendar(year, month, calendarTypes);

    return json({ days });
}
