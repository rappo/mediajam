import db from '$lib/server/db.js';
import { arrFetch } from '$lib/server/arr-client.js';
import { json } from '@sveltejs/kit';
import { logActivity } from '$lib/server/activity-log.js';

/**
 * GET /api/arr/[service]/releases?mediaParentId={id}&episodeId={id}
 * Interactive search — queries indexers via *arr and returns release results.
 * For Sonarr, if episodeId is provided, searches for that specific episode.
 * This can take 30s–3min+, so the timeout is generous.
 */
export async function GET({ params, url, locals }) {
    if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

    const service = params.service;
    if (!['radarr', 'sonarr', 'lidarr'].includes(service)) {
        return json({ error: 'Invalid service' }, { status: 400 });
    }

    const mediaParentId = parseInt(url.searchParams.get('mediaParentId') || '');
    if (!mediaParentId) return json({ error: 'mediaParentId required' }, { status: 400 });
    const episodeId = url.searchParams.get('episodeId') ? parseInt(url.searchParams.get('episodeId') || '') : null;

    const settings = /** @type {any} */ (db.prepare(
        `SELECT ${service}_url as url, ${service}_api_key as apiKey FROM app_settings WHERE id = 1`
    ).get());

    if (!settings?.url || !settings?.apiKey) {
        return json({ error: `${service} not configured` }, { status: 400 });
    }

    const idColumn = service === 'radarr' ? 'radarr_id' : service === 'sonarr' ? 'sonarr_id' : 'lidarr_id';
    const media = /** @type {any} */ (db.prepare(
        `SELECT ${idColumn} as arr_id, title FROM media_parents WHERE id = ?`
    ).get(mediaParentId));

    if (!media?.arr_id) return json({ error: `Not in ${service}` }, { status: 400 });

    const idParam = service === 'radarr' ? 'movieId' : service === 'sonarr' ? 'seriesId' : 'artistId';

    try {
        // For Sonarr episode-level search, look up the Sonarr episode ID
        let releaseQuery = `release?${idParam}=${media.arr_id}`;
        if (service === 'sonarr' && episodeId) {
            const episode = /** @type {any} */ (db.prepare(
                'SELECT season_number, item_number FROM media_children WHERE id = ? AND parent_id = ?'
            ).get(episodeId, mediaParentId));
            if (episode) {
                // Look up Sonarr episode ID
                const sonarrEpisodes = await arrFetch(settings.url, settings.apiKey, service,
                    `episode?seriesId=${media.arr_id}&seasonNumber=${episode.season_number}`,
                    { signal: AbortSignal.timeout(15000) });
                const sonarrEp = (Array.isArray(sonarrEpisodes) ? sonarrEpisodes : []).find(
                    (/** @type {any} */ e) => e.episodeNumber === episode.item_number
                );
                if (sonarrEp) {
                    releaseQuery = `release?episodeId=${sonarrEp.id}`;
                }
            }
        }

        const releases = await arrFetch(settings.url, settings.apiKey, service, releaseQuery, {
            signal: AbortSignal.timeout(180000), // 3 minutes — indexer queries are slow
        });

        // Normalize the release data for the frontend
        const results = (Array.isArray(releases) ? releases : []).map((r) => ({
            guid: r.guid,
            indexerId: r.indexerId,
            title: r.title,
            indexer: r.indexer,
            size: r.size,
            age: r.ageMinutes != null ? Math.floor(r.ageMinutes / 1440) : (r.age || 0),
            seeders: r.seeders,
            leechers: r.leechers,
            quality: r.quality?.quality?.name || 'Unknown',
            qualityWeight: r.quality?.quality?.id || 0,
            customFormatScore: r.customFormatScore || 0,
            rejected: r.rejected || false,
            rejections: r.rejections || [],
            protocol: r.protocol, // 'usenet' or 'torrent'
            infoUrl: r.infoUrl,
            languages: (r.languages || []).map((l) => l.name || l),
            customFormats: (r.customFormats || []).map((cf) => cf.name || cf),
        }));

        return json({ success: true, releases: results, title: media.title });
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        const isTimeout = msg.includes('abort') || msg.includes('timeout') || msg.includes('TimeoutError');

        if (isTimeout) {
            logActivity({
                category: 'arr',
                action: 'interactive_search_timeout',
                title: `Interactive search timed out for "${media.title}"`,
                detail: `${service} indexer query exceeded 3 minutes. You can retry with a longer timeout.`,
                icon: '⏱️',
                status: 'warning',
                actionable: true,
                actionType: 'navigate',
                actionData: { href: `/movies/${mediaParentId}` },
            });
        }

        return json({ error: isTimeout ? 'Search timed out — indexers took too long. Check Activity Log.' : msg, timeout: isTimeout }, { status: isTimeout ? 504 : 500 });
    }
}

/**
 * POST /api/arr/[service]/releases — queue a download from interactive search results.
 * Body: { guid, indexerId, mediaParentId }
 */
export async function POST({ params, request, locals }) {
    if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

    const service = params.service;
    if (!['radarr', 'sonarr', 'lidarr'].includes(service)) {
        return json({ error: 'Invalid service' }, { status: 400 });
    }

    const { guid, indexerId, mediaParentId } = await request.json();
    if (!guid || indexerId == null) return json({ error: 'guid and indexerId required' }, { status: 400 });

    const settings = /** @type {any} */ (db.prepare(
        `SELECT ${service}_url as url, ${service}_api_key as apiKey FROM app_settings WHERE id = 1`
    ).get());

    if (!settings?.url || !settings?.apiKey) {
        return json({ error: `${service} not configured` }, { status: 400 });
    }

    try {
        await arrFetch(settings.url, settings.apiKey, service, 'release', {
            method: 'POST',
            body: JSON.stringify({ guid, indexerId }),
            signal: AbortSignal.timeout(30000),
        });

        // Log the download
        const media = /** @type {any} */ (db.prepare('SELECT title FROM media_parents WHERE id = ?').get(mediaParentId));
        logActivity({
            category: 'arr',
            action: 'download_queued',
            title: `Download queued: ${media?.title || 'Unknown'}`,
            detail: `Sent to ${service} via interactive search`,
            icon: '📥',
            status: 'success',
        });

        return json({ success: true });
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return json({ error: msg }, { status: 500 });
    }
}
