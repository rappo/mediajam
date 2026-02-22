import db from '$lib/server/db.js';

/** @type {import('./$types').PageServerLoad} */
export function load({ locals }) {
    if (!locals.isSetupComplete) return {};

    const showCount = db.prepare('SELECT COUNT(*) as c FROM media_parents WHERE media_type = ?').get('show').c;
    const movieCount = db.prepare('SELECT COUNT(*) as c FROM media_parents WHERE media_type = ?').get('movie').c;
    const artistCount = db.prepare('SELECT COUNT(*) as c FROM media_parents WHERE media_type = ?').get('artist').c;
    const episodeCount = db.prepare(`SELECT COUNT(*) as c FROM media_children mc JOIN media_parents mp ON mc.parent_id = mp.id WHERE mp.media_type = 'show'`).get().c;
    const albumCount = db.prepare(`SELECT COUNT(*) as c FROM media_children mc JOIN media_parents mp ON mc.parent_id = mp.id WHERE mp.media_type = 'artist'`).get().c;

    const watchedEps = db.prepare(`SELECT COUNT(*) as c FROM media_children mc JOIN media_parents mp ON mc.parent_id = mp.id WHERE mp.media_type = 'show' AND mc.watch_status = 'watched'`).get().c;
    const watchedMovies = db.prepare(`SELECT COUNT(*) as c FROM media_children mc JOIN media_parents mp ON mc.parent_id = mp.id WHERE mp.media_type = 'movie' AND mc.watch_status = 'watched'`).get().c;

    const totalRuntime = db.prepare(`SELECT SUM(runtime_ticks) as t FROM media_children`).get().t || 0;
    const runtimeHours = Math.round(totalRuntime / 10000000 / 3600);

    const syncState = db.prepare('SELECT last_sync_timestamp FROM sync_state WHERE id = 1').get();

    return {
        showCount,
        movieCount,
        artistCount,
        episodeCount,
        albumCount,
        watchedEps,
        watchedMovies,
        runtimeHours,
        lastSync: syncState?.last_sync_timestamp || null
    };
}
