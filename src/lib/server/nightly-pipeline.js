/**
 * Nightly Pipeline — dependency-aware sync/enrich/dedup orchestrator.
 *
 * Phases run sequentially. Each phase can be toggled individually.
 * Uses shared lock to coordinate with backup scheduler.
 *
 * Nightly: Phases 1-7
 * Weekly:  Phases 8-11 (after nightly completes)
 */

import db from '$lib/server/db.js';
import { acquireLock, releaseLock, createBackup } from '$lib/server/backup-engine.js';

// ── Phase Imports ───────────────────────────────────────────────────────────

import { startSync } from '$lib/server/sync-engine.js';
import { syncJellyfinHistory } from '$lib/server/jellyfin-history-engine.js';
import { backfillTrakt, backfillLastfm, processLastfmScrobbles } from '$lib/server/backfill-engine.js';
import { syncAllArr } from '$lib/server/arr-sync.js';
import {
    deduplicateParents, deduplicateParentsByTitle, deduplicateChildren,
    deduplicatePlaybackHistory, mergeOrphanArtistsIntoAlbums, deduplicateExternalAlbums,
    mergePersonDuplicates,
} from '$lib/server/reconcile.js';
import { warmCache } from '$lib/server/image-cache.js';
import { getPrecomputed, setPrecomputed, invalidatePrecomputed } from '$lib/server/section-cache.js';
import {
    getHomepagePrefs,
    detectMoviePatterns, getPersonRecommendations, getRecentlyWatchedMovies,
    getUnwatchedMovies, getRecommendedMovies,
    getAiringThisWeek, getNewUnwatchedEpisodes, getBehindOnShows,
    getUpcomingEpisodes, getRecentlyWatchedShows,
    getRecentListening, getNewFromFavorites, getRediscoverArtists,
    getHeavyRotation, getUnplayedAlbums, getItsBeenAWhile,
} from '$lib/server/homepage-engine.js';
import { startPeopleSync, startExternalIdsSync, startPeopleEnrichSync } from '$lib/server/people-sync-engine.js';
import { startMusicBrainzEnrich } from '$lib/server/musicbrainz-engine.js';
import { autoMergeMediumPlus, enrichUnmatchedAlbums, backfillOriginalYears } from '$lib/server/album-matcher.js';
import { fetchAllRatings } from '$lib/server/ratings-engine.js';
import { refreshLibrarySizes } from '$lib/server/discovery-engine.js';
import { backfillWikipedia } from '$lib/server/wikipedia-backfill.js';
import { generate, embed, isEmbeddingAvailable } from '$lib/server/llm.js';
import crypto from 'crypto';

// ── State ───────────────────────────────────────────────────────────────────

let running = false;
let currentPhase = '';
let pipelineAbort = false;

/** @type {Array<(event: PipelineEvent) => void>} */
let listeners = [];

/**
 * @typedef {{
 *   type: 'phase_start' | 'phase_end' | 'phase_skip' | 'phase_error' | 'phase_progress' | 'pipeline_start' | 'pipeline_end',
 *   phase?: string,
 *   phaseIndex?: number,
 *   totalPhases?: number,
 *   message?: string,
 *   error?: string,
 *   duration?: number,
 *   mode?: 'nightly' | 'weekly',
 * }} PipelineEvent
 */

function emit(/** @type {PipelineEvent} */ event) {
    for (const fn of listeners) {
        try { fn(event); } catch { /* ignore listener errors */ }
    }
}

export function addPipelineListener(/** @type {(e: PipelineEvent) => void} */ fn) {
    listeners.push(fn);
    return () => { listeners = listeners.filter(l => l !== fn); };
}

export function isPipelineRunning() { return running; }
export function getPipelineStatus() { return { running, currentPhase }; }
export function stopPipeline() { pipelineAbort = true; }

// ── Settings ────────────────────────────────────────────────────────────────

/**
 * Read pipeline settings.
 */
export function getPipelineSettings() {
    const row = /** @type {any} */ (db.prepare(`
        SELECT pipeline_enabled, nightly_pipeline_time, weekly_pipeline_day,
               weekly_pipeline_time, pipeline_phase_flags, nightly_pipeline_days
        FROM app_settings WHERE id = 1
    `).get());
    let phaseFlags = {};
    try { phaseFlags = JSON.parse(row?.pipeline_phase_flags || '{}'); } catch { /* */ }
    let nightlyDays = ['monday','tuesday','wednesday','thursday','friday','saturday','sunday'];
    try {
        const parsed = JSON.parse(row?.nightly_pipeline_days || 'null');
        if (Array.isArray(parsed)) nightlyDays = parsed;
    } catch { /* */ }
    return {
        pipelineEnabled: (row?.pipeline_enabled ?? 0) !== 0,
        nightlyTime: row?.nightly_pipeline_time || '02:00',
        weeklyDay: row?.weekly_pipeline_day || 'sunday',
        weeklyTime: row?.weekly_pipeline_time || '03:00',
        phaseFlags,
        nightlyDays,
    };
}

/**
 * Update pipeline settings.
 */
export function updatePipelineSettings(settings) {
    const cols = [];
    const vals = [];
    if (settings.pipelineEnabled !== undefined) { cols.push('pipeline_enabled = ?'); vals.push(settings.pipelineEnabled ? 1 : 0); }
    if (settings.nightlyTime !== undefined) { cols.push('nightly_pipeline_time = ?'); vals.push(settings.nightlyTime); }
    if (settings.weeklyDay !== undefined) { cols.push('weekly_pipeline_day = ?'); vals.push(settings.weeklyDay); }
    if (settings.weeklyTime !== undefined) { cols.push('weekly_pipeline_time = ?'); vals.push(settings.weeklyTime); }
    if (settings.phaseFlags !== undefined) { cols.push('pipeline_phase_flags = ?'); vals.push(JSON.stringify(settings.phaseFlags)); }
    if (settings.nightlyDays !== undefined) { cols.push('nightly_pipeline_days = ?'); vals.push(JSON.stringify(settings.nightlyDays)); }
    if (cols.length === 0) return;
    db.prepare(`UPDATE app_settings SET ${cols.join(', ')} WHERE id = 1`).run(...vals);
}

// ── Phase Definitions ───────────────────────────────────────────────────────

/**
 * @typedef {{
 *   id: string,
 *   label: string,
 *   schedule: 'nightly' | 'weekly',
 *   run: (log: (msg: string) => void) => Promise<string>,
 *   shouldSkip?: () => boolean,
 * }} PhaseDefinition
 */

/**
 * Get the user ID for pipeline operations (first admin user).
 */
function getPipelineUserId() {
    const user = /** @type {any} */ (db.prepare('SELECT id FROM users WHERE is_admin = 1 LIMIT 1').get());
    return user?.id || 1;
}

/**
 * Check whether Trakt auto-sync is enabled for any user.
 */
function isTraktAutoSyncEnabled() {
    const row = /** @type {any} */ (db.prepare("SELECT COUNT(*) as cnt FROM user_identities WHERE provider = 'trakt' AND auto_sync = 1").get());
    return (row?.cnt ?? 0) > 0;
}

/**
 * Check whether Last.fm auto-sync is enabled for any user.
 */
function isLastfmAutoSyncEnabled() {
    const row = /** @type {any} */ (db.prepare("SELECT COUNT(*) as cnt FROM user_identities WHERE provider = 'lastfm' AND auto_sync = 1").get());
    return (row?.cnt ?? 0) > 0;
}

/**
 * Check whether *arr services are configured.
 */
function isArrConfigured() {
    const row = /** @type {any} */ (db.prepare(`
        SELECT radarr_url, sonarr_url, lidarr_url FROM app_settings WHERE id = 1
    `).get());
    return !!(row?.radarr_url || row?.sonarr_url || row?.lidarr_url);
}

/**
 * Check whether an LLM chat provider is configured (for tag generation).
 */
function isLlmConfigured() {
    try {
        const row = /** @type {any} */ (db.prepare(`
            SELECT llm_provider, ollama_url, ollama_chat_model,
                   openai_api_key, gemini_api_key, claude_api_key, kimi_api_key, llm_api_key,
                   codex_access_token
            FROM app_settings WHERE id = 1
        `).get());
        if (!row) return false;
        const provider = row.llm_provider || 'ollama';
        if (provider === 'ollama') return !!(row.ollama_url && row.ollama_chat_model);
        return !!(row.openai_api_key || row.gemini_api_key || row.claude_api_key || row.kimi_api_key || row.llm_api_key || row.codex_access_token);
    } catch {
        return false;
    }
}

/** @type {PhaseDefinition[]} */
const PHASES = [
    // ── Nightly ──
    {
        id: 'jellyfin-sync',
        label: 'Jellyfin Library Sync',
        schedule: 'nightly',
        async run(log) {
            log('Connecting to Jellyfin...');
            const before = /** @type {any} */ (db.prepare('SELECT COUNT(*) as c FROM media_parents').get())?.c || 0;
            await startSync();
            const after = /** @type {any} */ (db.prepare('SELECT COUNT(*) as c FROM media_parents').get())?.c || 0;
            const diff = after - before;
            if (diff > 0) log(`Added ${diff} new items (${before} → ${after})`);
            else log(`Library unchanged at ${after} items`);
            return 'Jellyfin library sync complete';
        },
    },
    {
        id: 'jellyfin-history',
        label: 'Jellyfin Watch History',
        schedule: 'nightly',
        async run(log) {
            const userId = getPipelineUserId();
            const beforeCount = /** @type {any} */ (db.prepare('SELECT COUNT(*) as c FROM playback_history').get())?.c || 0;
            log('Fetching watch history from Jellyfin...');
            await syncJellyfinHistory(userId);
            const afterCount = /** @type {any} */ (db.prepare('SELECT COUNT(*) as c FROM playback_history').get())?.c || 0;
            const diff = afterCount - beforeCount;
            if (diff > 0) log(`Imported ${diff} new play records (${beforeCount} → ${afterCount})`);
            else log(`No new plays (${afterCount} total)`);
            return 'Jellyfin watch history synced';
        },
    },
    {
        id: 'trakt-import',
        label: 'Trakt History Import',
        schedule: 'nightly',
        shouldSkip: () => !isTraktAutoSyncEnabled(),
        async run(log) {
            const userId = getPipelineUserId();
            log('Fetching Trakt watch history...');
            await backfillTrakt(userId);
            const traktCount = /** @type {any} */ (db.prepare("SELECT COUNT(*) as c FROM playback_history WHERE source = 'trakt'").get())?.c || 0;
            log(`Trakt plays total: ${traktCount}`);
            return 'Trakt history imported';
        },
    },
    {
        id: 'lastfm-import',
        label: 'Last.fm Scrobble Import',
        schedule: 'nightly',
        shouldSkip: () => !isLastfmAutoSyncEnabled(),
        async run(log) {
            const userId = getPipelineUserId();
            log('Fetching Last.fm scrobbles...');
            await backfillLastfm(userId);
            log('Processing scrobbles into playback history...');
            processLastfmScrobbles(userId);
            const lfmCount = /** @type {any} */ (db.prepare("SELECT COUNT(*) as c FROM playback_history WHERE source = 'lastfm'").get())?.c || 0;
            log(`Last.fm plays total: ${lfmCount}`);
            return 'Last.fm scrobbles imported and processed';
        },
    },
    {
        id: 'arr-sync',
        label: '*arr Sync',
        schedule: 'nightly',
        shouldSkip: () => !isArrConfigured(),
        async run(log) {
            const settings = /** @type {any} */ (db.prepare('SELECT radarr_url, sonarr_url, lidarr_url FROM app_settings WHERE id = 1').get());
            const services = [settings?.radarr_url && 'Radarr', settings?.sonarr_url && 'Sonarr', settings?.lidarr_url && 'Lidarr'].filter(Boolean);
            log(`Syncing: ${services.join(', ')}`);
            await syncAllArr();
            return '*arr sync complete';
        },
    },
    {
        id: 'dedup-cleanup',
        label: 'Quick Cleanup (Dedup)',
        schedule: 'nightly',
        async run(log) {
            log('Deduplicating parents by external ID...');
            const p = deduplicateParents();
            if (p.deduped > 0) log(`  Merged ${p.deduped} parent duplicates`);

            log('Deduplicating parents by title...');
            const pt = deduplicateParentsByTitle();
            if (pt.deduped > 0) log(`  Merged ${pt.deduped} title duplicates`);

            log('Deduplicating children...');
            const c = deduplicateChildren();
            if (c.deduped > 0) log(`  Merged ${c.deduped} child duplicates`);

            log('Removing duplicate playback history...');
            const ph = deduplicatePlaybackHistory();
            if (ph.removed > 0) log(`  Removed ${ph.removed} duplicate plays`);

            log('Merging orphan artists into albums...');
            const oa = mergeOrphanArtistsIntoAlbums();
            if (oa.merged > 0) log(`  Merged ${oa.merged} orphan artists`);

            log('Deduplicating external albums...');
            const ea = deduplicateExternalAlbums();
            if (ea.deduped > 0) log(`  Merged ${ea.deduped} external album duplicates`);

            log('Merging duplicate persons...');
            const mp = mergePersonDuplicates();
            if (mp.merged > 0) log(`  Merged ${mp.merged} duplicate persons, moved ${mp.creditsMoved} credits`);

            // Clean up orphaned external_ratings pointing to deleted parents
            const orphanedRatings = db.prepare(`
                DELETE FROM external_ratings WHERE media_parent_id NOT IN (SELECT id FROM media_parents)
            `).run();
            if (orphanedRatings.changes > 0) log(`  Cleaned ${orphanedRatings.changes} orphaned ratings`);

            const totalMerged = p.deduped + pt.deduped + c.deduped + ph.removed + oa.merged + ea.deduped + mp.merged;
            return totalMerged > 0
                ? `Cleanup complete: ${totalMerged} total operations`
                : 'No duplicates found';
        },
    },
    {
        id: 'image-warm',
        label: 'Image Cache Warm',
        schedule: 'nightly',
        async run(log) {
            const rows = /** @type {any[]} */ (db.prepare(`
                SELECT poster_url, backdrop_url FROM media_parents
                WHERE poster_url IS NOT NULL OR backdrop_url IS NOT NULL
            `).all());
            const urls = rows.flatMap(r => [r.poster_url, r.backdrop_url].filter(Boolean));
            if (urls.length === 0) return 'No images to warm';
            log(`Found ${urls.length} images to warm...`);
            await warmCache(urls, 5);
            return `Warmed ${urls.length} images`;
        },
    },
    {
        id: 'sections-cache',
        label: 'Rebuild Smart Sections',
        schedule: 'nightly',
        async run(log) {
            const users = /** @type {any[]} */ (db.prepare('SELECT id FROM users').all());
            const prefs = getHomepagePrefs();
            let built = 0;

            for (const user of users) {
                const userId = user.id;

                // Movies
                try {
                    let hero = null, personRecs = [], recentlyWatched = [], unwatched = [], recommended = [];
                    try { hero = detectMoviePatterns(userId, prefs); } catch { /* */ }
                    try { recommended = getRecommendedMovies(userId, prefs.maxItemsPerSection); } catch { /* */ }
                    try { personRecs = getPersonRecommendations(userId, prefs); } catch { /* */ }
                    try { recentlyWatched = getRecentlyWatchedMovies(userId, prefs.maxItemsPerSection); } catch { /* */ }
                    try { unwatched = getUnwatchedMovies(prefs.maxItemsPerSection); } catch { /* */ }
                    setPrecomputed(`movies-smart-${userId}`, {
                        sections: { hero, recommended, personRecs, recentlyWatched, unwatched },
                    });
                    built++;
                } catch (e) { log(`Movies sections failed for user ${userId}: ${e instanceof Error ? e.message : e}`); }

                // TV
                try {
                    let airingThisWeek = [], newUnwatched = [], behindOn = [], comingUp = [], recentlyWatchedTV = [];
                    try { airingThisWeek = getAiringThisWeek(prefs); } catch { /* */ }
                    try { newUnwatched = getNewUnwatchedEpisodes(prefs, userId); } catch { /* */ }
                    try { behindOn = getBehindOnShows(userId); } catch { /* */ }
                    try { comingUp = getUpcomingEpisodes(prefs, userId); } catch { /* */ }
                    try { recentlyWatchedTV = getRecentlyWatchedShows(userId, prefs.maxItemsPerSection); } catch { /* */ }
                    setPrecomputed(`tv-smart-${userId}`, {
                        sections: { airingThisWeek, newUnwatched, behindOn, comingUp, recentlyWatched: recentlyWatchedTV },
                    });
                    built++;
                } catch (e) { log(`TV sections failed for user ${userId}: ${e instanceof Error ? e.message : e}`); }

                // Music
                try {
                    let recentListening = [], newFromFav = [], rediscover = [];
                    let heavyRotation = [], unplayedAlbums = [], itsBeenAWhile = [];
                    try { recentListening = getRecentListening(userId, prefs.maxItemsPerSection, 0); } catch { /* */ }
                    try { newFromFav = getNewFromFavorites(userId, prefs.maxItemsPerSection); } catch { /* */ }
                    try { rediscover = getRediscoverArtists(userId, prefs); } catch { /* */ }
                    try { heavyRotation = getHeavyRotation(userId, prefs.maxItemsPerSection, 30); } catch { /* */ }
                    try { unplayedAlbums = getUnplayedAlbums(userId, prefs.maxItemsPerSection); } catch { /* */ }
                    try { itsBeenAWhile = getItsBeenAWhile(userId, 6, prefs.maxItemsPerSection); } catch { /* */ }
                    setPrecomputed(`music-smart-${userId}`, {
                        sections: { recentListening, newFromFavorites: newFromFav, rediscover, heavyRotation, unplayedAlbums, itsBeenAWhile },
                        timeFilters: { rotationTime: '30', recentTime: '0', awhileTime: '6' },
                    });
                    built++;
                } catch (e) { log(`Music sections failed for user ${userId}: ${e instanceof Error ? e.message : e}`); }
            }

            return `Built ${built} section caches for ${users.length} user(s)`;
        },
    },

    // ── Weekly ──
    {
        id: 'people-sync',
        label: 'People & Credits',
        schedule: 'weekly',
        async run(log) {
            const beforePeople = /** @type {any} */ (db.prepare('SELECT COUNT(*) as c FROM persons').get())?.c || 0;
            const beforeCredits = /** @type {any} */ (db.prepare('SELECT COUNT(*) as c FROM person_credits').get())?.c || 0;
            log(`Starting with ${beforePeople} people, ${beforeCredits} credits`);

            log('Phase 1: Syncing people from Jellyfin...');
            await startPeopleSync();
            const afterSync = /** @type {any} */ (db.prepare('SELECT COUNT(*) as c FROM persons').get())?.c || 0;
            if (afterSync > beforePeople) log(`  Added ${afterSync - beforePeople} new people`);

            log('Phase 2: Backfilling external IDs (TMDB)...');
            await startExternalIdsSync();

            log('Phase 3: TMDB crew enrichment (directors, writers)...');
            await startPeopleEnrichSync();
            const afterCredits = /** @type {any} */ (db.prepare('SELECT COUNT(*) as c FROM person_credits').get())?.c || 0;
            if (afterCredits > beforeCredits) log(`  Added ${afterCredits - beforeCredits} new credits`);

            return `People sync complete: ${afterSync} people, ${afterCredits} credits`;
        },
    },
    {
        id: 'music-enrich',
        label: 'Music Enrichment',
        schedule: 'weekly',
        async run(log) {
            log('Running MusicBrainz enrichment...');
            await startMusicBrainzEnrich();

            log('Auto-merging high-confidence album matches...');
            const merged = autoMergeMediumPlus();
            if ((merged?.merged ?? 0) > 0) log(`  Merged ${merged.merged} albums`);

            log('Enriching remaining unmatched albums...');
            await enrichUnmatchedAlbums();

            log('Backfilling original release years from MusicBrainz...');
            const years = await backfillOriginalYears();
            if (years.updated > 0) log(`  Fixed ${years.updated} album years`);

            return `MB enrich done, ${merged?.merged ?? 0} albums auto-merged, unmatched enriched, ${years.updated} years fixed`;
        },
    },
    {
        id: 'ratings-refresh',
        label: 'Ratings Refresh',
        schedule: 'nightly',
        async run(log) {
            const needsRating = /** @type {any} */ (db.prepare(
                "SELECT COUNT(*) as c FROM media_parents WHERE tmdb_id IS NOT NULL AND tmdb_id != '' AND id NOT IN (SELECT media_parent_id FROM external_ratings)"
            ).get())?.c || 0;
            log(`${needsRating} items need ratings...`);
            const result = await fetchAllRatings({ force: false });
            log(`Fetched ${result?.fetched ?? 0}, skipped ${result?.skipped ?? 0}`);
            return `Ratings refreshed: ${result?.fetched ?? 0} fetched, ${result?.skipped ?? 0} skipped`;
        },
    },
    {
        id: 'wikipedia-backfill',
        label: 'Wikipedia Backfill',
        schedule: 'weekly',
        async run(log) {
            const missing = /** @type {any} */ (db.prepare(
                "SELECT COUNT(*) as c FROM media_parents WHERE wikipedia_url IS NULL AND tmdb_id IS NOT NULL AND tmdb_id != '' AND media_type IN ('movie','show')"
            ).get())?.c || 0;
            log(`${missing} items missing Wikipedia links...`);
            await backfillWikipedia();
            return 'Wikipedia backfill complete';
        },
    },
    {
        id: 'llm-tags',
        label: 'Generate Tags (LLM)',
        schedule: 'weekly',
        shouldSkip: () => !isLlmConfigured(),
        async run(log) {
            // Test that the LLM is actually reachable
            const test = await generate('Say "ok"', { temperature: 0 });
            if (!test) throw new Error('LLM not reachable — skipping tag generation');

            const parents = /** @type {any[]} */ (db.prepare(`
                SELECT mp.id, mp.title, mp.overview, mp.media_type
                FROM media_parents mp
                WHERE mp.overview IS NOT NULL AND mp.overview != ''
                AND mp.id NOT IN (SELECT DISTINCT media_parent_id FROM media_tags)
                ORDER BY mp.title
            `).all());

            if (parents.length === 0) return 'All items already tagged';
            log(`${parents.length} items need tagging...`);

            const insertTag = db.prepare(
                'INSERT OR IGNORE INTO media_tags (media_parent_id, tag_type, tag_value) VALUES (?, ?, ?)'
            );

            let tagged = 0;
            let failed = 0;
            for (let i = 0; i < parents.length; i++) {
                const parent = parents[i];
                const mediaTypeLabel = parent.media_type === 'artist' ? 'music artist' : parent.media_type;
                const prompt = `Categorize this ${mediaTypeLabel}:
Title: ${parent.title}
Overview: ${parent.overview}

Return a JSON object with these arrays:
- genres: up to 3 genre tags (e.g. Action, Comedy, Rock, Jazz)
- moods: up to 2 mood/tone tags (e.g. Dark, Uplifting, Suspenseful, Chill)
- themes: up to 3 theme tags (e.g. Family, Revenge, Space, Coming-of-age)

Only return valid JSON, no explanation.`;

                const response = await generate(prompt, {
                    temperature: 0.2,
                    format: 'json',
                    system: 'You are a media categorization expert. Return only valid JSON with genres, moods, and themes arrays.',
                });

                if (response) {
                    try {
                        const tags = JSON.parse(response);
                        db.transaction(() => {
                            for (const genre of (tags.genres || [])) {
                                insertTag.run(parent.id, 'genre', String(genre).toLowerCase().trim());
                            }
                            for (const mood of (tags.moods || [])) {
                                insertTag.run(parent.id, 'mood', String(mood).toLowerCase().trim());
                            }
                            for (const theme of (tags.themes || [])) {
                                insertTag.run(parent.id, 'theme', String(theme).toLowerCase().trim());
                            }
                        })();
                        tagged++;
                    } catch {
                        failed++;
                    }
                } else {
                    failed++;
                }

                if ((i + 1) % 25 === 0) log(`Tagged ${tagged}/${i + 1} (${failed} failed)`);
            }

            return `Tagged ${tagged}/${parents.length} items (${failed} failed)`;
        },
    },
    {
        id: 'llm-embeddings',
        label: 'Generate Embeddings (LLM)',
        schedule: 'weekly',
        shouldSkip: () => !isEmbeddingAvailable(),
        async run(log) {
            // Verify embedding works
            const testEmbed = await embed('test');
            if (!testEmbed) throw new Error('Embedding model not available');
            const embedDim = testEmbed.length;
            if (embedDim !== 768) throw new Error(`Embedding dimension mismatch: got ${embedDim}, expected 768`);

            // Phase 1: Overview embeddings
            const parents = /** @type {any[]} */ (db.prepare(
                `SELECT mp.id, mp.title, mp.overview, eh.content_hash
                 FROM media_parents mp
                 LEFT JOIN embedding_hashes eh ON eh.media_parent_id = mp.id
                 WHERE mp.overview IS NOT NULL AND mp.overview != ''`
            ).all());

            const checkVecExists = db.prepare(
                'SELECT 1 FROM overview_embeddings WHERE media_parent_id = ? LIMIT 1'
            );
            const needsEmbedding = parents.filter(p => {
                const hash = crypto.createHash('sha256').update(`${p.title}. ${p.overview}`).digest('hex');
                p._hash = hash;
                if (!p.content_hash || p.content_hash !== hash) return true;
                try { return !checkVecExists.get(Number(p.id)); } catch { return true; }
            });

            log(`${needsEmbedding.length} overviews need embedding (${parents.length - needsEmbedding.length} up-to-date)...`);

            // Hoist prepared statements outside loops
            const deleteOverview = db.prepare('DELETE FROM overview_embeddings WHERE media_parent_id = CAST(? AS INTEGER)');
            const insertOverview = db.prepare('INSERT INTO overview_embeddings (media_parent_id, overview_embedding) VALUES (CAST(? AS INTEGER), ?)');
            const upsertHash = db.prepare("INSERT OR REPLACE INTO embedding_hashes (media_parent_id, content_hash, embedded_at) VALUES (?, ?, datetime('now'))");
            const deleteTitle = db.prepare('DELETE FROM media_embeddings WHERE media_id = CAST(? AS INTEGER)');
            const insertTitle = db.prepare('INSERT INTO media_embeddings (media_id, title_embedding) VALUES (CAST(? AS INTEGER), ?)');

            let overviewOk = 0;
            let overviewFail = 0;
            for (let i = 0; i < needsEmbedding.length; i++) {
                const parent = needsEmbedding[i];
                const text = `${parent.title}. ${parent.overview}`;
                const embedding = await embed(text);
                if (embedding) {
                    try {
                        const pid = parent.id;
                        const vecJson = JSON.stringify(embedding);
                        try { deleteOverview.run(pid); } catch { /* may not exist */ }
                        insertOverview.run(pid, vecJson);
                        upsertHash.run(pid, parent._hash);
                        overviewOk++;
                    } catch {
                        overviewFail++;
                    }
                }
                if ((i + 1) % 50 === 0) log(`Overviews: ${overviewOk}/${i + 1} embedded`);
            }

            // Phase 2: Title embeddings
            const children = /** @type {any[]} */ (db.prepare(
                `SELECT mc.id, mc.title, mp.title as parent_title
                 FROM media_children mc
                 JOIN media_parents mp ON mc.parent_id = mp.id
                 WHERE mc.id NOT IN (SELECT media_id FROM media_embeddings)`
            ).all());

            log(`${children.length} titles need embedding...`);

            let titleOk = 0;
            for (let i = 0; i < children.length; i++) {
                const child = children[i];
                const text = `${child.parent_title} - ${child.title}`;
                const embedding = await embed(text);
                if (embedding) {
                    try {
                        const cid = child.id;
                        try { deleteTitle.run(cid); } catch { /* */ }
                        insertTitle.run(cid, JSON.stringify(embedding));
                        titleOk++;
                    } catch { /* */ }
                }
                if ((i + 1) % 50 === 0) log(`Titles: ${titleOk}/${i + 1} embedded`);
            }

            return `Overviews: ${overviewOk} embedded (${overviewFail} failed), Titles: ${titleOk} embedded`;
        },
    },
];

// ── Pipeline Runner ─────────────────────────────────────────────────────────

/**
 * Run the pipeline.
 * @param {'nightly' | 'weekly'} mode — 'nightly' runs only nightly phases, 'weekly' runs all
 * @returns {Promise<{ success: boolean, results: Array<{ phase: string, status: string, message: string, durationMs: number }>, error?: string }>}
 */
export async function runPipeline(mode = 'nightly') {
    if (running) {
        return { success: false, results: [], error: 'Pipeline is already running' };
    }

    running = true;
    pipelineAbort = false;
    const settings = getPipelineSettings();
    const phases = PHASES;

    // Persist run start
    const runRow = db.prepare(
        'INSERT INTO pipeline_runs (mode, status, started_at) VALUES (?, ?, ?)'
    ).run(mode, 'running', new Date().toISOString());
    const runId = runRow.lastInsertRowid;

    emit({ type: 'pipeline_start', mode, totalPhases: phases.length });
    console.log(`[pipeline] Starting ${mode} pipeline (${phases.length} phases)`);

    // Acquire lock (waits for backup to finish if running)
    await acquireLock('pipeline');

    // Pre-pipeline backup
    try {
        createBackup('auto');
        console.log('[pipeline] Pre-pipeline backup created');
    } catch (e) {
        console.warn('[pipeline] Pre-pipeline backup failed:', e instanceof Error ? e.message : e);
    }

    /** @type {Array<{ phase: string, status: string, message: string, durationMs: number }>} */
    const results = [];

    for (let i = 0; i < phases.length; i++) {
        if (pipelineAbort) {
            console.log('[pipeline] Aborted by user');
            break;
        }

        const phase = phases[i];
        const phaseFlag = settings.phaseFlags[phase.id];

        // New-style: { nightly: bool, weekly: bool } — or legacy boolean
        let enabled = true;
        if (phaseFlag !== undefined) {
            if (typeof phaseFlag === 'object' && phaseFlag !== null) {
                // New format: check if this phase is enabled for the current mode
                enabled = mode === 'nightly' ? (phaseFlag.nightly ?? false) : (phaseFlag.weekly ?? false);
            } else {
                // Legacy boolean format
                enabled = phaseFlag !== false;
            }
        } else {
            // No explicit flag — use phase's default schedule
            enabled = mode === 'weekly' || phase.schedule === 'nightly';
        }

        // Check if phase is disabled via settings
        if (!enabled) {
            emit({ type: 'phase_skip', phase: phase.id, phaseIndex: i, totalPhases: phases.length, message: 'Disabled in settings' });
            results.push({ phase: phase.id, status: 'skipped', message: 'Disabled in settings', durationMs: 0 });
            continue;
        }

        // Check if phase should be skipped (e.g. no Trakt configured)
        if (phase.shouldSkip?.()) {
            emit({ type: 'phase_skip', phase: phase.id, phaseIndex: i, totalPhases: phases.length, message: 'Not configured' });
            results.push({ phase: phase.id, status: 'skipped', message: 'Not configured', durationMs: 0 });
            continue;
        }

        currentPhase = phase.label;
        emit({ type: 'phase_start', phase: phase.id, phaseIndex: i, totalPhases: phases.length, message: phase.label });
        console.log(`[pipeline] Phase ${i + 1}/${phases.length}: ${phase.label}`);

        const start = Date.now();
        /** @param {string} msg */
        const phaseLog = (msg) => {
            emit({ type: 'phase_progress', phase: phase.id, phaseIndex: i, totalPhases: phases.length, message: msg });
            console.log(`[pipeline]   ${msg}`);
        };
        try {
            const message = await phase.run(phaseLog);
            const durationMs = Date.now() - start;
            emit({ type: 'phase_end', phase: phase.id, phaseIndex: i, totalPhases: phases.length, message, duration: durationMs });
            results.push({ phase: phase.id, status: 'done', message, durationMs });
            console.log(`[pipeline] ✓ ${phase.label} (${(durationMs / 1000).toFixed(1)}s) — ${message}`);
        } catch (e) {
            const durationMs = Date.now() - start;
            const errMsg = e instanceof Error ? e.message : String(e);
            emit({ type: 'phase_error', phase: phase.id, phaseIndex: i, totalPhases: phases.length, error: errMsg, duration: durationMs });
            results.push({ phase: phase.id, status: 'error', message: errMsg, durationMs });
            console.error(`[pipeline] ✗ ${phase.label} (${(durationMs / 1000).toFixed(1)}s) — ${errMsg}`);
            // Continue to next phase (don't abort on single failure)
        }
    }

    // Refresh library sizes cache so dashboard shows up-to-date data
    try {
        await refreshLibrarySizes();
        console.log('[pipeline] Library sizes cache refreshed');
    } catch (e) {
        console.warn('[pipeline] Library sizes cache refresh failed:', e instanceof Error ? e.message : e);
    }

    releaseLock('pipeline');
    running = false;
    currentPhase = '';

    const totalMs = results.reduce((sum, r) => sum + r.durationMs, 0);
    const hasError = results.some(r => r.status === 'error');
    const summary = buildSummary(results);

    // Persist run results
    try {
        db.prepare(`
            UPDATE pipeline_runs
            SET status = ?, finished_at = ?, duration_ms = ?, phase_results = ?, summary = ?
            WHERE id = ?
        `).run(
            hasError ? 'completed_with_errors' : 'completed',
            new Date().toISOString(),
            totalMs,
            JSON.stringify(results),
            summary,
            runId
        );
    } catch (e) {
        console.warn('[pipeline] Failed to persist run results:', e instanceof Error ? e.message : e);
    }

    emit({ type: 'pipeline_end', mode, message: `Completed in ${(totalMs / 1000).toFixed(0)}s` });
    console.log(`[pipeline] ${mode} pipeline complete (${(totalMs / 1000).toFixed(0)}s total)`);

    return { success: true, results };
}

// ── Scheduler ───────────────────────────────────────────────────────────────

let nightlyTimeout = /** @type {ReturnType<typeof setTimeout>|null} */ (null);
let weeklyTimeout = /** @type {ReturnType<typeof setTimeout>|null} */ (null);

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

/**
 * Calculate delay until the next occurrence of a specific time.
 * @param {string} timeStr — 'HH:MM'
 * @returns {number} milliseconds
 */
function msUntilTime(timeStr) {
    const [h, m] = timeStr.split(':').map(Number);
    const now = new Date();
    const target = new Date(now);
    target.setHours(h, m, 0, 0);
    if (target <= now) target.setDate(target.getDate() + 1);
    return target.getTime() - now.getTime();
}

/**
 * Calculate delay until the next occurrence of a specific day+time.
 * @param {string} day — 'sunday', 'monday', etc.
 * @param {string} timeStr — 'HH:MM'
 * @returns {number} milliseconds
 */
function msUntilDayTime(day, timeStr) {
    const [h, m] = timeStr.split(':').map(Number);
    const dayIndex = WEEKDAYS.indexOf(day.toLowerCase());
    if (dayIndex === -1) return msUntilTime(timeStr); // fallback

    const now = new Date();
    const target = new Date(now);
    target.setHours(h, m, 0, 0);

    // Find next occurrence of the target day
    const currentDay = now.getDay();
    let daysAhead = dayIndex - currentDay;
    if (daysAhead < 0) daysAhead += 7;
    if (daysAhead === 0 && target <= now) daysAhead = 7;
    target.setDate(target.getDate() + daysAhead);

    return target.getTime() - now.getTime();
}

async function runNightly() {
    const settings = getPipelineSettings();
    if (!settings.pipelineEnabled) return;

    // Check if today is an enabled nightly day
    const todayIndex = new Date().getDay();
    const todayName = WEEKDAYS[todayIndex];
    if (!settings.nightlyDays.includes(todayName)) {
        console.log(`[pipeline] Skipping nightly — ${todayName} is not enabled`);
        scheduleNightly();
        return;
    }

    try {
        await runPipeline('nightly');
    } catch (e) {
        console.error('[pipeline] Nightly run failed:', e instanceof Error ? e.message : e);
    }

    // Schedule next nightly
    scheduleNightly();
}

async function runWeekly() {
    const settings = getPipelineSettings();
    if (!settings.pipelineEnabled) return;

    try {
        await runPipeline('weekly');
    } catch (e) {
        console.error('[pipeline] Weekly run failed:', e instanceof Error ? e.message : e);
    }

    // Schedule next weekly
    scheduleWeekly();
}

function scheduleNightly() {
    if (nightlyTimeout) { clearTimeout(nightlyTimeout); nightlyTimeout = null; }
    const settings = getPipelineSettings();
    if (!settings.pipelineEnabled) return;

    const delayMs = msUntilTime(settings.nightlyTime);
    console.log(`[pipeline] Next nightly in ${Math.round(delayMs / 60000)}min`);
    nightlyTimeout = setTimeout(runNightly, delayMs);
}

function scheduleWeekly() {
    if (weeklyTimeout) { clearTimeout(weeklyTimeout); weeklyTimeout = null; }
    const settings = getPipelineSettings();
    if (!settings.pipelineEnabled) return;

    const delayMs = msUntilDayTime(settings.weeklyDay, settings.weeklyTime);
    console.log(`[pipeline] Next weekly in ${Math.round(delayMs / 60000)}min`);
    weeklyTimeout = setTimeout(runWeekly, delayMs);
}

/**
 * Start the pipeline scheduler. Call on server boot.
 */
let pipelineSchedulerStarted = false;
export function startPipelineScheduler() {
    if (pipelineSchedulerStarted) return;
    pipelineSchedulerStarted = true;
    const settings = getPipelineSettings();
    if (!settings.pipelineEnabled) {
        console.log('[pipeline] Pipeline scheduler disabled');
        return;
    }
    scheduleNightly();
    scheduleWeekly();
}

/**
 * Restart the scheduler (after settings change).
 */
export function restartPipelineScheduler() {
    pipelineSchedulerStarted = false;
    if (nightlyTimeout) { clearTimeout(nightlyTimeout); nightlyTimeout = null; }
    if (weeklyTimeout) { clearTimeout(weeklyTimeout); weeklyTimeout = null; }
    startPipelineScheduler();
}

/**
 * Stop the scheduler.
 */
export function stopPipelineScheduler() {
    if (nightlyTimeout) { clearTimeout(nightlyTimeout); nightlyTimeout = null; }
    if (weeklyTimeout) { clearTimeout(weeklyTimeout); weeklyTimeout = null; }
    console.log('[pipeline] Scheduler stopped');
}

/** Export PHASES for UI display */
export { PHASES };

// ── Run History ─────────────────────────────────────────────────────────────

/**
 * Build a human-readable summary from phase results.
 * @param {Array<{phase: string, status: string, message: string, durationMs: number}>} results
 * @returns {string}
 */
function buildSummary(results) {
    const done = results.filter(r => r.status === 'done').length;
    const errors = results.filter(r => r.status === 'error').length;
    const skipped = results.filter(r => r.status === 'skipped').length;
    const parts = [`${done} completed`];
    if (errors > 0) parts.push(`${errors} failed`);
    if (skipped > 0) parts.push(`${skipped} skipped`);
    return parts.join(', ');
}

/**
 * Get recent pipeline run history.
 * @param {number} limit
 * @returns {Array<{id: number, mode: string, status: string, started_at: string, finished_at: string|null, duration_ms: number|null, summary: string|null}>}
 */
export function getRunHistory(limit = 20) {
    return /** @type {any[]} */ (db.prepare(
        'SELECT id, mode, status, started_at, finished_at, duration_ms, summary FROM pipeline_runs ORDER BY started_at DESC LIMIT ?'
    ).all(limit));
}

/**
 * Get full details for a single pipeline run (including phase_results JSON).
 * @param {number} id
 * @returns {any|null}
 */
export function getRunDetail(id) {
    const row = /** @type {any} */ (db.prepare(
        'SELECT * FROM pipeline_runs WHERE id = ?'
    ).get(id));
    if (!row) return null;
    try { row.phase_results = JSON.parse(row.phase_results); } catch { /* keep as string */ }
    return row;
}
