import { json } from '@sveltejs/kit';
import { getMonthCalendar } from '$lib/server/discovery-engine.js';

export async function GET({ url }) {
    const year = parseInt(url.searchParams.get('year') || String(new Date().getFullYear()), 10);
    const month = parseInt(url.searchParams.get('month') || String(new Date().getMonth() + 1), 10);
    const calendarTypes = (url.searchParams.get('calendarTypes') || 'movie,show,artist')
        .split(',')
        .filter(Boolean);

    const days = await getMonthCalendar(year, month, calendarTypes);

    return json({ days });
}
