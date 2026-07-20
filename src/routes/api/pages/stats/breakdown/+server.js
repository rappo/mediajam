import db from '$lib/server/db.js';
import { json } from '@sveltejs/kit';
import { arrFetch } from '$lib/server/arr-client.js';
import { getPrecomputed, setPrecomputed, isPrecomputedFresh } from '$lib/server/section-cache.js';

/**
 * GET /api/pages/stats/breakdown — per-media-type pie chart data for the Stats page.
 *
 * movies: quality profile, resolution, codec, HDR      (profiles from DB; rest from Radarr)
 * tv:     episode count, size on disk, resolution, quality profile
 *         (episode count + profiles from DB; sizes from Sonarr; resolution needs one
 *          episodefile call per series, so it is built in the background and cached)
 * music:  size on disk (Lidarr), quality profile (DB)
 *
 * Cached in precomputed_sections (stale-while-revalidate). On a cold cache the fast
 * parts are returned immediately with tvResolution=null + building=true while the
 * full payload (including TV resolution) is assembled in the background.
 */

const CACHE_KEY = 'stats-breakdown';
const CACHE_TTL = 6 * 60 * 60 * 1000;
const TOP_N = 10;

let building = false;

export async function GET({ locals }) {
    if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

    const cached = getPrecomputed(CACHE_KEY);
    if (cached) {
        if (!isPrecomputedFresh(CACHE_KEY, CACHE_TTL)) backgroundBuild();
        return json({ ...cached.data, cached: true });
    }

    // Cold cache: serve everything that's cheap now; TV resolution arrives later.
    const partial = await buildBreakdown({ includeTvResolution: false });
    backgroundBuild();
    return json({ ...partial, building: true });
}

function backgroundBuild() {
    if (building) return;
    building = true;
    buildBreakdown({ includeTvResolution: true })
        .then(full => { try { setPrecomputed(CACHE_KEY, full); } catch { /* non-fatal */ } })
        .catch(e => console.warn('[stats-breakdown] background build failed:', e instanceof Error ? e.message : e))
        .finally(() => { building = false; });
}

/** @param {{ includeTvResolution: boolean }} opts */
async function buildBreakdown({ includeTvResolution }) {
    const settings = /** @type {any} */ (db.prepare(
        `SELECT radarr_url, radarr_api_key, radarr_external_url,
                sonarr_url, sonarr_api_key, sonarr_external_url,
                lidarr_url, lidarr_api_key, lidarr_external_url
         FROM app_settings WHERE id = 1`
    ).get());

    // ── DB-backed slices ────────────────────────────────────────────────────
    const profileRows = (/** @type {'movie'|'show'|'artist'} */ type) =>
        /** @type {any[]} */ (db.prepare(`
            SELECT arr_quality_profile AS label, COUNT(*) AS value
            FROM media_parents
            WHERE media_type = ? AND arr_quality_profile IS NOT NULL
            GROUP BY arr_quality_profile ORDER BY value DESC
        `).all(type));

    const tvEpisodeCount = topN(/** @type {any[]} */ (db.prepare(`
        SELECT title AS label, collected_children AS value
        FROM media_parents
        WHERE media_type = 'show' AND collected_children > 0
        ORDER BY collected_children DESC
    `).all()), TOP_N);

    /** @type {any} */
    const out = {
        movies: {
            qualityProfile: profileRows('movie'),
            resolution: null,
            codec: null,
            hdr: null,
        },
        tv: {
            episodeCount: tvEpisodeCount,
            sizeOnDisk: null,
            resolution: null,
            qualityProfile: profileRows('show'),
        },
        music: {
            sizeOnDisk: null,
            qualityProfile: profileRows('artist'),
        },
        builtAt: new Date().toISOString(),
    };

    // ── Radarr: resolution / codec / HDR from movie files (single call) ─────
    const radarr = await tryArr(settings?.radarr_url, settings?.radarr_external_url, settings?.radarr_api_key, 'radarr', 'movie');
    const sonarrBase = await resolveArrBase(settings?.sonarr_url, settings?.sonarr_external_url, settings?.sonarr_api_key, 'sonarr');
    if (Array.isArray(radarr)) {
        /** @type {Record<string, number>} */ const res = {};
        /** @type {Record<string, number>} */ const codec = {};
        /** @type {Record<string, number>} */ const hdr = {};
        for (const m of radarr) {
            if (!m.hasFile || !m.movieFile) continue;
            const mi = m.movieFile.mediaInfo || {};
            bump(res, resolutionLabel(m.movieFile.quality?.quality?.resolution, mi.resolution));
            bump(codec, codecLabel(mi.videoCodec));
            bump(hdr, hdrLabel(mi));
        }
        out.movies.resolution = toSorted(res);
        out.movies.codec = toSorted(codec);
        out.movies.hdr = toSorted(hdr);
    }

    // ── Sonarr: per-show size on disk (single call) + resolution (per-series) ──
    const sonarr = sonarrBase
        ? await arrFetch(sonarrBase, settings.sonarr_api_key, 'sonarr', 'series', { signal: AbortSignal.timeout(30000) }).catch(() => null)
        : null;
    if (Array.isArray(sonarr)) {
        out.tv.sizeOnDisk = topN(
            sonarr
                .filter(s => s.statistics?.sizeOnDisk > 0)
                .map(s => ({ label: s.title, value: toGB(s.statistics.sizeOnDisk) }))
                .sort((a, b) => b.value - a.value),
            TOP_N
        );

        if (includeTvResolution) {
            /** @type {Record<string, number>} */ const res = {};
            const withFiles = sonarr.filter(s => s.statistics?.episodeFileCount > 0);
            const CONCURRENCY = 8;
            for (let i = 0; i < withFiles.length; i += CONCURRENCY) {
                const chunk = withFiles.slice(i, i + CONCURRENCY);
                await Promise.all(chunk.map(async (s) => {
                    try {
                        // Reuse the base URL that already worked — re-probing a dead
                        // primary URL per series would burn its timeout 400× over.
                        const files = await arrFetch(sonarrBase, settings.sonarr_api_key, 'sonarr', `episodefile?seriesId=${s.id}`);
                        for (const f of (Array.isArray(files) ? files : [])) {
                            bump(res, resolutionLabel(f.quality?.quality?.resolution, f.mediaInfo?.resolution));
                        }
                    } catch { /* one series failing shouldn't kill the chart */ }
                }));
            }
            out.tv.resolution = toSorted(res);
        }
    }

    // ── Lidarr: per-artist size on disk (single call) ───────────────────────
    const lidarr = await tryArr(settings?.lidarr_url, settings?.lidarr_external_url, settings?.lidarr_api_key, 'lidarr', 'artist');
    if (Array.isArray(lidarr)) {
        out.music.sizeOnDisk = topN(
            lidarr
                .filter(a => a.statistics?.sizeOnDisk > 0)
                .map(a => ({ label: a.artistName, value: toGB(a.statistics.sizeOnDisk) }))
                .sort((a, b) => b.value - a.value),
            TOP_N
        );
    }

    return out;
}

/** Fetch from an *arr with primary → external URL fallback; null when unconfigured/down. */
async function tryArr(primaryUrl, externalUrl, apiKey, service, path) {
    const base = await resolveArrBase(primaryUrl, externalUrl, apiKey, service);
    if (!base) return null;
    try {
        return await arrFetch(base, apiKey, service, path, { signal: AbortSignal.timeout(30000) });
    } catch {
        return null;
    }
}

// Which candidate URL actually answers, probed once per service (cheap
// system/status call) and remembered — instead of re-timing-out on a dead
// primary URL for every request.
/** @type {Map<string, { url: string, ts: number }>} */
const arrBaseCache = new Map();
const ARR_BASE_TTL = 10 * 60 * 1000;

async function resolveArrBase(primaryUrl, externalUrl, apiKey, service) {
    if (!apiKey) return null;
    const cached = arrBaseCache.get(service);
    if (cached && Date.now() - cached.ts < ARR_BASE_TTL) return cached.url;
    for (const url of [primaryUrl, externalUrl].filter(Boolean)) {
        try {
            await arrFetch(url, apiKey, service, 'system/status', { signal: AbortSignal.timeout(4000) });
            arrBaseCache.set(service, { url, ts: Date.now() });
            return url;
        } catch { /* try next candidate */ }
    }
    return null;
}

/** @param {Record<string, number>} acc @param {string} key */
function bump(acc, key) { acc[key] = (acc[key] || 0) + 1; }

/** @param {Record<string, number>} acc */
function toSorted(acc) {
    return Object.entries(acc)
        .map(([label, value]) => ({ label, value }))
        .sort((a, b) => b.value - a.value);
}

/** Keep the biggest N slices, roll the rest into "Others". */
function topN(rows, n) {
    if (rows.length <= n) return rows;
    const top = rows.slice(0, n);
    const rest = rows.slice(n).reduce((sum, r) => sum + r.value, 0);
    return [...top, { label: `Others (${rows.length - n})`, value: Math.round(rest * 10) / 10 }];
}

function toGB(bytes) { return Math.round((bytes / 1024 ** 3) * 10) / 10; }

/**
 * "2160p" from the *arr quality resolution (number), falling back to parsing
 * mediaInfo.resolution ("3840x2160").
 */
function resolutionLabel(qualityRes, miRes) {
    let p = qualityRes || 0;
    if (!p && typeof miRes === 'string' && miRes.includes('x')) {
        const h = parseInt(miRes.split('x')[1]);
        if (h) p = h > 1600 ? 2160 : h > 900 ? 1080 : h > 640 ? 720 : 480;
    }
    if (!p) return 'Unknown';
    return p === 2160 ? '4K (2160p)' : `${p}p`;
}

function codecLabel(codec) {
    if (!codec) return 'Unknown';
    const s = String(codec).toLowerCase();
    if (s.includes('265') || s.includes('hevc')) return 'H.265 / HEVC';
    if (s.includes('264') || s.includes('avc')) return 'H.264 / AVC';
    if (s.includes('av1')) return 'AV1';
    if (s.includes('vc1') || s.includes('vc-1')) return 'VC-1';
    if (s.includes('mpeg2')) return 'MPEG-2';
    if (s.includes('xvid') || s.includes('divx')) return 'XviD/DivX';
    return codec;
}

/** @param {any} mi movieFile.mediaInfo */
function hdrLabel(mi) {
    const t = String(mi.videoDynamicRangeType || '').toUpperCase();
    if (t.includes('DV')) return 'Dolby Vision';
    if (t.includes('HDR10+') || t.includes('HDR10PLUS')) return 'HDR10+';
    if (t.includes('HDR10')) return 'HDR10';
    if (t.includes('HLG')) return 'HLG';
    if (String(mi.videoDynamicRange || '').toUpperCase() === 'HDR') return 'HDR';
    return 'SDR';
}
