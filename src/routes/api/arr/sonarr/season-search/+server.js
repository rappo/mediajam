import db from '$lib/server/db.js';
import { arrFetch } from '$lib/server/arr-client.js';
import { json } from '@sveltejs/kit';

/**
 * POST /api/arr/sonarr/season-search — trigger a Sonarr search for missing episodes in a season.
 * 
 * If the entire season is missing, sends a SeasonSearch command.
 * If only some episodes are missing, sends an EpisodeSearch for each missing episode.
 * 
 * Body: { mediaParentId: number, seasonNumber: number }
 */
export async function POST({ request, locals }) {
    if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

    const { mediaParentId, seasonNumber } = await request.json();
    if (!mediaParentId || seasonNumber == null) {
        return json({ error: 'mediaParentId and seasonNumber required' }, { status: 400 });
    }

    const settings = /** @type {any} */ (db.prepare(
        'SELECT sonarr_url as url, sonarr_api_key as apiKey FROM app_settings WHERE id = 1'
    ).get());

    if (!settings?.url || !settings?.apiKey) {
        return json({ error: 'Sonarr not configured' }, { status: 400 });
    }

    const media = /** @type {any} */ (db.prepare(
        'SELECT sonarr_id as arr_id, title FROM media_parents WHERE id = ?'
    ).get(mediaParentId));

    if (!media?.arr_id) return json({ error: 'Not in Sonarr' }, { status: 400 });

    // Figure out which episodes are missing in our DB for this season
    const now = new Date().toISOString();
    const episodes = /** @type {any[]} */ (db.prepare(`
        SELECT item_number, is_collected, premiere_date
        FROM media_children
        WHERE parent_id = ? AND season_number = ?
        ORDER BY item_number
    `).all(mediaParentId, seasonNumber));

    const missingEps = episodes.filter(ep =>
        ep.is_collected === 0 && (!ep.premiere_date || ep.premiere_date <= now)
    );
    const collectedEps = episodes.filter(ep => ep.is_collected === 1);
    const isEntireSeasonMissing = collectedEps.length === 0 && missingEps.length > 0;

    if (missingEps.length === 0) {
        return json({ error: 'No missing episodes in this season' }, { status: 400 });
    }

    try {
        if (isEntireSeasonMissing) {
            // Full season search
            await arrFetch(settings.url, settings.apiKey, 'sonarr', 'command', {
                method: 'POST',
                body: JSON.stringify({
                    name: 'SeasonSearch',
                    seriesId: media.arr_id,
                    seasonNumber,
                }),
            });

            return json({
                success: true,
                type: 'season',
                seasonNumber,
                missingCount: missingEps.length,
            });
        } else {
            // Partial season — search individual missing episodes
            // First get Sonarr's episode list for this season
            const sonarrEpisodes = await arrFetch(settings.url, settings.apiKey, 'sonarr',
                `episode?seriesId=${media.arr_id}&seasonNumber=${seasonNumber}`,
                { signal: AbortSignal.timeout(15000) });

            const sonarrEpList = Array.isArray(sonarrEpisodes) ? sonarrEpisodes : [];
            const missingEpNumbers = new Set(missingEps.map(ep => ep.item_number));

            // Find matching Sonarr episode IDs
            const sonarrEpIds = sonarrEpList
                .filter((/** @type {any} */ e) => missingEpNumbers.has(e.episodeNumber))
                .map((/** @type {any} */ e) => e.id);

            if (sonarrEpIds.length === 0) {
                return json({ error: 'Missing episodes not found in Sonarr' }, { status: 404 });
            }

            // Trigger EpisodeSearch for all missing episodes at once
            await arrFetch(settings.url, settings.apiKey, 'sonarr', 'command', {
                method: 'POST',
                body: JSON.stringify({
                    name: 'EpisodeSearch',
                    episodeIds: sonarrEpIds,
                }),
            });

            return json({
                success: true,
                type: 'episodes',
                seasonNumber,
                missingCount: sonarrEpIds.length,
            });
        }
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return json({ error: msg }, { status: 500 });
    }
}
