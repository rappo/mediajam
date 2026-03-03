import { redirect } from '@sveltejs/kit';

/** @type {import('./$types').PageServerLoad} */
export function load({ locals }) {
    if (locals.user) {
        throw redirect(302, '/');
    }
    return {};
}
