import { redirect } from '@sveltejs/kit';
import db from '$lib/server/db.js';

/** @type {import('@sveltejs/kit').Handle} */
export async function handle({ event, resolve }) {
    // Check if setup is complete
    const settings = db.prepare('SELECT setup_complete, theme FROM app_settings WHERE id = 1').get();
    const isSetupComplete = settings?.setup_complete === 1;
    const theme = settings?.theme || 'dark';

    // Store in locals for use in layouts
    event.locals.isSetupComplete = isSetupComplete;
    event.locals.theme = theme;

    // Redirect to setup if not complete (unless already on setup or API)
    if (!isSetupComplete && !event.url.pathname.startsWith('/setup') && !event.url.pathname.startsWith('/api')) {
        throw redirect(302, '/setup');
    }

    // Redirect away from setup if already complete
    if (isSetupComplete && event.url.pathname.startsWith('/setup')) {
        throw redirect(302, '/');
    }

    const response = await resolve(event, {
        transformPageChunk: ({ html }) => {
            return html.replace('data-theme="dark"', `data-theme="${theme}"`);
        }
    });

    return response;
}
