import db from '$lib/server/db.js';
import { arrFetch } from '$lib/server/arr-client.js';
import { json } from '@sveltejs/kit';

/**
 * GET /api/arr/[service]/file-info?mediaParentId={id}
 * Returns the actual file quality details (resolution, codec, audio) from *arr.
 */
export async function GET({ params, url, locals }) {
    if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

    const service = params.service;
    if (!['radarr', 'sonarr', 'lidarr'].includes(service)) {
        return json({ error: 'Invalid service' }, { status: 400 });
    }

    const mediaParentId = parseInt(url.searchParams.get('mediaParentId') || '');
    if (!mediaParentId) return json({ error: 'mediaParentId required' }, { status: 400 });

    const settings = /** @type {any} */ (db.prepare(
        `SELECT ${service}_url as url, ${service}_api_key as apiKey FROM app_settings WHERE id = 1`
    ).get());

    if (!settings?.url || !settings?.apiKey) {
        return json({ error: `${service} not configured` }, { status: 400 });
    }

    const idColumn = service === 'radarr' ? 'radarr_id' : service === 'sonarr' ? 'sonarr_id' : 'lidarr_id';
    const media = /** @type {any} */ (db.prepare(
        `SELECT ${idColumn} as arr_id FROM media_parents WHERE id = ?`
    ).get(mediaParentId));

    if (!media?.arr_id) return json({ error: `Not in ${service}` }, { status: 400 });

    try {
        const endpoint = service === 'radarr' ? 'movie' : service === 'sonarr' ? 'series' : 'artist';
        const item = await arrFetch(settings.url, settings.apiKey, service, `${endpoint}/${media.arr_id}`);

        if (!item) return json({ error: 'Item not found' }, { status: 404 });

        // Radarr: movieFile, Sonarr: episodeFile (different pattern), Lidarr: trackFile
        const movieFile = item.movieFile || null;
        if (!movieFile) {
            return json({ hasFile: false });
        }

        const quality = movieFile.quality?.quality || {};
        const mediaInfo = movieFile.mediaInfo || {};

        return json({
            hasFile: true,
            qualityName: quality.name || null, // e.g. "Bluray-2160p"
            qualitySource: quality.source || null, // e.g. "bluray"
            qualityResolution: quality.resolution || null, // e.g. 2160
            videoCodec: mediaInfo.videoCodec || null, // e.g. "x265" or "HEVC"
            videoDynamicRange: mediaInfo.videoDynamicRange || null, // e.g. "HDR"
            videoDynamicRangeType: mediaInfo.videoDynamicRangeType || null, // e.g. "Dolby Vision"
            audioCodec: mediaInfo.audioCodec || null, // e.g. "TrueHD Atmos"
            audioChannels: mediaInfo.audioChannels || null, // e.g. 7.1
            audioLanguages: mediaInfo.audioLanguages || null, // e.g. "English"
            subtitles: mediaInfo.subtitles || null,
            filePath: movieFile.relativePath || movieFile.path || null,
            fileSize: movieFile.size || null,
            customFormats: (movieFile.customFormats || []).map((cf) => cf.name || cf),
            customFormatScore: movieFile.customFormatScore || 0,
        });
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return json({ error: msg }, { status: 500 });
    }
}
