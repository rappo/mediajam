<script>
    import FavoriteButton from "$lib/components/FavoriteButton.svelte";
    import ExternalLinks from "$lib/components/ExternalLinks.svelte";
    import ArrAddDialog from "$lib/components/ArrAddDialog.svelte";
    import HeartBorder from "$lib/components/HeartBorder.svelte";
    import RemotePlayButton from "$lib/components/RemotePlayButton.svelte";
    import StatCard from "$lib/components/StatCard.svelte";
    import ServiceIcon from "$lib/components/ServiceIcon.svelte";
    import InteractiveSearchDialog from "$lib/components/InteractiveSearchDialog.svelte";
    import MediaDetailHeader from "$lib/components/MediaDetailHeader.svelte";
    import PosterRow from "$lib/components/PosterRow.svelte";
    import { invalidateAll, goto } from "$app/navigation";
    import { page } from "$app/stores";
    import { imgUrl } from "$lib/utils.js";
    let { data } = $props();



    function formatRuntime(minutes) {
        if (!minutes) return "—";
        const h = Math.floor(minutes / 60);
        const m = Math.round(minutes % 60);
        return h > 0 ? `${h}h ${m}m` : `${m}m`;
    }

    function formatDate(timestamp) {
        if (!timestamp) return "—";
        return new Date(timestamp).toLocaleDateString("en-US", {
            year: "numeric",
            month: "short",
            day: "numeric",
        });
    }

    function timeAgo(timestamp) {
        if (!timestamp) return "";
        const diff = Date.now() - new Date(timestamp).getTime();
        const days = Math.floor(diff / 86400000);
        if (days === 0) return "today";
        if (days === 1) return "yesterday";
        if (days < 30) return `${days}d ago`;
        if (days < 365) return `${Math.floor(days / 30)}mo ago`;
        return `${Math.floor(days / 365)}y ago`;
    }

    function watchStatusBadge(status) {
        if (status === "watched")
            return { label: "Watched", cls: "badge-success" };
        if (status === "in_progress")
            return { label: "In Progress", cls: "badge-warning" };
        return { label: "Unwatched", cls: "badge-ghost" };
    }

    function sourceIcon(source) {
        const map = {
            webhook: null,
            trakt: "trakt",
            lastfm: "lastfm",
            jellyfin_pr: "jellyfin",
        };
        return map[source] || null;
    }

    const badge = watchStatusBadge(data.movie.watch_status);

    // Watchlist toggle
    let inWatchlist = $state(data.inWatchlist);
    let watchlistLoading = $state(false);

    async function toggleWatchlist() {
        watchlistLoading = true;
        const prev = inWatchlist;
        inWatchlist = !inWatchlist; // optimistic
        try {
            const res = await fetch('/api/watchlist', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ mediaParentId: data.movie.id })
            });
            const result = await res.json();
            inWatchlist = result.inWatchlist;
        } catch {
            inWatchlist = prev; // revert
        }
        watchlistLoading = false;
    }

    let syncing = $state(false);
    let syncStatus = $state("");
    let syncError = $state("");

    // Runtime lazy-fetch
    let lazyRuntime = $state(/** @type {number|null} */ (null));
    let runtimeLoading = $state(false);

    $effect(() => {
        if (data.movie.needsRuntimeFetch && !lazyRuntime && !runtimeLoading) {
            runtimeLoading = true;
            fetch(`/api/movies/${data.movie.id}/runtime`)
                .then(r => r.json())
                .then(d => {
                    if (d.runtime) lazyRuntime = d.runtime;
                })
                .catch(() => {})
                .finally(() => { runtimeLoading = false; });
        }
    });

    let showDeleteConfirm = $state(false);
    let showAllCast = $state(false);
    let showAllCrew = $state(false);
    let deleting = $state(false);

    async function deleteItem() {
        deleting = true;
        try {
            const res = await fetch(`/api/media/${data.movie.id}`, { method: 'DELETE' });
            const result = await res.json();
            if (result.success) {
                const params = new URLSearchParams({ deleted: result.title, undoToken: result.undoToken, undoId: String(data.movie.id) });
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

    // External ratings
    let externalRatings = $state(data.externalRatings || []);
    let ratingsLoading = $state(false);

    function getRating(source) {
        return externalRatings.find(
            (r) => r.source === source && r.rating_type === "score",
        );
    }

    async function refreshRatings() {
        ratingsLoading = true;
        try {
            const res = await fetch("/api/ratings", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    mediaParentId: data.movie.id,
                    refresh: true,
                }),
            });
            const result = await res.json();
            if (result.ratings) externalRatings = result.ratings;
        } catch {
            /* ignore */
        }
        ratingsLoading = false;
    }

    // Auto-fetch ratings on first visit if none exist
    let ratingsAutoFetched = $state(false);
    $effect(() => {
        if (
            externalRatings.length === 0 &&
            !ratingsLoading &&
            !ratingsAutoFetched &&
            (data.movie.tmdb_id || data.movie.imdb_id)
        ) {
            ratingsAutoFetched = true;
            refreshRatings();
        }
    });

    // *arr state
    let arrLoading = $state("");
    let arrError = $state("");
    let arrMonitored = $state(!!data.movie.arr_monitored);
    let searchDialog = $state(/** @type {any} */ (null));

    // File quality lazy-fetch from *arr
    let fileInfo = $state(/** @type {any} */ (null));
    let fileInfoLoading = $state(false);

    $effect(() => {
        if (data.movie.radarr_id && data.movie.arr_has_file && !fileInfo && !fileInfoLoading) {
            fileInfoLoading = true;
            fetch(`/api/arr/radarr/file-info?mediaParentId=${data.movie.id}`)
                .then(r => r.json())
                .then(d => { if (d.hasFile) fileInfo = d; })
                .catch(() => {})
                .finally(() => { fileInfoLoading = false; });
        }
    });

    /** Format resolution as familiar label */
    function formatResolution(fi) {
        if (!fi) return null;
        let r = fi.qualityResolution;
        if (!r && fi.qualityName) {
            const m = fi.qualityName.match(/(\d+)/i);
            if (m) r = parseInt(m[1]);
        }
        if (!r) return null;
        if (r >= 2160) return '4K';
        if (r >= 1080) return '1080p';
        if (r >= 720) return '720p';
        return 'SD';
    }

    /** Check if file has any HDR format */
    function hasHDR(fi) {
        if (!fi) return false;
        return !!(fi.videoDynamicRangeType || fi.videoDynamicRange);
    }

    let fileInfoExpanded = $state(false);

    function formatFileSize(bytes) {
        if (!bytes) return null;
        const gb = bytes / (1024 * 1024 * 1024);
        if (gb >= 1) return `${gb.toFixed(1)} GB`;
        const mb = bytes / (1024 * 1024);
        return `${mb.toFixed(0)} MB`;
    }

    async function onArrAdded() {
        await invalidateAll();
    }

    async function toggleMonitorRadarr() {
        const newState = !arrMonitored;
        arrLoading = "monitor";
        arrError = "";
        try {
            const res = await fetch("/api/arr/radarr/monitor", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    mediaParentId: data.movie.id,
                    monitored: newState,
                }),
            });
            if (!res.ok) {
                const result = await res.json();
                throw new Error(result.error || "Failed");
            }
            arrMonitored = newState;
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
            const body = data.movie.jellyfin_id
                ? { jellyfinId: data.movie.jellyfin_id }
                : { mediaParentId: data.movie.id, tmdbId: data.movie.tmdb_id };
            const res = await fetch("/api/sync/item", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
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
        if (data.movie.needsEnrichment && !enriching && !enrichFailed) {
            enriching = true;
            const body = data.movie.jellyfin_id
                ? { jellyfinId: data.movie.jellyfin_id }
                : { mediaParentId: data.movie.id, tmdbId: data.movie.tmdb_id };
            fetch('/api/sync/item', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            })
                .then(r => r.json())
                .then(d => { if (d.success) invalidateAll(); else enrichFailed = true; })
                .catch(() => { enrichFailed = true; })
                .finally(() => { enriching = false; });
        }
    });

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

    /** Filter discover items based on toggle */
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
            const res = await fetch(`/api/discover/movie/${data.movie.id}`);
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
            const serviceOptions = options.radarr;
            if (!serviceOptions) throw new Error("Radarr not configured");
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
                    media_type: 'movie',
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

            // Step 2: Add to Radarr
            const arrRes = await fetch(`/api/arr/radarr/add`, {
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
                throw new Error(r.error || "Failed to add to Radarr");
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
    <title>{data.movie.title} — Mediajam</title>
</svelte:head>

<div class="space-y-6 max-w-5xl mx-auto">
        <!-- ═══ NEW LAYOUT (Option B) ═══ -->
        <MediaDetailHeader
            mediaType="movie"
            backHref="/movies"
            backLabel="Movies"
            title={data.movie.title}
            posterUrl={data.movie.posterUrl}
            backdropUrl={data.movie.backdropUrl}
            year={data.movie.release_year}
            runtime={formatRuntime(data.movie.runtime_minutes || lazyRuntime)}
            overview={data.movie.overview}
            watchStatusBadge={badge}
            isFavorite={!!data.movie.is_favorite}
            favoriteType="media"
            favoriteId={data.movie.id}
            heartBorderEnabled={!!data.settings?.heartBorderMovies}
            stats={[
                { label: data.stats.totalPlays === 1 ? 'play' : 'plays', value: data.stats.totalPlays },
                ...(data.stats.lastWatched ? [{ label: 'watched', value: timeAgo(data.stats.lastWatched) }] : []),
                ...(data.movie.community_rating ? [{ label: 'Rating', value: `${data.movie.community_rating} ★` }] : []),
            ]}
            fileInfo={[
                ...(formatResolution(fileInfo) ? [{ label: 'quality', value: formatResolution(fileInfo) }] : []),
                ...(hasHDR(fileInfo) ? [{ label: 'hdr', value: 'HDR' }] : []),
                ...(formatFileSize(fileInfo?.fileSize) ? [{ label: 'size', value: formatFileSize(fileInfo?.fileSize) }] : []),
            ]}
            onFileInfoClick={() => fileInfoExpanded = !fileInfoExpanded}
            externalLinks={{
                tmdb_id: data.movie.tmdb_id,
                imdb_id: data.movie.imdb_id,
                tvdb_id: data.movie.tvdb_id,
                jellyfin_id: data.movie.jellyfin_id,
                jellyfin_url: data.jellyfinUrl,
                arr_slug: data.movie.arr_slug,
                arr_url: data.arrUrl,
                arr_service: data.arrService,
                trakt_slug: data.movie.trakt_slug,
                wikipedia_url: data.movie.wikipedia_url,
                mediaType: 'movie'
            }}
            extraBadges={[
                ...(data.movie.collection_status === 'external' ? [{ label: '📡 Not in library', cls: 'badge-warning' }] : []),
            ]}
        >
            {#snippet watchlistAction()}
                <button
                    class="btn btn-xs btn-ghost gap-1 {inWatchlist ? 'text-primary' : ''}"
                    onclick={toggleWatchlist}
                    disabled={watchlistLoading}
                    title={inWatchlist ? 'Remove from watchlist' : 'Add to watchlist'}
                >
                    {#if inWatchlist}
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 24 24" fill="currentColor"><path d="M14 10H2v2h12v-2zm0-4H2v2h12V6zM2 16h8v-2H2v2zm19.5-4.5L23 13l-6.99 7-4.51-4.5L13 14l3.01 3z"/></svg>
                    {:else}
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 24 24" fill="currentColor"><path d="M14 10H2v2h12v-2zm0-4H2v2h12V6zm4 8v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zM2 16h8v-2H2v2z"/></svg>
                    {/if}
                </button>
            {/snippet}
            {#snippet actions()}
                <button
                    class="btn btn-xs btn-ghost gap-1"
                    class:btn-success={syncStatus === 'success'}
                    class:btn-error={syncStatus === 'failed'}
                    disabled={syncing}
                    onclick={fullSync}
                >
                    {#if syncing}
                        <span class="loading loading-spinner loading-xs"></span> Syncing…
                    {:else if syncStatus === 'success'}
                        ✅ Synced
                    {:else if syncStatus === 'failed'}
                        ❌ Failed
                    {:else}
                        🔄 Full Sync
                    {/if}
                </button>
                {#if data.movie.radarr_id}
                    <InteractiveSearchDialog
                        service="radarr"
                        mediaParentId={data.movie.id}
                        title="{data.movie.title} ({data.movie.release_year || ''})"
                        bind:this={searchDialog}
                    />
                    <button
                        class="btn btn-xs btn-ghost gap-1"
                        onclick={toggleMonitorRadarr}
                        disabled={arrLoading === 'monitor'}
                    >
                        {#if arrLoading === 'monitor'}
                            <span class="loading loading-spinner loading-xs"></span>
                        {:else if arrMonitored}
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 24 24" fill="currentColor"><path d="M17 3H7c-1.1 0-2 .9-2 2v16l7-3 7 3V5c0-1.1-.9-2-2-2z"/></svg>
                        {:else}
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
                        {/if}
                        {arrMonitored ? 'Unmonitor' : 'Monitor'}
                    </button>
                {:else if data.movie.tmdb_id}
                    <ArrAddDialog
                        service="radarr"
                        mediaParentId={data.movie.id}
                        onComplete={onArrAdded}
                    />
                {/if}
                <button
                    class="btn btn-xs btn-ghost gap-1"
                    onclick={refreshRatings}
                    disabled={ratingsLoading}
                >
                    {#if ratingsLoading}
                        <span class="loading loading-spinner loading-xs"></span> Fetching…
                    {:else}
                        📊 Fetch Ratings
                    {/if}
                </button>
                {#if data.movie.jellyfin_id}
                    <RemotePlayButton
                        jellyfinId={data.movie.jellyfin_id}
                        enabled={$page.data.remoteControlEnabled}
                        savedPlayers={$page.data.userPreferences?.savedPlayers || []}
                        defaultPlayerId={$page.data.userPreferences?.defaultPlayerId || ''}
                    />
                {/if}
            {/snippet}
        </MediaDetailHeader>

        <!-- External Ratings (new layout) -->
        {#if externalRatings.length > 0}
            <div class="flex flex-wrap items-center gap-2 mt-3 px-1">
                {#if getRating('omdb_imdb')}
                    {@const r = getRating('omdb_imdb')}
                    <div class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#F5C518]/10 border border-[#F5C518]/20">
                        <ServiceIcon service="imdb" size="w-4 h-4" class="text-[#F5C518]" />
                        <span class="font-bold text-sm">{r.raw_value}</span>
                        {#if r.vote_count}
                            <span class="text-xs text-base-content/40">{(r.vote_count / 1000).toFixed(0)}k</span>
                        {/if}
                    </div>
                {/if}
                {#if getRating('omdb_rt')}
                    {@const r = getRating('omdb_rt')}
                    <div class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#FA320A]/10 border border-[#FA320A]/20">
                        <span class="text-lg leading-none">🍅</span>
                        <span class="font-bold text-sm">{r.raw_value}</span>
                    </div>
                {/if}
                {#if getRating('omdb_metacritic')}
                    {@const r = getRating('omdb_metacritic')}
                    <div class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border {r.value >= 61 ? 'bg-success/10 border-success/20' : r.value >= 40 ? 'bg-warning/10 border-warning/20' : 'bg-error/10 border-error/20'}">
                        <span class="font-bold text-xs">MC</span>
                        <span class="font-bold text-sm">{r.raw_value}</span>
                    </div>
                {/if}
                {#if getRating('tmdb')}
                    {@const r = getRating('tmdb')}
                    <div class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#01B4E4]/10 border border-[#01B4E4]/20">
                        <ServiceIcon service="tmdb" size="w-3.5 h-3.5" class="text-[#01B4E4]" />
                        <span class="font-bold text-sm">{r.raw_value}</span>
                        {#if r.vote_count}
                            <span class="text-xs text-base-content/40">{(r.vote_count / 1000).toFixed(0)}k</span>
                        {/if}
                    </div>
                {/if}
                {#if data.movie.jellyfin_user_rating}
                    <div class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-warning/10 border border-warning/20">
                        <span class="text-warning">★</span>
                        <span class="font-bold text-sm">{data.movie.jellyfin_user_rating}</span>
                        <span class="text-xs text-base-content/40">Yours</span>
                    </div>
                {/if}
            </div>
        {/if}

    <!-- Expandable File Info Detail Panel -->
    {#if fileInfoExpanded && fileInfo}
        <div class="card bg-base-200/50 border border-base-300">
            <div class="card-body py-4">
                <div class="flex items-center justify-between mb-2">
                    <h3 class="text-sm font-semibold text-base-content/70">File Details</h3>
                    <button class="btn btn-ghost btn-xs" onclick={() => fileInfoExpanded = false}>✕</button>
                </div>
                <div class="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
                    {#if fileInfo.qualityName}
                        <div>
                            <span class="text-xs text-base-content/40 uppercase">Quality</span>
                            <p class="font-medium">{fileInfo.qualityName}</p>
                        </div>
                    {/if}
                    {#if fileInfo.videoCodec}
                        <div>
                            <span class="text-xs text-base-content/40 uppercase">Video Codec</span>
                            <p class="font-medium">{fileInfo.videoCodec}</p>
                        </div>
                    {/if}
                    {#if fileInfo.videoDynamicRangeType || fileInfo.videoDynamicRange}
                        <div>
                            <span class="text-xs text-base-content/40 uppercase">Dynamic Range</span>
                            <p class="font-medium">{fileInfo.videoDynamicRangeType || fileInfo.videoDynamicRange}</p>
                        </div>
                    {/if}
                    {#if fileInfo.audioCodec}
                        <div>
                            <span class="text-xs text-base-content/40 uppercase">Audio</span>
                            <p class="font-medium">{fileInfo.audioCodec}{fileInfo.audioChannels ? ` ${fileInfo.audioChannels}ch` : ''}</p>
                        </div>
                    {/if}
                    {#if fileInfo.audioLanguages}
                        <div>
                            <span class="text-xs text-base-content/40 uppercase">Audio Languages</span>
                            <p class="font-medium">{fileInfo.audioLanguages}</p>
                        </div>
                    {/if}
                    {#if fileInfo.subtitles}
                        <div>
                            <span class="text-xs text-base-content/40 uppercase">Subtitles</span>
                            <p class="font-medium">{fileInfo.subtitles}</p>
                        </div>
                    {/if}
                    {#if formatFileSize(fileInfo.fileSize)}
                        <div>
                            <span class="text-xs text-base-content/40 uppercase">File Size</span>
                            <p class="font-medium">{formatFileSize(fileInfo.fileSize)}</p>
                        </div>
                    {/if}
                    {#if fileInfo.filePath}
                        <div class="col-span-2 md:col-span-3">
                            <span class="text-xs text-base-content/40 uppercase">File</span>
                            <p class="font-medium text-xs break-all text-base-content/60">{fileInfo.filePath}</p>
                        </div>
                    {/if}
                </div>
                {#if fileInfo.customFormats?.length > 0}
                    <div class="mt-2 pt-2 border-t border-base-300">
                        <span class="text-xs text-base-content/40 uppercase">Custom Formats</span>
                        <div class="flex flex-wrap gap-1 mt-1">
                            {#each fileInfo.customFormats as cf}
                                <span class="badge badge-ghost badge-xs">{cf}</span>
                            {/each}
                        </div>
                    </div>
                {/if}
            </div>
        </div>
    {/if}

    <!-- Cast & Crew -->
    {#if data.cast.length > 0 || data.crew.length > 0}
        {@const CAST_LIMIT = 16}
        {@const CREW_LIMIT = 16}
        <div class="card bg-base-200/50 border border-base-300">
            <div class="card-body">
                <h2 class="card-title text-lg">
                    <svg
                        xmlns="http://www.w3.org/2000/svg"
                        class="h-5 w-5 text-accent"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                    >
                        <path
                            d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"
                        /><circle cx="9" cy="7" r="4" /><path
                            d="M23 21v-2a4 4 0 0 0-3-3.87"
                        /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
                    </svg>
                    Cast & Crew
                    <span class="badge badge-ghost badge-sm"
                        >{data.cast.length + data.crew.length}</span
                    >
                </h2>

                {#if data.cast.length > 0}
                    <h3 class="text-sm font-semibold text-base-content/60 mt-2">
                        Cast
                    </h3>
                    <div class="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-3">
                        {#each (showAllCast ? data.cast : data.cast.slice(0, CAST_LIMIT)) as person}
                            <a
                                href="/people/{person.id}"
                                class="flex flex-col items-center gap-1 group"
                            >
                                {#if person.photo_url}
                                    <img
                                        src={imgUrl(person.photo_url, 200)}
                                        alt={person.name}
                                        class="w-20 h-20 rounded-full object-cover border-2 border-base-300 group-hover:border-primary transition-colors"
                                    />
                                {:else}
                                    <div
                                        class="w-20 h-20 rounded-full bg-base-300 flex items-center justify-center text-2xl"
                                    >
                                        👤
                                    </div>
                                {/if}
                                <span
                                    class="text-xs font-medium text-center leading-tight truncate w-full group-hover:text-primary transition-colors"
                                    >{person.name}</span
                                >
                                {#if person.character_name}
                                    <span
                                        class="text-[10px] text-base-content/40 text-center leading-tight truncate w-full"
                                        >{person.character_name}</span
                                    >
                                {/if}
                            </a>
                        {/each}
                    </div>
                    {#if data.cast.length > CAST_LIMIT}
                        <button
                            class="text-xs text-primary/70 hover:text-primary mt-1 self-start"
                            onclick={() => showAllCast = !showAllCast}
                        >
                            {showAllCast ? '← Show less' : `Show all ${data.cast.length} →`}
                        </button>
                    {/if}
                {/if}

                {#if data.crew.length > 0}
                    <h3 class="text-sm font-semibold text-base-content/60 mt-3">
                        Crew
                    </h3>
                    <div class="flex flex-wrap gap-2 mt-1">
                        {#each (showAllCrew ? data.crew : data.crew.slice(0, CREW_LIMIT)) as person}
                            <a
                                href="/people/{person.id}"
                                class="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-base-300/50 hover:bg-base-300 transition-colors text-sm group"
                            >
                                {#if person.photo_url}
                                    <img
                                        src={imgUrl(person.photo_url, 80)}
                                        alt={person.name}
                                        class="w-6 h-6 rounded-full object-cover"
                                    />
                                {:else}
                                    <div
                                        class="w-6 h-6 rounded-full bg-base-300 flex items-center justify-center text-xs"
                                    >
                                        👤
                                    </div>
                                {/if}
                                <span
                                    class="group-hover:text-primary transition-colors"
                                    >{person.name}</span
                                >
                                <span
                                    class="badge badge-ghost badge-xs capitalize"
                                    >{person.role_type}</span
                                >
                            </a>
                        {/each}
                    </div>
                    {#if data.crew.length > CREW_LIMIT}
                        <button
                            class="text-xs text-primary/70 hover:text-primary mt-1 self-start"
                            onclick={() => showAllCrew = !showAllCrew}
                        >
                            {showAllCrew ? '← Show less' : `Show all ${data.crew.length} →`}
                        </button>
                    {/if}
                {/if}
            </div>
        </div>
    {/if}

    <!-- Similar Items -->
    <PosterRow
        title="Similar In Your Library"
        items={data.similarInLibrary}
    />
    <PosterRow
        title="💡 You Might Like"
        items={data.similarYouMightLike}
    />

    <!-- Playback History -->
    {#if data.history.length > 0}
        <div class="card bg-base-200/50 border border-base-300">
            <div class="card-body">
                <h2 class="card-title text-lg">
                    <svg
                        xmlns="http://www.w3.org/2000/svg"
                        class="h-5 w-5 text-secondary"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                    >
                        <circle cx="12" cy="12" r="10" /><polyline
                            points="12 6 12 12 16 14"
                        />
                    </svg>
                    Watch History
                    <span class="badge badge-ghost badge-sm"
                        >{data.history.length} plays</span
                    >
                </h2>
                <div class="overflow-x-auto">
                    <table class="table table-sm">
                        <thead>
                            <tr class="text-xs text-base-content/50">
                                <th>Date</th>
                                <th>Source</th>
                                <th>Completion</th>
                                <th></th>
                            </tr>
                        </thead>
                        <tbody>
                            {#each data.history as play}
                                <tr class="hover:bg-base-300/20">
                                    <td>
                                        <div>
                                            <span class="font-medium text-sm"
                                                >{formatDate(
                                                    play.timestamp,
                                                )}</span
                                            >
                                            <span
                                                class="text-xs text-base-content/40 ml-2"
                                                >{timeAgo(play.timestamp)}</span
                                            >
                                        </div>
                                    </td>
                                    <td>
                                        {#if sourceIcon(play.source)}
                                            <ServiceIcon
                                                service={sourceIcon(
                                                    play.source,
                                                )}
                                                size="w-4 h-4"
                                            />
                                        {:else}
                                            <span
                                                class="badge badge-ghost badge-xs"
                                                >{play.source}</span
                                            >
                                        {/if}
                                    </td>
                                    <td>
                                        {#if play.completion_pct}
                                            <div
                                                class="flex items-center gap-2"
                                            >
                                                <progress
                                                    class="progress progress-success w-16 h-1.5"
                                                    value={play.completion_pct}
                                                    max="100"
                                                ></progress>
                                                <span
                                                    class="text-xs text-base-content/50"
                                                    >{play.completion_pct}%</span
                                                >
                                            </div>
                                        {:else}
                                            <span
                                                class="text-xs text-base-content/40"
                                                >—</span
                                            >
                                        {/if}
                                    </td>
                                    <td>
                                        <button
                                            class="btn btn-ghost btn-xs btn-circle text-base-content/30 hover:text-error"
                                            title="Delete this play entry"
                                            onclick={async () => {
                                                if (!confirm(`Delete this ${play.source} play from ${formatDate(play.timestamp)}?`)) return;
                                                try {
                                                    const res = await fetch(`/api/playback-history/${play.id}`, { method: 'DELETE' });
                                                    if (res.ok) await invalidateAll();
                                                } catch { /* ignore */ }
                                            }}
                                        >
                                            <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                                        </button>
                                    </td>
                                </tr>
                            {/each}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    {:else}
        <div class="card bg-base-200/30 border border-base-300/50">
            <div class="card-body items-center text-center py-10">
                <div class="text-4xl mb-2">📭</div>
                <p class="text-base-content/50 text-sm">
                    No watch history recorded for this movie yet.
                </p>
            </div>
        </div>
    {/if}
</div>

<!-- Discovery: Related Movies from TMDb -->
{#if data.movie.tmdb_id}
    <div class="card bg-base-200/50 border border-base-300 max-w-5xl mx-auto">
        <div class="card-body">
            {#if !discoveryLoaded && !discoveryLoading}
                <button class="btn btn-ghost btn-sm gap-2 self-center" onclick={loadDiscovery}>
                    🔍 Discover Related Movies
                </button>
            {:else if discoveryLoading}
                <div class="flex justify-center py-6">
                    <span class="loading loading-spinner loading-md"></span>
                    <span class="ml-2 text-sm text-base-content/50">Finding related movies…</span>
                </div>
            {:else if discoveryError}
                <div class="alert alert-error text-sm">{discoveryError}</div>
            {:else}
                <div class="flex items-center justify-between mb-3">
                    <h2 class="text-lg font-bold flex items-center gap-2">
                        🔍 Related Movies
                        <span class="badge badge-sm badge-ghost">{filteredDiscoveryItems(discoveryItems).length} not in library</span>
                    </h2>
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
                        <p>🎉 You have all the related movies!</p>
                    </div>
                {:else}
                    <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
                        {#each filteredDiscoveryItems(discoveryItems).slice(0, discoveryLimit) as item}
                            <div class="card bg-base-300/30 card-compact overflow-hidden group">
                                {#if item.poster_url}
                                    <figure class="aspect-[2/3] relative">
                                        <img
                                            src={imgUrl(item.poster_url)}
                                            alt={item.title}
                                            class="w-full h-full object-cover"
                                        />
                                        {#if item.vote_average > 0}
                                            <div class="absolute top-1 right-1 badge badge-sm bg-black/60 border-0 text-warning">
                                                ★ {item.vote_average.toFixed(1)}
                                            </div>
                                        {/if}
                                    </figure>
                                {:else}
                                    <div class="aspect-[2/3] bg-base-300 flex items-center justify-center text-3xl">🎬</div>
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
                                            ✅ Added
                                        {:else}
                                            <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                                            Download
                                        {/if}
                                    </button>
                                </div>
                            </div>
                        {/each}

                        {#if showDiscoverInLib}
                            {#each discoveryInLibrary as item}
                                <a href="/movies/{item.library_id}" class="card bg-base-300/30 card-compact overflow-hidden group opacity-60 ring-2 ring-success/30">
                                    {#if item.poster_url}
                                        <figure class="aspect-[2/3]">
                                            <img src={imgUrl(item.poster_url)} alt={item.title} class="w-full h-full object-cover" />
                                        </figure>
                                    {:else}
                                        <div class="aspect-[2/3] bg-base-300 flex items-center justify-center text-3xl">🎬</div>
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
            {/if}
        </div>
    </div>
{/if}

<!-- Discovery Quality Profile Dialog -->
{#if discShowProfileDialog && discPendingItem}
    <div class="modal modal-open">
        <div class="modal-box max-w-sm">
            <h3 class="font-bold text-lg">Add to Radarr</h3>
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
        <div class="modal-backdrop" onclick={() => { discShowProfileDialog = false; discPendingItem = null; }}></div>
    </div>
{/if}

<!-- Delete Confirmation Modal -->
{#if showDeleteConfirm}
    <div class="modal modal-open">
        <div class="modal-box">
            <h3 class="font-bold text-lg text-error">Delete Movie</h3>
            <p class="py-4">
                Are you sure you want to delete <strong>{data.movie.title}</strong> from Mediajam?
                This will remove all associated data including watch history, ratings, and credits.
            </p>
            {#if data.movie.jellyfin_id}
                <div class="alert alert-warning text-sm py-2">
                    <span>⚠️ This movie is tracked in Jellyfin and will reappear on the next sync.</span>
                </div>
            {/if}
            <div class="modal-action">
                <button class="btn btn-ghost btn-sm" onclick={() => showDeleteConfirm = false}>Cancel</button>
                <button
                    class="btn btn-error btn-sm"
                    onclick={deleteItem}
                    disabled={deleting}
                >
                    {#if deleting}
                        <span class="loading loading-spinner loading-xs"></span>
                        Deleting…
                    {:else}
                        Delete
                    {/if}
                </button>
            </div>
        </div>
        <div class="modal-backdrop" onclick={() => showDeleteConfirm = false}></div>
    </div>
{/if}
