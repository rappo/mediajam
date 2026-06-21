<script>
    import MdiIcon from "$lib/components/MdiIcon.svelte";
    import { mdiCheckCircle, mdiCloseCircle, mdiSync, mdiEye, mdiCancel, mdiMerge, mdiDramaMasks, mdiMagnify, mdiTelevision, mdiAlert, mdiBookmark, mdiBookmarkOutline, mdiViewGrid, mdiStar, mdiViewList, mdiDownload, mdiMagnifyPlusOutline, mdiLightbulb } from '@mdi/js';
    import { addToast } from '$lib/stores/toast.js';
    let { data } = $props();
    import { invalidateAll, goto } from "$app/navigation";
    import DataTable from "$lib/components/DataTable.svelte";
    import ExternalLinks from "$lib/components/ExternalLinks.svelte";
    import ArrAddDialog from "$lib/components/ArrAddDialog.svelte";
    import HeartBorder from "$lib/components/HeartBorder.svelte";
    import FavoriteButton from "$lib/components/FavoriteButton.svelte";
    import RemotePlayButton from "$lib/components/RemotePlayButton.svelte";
    import MediaDetailHeader from "$lib/components/MediaDetailHeader.svelte";
    import CollectionStatusBanner from "$lib/components/CollectionStatusBanner.svelte";
    import InteractiveSearchDialog from "$lib/components/InteractiveSearchDialog.svelte";
    import PosterRow from "$lib/components/PosterRow.svelte";
    import CreditRow from "$lib/components/CreditRow.svelte";
    import DashSection from "$lib/components/DashSection.svelte";
    import { imgUrl } from "$lib/utils.js";
    import { page } from "$app/stores";

    let isDashboardHiddenLocal = $state(/** @type {boolean|null} */ (null));
    let isDashboardHidden = $derived(isDashboardHiddenLocal !== null ? isDashboardHiddenLocal : !!data.show.is_dashboard_hidden);

    async function toggleDashboardHidden() {
        const newVal = !isDashboardHidden;
        isDashboardHiddenLocal = newVal;
        try {
            await fetch(`/api/media/${data.show.id}/dashboard-hide`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ hidden: newVal }),
            });
        } catch (e) {
            console.error('Failed to toggle dashboard hidden:', e);
            isDashboardHiddenLocal = !newVal; // revert on error
        }
    }


    function statusColor(status) {
        if (status === "watched") return "var(--color-success, #22c55e)";
        if (status === "in_progress") return "var(--color-warning, #f59e0b)";
        return "var(--color-base-300, #2a2e37)";
    }

    function statusClass(status, isCollected, premiereDate) {
        // Upcoming: not collected and premiere date is in the future (or no premiere date but not aired)
        if (
            !isCollected &&
            premiereDate &&
            new Date(premiereDate) > new Date()
        ) {
            return "ep-upcoming";
        }
        let cls = "";
        if (status === "watched") cls = "ep-watched";
        else if (status === "in_progress") cls = "ep-progress";
        else cls = "ep-unwatched";
        if (!isCollected) cls += " ep-missing";
        return cls;
    }

    function formatRuntime(ticks) {
        if (!ticks) return "";
        const mins = Math.round(ticks / 600000000);
        return `${mins}m`;
    }

    let syncing = $state(false);
    let syncStatus = $state(""); // "", "success", "failed"
    let syncError = $state("");

    // *arr state
    let arrLoading = $state("");
    let arrError = $state("");
    let arrMonitoredLocal = $state(/** @type {boolean|null} */ (null));
    let arrMonitored = $derived(arrMonitoredLocal !== null ? arrMonitoredLocal : !!data.show.arr_monitored);

    /** @type {'map' | 'list' | 'ratings'} */
    let episodeView = $state('map');
    let showWatchStatus = $state(false);

    // ─── Episode-level download search ──────────────────────────────────────────
    /** @type {Set<number>} */
    let epSearching = $state(new Set());
    /** @type {Set<number>} */
    let epSearchDone = $state(new Set());
    /** @type {number | null} */
    let epInteractiveSearchId = $state(null);
    let epInteractiveSearchTitle = $state('');
    /** @type {import('$lib/components/InteractiveSearchDialog.svelte').default | null} */
    let epSearchDialog = $state(null);

    /**
     * Trigger an auto-search for a single episode via Sonarr.
     * @param {any} ep
     */
    async function autoSearchEpisode(ep) {
        const next = new Set(epSearching);
        next.add(ep.id);
        epSearching = next;
        try {
            const res = await fetch('/api/arr/sonarr/episode-search', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    mediaParentId: data.show.id,
                    seasonNumber: ep.season_number,
                    episodeNumber: ep.item_number,
                }),
            });
            if (!res.ok) {
                const r = await res.json();
                throw new Error(r.error || 'Search failed');
            }
            const done = new Set(epSearchDone);
            done.add(ep.id);
            epSearchDone = done;
            addToast({ type: 'success', message: `Started search for S${String(ep.season_number).padStart(2,'0')}E${String(ep.item_number).padStart(2,'0')}`, detail: ep.title });
        } catch (e) {
            addToast({ type: 'error', message: `Episode search failed`, detail: e instanceof Error ? e.message : String(e) });
        }
        const rm = new Set(epSearching);
        rm.delete(ep.id);
        epSearching = rm;
    }

    /**
     * Open the interactive search dialog for a specific episode.
     * @param {any} ep
     */
    function browseEpisodeReleases(ep) {
        epInteractiveSearchId = ep.id;
        epInteractiveSearchTitle = `${data.show.title} — S${String(ep.season_number).padStart(2,'0')}E${String(ep.item_number).padStart(2,'0')}: ${ep.title || 'TBA'}`;
        // Wait for reactivity to update the dialog props, then show
        setTimeout(() => epSearchDialog?.show(), 0);
    }

    /**
     * Get watch-status border class for rating cells
     * @param {any} ep
     * @returns {string}
     */
    function watchBorderClass(ep) {
        if (!ep.is_collected) return 'border-2 border-dashed !border-error/70';
        if (ep.watch_status === 'watched') return 'border-2 !border-white/80';
        if (ep.watch_status === 'in_progress') return 'border-2 !border-amber-300';
        return '';
    }

    /**
     * Get rating color class based on score
     * @param {number|null} rating
     * @returns {string}
     */
    function ratingColor(rating) {
        if (rating === null || rating === undefined) return 'bg-base-300/30 text-base-content/20';
        if (rating >= 9) return 'bg-[#0d6e3f] text-white'; // Outstanding - deep emerald
        if (rating >= 8) return 'bg-[#2d9d5c] text-white'; // Excellent - emerald
        if (rating >= 7) return 'bg-[#8cc152] text-black'; // Solid - lime
        if (rating >= 6) return 'bg-[#c9a833] text-black'; // Fair - gold
        if (rating >= 4) return 'bg-[#d35430] text-white'; // Poor - burnt orange
        return 'bg-[#6b4226] text-white'; // Awful - poop brown
    }

    async function onArrAdded() {
        await invalidateAll();
    }

    async function searchSonarr() {
        arrLoading = "search";
        arrError = "";
        try {
            const res = await fetch("/api/arr/sonarr/search", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ mediaParentId: data.show.id }),
            });
            if (!res.ok) {
                const r = await res.json();
                throw new Error(r.error || "Failed");
            }
        } catch (e) {
            arrError = e instanceof Error ? e.message : "Failed";
            setTimeout(() => (arrError = ""), 5000);
        }
        arrLoading = "";
    }

    async function toggleMonitorSonarr() {
        const newState = !arrMonitored;
        arrLoading = "monitor";
        arrError = "";
        try {
            const res = await fetch("/api/arr/sonarr/monitor", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    mediaParentId: data.show.id,
                    monitored: newState,
                }),
            });
            if (!res.ok) {
                const r = await res.json();
                throw new Error(r.error || "Failed");
            }
            arrMonitoredLocal = newState;
        } catch (e) {
            arrError = e instanceof Error ? e.message : "Failed";
            setTimeout(() => (arrError = ""), 5000);
        }
        arrLoading = "";
    }

    async function fullSync() {
        syncing = true;
        syncStatus = "";
        syncError = "";
        try {
            const syncBody = data.show.jellyfin_id
                ? { jellyfinId: data.show.jellyfin_id }
                : { mediaParentId: data.show.id, tmdbId: data.show.tmdb_id };
            const res = await fetch("/api/sync/item", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(syncBody),
            });
            const result = await res.json();
            if (result.success) {
                syncStatus = "success";
                await invalidateAll();
            } else {
                syncStatus = "failed";
                syncError = result.error || `HTTP ${res.status}`;
                console.error("[sync]", syncError);
            }
            setTimeout(() => {
                syncStatus = "";
                syncError = "";
            }, 5000);
        } catch (e) {
            console.error("[sync] Error:", e);
            syncStatus = "failed";
            syncError = e instanceof Error ? e.message : "Network error";
            setTimeout(() => {
                syncStatus = "";
                syncError = "";
            }, 5000);
        }
        syncing = false;
    }

    // Auto-enrich: silently sync when key data is missing
    let enriching = $state(false);
    let enrichFailed = $state(false);
    $effect(() => {
        if (data.show.needsEnrichment && !enriching && !enrichFailed && data.show.jellyfin_id) {
            enriching = true;
            fetch('/api/sync/item', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ jellyfinId: data.show.jellyfin_id }),
            })
                .then(r => r.json())
                .then(d => { if (d.success) invalidateAll(); else enrichFailed = true; })
                .catch(() => { enrichFailed = true; })
                .finally(() => { enriching = false; });
        }
    });

    let showDeleteConfirm = $state(false);
    let showMergeDialog = $state(false);
    let mergeSearchQuery = $state('');
    /** @type {any[]} */
    let mergeSearchResults = $state([]);
    let mergeSearching = $state(false);
    let merging = $state(false);
    let deleting = $state(false);

    async function searchMergeTarget() {
        if (mergeSearchQuery.length < 2) { mergeSearchResults = []; return; }
        mergeSearching = true;
        try {
            const res = await fetch(`/api/search?q=${encodeURIComponent(mergeSearchQuery)}`);
            if (res.ok) {
                const d = await res.json();
                mergeSearchResults = (d.results?.shows || []).filter(/** @param {any} s */ (s) => s.id !== data.show.id);
            }
        } catch (e) { console.error(e); }
        mergeSearching = false;
    }

    /** @param {any} target */
    async function mergeInto(target) {
        if (!confirm(`Merge "${data.show.title}" into "${target.title}"?\n\nAll episodes, watch history, and credits will be moved.`)) return;
        merging = true;
        try {
            const res = await fetch(`/api/media/merge-parents`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sourceId: data.show.id, targetId: target.id }),
            });
            const result = await res.json();
            if (result.success) {
                goto(`/tv/${result.slug || target.id}`);
            } else {
                alert(result.error || 'Merge failed');
            }
        } catch (e) {
            alert(e instanceof Error ? e.message : 'Merge failed');
        }
        merging = false;
        showMergeDialog = false;
    }

    async function deleteItem() {
        deleting = true;
        try {
            const res = await fetch(`/api/media/${data.show.id}`, { method: 'DELETE' });
            const result = await res.json();
            if (result.success) {
                const params = new URLSearchParams({ deleted: result.title, undoToken: result.undoToken, undoId: String(data.show.id) });
                goto(`/${result.route}?${params.toString()}`);
            } else {
                alert(result.error || 'Failed to delete');
            }
        } catch (e) {
            alert(e instanceof Error ? e.message : 'Network error');
        }
        deleting = false;
        showDeleteConfirm = false;
    }

    // ── Discovery state ──
    let discoveryLoading = $state(false);
    let discoveryLoaded = $state(false);
    let discoveryError = $state("");
    /** @type {any[]} */
    let discoveryItems = $state([]);
    /** @type {any[]} */
    let discoveryInLibrary = $state([]);
    let discoveryLimit = $state(12);
    let showDiscoverInLib = $state(false);
    let discAddingToArr = $state(/** @type {string|null} */ (null));
    let discAddedToArr = $state(/** @type {Set<string>} */ (new Set()));
    let discAddError = $state("");
    let hideDocumentaries = $state(true);

    // TMDb genre ID 99 = Documentary, 10770 = TV Movie (often making-of)
    const DOC_GENRE_IDS = [99, 10770];
    const DOC_TITLE_PATTERNS = /\b(making of|behind the scenes|the making)\b/i;

    /** @param {any[]} items */
    function filteredDiscoveryItems(items) {
        if (!hideDocumentaries) return items;
        return items.filter(item => {
            const isDocGenre = item.genre_ids?.some(id => DOC_GENRE_IDS.includes(id));
            const isDocTitle = DOC_TITLE_PATTERNS.test(item.title || '');
            return !isDocGenre && !isDocTitle;
        });
    }

    // Quality profile dialog state for discovery
    let discShowProfileDialog = $state(false);
    /** @type {any} */
    let discPendingItem = $state(null);
    /** @type {any[]} */
    let discAvailableProfiles = $state([]);
    /** @type {any[]} */
    let discAvailableRootFolders = $state([]);
    let discSelectedProfileId = $state(/** @type {number|null} */ (null));
    let discSelectedRootFolder = $state(/** @type {string|null} */ (null));

    async function loadDiscovery() {
        discoveryLoading = true;
        discoveryError = "";
        try {
            const res = await fetch(`/api/discover/show/${data.show.id}`);
            if (!res.ok) {
                const r = await res.json();
                throw new Error(r.error || "Failed");
            }
            const result = await res.json();
            discoveryItems = result.items || [];
            discoveryInLibrary = result.inLibrary || [];
            discoveryLoaded = true;
        } catch (e) {
            discoveryError = e instanceof Error ? e.message : "Discovery failed";
        }
        discoveryLoading = false;
    }

    /** @param {any} item */
    async function addDiscoveryToArr(item) {
        discAddingToArr = item.tmdb_id;
        try {
            const res = await fetch("/api/arr/profiles");
            if (!res.ok) throw new Error("Failed to fetch profiles");
            const options = await res.json();
            const serviceOptions = options.sonarr;
            if (!serviceOptions) throw new Error("Sonarr not configured");
            discAvailableProfiles = serviceOptions.profiles || [];
            discAvailableRootFolders = serviceOptions.rootFolders || [];
            discSelectedProfileId = discAvailableProfiles[0]?.id || null;
            discSelectedRootFolder = discAvailableRootFolders[0]?.path || null;
            discPendingItem = item;
            discAddingToArr = null;
            discShowProfileDialog = true;
        } catch (e) {
            discAddingToArr = null;
            discAddError = e instanceof Error ? e.message : "Failed";
            setTimeout(() => (discAddError = ""), 5000);
        }
    }

    async function confirmDiscoveryAdd() {
        if (!discPendingItem || !discSelectedProfileId) return;
        const item = discPendingItem;
        discShowProfileDialog = false;
        discAddingToArr = item.tmdb_id;
        discAddError = "";
        try {
            // Step 1: Create a media_parents stub
            const createRes = await fetch("/api/discover/add", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    tmdb_id: item.tmdb_id,
                    media_type: 'show',
                    title: item.title,
                    release_year: item.release_year ? parseInt(item.release_year) : null,
                    poster_url: item.poster_url,
                    overview: item.overview,
                }),
            });
            if (!createRes.ok) {
                const r = await createRes.json();
                throw new Error(r.error || "Failed to create media entry");
            }
            const { mediaParentId } = await createRes.json();

            // Step 2: Add to Sonarr
            const arrRes = await fetch(`/api/arr/sonarr/add`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    mediaParentId,
                    qualityProfileId: discSelectedProfileId,
                    rootFolderPath: discSelectedRootFolder,
                }),
            });
            if (!arrRes.ok) {
                const r = await arrRes.json();
                throw new Error(r.error || "Failed to add to Sonarr");
            }
            const next = new Set(discAddedToArr);
            next.add(item.tmdb_id);
            discAddedToArr = next;
        } catch (e) {
            discAddError = e instanceof Error ? e.message : "Failed";
            setTimeout(() => (discAddError = ""), 5000);
        }
        discAddingToArr = null;
        discPendingItem = null;
    }
</script>

<svelte:head>
    <title>{data.show.title} — Mediajam</title>
</svelte:head>

<div class="space-y-6 max-w-6xl mx-auto">
        <!-- ═══ NEW LAYOUT (Option B) ═══ -->
        <MediaDetailHeader
            mediaType="show"
            backHref="/tv"
            backLabel="Shows"
            title={data.show.title}
            posterUrl={data.show.posterUrl || (data.show.poster_url ? imgUrl(data.show.poster_url) : null)}
            backdropUrl={data.show.backdropUrl}
            year={data.show.release_year}
            overview={data.show.overview}
            isFavorite={!!data.show.is_favorite}
            favoriteType="media"
            favoriteId={data.show.id}
            heartBorderEnabled={!!data.settings?.heartBorderShows}
            heroBadges={[]}
            stats={[
                { label: data.seasons.length === 1 ? 'season' : 'seasons', value: data.seasons.length },
                { label: 'watched', value: `${data.totalWatched}/${data.totalEpisodes}` },
                ...(data.show.collection_pct !== null ? [{ label: 'collected', value: `${data.show.collection_pct}%` }] : []),
                ...(data.totalMissing > 0 ? [{ label: 'missing', value: data.totalMissing }] : []),
                ...(data.totalUpcoming > 0 ? [{ label: 'upcoming', value: data.totalUpcoming }] : []),
            ]}
            externalLinks={{
                tmdb_id: data.show.tmdb_id,
                imdb_id: data.show.imdb_id,
                tvdb_id: data.show.tvdb_id,
                jellyfin_id: data.show.jellyfin_id,
                jellyfin_url: data.jellyfinUrl,
                arr_slug: data.show.arr_slug,
                arr_url: data.arrUrl,
                arr_service: data.arrService,
                trakt_slug: data.show.trakt_slug,
                wikipedia_url: data.show.wikipedia_url,
                mediaType: 'show'
            }}
        >
            {#snippet actions()}
                <button
                    class="btn btn-xs btn-ghost gap-1"
                    class:btn-success={syncStatus === 'success'}
                    class:btn-error={syncStatus === 'failed'}
                    disabled={syncing}
                    onclick={fullSync}
                    title={syncStatus === 'failed' ? syncError : ''}
                >
                    {#if syncing}
                        <span class="loading loading-spinner loading-xs"></span> Syncing…
                    {:else if syncStatus === 'success'}
                        <MdiIcon icon={mdiCheckCircle} size={14} /> Synced
                    {:else if syncStatus === 'failed'}
                        <MdiIcon icon={mdiCloseCircle} size={14} /> {syncError || 'Failed'}
                    {:else}
                        <MdiIcon icon={mdiSync} size={14} /> {data.show.jellyfin_id ? 'Update from Jellyfin' : 'Update from TMDb'}
                    {/if}
                </button>
                {#if data.show.sonarr_id}
                    <InteractiveSearchDialog
                        service="sonarr"
                        mediaParentId={data.show.id}
                        title="{data.show.title} ({data.show.release_year || ''})"
                    />
                    <button
                        class="btn btn-xs btn-ghost gap-1"
                        onclick={toggleMonitorSonarr}
                        disabled={arrLoading === 'monitor'}
                    >
                        {#if arrLoading === 'monitor'}<span class="loading loading-spinner loading-xs"></span>{:else if arrMonitored}<MdiIcon icon={mdiBookmark} size={16} />{:else}<MdiIcon icon={mdiBookmarkOutline} size={16} />{/if}
                        {arrMonitored ? 'Unmonitor' : 'Monitor'}
                    </button>
                {:else if data.show.tvdb_id || data.show.tmdb_id}
                    <ArrAddDialog
                        service="sonarr"
                        mediaParentId={data.show.id}
                        onComplete={onArrAdded}
                    />
                {/if}
                <button
                    class="btn btn-xs btn-ghost gap-1"
                    onclick={toggleDashboardHidden}
                    title={isDashboardHidden ? 'Show on TV dashboard' : 'Hide from TV dashboard'}
                >
                    {#if isDashboardHidden}
                        <MdiIcon icon={mdiEye} size={14} /> Unignore
                    {:else}
                        <MdiIcon icon={mdiCancel} size={14} /> Ignore
                    {/if}
                </button>
                {#if data.show.jellyfin_id}
                    <RemotePlayButton
                        jellyfinId={data.show.jellyfin_id}
                        enabled={$page.data.remoteControlEnabled}
                        savedPlayers={$page.data.userPreferences?.savedPlayers || []}
                        defaultPlayerId={$page.data.userPreferences?.defaultPlayerId || ''}
                    />
                {/if}
                <button
                    class="btn btn-xs btn-ghost gap-1"
                    onclick={() => { showMergeDialog = true; mergeSearchQuery = ''; mergeSearchResults = []; }}
                    title="Merge this show into another"
                >
                    <MdiIcon icon={mdiMerge} size={14} /> Merge
                </button>
            {/snippet}
        </MediaDetailHeader>

        <!-- Collection Status Banner -->
        <CollectionStatusBanner
            mediaParentId={data.show.id}
            mediaType="show"
            title={data.show.title}
            collectionStatus={data.show.collection_status}
            arrHasFile={data.show.arr_has_file}
            arrId={data.show.sonarr_id}
            arrMonitored={data.show.arr_monitored}
            releaseYear={data.show.release_year}
            premiereDate={null}
            service="sonarr"
            jellyfinId={data.show.jellyfin_id}
            tmdbId={data.show.tmdb_id}
            collectedCount={data.totalEpisodes}
            missingCount={data.totalMissing}
            onStatusChange={() => invalidateAll()}
        />

    <!-- Episode Grid / List -->
    <div class="space-y-2">
        <div class="flex items-center justify-between">
            <h2 class="text-xl font-bold">Episodes</h2>
            <div class="join">
                <button
                    class="join-item btn btn-xs gap-1 {episodeView === 'map' ? 'btn-primary' : 'btn-ghost'}"
                    onclick={() => episodeView = 'map'}
><MdiIcon icon={mdiViewGrid} size={14} />Grid</button>
                <button
                    class="join-item btn btn-xs gap-1 {episodeView === 'ratings' ? 'btn-primary' : 'btn-ghost'}"
                    onclick={() => episodeView = 'ratings'}
><MdiIcon icon={mdiStar} size={14} />Ratings</button>
                <button
                    class="join-item btn btn-xs gap-1 {episodeView === 'list' ? 'btn-primary' : 'btn-ghost'}"
                    onclick={() => episodeView = 'list'}
><MdiIcon icon={mdiViewList} size={14} />List</button>
            </div>
        </div>

        {#if episodeView === 'map'}
            <p class="text-xs text-base-content/50">
                <span
                    class="inline-block w-3 h-3 rounded-sm bg-success mr-1 align-middle"
                ></span>
                Watched
                <span
                    class="inline-block w-3 h-3 rounded-sm bg-warning mr-1 ml-3 align-middle"
                ></span>
                In Progress
                <span
                    class="inline-block w-3 h-3 rounded-sm ep-unwatched-legend mr-1 ml-3 align-middle"
                ></span>
                Not Watched
                <span
                    class="inline-block w-3 h-3 rounded-sm ep-missing-legend mr-1 ml-3 align-middle"
                ></span>
                Missing
                <span
                    class="inline-block w-3 h-3 rounded-sm ep-upcoming-legend mr-1 ml-3 align-middle"
                ></span>
                Upcoming
            </p>

            <div style="overflow: visible; padding-top: 2.5rem;">
                <div class="grid-container">
                    {#each data.seasons as season}
                        <div class="grid-row">
                            <div
                                class="season-label"
                                title="Season {season.number}"
                            >
                                {#if season.number === 0}
                                    <span class="text-xs">SP</span>
                                {:else}
                                    <span class="text-xs">S{season.number}</span>
                                {/if}
                            </div>
                            <div class="episode-cells">
                                {#each season.episodes as ep}
                                    <div
                                        class="tooltip"
                                        data-tip="S{season.number}E{ep.item_number} {ep.title}"
                                    >
                                    <a
                                        href="/tv/{data.show.id}/episode/{ep.id}"
                                        class="ep-cell {statusClass(
                                            ep.watch_status,
                                            ep.is_collected,
                                            ep.premiere_date,
                                        )}"
                                    >
                                        <span class="ep-num">{ep.item_number}</span>
                                    </a>
                                    </div>
                                {/each}
                            </div>
                            <div class="season-stat">
                                <span class="text-xs text-base-content/50">
                                    {season.collected}/{season.total}
                                </span>
                            </div>
                        </div>
                    {/each}
                </div>
            </div>
        {:else if episodeView === 'ratings'}
            <!-- Ratings Heatmap -->
            <div class="flex flex-wrap items-center gap-x-4 gap-y-0.5 text-xs text-base-content/60 mb-2">
                <span class="flex items-center gap-1"><span class="inline-block w-3 h-3 rounded-sm bg-[#0d6e3f]"></span> Outstanding (9+)</span>
                <span class="flex items-center gap-1"><span class="inline-block w-3 h-3 rounded-sm bg-[#2d9d5c]"></span> Excellent (8+)</span>
                <span class="flex items-center gap-1"><span class="inline-block w-3 h-3 rounded-sm bg-[#8cc152]"></span> Solid (7+)</span>
                <span class="flex items-center gap-1"><span class="inline-block w-3 h-3 rounded-sm bg-[#c9a833]"></span> Fair (6+)</span>
                <span class="flex items-center gap-1"><span class="inline-block w-3 h-3 rounded-sm bg-[#d35430]"></span> Poor (4+)</span>
                <span class="flex items-center gap-1"><span class="inline-block w-3 h-3 rounded-sm bg-[#6b4226]"></span> Awful (&lt;4)</span>
                <label class="flex items-center gap-1.5 ml-auto cursor-pointer">
                    <input type="checkbox" class="toggle toggle-xs toggle-success" bind:checked={showWatchStatus} />
                    <span>Watch Status</span>
                </label>
            </div>

            <div class="overflow-x-auto" style="overflow-y: visible; padding-top: 2.5rem;">
                <div class="grid-container">
                    {#each data.seasons as season}
                        <div class="grid-row">
                            <div
                                class="season-label"
                                title="Season {season.number}"
                            >
                                {#if season.number === 0}
                                    <span class="text-xs">SP</span>
                                {:else}
                                    <span class="text-xs">S{season.number}</span>
                                {/if}
                            </div>
                            <div class="episode-cells">
                                {#each season.episodes as ep}
                                    <div
                                        class="tooltip"
                                        data-tip="S{season.number}E{ep.item_number} {ep.title}"
                                    >
                                    <a
                                        href="/tv/{data.show.id}/episode/{ep.id}"
                                        class="ep-cell {ratingColor(ep.community_rating)} {showWatchStatus ? watchBorderClass(ep) : ''}"
                                    >
                                        <span class="ep-rating">{ep.community_rating != null ? ep.community_rating.toFixed(1) : '—'}</span>
                                    </a>
                                    </div>
                                {/each}
                            </div>
                            {#each [season.episodes.filter(e => e.community_rating != null)] as rated}
                                <div class="season-stat">
                                    <span class="text-xs text-base-content/50">
                                        {rated.length > 0 ? (rated.reduce((s, e) => s + e.community_rating, 0) / rated.length).toFixed(1) : '—'}
                                    </span>
                                </div>
                            {/each}
                        </div>
                    {/each}
                </div>
            </div>
        {:else}
            <!-- List view with accordion -->
            <div class="join join-vertical w-full">
                {#each data.seasons as season, i}
                    <div class="collapse collapse-arrow join-item bg-base-200/50 border border-base-300">
                        <input type="checkbox" name="season-accordion-{i}" />
                        <div class="collapse-title font-medium text-sm">
                            {season.number === 0
                                ? "Specials"
                                : `Season ${season.number}`}
                            <span class="text-base-content/50 ml-2">
                                ({season.collected}/{season.total} collected
                                {#if season.missing > 0}
                                    · <span class="text-error"
                                        >{season.missing} missing</span
                                    >
                                {/if}
                                {#if season.upcoming > 0}
                                    · <span class="text-base-content/40"
                                        >{season.upcoming} upcoming</span
                                    >
                                {/if})
                            </span>
                        </div>
                        <div class="collapse-content">
                            <div class="overflow-x-auto">
                                <table class="table table-sm">
                                    <thead>
                                        <tr class="text-xs text-base-content/50">
                                            <th class="w-12">#</th>
                                            <th>Title</th>
                                            <th class="w-24">Status</th>
                                            <th class="w-16">Plays</th>
                                            <th class="w-16">Duration</th>
                                            {#if data.show.sonarr_id}
                                                <th class="w-24">Search</th>
                                            {/if}
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {#each season.episodes as ep}
                                            <tr
                                                class="hover:bg-base-300/20"
                                                class:ep-row-missing={!ep.is_collected}
                                            >
                                                <td class="text-base-content/50"
                                                    >{ep.item_number}</td
                                                >
                                                <td class="font-medium">
                                                    <a
                                                        href="/tv/{data.show
                                                            .id}/episode/{ep.id}"
                                                        class="hover:text-primary transition-colors"
                                                    >
                                                        {ep.title}
                                                    </a>
                                                    {#if !ep.is_collected}
                                                        <span
                                                            class="badge badge-error badge-xs ml-1"
                                                            >MISSING</span
                                                        >
                                                    {/if}
                                                </td>
                                                <td>
                                                    {#if !ep.is_collected}
                                                        <span
                                                            class="badge badge-error badge-sm"
                                                            >✗</span
                                                        >
                                                    {:else if ep.watch_status === "watched"}
                                                        <span
                                                            class="badge badge-success badge-sm"
                                                            >✓</span
                                                        >
                                                    {:else if ep.watch_status === "in_progress"}
                                                        <span
                                                            class="badge badge-warning badge-sm"
                                                            >⏳</span
                                                        >
                                                    {:else}
                                                        <span
                                                            class="badge badge-ghost badge-sm"
                                                            >—</span
                                                        >
                                                    {/if}
                                                </td>
                                                <td class="text-base-content/50"
                                                    >{ep.is_collected
                                                        ? ep.play_count || "—"
                                                        : "—"}</td
                                                >
                                                <td class="text-base-content/50"
                                                    >{ep.is_collected
                                                    ? formatRuntime(
                                                              ep.runtime_ticks,
                                                          )
                                                        : ""}</td
                                                >
                                                {#if data.show.sonarr_id}
                                                    <td>
                                                        <div class="flex items-center gap-1">
                                                            <button
                                                                class="btn btn-xs btn-ghost btn-square"
                                                                title="Auto-search for this episode"
                                                                disabled={epSearching.has(ep.id)}
                                                                onclick={() => autoSearchEpisode(ep)}
                                                            >
                                                                {#if epSearching.has(ep.id)}
                                                                    <span class="loading loading-spinner loading-xs"></span>
                                                                {:else if epSearchDone.has(ep.id)}
                                                                    <MdiIcon icon={mdiCheckCircle} size={14} class="text-success" />
                                                                {:else}
                                                                    <MdiIcon icon={mdiDownload} size={14} />
                                                                {/if}
                                                            </button>
                                                            <button
                                                                class="btn btn-xs btn-ghost btn-square"
                                                                title="Browse available releases"
                                                                onclick={() => browseEpisodeReleases(ep)}
                                                            >
                                                                <MdiIcon icon={mdiMagnifyPlusOutline} size={14} />
                                                            </button>
                                                        </div>
                                                    </td>
                                                {/if}
                                            </tr>
                                        {/each}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                {/each}
            </div>
        {/if}
    </div>

    {#if data.show.sonarr_id}
        <InteractiveSearchDialog
            bind:this={epSearchDialog}
            service="sonarr"
            mediaParentId={data.show.id}
            title={epInteractiveSearchTitle}
            episodeId={epInteractiveSearchId}
            hidden={true}
        />
    {/if}

    <!-- Cast & Crew -->
    {#if data.cast.length > 0 || data.crew.length > 0}
        <DashSection title="Cast & Crew" icon={mdiDramaMasks} noGlow>
            {#if data.cast.length > 0}
                <CreditRow title="Cast" items={data.cast} limit={20} />
            {/if}
            {#if data.crew.length > 0}
                <CreditRow title="Crew" items={data.crew} limit={20} />
            {/if}
        </DashSection>
    {/if}

    <!-- Similar Shows -->
    {#if data.similarInLibrary.length > 0 || data.similarYouMightLike.length > 0 || data.show.tmdb_id}
        <DashSection title="Similar Shows" icon={mdiLightbulb} noGlow>
            {#if data.similarInLibrary.length > 0}
                <h4 class="text-sm font-semibold text-base-content/60 mb-2">In Your Library</h4>
                <div class="grid grid-cols-[repeat(auto-fill,minmax(110px,1fr))] gap-3">
                    {#each data.similarInLibrary as item}
                        <a href={item.href} class="no-underline text-inherit transition-transform duration-150 hover:-translate-y-1" title={item.title}>
                            <div class="relative aspect-[2/3] rounded-lg overflow-hidden bg-base-300 shadow-md">
                                {#if item.poster_url}
                                    <img src={imgUrl(item.poster_url)} alt={item.title} class="w-full h-full object-cover" loading="lazy" />
                                {/if}
                            </div>
                            <div class="mt-1.5 flex flex-col gap-px">
                                <span class="text-[0.72rem] font-semibold leading-tight truncate">{item.title}</span>
                                {#if item.subtitle}
                                    <span class="text-[0.62rem] text-base-content/40">{item.subtitle}</span>
                                {/if}
                            </div>
                        </a>
                    {/each}
                </div>
            {/if}
            {#if data.similarYouMightLike.length > 0}
                <h4 class="text-sm font-semibold text-base-content/60 mb-2 mt-4">You Might Also Like</h4>
                <div class="grid grid-cols-[repeat(auto-fill,minmax(110px,1fr))] gap-3">
                    {#each data.similarYouMightLike as item}
                        <a href={item.href} class="no-underline text-inherit transition-transform duration-150 hover:-translate-y-1" title={item.title}>
                            <div class="relative aspect-[2/3] rounded-lg overflow-hidden bg-base-300 shadow-md">
                                {#if item.poster_url}
                                    <img src={imgUrl(item.poster_url)} alt={item.title} class="w-full h-full object-cover" loading="lazy" />
                                {/if}
                            </div>
                            <div class="mt-1.5 flex flex-col gap-px">
                                <span class="text-[0.72rem] font-semibold leading-tight truncate">{item.title}</span>
                                {#if item.subtitle}
                                    <span class="text-[0.62rem] text-base-content/40">{item.subtitle}</span>
                                {/if}
                            </div>
                        </a>
                    {/each}
                </div>
            {/if}

            <!-- Discover Related (inline) -->
            {#if data.show.tmdb_id}
                {#if !discoveryLoaded && !discoveryLoading}
                    <button class="btn btn-ghost btn-sm gap-2 w-full mt-2" onclick={loadDiscovery}>
                        <MdiIcon icon={mdiMagnify} size={16} /> Discover More Related Shows
                    </button>
                {:else if discoveryLoading}
                    <div class="flex justify-center py-4">
                        <span class="loading loading-spinner loading-md"></span>
                        <span class="ml-2 text-sm text-base-content/50">Finding related shows…</span>
                    </div>
                {:else if discoveryError}
                    <div class="alert alert-error text-sm">{discoveryError}</div>
                {:else}
                    <div class="mt-3">
                        <div class="flex items-center justify-between mb-2">
                            <h3 class="text-sm font-semibold text-base-content/60">
                                Discover
                                <span class="badge badge-sm badge-ghost ml-1">{filteredDiscoveryItems(discoveryItems).length} not in library</span>
                            </h3>
                            <div class="flex items-center gap-2">
                                <label class="flex items-center gap-1.5 cursor-pointer text-xs text-base-content/60">
                                    <input type="checkbox" class="toggle toggle-xs toggle-primary" bind:checked={hideDocumentaries} />
                                    Hide docs/making-of
                                </label>
                                {#if discoveryInLibrary.length > 0}
                                    <button
                                        class="btn btn-ghost btn-xs"
                                        onclick={() => showDiscoverInLib = !showDiscoverInLib}
                                    >
                                        {showDiscoverInLib ? 'Hide' : 'Show'} {discoveryInLibrary.length} in library
                                    </button>
                                {/if}
                            </div>
                        </div>

                        {#if filteredDiscoveryItems(discoveryItems).length === 0 && !showDiscoverInLib}
                            <div class="text-center py-4 text-base-content/40">
                                <p>You have all the related shows!</p>
                            </div>
                        {:else}
                            <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
                                {#each filteredDiscoveryItems(discoveryItems).slice(0, discoveryLimit) as item}
                                    <div class="card bg-base-300/30 card-compact overflow-hidden group">
                                        {#if item.poster_url}
                                            <figure class="aspect-[2/3] relative">
                                                <img src={imgUrl(item.poster_url)} alt={item.title} class="w-full h-full object-cover" />
                                                {#if item.vote_average > 0}
                                                    <div class="absolute top-1 right-1 badge badge-sm bg-black/60 border-0 text-warning">
                                                        ★ {item.vote_average.toFixed(1)}
                                                    </div>
                                                {/if}
                                            </figure>
                                        {:else}
                                            <div class="aspect-[2/3] bg-base-300 flex items-center justify-center"><MdiIcon icon={mdiTelevision} size={32} /></div>
                                        {/if}
                                        <div class="card-body !p-2 !gap-1">
                                            <h3 class="font-medium text-xs leading-tight line-clamp-2" title={item.title}>{item.title}</h3>
                                            {#if item.release_year}
                                                <span class="text-[10px] text-base-content/40">{item.release_year}</span>
                                            {/if}
                                            <button
                                                class="btn btn-xs btn-primary gap-1 mt-1 w-full"
                                                disabled={discAddingToArr === item.tmdb_id || discAddedToArr.has(item.tmdb_id)}
                                                onclick={() => addDiscoveryToArr(item)}
                                            >
                                                {#if discAddingToArr === item.tmdb_id}
                                                    <span class="loading loading-spinner loading-xs"></span>
                                                {:else if discAddedToArr.has(item.tmdb_id)}
                                                    <MdiIcon icon={mdiCheckCircle} size={12} /> Added
                                                {:else}
                                                    <MdiIcon icon={mdiDownload} size={12} />
                                                    Download
                                                {/if}
                                            </button>
                                        </div>
                                    </div>
                                {/each}

                                {#if showDiscoverInLib}
                                    {#each discoveryInLibrary as item}
                                        <a href="/tv/{item.library_id}" class="card bg-base-300/30 card-compact overflow-hidden group opacity-60 ring-2 ring-success/30">
                                            {#if item.poster_url}
                                                <figure class="aspect-[2/3]">
                                                    <img src={imgUrl(item.poster_url)} alt={item.title} class="w-full h-full object-cover" />
                                                </figure>
                                            {:else}
                                                <div class="aspect-[2/3] bg-base-300 flex items-center justify-center"><MdiIcon icon={mdiTelevision} size={32} /></div>
                                            {/if}
                                            <div class="card-body !p-2 !gap-1">
                                                <span class="badge badge-xs badge-success">✓ In Library</span>
                                                <h3 class="font-medium text-xs leading-tight line-clamp-2">{item.title}</h3>
                                            </div>
                                        </a>
                                    {/each}
                                {/if}
                            </div>

                            {#if discoveryItems.length > discoveryLimit}
                                <button class="btn btn-ghost btn-sm w-full mt-2" onclick={() => discoveryLimit += 12}>
                                    Show more ({discoveryItems.length - discoveryLimit} remaining)
                                </button>
                            {/if}
                        {/if}

                        {#if discAddError}
                            <div class="alert alert-error text-sm mt-2">{discAddError}</div>
                        {/if}
                    </div>
                {/if}
            {/if}
        </DashSection>
    {/if}
</div>

<!-- Discovery Quality Profile Dialog -->
{#if discShowProfileDialog && discPendingItem}
    <div class="modal modal-open">
        <div class="modal-box max-w-sm">
            <h3 class="font-bold text-lg">Add to Sonarr</h3>
            <p class="text-sm text-base-content/60 mt-1">{discPendingItem.title}</p>
            <div class="space-y-3 mt-3">
                <div class="form-control">
                    <label class="label" for="disc-qp"><span class="label-text text-sm">Quality Profile</span></label>
                    <select id="disc-qp" class="select select-bordered select-sm w-full" bind:value={discSelectedProfileId}>
                        {#each discAvailableProfiles as p}
                            <option value={p.id}>{p.name}</option>
                        {/each}
                    </select>
                </div>
                {#if discAvailableRootFolders.length > 1}
                    <div class="form-control">
                        <label class="label" for="disc-rf"><span class="label-text text-sm">Root Folder</span></label>
                        <select id="disc-rf" class="select select-bordered select-sm w-full" bind:value={discSelectedRootFolder}>
                            {#each discAvailableRootFolders as rf}
                                <option value={rf.path}>{rf.path}</option>
                            {/each}
                        </select>
                    </div>
                {/if}
            </div>
            <div class="modal-action">
                <button class="btn btn-sm btn-ghost" onclick={() => { discShowProfileDialog = false; discPendingItem = null; }}>Cancel</button>
                <button class="btn btn-sm btn-primary" onclick={confirmDiscoveryAdd} disabled={!discSelectedProfileId}>Add</button>
            </div>
        </div>
        <button class="modal-backdrop" aria-label="Close dialog" onclick={() => { discShowProfileDialog = false; discPendingItem = null; }}></button>
    </div>
{/if}

<!-- Delete Confirmation Modal -->
{#if showDeleteConfirm}
    <div class="modal modal-open">
        <div class="modal-box">
            <h3 class="font-bold text-lg">Delete "{data.show.title}"?</h3>
            <p class="py-4 text-base-content/70">
                This will remove this show and all its episodes, watch history, and ratings.
                {#if data.show.jellyfin_id}
                    <br /><span class="text-warning text-sm"><MdiIcon icon={mdiAlert} size={14} /> This item is in Jellyfin and will reappear on the next sync.</span>
                {/if}
            </p>
            <div class="modal-action">
                <button class="btn" onclick={() => (showDeleteConfirm = false)}>Cancel</button>
                <button class="btn btn-error" onclick={deleteItem} disabled={deleting}>
                    {#if deleting}
                        <span class="loading loading-spinner loading-xs"></span>
                    {/if}
                    Delete
                </button>
            </div>
        </div>
        <button class="modal-backdrop" aria-label="Close dialog" onclick={() => (showDeleteConfirm = false)}></button>
    </div>
{/if}

<!-- Merge Modal -->
{#if showMergeDialog}
    <div class="modal modal-open">
        <div class="modal-box">
            <h3 class="font-bold text-lg">Merge "{data.show.title}" into...</h3>
            <p class="text-sm text-base-content/60 mt-1">All episodes, history, and credits will be moved to the target show. This show will be deleted.</p>
            <div class="form-control mt-4">
                <input
                    type="text"
                    placeholder="Search for target show..."
                    class="input input-bordered input-sm w-full"
                    bind:value={mergeSearchQuery}
                    oninput={searchMergeTarget}
                />
            </div>
            {#if mergeSearching}
                <div class="flex justify-center py-4"><span class="loading loading-spinner loading-sm"></span></div>
            {:else if mergeSearchResults.length > 0}
                <div class="mt-3 max-h-60 overflow-y-auto space-y-1">
                    {#each mergeSearchResults as target}
                        <button
                            class="flex items-center gap-3 w-full p-2 rounded-lg hover:bg-base-300/50 transition-colors text-left"
                            onclick={() => mergeInto(target)}
                            disabled={merging}
                        >
                            {#if target.poster_url}
                                <img src={imgUrl(target.poster_url, 80)} alt="" class="w-10 h-14 rounded object-cover shrink-0" />
                            {:else}
                                <div class="w-10 h-14 bg-base-300 rounded flex items-center justify-center"><MdiIcon icon={mdiTelevision} size={24} /></div>
                            {/if}
                            <div class="min-w-0">
                                <div class="font-medium text-sm truncate">{target.title}</div>
                                <div class="text-xs text-base-content/50">{target.release_year || ''} · {target.episode_count || 0} episodes</div>
                            </div>
                        </button>
                    {/each}
                </div>
            {:else if mergeSearchQuery.length >= 2}
                <p class="text-sm text-base-content/40 py-4 text-center">No matching shows found</p>
            {/if}
            <div class="modal-action">
                <button class="btn btn-sm" onclick={() => (showMergeDialog = false)}>Cancel</button>
            </div>
        </div>
        <button class="modal-backdrop" aria-label="Close dialog" onclick={() => (showMergeDialog = false)}></button>
    </div>
{/if}

<style>
    .grid-container {
        display: flex;
        flex-direction: column;
        gap: 2px;
    }

    /* Fix tooltip clipping — ensure tooltips can escape container bounds */
    .grid-container,
    .grid-row,
    .episode-cells {
        overflow: visible;
    }
    .episode-cells :global(.tooltip) {
        position: relative;
        /* Lift hovered tooltip above all siblings */
    }
    .episode-cells :global(.tooltip:hover) {
        z-index: 50;
    }
    .episode-cells :global(.tooltip::before) {
        white-space: nowrap;
        max-width: 260px;
        overflow: hidden;
        text-overflow: ellipsis;
        z-index: 50;
        /* Force tooltip above the row, shift to right so left-edge cells aren't clipped */
        left: 0;
        transform: translateY(-100%);
        translate: 0;
    }

    .grid-row {
        display: flex;
        align-items: center;
        gap: 4px;
    }

    .season-label {
        width: 32px;
        text-align: right;
        color: oklch(var(--bc) / 0.5);
        flex-shrink: 0;
    }

    .episode-cells {
        display: flex;
        gap: 2px;
        flex-wrap: wrap;
    }

    .ep-cell {
        width: 24px;
        height: 24px;
        border-radius: 4px;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: default;
        transition:
            transform 0.15s,
            box-shadow 0.15s;
        position: relative;
    }

    .ep-cell:hover {
        transform: scale(1.3);
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
        z-index: 10;
    }

    .ep-num {
        font-size: 8px;
        font-weight: 600;
        opacity: 0.6;
    }

    .ep-watched {
        background: oklch(var(--su, 0.75 0.18 140));
        color: oklch(var(--suc, 0.2 0.05 140));
    }

    .ep-watched .ep-num {
        opacity: 0.9;
    }

    .ep-progress {
        background: oklch(var(--wa, 0.8 0.15 75));
        color: oklch(var(--wac, 0.2 0.04 75));
    }

    .ep-progress .ep-num {
        opacity: 0.9;
    }

    .ep-unwatched {
        background: rgba(100, 116, 139, 0.6);
    }

    .ep-missing {
        background: rgba(239, 68, 68, 0.15);
        border: 2px dashed rgba(239, 68, 68, 0.8);
    }

    .ep-missing .ep-num {
        opacity: 0.5;
        color: rgba(239, 68, 68, 0.9);
    }

    :global(.ep-unwatched-legend) {
        background: rgba(100, 116, 139, 0.6);
    }

    :global(.ep-missing-legend) {
        background: rgba(239, 68, 68, 0.15);
        border: 2px dashed rgba(239, 68, 68, 0.8);
    }

    .ep-upcoming {
        background: rgba(100, 116, 139, 0.6);
        border: 2px dashed oklch(var(--wa, 0.8 0.15 75));
    }

    .ep-upcoming .ep-num {
        opacity: 0.4;
    }

    :global(.ep-upcoming-legend) {
        background: rgba(100, 116, 139, 0.6);
        border: 2px dashed oklch(var(--wa, 0.8 0.15 75));
    }

    .ep-row-missing {
        opacity: 0.5;
    }

    .season-stat {
        flex-shrink: 0;
        width: 48px;
        text-align: right;
    }

    .ep-rating {
        font-size: 9px;
        font-weight: 700;
        opacity: 0.9;
        line-height: 1;
    }
</style>
