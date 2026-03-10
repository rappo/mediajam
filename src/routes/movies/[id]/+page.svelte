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
</script>

<svelte:head>
    <title>{data.movie.title} — Mediajam</title>
</svelte:head>

<div class="space-y-6 max-w-5xl mx-auto">
    <!-- Back + Sync + Layout Toggle -->
    <div class="flex items-center justify-between">
        <div class="flex items-center gap-2">
        <a href="/movies" class="btn btn-ghost btn-sm gap-1">
            <svg
                xmlns="http://www.w3.org/2000/svg"
                class="h-4 w-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"><polyline points="15 18 9 12 15 6" /></svg
            >
            All Movies
        </a>
        {#if !data.movie.jellyfin_id}
        <button
            class="btn btn-ghost btn-xs text-base-content/40 hover:text-error"
            onclick={() => showDeleteConfirm = true}
            title="Delete this movie from Mediajam"
        >
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
        </button>
        {/if}
        </div>
    </div>
        <!-- ═══ NEW LAYOUT (Option B) ═══ -->
        <MediaDetailHeader
            mediaType="movie"
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
            {#snippet actions()}
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
                    <div class="flex gap-3 overflow-x-auto pb-2 -mx-2 px-2">
                        {#each data.cast as person}
                            <a
                                href="/people/{person.id}"
                                class="flex flex-col items-center gap-1 shrink-0 w-28 group"
                            >
                                {#if person.photo_url}
                                    <img
                                        src={imgUrl(person.photo_url, 200)}
                                        alt={person.name}
                                        class="w-24 h-24 rounded-full object-cover border-2 border-base-300 group-hover:border-primary transition-colors"
                                    />
                                {:else}
                                    <div
                                        class="w-24 h-24 rounded-full bg-base-300 flex items-center justify-center text-2xl"
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
                {/if}

                {#if data.crew.length > 0}
                    <h3 class="text-sm font-semibold text-base-content/60 mt-3">
                        Crew
                    </h3>
                    <div class="flex flex-wrap gap-2 mt-1">
                        {#each data.crew as person}
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
                {/if}
            </div>
        </div>
    {/if}

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

<!-- TODO: Discovery — show related movies from TMDb (same director, franchise, similar) not in your library -->
<div class="container mx-auto px-6 py-8 opacity-30">
    <div class="card bg-base-200/30 border border-dashed border-base-300/50">
        <div class="card-body items-center text-center py-6">
            <div class="text-3xl mb-2">🔍</div>
            <h3 class="font-semibold text-base-content/50">Discover More</h3>
            <p class="text-sm text-base-content/30 max-w-md">
                Related movies discovery coming soon — browse similar films,
                franchise entries, and director filmographies from TMDb and add
                to Radarr.
            </p>
        </div>
    </div>
</div>

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
