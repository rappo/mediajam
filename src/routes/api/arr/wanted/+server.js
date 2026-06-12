import db from '$lib/server/db.js';
import { json } from '@sveltejs/kit';

// ── In-memory cache (stale-while-revalidate) ─────────────────────────
const CACHE_TTL = 2 * 60 * 1000;   // 2 min — serve fresh
const cache = { data: null, ts: 0, refreshing: false, cutoff: false };

/** Kick off a background refresh (non-blocking). */
function backgroundRefresh(includeCutoff) {
    if (cache.refreshing) return;
    cache.refreshing = true;
    fetchWantedData(includeCutoff)
        .then(result => {
            cache.data = result;
            cache.ts = Date.now();
            cache.cutoff = includeCutoff;
        })
        .catch(e => console.error('[wanted] background refresh failed:', e))
        .finally(() => { cache.refreshing = false; });
}

/**
 * GET /api/arr/wanted — Fetch all missing/wanted items from configured *arr services.
 * Query params:
 *   - includeCutoff=1 — include cutoff-unmet items
 *   - refresh=1 — force a fresh fetch (still returns cache if available)
 */
export async function GET({ url, locals }) {
    if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

    const includeCutoff = url.searchParams.get('includeCutoff') === '1';
    const forceRefresh = url.searchParams.get('refresh') === '1';
    const stale = Date.now() - cache.ts > CACHE_TTL;
    const cutoffChanged = cache.cutoff !== includeCutoff;

    // If we have cached data and it's fresh, return it
    if (cache.data && !stale && !cutoffChanged && !forceRefresh) {
        return json({ ...cache.data, cached: true });
    }

    // If we have cached data but it's stale, return it AND refresh in background
    if (cache.data && !cutoffChanged && !forceRefresh) {
        backgroundRefresh(includeCutoff);
        return json({ ...cache.data, cached: true, refreshing: true });
    }

    // No cache or cutoff changed or forced — do a blocking fetch
    const result = await fetchWantedData(includeCutoff);
    cache.data = result;
    cache.ts = Date.now();
    cache.cutoff = includeCutoff;
    return json(result);
}

/** Core data-fetching logic, extracted for caching. */
async function fetchWantedData(includeCutoff) {
    const now = new Date();

    const settings = /** @type {any} */ (db.prepare(
        `SELECT sonarr_url, sonarr_api_key, sonarr_external_url,
                radarr_url, radarr_api_key, radarr_external_url,
                lidarr_url, lidarr_api_key, lidarr_external_url
         FROM app_settings WHERE id = 1`
    ).get());

    console.log('[wanted] settings:', {
        sonarr: settings?.sonarr_url ? `${settings.sonarr_url} / ext: ${settings.sonarr_external_url || 'none'}` : 'not configured',
        radarr: settings?.radarr_url ? `${settings.radarr_url} / ext: ${settings.radarr_external_url || 'none'}` : 'not configured',
        lidarr: settings?.lidarr_url ? `${settings.lidarr_url} / ext: ${settings.lidarr_external_url || 'none'}` : 'not configured',
    });

    // Build local slug+poster lookup maps for linking back to MediaJam
    const localByArr = { sonarr: new Map(), radarr: new Map(), lidarr: new Map() };
    try {
        /** @type {any[]} */ (db.prepare(
            `SELECT id, slug, poster_url, sonarr_id, radarr_id, lidarr_id, title, media_type FROM media_parents
             WHERE sonarr_id IS NOT NULL OR radarr_id IS NOT NULL OR lidarr_id IS NOT NULL`
        ).all()).forEach(r => {
            if (r.sonarr_id) localByArr.sonarr.set(r.sonarr_id, r);
            if (r.radarr_id) localByArr.radarr.set(r.radarr_id, r);
            if (r.lidarr_id) localByArr.lidarr.set(r.lidarr_id, r);
        });
    } catch { /* optional */ }

    /** @type {any[]} */
    const items = [];
    const now = new Date();

    // Helper: safe arr fetch with fallback to external URL (same pattern as arrCalendarFetch)
    const safeFetch = async (primaryUrl, externalUrl, apiKey, service, path) => {
        const candidates = [primaryUrl, externalUrl].filter(Boolean);
        if (candidates.length === 0 || !apiKey) return null;
        try {
            const config = { sonarr: 'v3', radarr: 'v3', lidarr: 'v1' };
            const apiVersion = config[service] || 'v3';
            return await Promise.any(candidates.map(async (baseUrl) => {
                const url = `${baseUrl.replace(/\/+$/, '')}/api/${apiVersion}/${path}`;
                const res = await fetch(url, {
                    headers: { 'X-Api-Key': apiKey },
                    signal: AbortSignal.timeout(15000),
                });
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                return res.json();
            }));
        } catch (e) {
            console.error(`[wanted] ${service} ${path} failed:`, e.message || e);
            return null;
        }
    };

    // Helper: fetch all pages from a paginated *arr endpoint
    const fetchAllPages = async (primaryUrl, externalUrl, apiKey, service, basePath, maxPages = 10) => {
        const allRecords = [];
        for (let page = 1; page <= maxPages; page++) {
            const sep = basePath.includes('?') ? '&' : '?';
            const data = await safeFetch(primaryUrl, externalUrl, apiKey, service, `${basePath}${sep}page=${page}&pageSize=100`);
            if (!data?.records) break;
            allRecords.push(...data.records);
            if (page >= data.totalRecords / 100) break;
        }
        return allRecords;
    };

    // ──────────────────────────────────────────────────────
    // SONARR
    // ──────────────────────────────────────────────────────
    if (settings?.sonarr_api_key && (settings?.sonarr_url || settings?.sonarr_external_url)) {
        const sUrl = settings.sonarr_url, sExt = settings.sonarr_external_url, sKey = settings.sonarr_api_key;
        const [missing, queue, failedHistory, cutoff] = await Promise.all([
            fetchAllPages(sUrl, sExt, sKey, 'sonarr',
                'wanted/missing?sortKey=airDateUtc&sortDirection=descending&includeSeries=true'),
            safeFetch(sUrl, sExt, sKey, 'sonarr',
                'queue?page=1&pageSize=200&includeSeries=true&includeEpisode=true'),
            safeFetch(sUrl, sExt, sKey, 'sonarr',
                'history?page=1&pageSize=200&sortKey=date&sortDirection=descending&eventType=4'),
            includeCutoff
                ? fetchAllPages(sUrl, sExt, sKey, 'sonarr',
                    'wanted/cutoff?sortKey=airDateUtc&sortDirection=descending&includeSeries=true')
                : Promise.resolve([]),
        ]);

        // Build lookup sets
        const queueEpisodeIds = new Set();
        const queueByEpisode = new Map();
        for (const q of (queue?.records || [])) {
            if (q.episodeId) {
                queueEpisodeIds.add(q.episodeId);
                queueByEpisode.set(q.episodeId, q);
            }
        }
        const failedEpisodeIds = new Set();
        const failedByEpisode = new Map();
        for (const h of (failedHistory?.records || [])) {
            if (h.episodeId) {
                failedEpisodeIds.add(h.episodeId);
                failedByEpisode.set(h.episodeId, h);
            }
        }

        // Group missing episodes by series
        const seriesMap = new Map();
        for (const ep of (missing || [])) {
            const seriesId = ep.seriesId;
            if (!seriesMap.has(seriesId)) {
                const series = ep.series || {};
                const local = localByArr.sonarr.get(seriesId);
                seriesMap.set(seriesId, {
                    service: 'sonarr',
                    type: 'show',
                    title: series.title || 'Unknown',
                    year: series.year,
                    arrId: seriesId,
                    mediaParentId: local?.id || null,
                    slug: local?.slug || null,
                    poster_url: local?.poster_url || (series.images?.find(i => i.coverType === 'poster')?.remoteUrl) || null,
                    arrStatus: series.status,
                    episodes: [],
                    queueItems: [],
                    failedItems: [],
                });
            }
            const entry = seriesMap.get(seriesId);
            const airDate = ep.airDateUtc ? new Date(ep.airDateUtc) : null;
            const epInfo = {
                episodeId: ep.id,
                label: `S${String(ep.seasonNumber).padStart(2, '0')}E${String(ep.episodeNumber).padStart(2, '0')}`,
                title: ep.title || 'TBA',
                airDate: ep.airDateUtc,
                isAired: airDate ? airDate < now : false,
            };
            if (queueEpisodeIds.has(ep.id)) {
                const q = queueByEpisode.get(ep.id);
                epInfo.queue = {
                    status: q.status,
                    progress: q.size > 0 ? Math.round(((q.size - q.sizeleft) / q.size) * 100) : 0,
                    timeleft: q.timeleft,
                    downloadClient: q.downloadClient,
                    trackedStatus: q.trackedDownloadStatus,
                    statusMessages: q.statusMessages,
                };
            }
            if (failedEpisodeIds.has(ep.id)) {
                const f = failedByEpisode.get(ep.id);
                epInfo.failure = {
                    date: f.date,
                    message: f.data?.message || 'Download failed',
                };
            }
            entry.episodes.push(epInfo);
        }

        // Classify each series
        for (const [, entry] of seriesMap) {
            const inQueue = entry.episodes.some(e => e.queue);
            const hasFailed = entry.episodes.some(e => e.failure);
            const allUnaired = entry.episodes.every(e => !e.isAired);
            const someUnaired = entry.episodes.some(e => !e.isAired);

            if (inQueue) {
                entry.reason = 'in_queue';
                entry.reasonLabel = 'Downloading';
            } else if (allUnaired) {
                entry.reason = 'not_out_yet';
                entry.reasonLabel = 'Unreleased';
            } else if (hasFailed) {
                entry.reason = 'failed';
                entry.reasonLabel = 'Failed';
            } else {
                entry.reason = 'not_available';
                entry.reasonLabel = 'Missing';
            }

            entry.missingCount = entry.episodes.length;
            entry.unairedCount = entry.episodes.filter(e => !e.isAired).length;
            items.push(entry);
        }

        // Cutoff unmet
        if (includeCutoff && cutoff?.length) {
            const cutoffSeriesMap = new Map();
            for (const ep of cutoff) {
                const seriesId = ep.seriesId;
                if (!cutoffSeriesMap.has(seriesId)) {
                    const series = ep.series || {};
                    const local = localByArr.sonarr.get(seriesId);
                    cutoffSeriesMap.set(seriesId, {
                        service: 'sonarr', type: 'show',
                        title: series.title || 'Unknown', year: series.year,
                        arrId: seriesId, mediaParentId: local?.id || null,
                        slug: local?.slug || null,
                        poster_url: local?.poster_url || null,
                        reason: 'cutoff_unmet', reasonLabel: 'Upgrade',
                        episodes: [], missingCount: 0,
                    });
                }
                cutoffSeriesMap.get(seriesId).episodes.push({
                    label: `S${String(ep.seasonNumber).padStart(2, '0')}E${String(ep.episodeNumber).padStart(2, '0')}`,
                    title: ep.title || 'TBA',
                });
                cutoffSeriesMap.get(seriesId).missingCount++;
            }
            for (const [, entry] of cutoffSeriesMap) items.push(entry);
        }
    }

    // ──────────────────────────────────────────────────────
    // RADARR
    // ──────────────────────────────────────────────────────
    if (settings?.radarr_api_key && (settings?.radarr_url || settings?.radarr_external_url)) {
        const rUrl = settings.radarr_url, rExt = settings.radarr_external_url, rKey = settings.radarr_api_key;
        const [allMovies, queue, failedHistory, cutoff] = await Promise.all([
            safeFetch(rUrl, rExt, rKey, 'radarr', 'movie'),
            safeFetch(rUrl, rExt, rKey, 'radarr',
                'queue?page=1&pageSize=200&includeMovie=true'),
            safeFetch(rUrl, rExt, rKey, 'radarr',
                'history?page=1&pageSize=200&sortKey=date&sortDirection=descending&eventType=4'),
            includeCutoff
                ? fetchAllPages(rUrl, rExt, rKey, 'radarr',
                    'wanted/cutoff?sortKey=digitalRelease&sortDirection=descending')
                : Promise.resolve([]),
        ]);

        // Build lookups
        const queueMovieIds = new Set();
        const queueByMovie = new Map();
        for (const q of (queue?.records || [])) {
            if (q.movieId) {
                queueMovieIds.add(q.movieId);
                queueByMovie.set(q.movieId, q);
            }
        }
        const failedMovieIds = new Set();
        const failedByMovie = new Map();
        for (const h of (failedHistory?.records || [])) {
            if (h.movieId) {
                failedMovieIds.add(h.movieId);
                failedByMovie.set(h.movieId, h);
            }
        }

        // Filter to monitored + missing
        const missingMovies = (allMovies || []).filter(m => m.monitored && !m.hasFile);

        for (const movie of missingMovies) {
            const local = localByArr.radarr.get(movie.id);
            const posterImg = movie.images?.find(i => i.coverType === 'poster');

            let reason, reasonLabel;
            if (queueMovieIds.has(movie.id)) {
                reason = 'in_queue';
                reasonLabel = 'Downloading';
            } else if (!movie.isAvailable || movie.status === 'announced') {
                reason = 'not_out_yet';
                reasonLabel = 'Unreleased';
            } else if (movie.status === 'inCinemas') {
                reason = 'not_out_yet';
                reasonLabel = 'In Cinemas';
            } else if (failedMovieIds.has(movie.id)) {
                reason = 'failed';
                reasonLabel = 'Failed';
            } else {
                reason = 'not_available';
                reasonLabel = 'Missing';
            }

            const entry = {
                service: 'radarr',
                type: 'movie',
                title: movie.title,
                year: movie.year,
                arrId: movie.id,
                mediaParentId: local?.id || null,
                slug: local?.slug || null,
                poster_url: local?.poster_url || posterImg?.remoteUrl || null,
                arrStatus: movie.status,
                reason,
                reasonLabel,
                missingCount: 1,
                episodes: [],
            };

            if (queueMovieIds.has(movie.id)) {
                const q = queueByMovie.get(movie.id);
                entry.queueInfo = {
                    status: q.status,
                    progress: q.size > 0 ? Math.round(((q.size - q.sizeleft) / q.size) * 100) : 0,
                    timeleft: q.timeleft,
                    downloadClient: q.downloadClient,
                    trackedStatus: q.trackedDownloadStatus,
                    statusMessages: q.statusMessages,
                };
            }
            if (failedMovieIds.has(movie.id)) {
                const f = failedByMovie.get(movie.id);
                entry.failureInfo = {
                    date: f.date,
                    message: f.data?.message || 'Download failed',
                };
            }

            items.push(entry);
        }

        // Cutoff unmet movies
        if (includeCutoff && cutoff?.length) {
            for (const movie of cutoff) {
                const local = localByArr.radarr.get(movie.id);
                items.push({
                    service: 'radarr', type: 'movie',
                    title: movie.title, year: movie.year,
                    arrId: movie.id, mediaParentId: local?.id || null,
                    slug: local?.slug || null,
                    poster_url: local?.poster_url || null,
                    reason: 'cutoff_unmet', reasonLabel: 'Upgrade',
                    missingCount: 1, episodes: [],
                });
            }
        }
    }

    // ──────────────────────────────────────────────────────
    // LIDARR
    // ──────────────────────────────────────────────────────
    if (settings?.lidarr_api_key && (settings?.lidarr_url || settings?.lidarr_external_url)) {
        const lUrl = settings.lidarr_url, lExt = settings.lidarr_external_url, lKey = settings.lidarr_api_key;
        const [missing, queue, failedHistory, cutoff] = await Promise.all([
            fetchAllPages(lUrl, lExt, lKey, 'lidarr',
                'wanted/missing?sortKey=releaseDate&sortDirection=descending&includeArtist=true'),
            safeFetch(lUrl, lExt, lKey, 'lidarr',
                'queue?page=1&pageSize=200'),
            safeFetch(lUrl, lExt, lKey, 'lidarr',
                'history?page=1&pageSize=200&sortKey=date&sortDirection=descending&eventType=4'),
            includeCutoff
                ? fetchAllPages(lUrl, lExt, lKey, 'lidarr',
                    'wanted/cutoff?sortKey=releaseDate&sortDirection=descending&includeArtist=true')
                : Promise.resolve([]),
        ]);

        const queueAlbumIds = new Set();
        const queueByAlbum = new Map();
        for (const q of (queue?.records || [])) {
            if (q.albumId) {
                queueAlbumIds.add(q.albumId);
                queueByAlbum.set(q.albumId, q);
            }
        }
        const failedAlbumIds = new Set();
        const failedByAlbum = new Map();
        for (const h of (failedHistory?.records || [])) {
            if (h.albumId) {
                failedAlbumIds.add(h.albumId);
                failedByAlbum.set(h.albumId, h);
            }
        }

        // Group by artist
        const artistMap = new Map();
        for (const album of (missing || [])) {
            const artistId = album.artistId;
            if (!artistMap.has(artistId)) {
                const artist = album.artist || {};
                const local = localByArr.lidarr.get(artistId);
                artistMap.set(artistId, {
                    service: 'lidarr',
                    type: 'artist',
                    title: artist.artistName || 'Unknown',
                    arrId: artistId,
                    mediaParentId: local?.id || null,
                    slug: local?.slug || null,
                    poster_url: local?.poster_url || (artist.images?.find(i => i.coverType === 'poster')?.remoteUrl) || null,
                    episodes: [], // reuse 'episodes' field for albums
                });
            }
            const entry = artistMap.get(artistId);
            const releaseDate = album.releaseDate ? new Date(album.releaseDate) : null;
            const albumInfo = {
                albumId: album.id,
                label: album.title || 'Unknown Album',
                title: album.title,
                airDate: album.releaseDate,
                isAired: releaseDate ? releaseDate < now : false,
                trackCount: album.statistics?.trackCount || 0,
                trackFileCount: album.statistics?.trackFileCount || 0,
            };
            if (queueAlbumIds.has(album.id)) {
                const q = queueByAlbum.get(album.id);
                albumInfo.queue = {
                    status: q.status,
                    progress: q.size > 0 ? Math.round(((q.size - q.sizeleft) / q.size) * 100) : 0,
                    timeleft: q.timeleft,
                    trackedStatus: q.trackedDownloadStatus,
                };
            }
            if (failedAlbumIds.has(album.id)) {
                const f = failedByAlbum.get(album.id);
                albumInfo.failure = {
                    date: f.date,
                    message: f.data?.message || 'Download failed',
                };
            }
            entry.episodes.push(albumInfo);
        }

        for (const [, entry] of artistMap) {
            const inQueue = entry.episodes.some(e => e.queue);
            const hasFailed = entry.episodes.some(e => e.failure);
            const allUnaired = entry.episodes.every(e => !e.isAired);

            if (inQueue) {
                entry.reason = 'in_queue';
                entry.reasonLabel = 'Downloading';
            } else if (allUnaired) {
                entry.reason = 'not_out_yet';
                entry.reasonLabel = 'Unreleased';
            } else if (hasFailed) {
                entry.reason = 'failed';
                entry.reasonLabel = 'Failed';
            } else {
                entry.reason = 'not_available';
                entry.reasonLabel = 'Missing';
            }

            entry.missingCount = entry.episodes.length;
            items.push(entry);
        }

        // Cutoff unmet
        if (includeCutoff && cutoff?.length) {
            const cutoffArtistMap = new Map();
            for (const album of cutoff) {
                const artistId = album.artistId;
                if (!cutoffArtistMap.has(artistId)) {
                    const artist = album.artist || {};
                    const local = localByArr.lidarr.get(artistId);
                    cutoffArtistMap.set(artistId, {
                        service: 'lidarr', type: 'artist',
                        title: artist.artistName || 'Unknown',
                        arrId: artistId, mediaParentId: local?.id || null,
                        slug: local?.slug || null, poster_url: local?.poster_url || null,
                        reason: 'cutoff_unmet', reasonLabel: 'Upgrade',
                        episodes: [], missingCount: 0,
                    });
                }
                cutoffArtistMap.get(artistId).episodes.push({
                    label: album.title || 'Unknown Album',
                    title: album.title,
                });
                cutoffArtistMap.get(artistId).missingCount++;
            }
            for (const [, entry] of cutoffArtistMap) items.push(entry);
        }
    }

    // Sort: in_queue first, then failed, then not_available, then not_out_yet, then cutoff
    const reasonOrder = { in_queue: 0, failed: 1, not_available: 2, not_out_yet: 3, cutoff_unmet: 4 };
    items.sort((a, b) => (reasonOrder[a.reason] ?? 9) - (reasonOrder[b.reason] ?? 9));

    // Build summary
    const summary = {
        total: items.reduce((sum, i) => sum + (i.missingCount || 1), 0),
        totalItems: items.length,
        byReason: {},
        byService: {},
    };
    for (const item of items) {
        summary.byReason[item.reason] = (summary.byReason[item.reason] || 0) + 1;
        summary.byService[item.service] = (summary.byService[item.service] || 0) + 1;
    }

    return { items, summary };
}
