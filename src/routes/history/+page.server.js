import db from '$lib/server/db.js';

export function load() {
    const settings = db.prepare('SELECT jellyfin_url FROM app_settings WHERE id = 1').get();
    const jellyfinUrl = /** @type {any} */ (settings)?.jellyfin_url || '';

    return {
        jellyfinUrl,
    };
}
