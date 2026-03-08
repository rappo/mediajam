import db from '$lib/server/db.js';
import { arrFetch } from '$lib/server/arr-client.js';
import { logActivity } from '$lib/server/activity-log.js';
import { json } from '@sveltejs/kit';

/**
 * POST /api/arr/[service]/add — Add media to an *arr service.
 * Body: { mediaParentId: number, qualityProfileId?: number, rootFolderPath?: string }
 */
export async function POST({ params, request, locals }) {
    if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

    const service = params.service;
    if (!['radarr', 'sonarr', 'lidarr'].includes(service)) {
        return json({ error: 'Invalid service' }, { status: 400 });
    }

    const body = await request.json();
    const { mediaParentId, qualityProfileId, rootFolderPath, monitorLevel } = body;

    if (!mediaParentId) return json({ error: 'mediaParentId required' }, { status: 400 });

    // Get settings
    const settings = /** @type {any} */ (db.prepare(
        `SELECT ${service}_url as url, ${service}_api_key as apiKey,
                ${service}_quality_profile_id as defaultQualityProfileId,
                ${service}_root_folder as defaultRootFolder
         FROM app_settings WHERE id = 1`
    ).get());

    if (!settings?.url || !settings?.apiKey) {
        return json({ error: `${service} not configured` }, { status: 400 });
    }

    // Get the media parent to find external IDs
    const media = /** @type {any} */ (db.prepare(
        'SELECT id, title, tmdb_id, imdb_id, tvdb_id, musicbrainz_id, media_type FROM media_parents WHERE id = ?'
    ).get(mediaParentId));

    if (!media) return json({ error: 'Media not found' }, { status: 404 });

    // Build the add request body based on service
    let profileId = qualityProfileId || settings.defaultQualityProfileId;
    const folder = rootFolderPath || settings.defaultRootFolder;

    // Auto-fetch quality profile if none configured
    if (!profileId) {
        try {
            const profiles = await arrFetch(settings.url, settings.apiKey, service, 'qualityprofile');
            profileId = profiles[0]?.id;
        } catch { /* fall through to error */ }
    }
    if (!profileId) return json({ error: 'Quality profile required — no profiles found in ' + service }, { status: 400 });

    let addBody;
    let endpoint;

    try {
        if (service === 'radarr') {
            if (!media.tmdb_id) return json({ error: 'No TMDB ID — cannot add to Radarr' }, { status: 400 });

            // If no root folder set, fetch the first one from Radarr
            let root = folder;
            if (!root) {
                const rootFolders = await arrFetch(settings.url, settings.apiKey, service, 'rootfolder');
                root = rootFolders[0]?.path;
            }

            addBody = {
                tmdbId: parseInt(media.tmdb_id),
                qualityProfileId: profileId,
                rootFolderPath: root,
                monitored: true,
                addOptions: { searchForMovie: true, monitor: monitorLevel || 'movieOnly' },
            };
            endpoint = 'movie';
        } else if (service === 'sonarr') {
            if (!media.tvdb_id) return json({ error: 'No TVDB ID — cannot add to Sonarr' }, { status: 400 });

            let root = folder;
            if (!root) {
                const rootFolders = await arrFetch(settings.url, settings.apiKey, service, 'rootfolder');
                root = rootFolders[0]?.path;
            }

            addBody = {
                tvdbId: parseInt(media.tvdb_id),
                qualityProfileId: profileId,
                rootFolderPath: root,
                monitored: true,
                addOptions: { monitor: monitorLevel || 'all', searchForMissingEpisodes: true, searchForCutoffUnmetEpisodes: false },
            };
            endpoint = 'series';
        } else if (service === 'lidarr') {
            if (!media.musicbrainz_id) return json({ error: 'No MusicBrainz ID — cannot add to Lidarr' }, { status: 400 });

            let root = folder;
            if (!root) {
                const rootFolders = await arrFetch(settings.url, settings.apiKey, service, 'rootfolder');
                root = rootFolders[0]?.path;
            }

            // Get default metadata profile if not specified
            const metaSettings = /** @type {any} */ (db.prepare(
                'SELECT lidarr_metadata_profile_id FROM app_settings WHERE id = 1'
            ).get());
            let metadataProfileId = metaSettings?.lidarr_metadata_profile_id;
            if (!metadataProfileId) {
                try {
                    const profiles = await arrFetch(settings.url, settings.apiKey, service, 'metadataprofile');
                    metadataProfileId = profiles[0]?.id || 1;
                } catch { metadataProfileId = 1; }
            }

            addBody = {
                foreignArtistId: media.musicbrainz_id,
                artistName: media.title,
                qualityProfileId: profileId,
                metadataProfileId,
                rootFolderPath: root,
                monitored: true,
                addOptions: { monitor: monitorLevel || 'all', searchForMissingAlbums: true },
            };
            endpoint = 'artist';
        }

        const result = await arrFetch(settings.url, settings.apiKey, service, /** @type {string} */(endpoint), {
            method: 'POST',
            body: JSON.stringify(addBody),
        });

        // Update local DB with the new *arr ID, slug, and quality profile
        const idColumn = service === 'radarr' ? 'radarr_id' : service === 'sonarr' ? 'sonarr_id' : 'lidarr_id';
        const slug = result.titleSlug || result.sortName || '';
        const qpName = result.qualityProfile?.name || '';
        db.prepare(`UPDATE media_parents SET ${idColumn} = ?, arr_monitored = 1, arr_slug = ?, arr_quality_profile = ? WHERE id = ?`)
            .run(result.id, slug, qpName || null, mediaParentId);

        logActivity({ category: 'arr', action: 'arr_item_added', title: `Added "${media.title}" to ${service}`, detail: qpName ? `Quality: ${qpName}` : undefined, icon: '📥', status: 'success' });
        return json({ success: true, arrId: result.id, title: result.title || media.title });
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`[arr] Failed to add to ${service}:`, msg);
        logActivity({ category: 'arr', action: 'arr_item_failed', title: `Failed to add "${media.title}" to ${service}`, detail: msg, icon: '❌', status: 'error' });
        return json({ error: msg }, { status: 500 });
    }
}
