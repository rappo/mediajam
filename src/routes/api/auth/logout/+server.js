import { redirect } from '@sveltejs/kit';
import { SESSION_COOKIE, COOKIE_OPTIONS } from '$lib/server/session.js';

/** @type {import('./$types').RequestHandler} */
export async function POST({ cookies }) {
    cookies.set(SESSION_COOKIE, '', { ...COOKIE_OPTIONS, maxAge: 0 });
    throw redirect(302, '/login');
}
