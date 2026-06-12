import { redirect } from '@sveltejs/kit';

/** @type {import('./$types').PageServerLoad} */
export function load({ locals }) {
    if (!locals.isSetupComplete) return {};
    // Dashboard page loads data client-side
    return {};
}
