<script>
    import FavoriteButton from "$lib/components/FavoriteButton.svelte";
    import ExternalLinks from "$lib/components/ExternalLinks.svelte";
    import ArrAddDialog from "$lib/components/ArrAddDialog.svelte";
    import HeartBorder from "$lib/components/HeartBorder.svelte";
    import RemotePlayButton from "$lib/components/RemotePlayButton.svelte";
    import StatCard from "$lib/components/StatCard.svelte";
    import ServiceIcon from "$lib/components/ServiceIcon.svelte";
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

    async function onArrAdded() {
        await invalidateAll();
    }

    async function searchRadarr() {
        arrLoading = "search";
        arrError = "";
        try {
            const res = await fetch("/api/arr/radarr/search", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ mediaParentId: data.movie.id }),
            });
            if (!res.ok) {
                const result = await res.json();
                throw new Error(result.error || "Failed");
            }
        } catch (e) {
            arrError = e instanceof Error ? e.message : "Failed";
            setTimeout(() => (arrError = ""), 5000);
        }
        arrLoading = "";
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
    <!-- Back link -->
    <div class="flex items-center justify-between">
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
        <button
            class="btn btn-ghost btn-xs gap-1"
            class:btn-success={syncStatus === "success"}
            class:btn-error={syncStatus === "failed"}
            disabled={syncing}
            onclick={fullSync}
            title="Re-fetch all data from Jellyfin for this movie"
        >
            {#if syncing}
                <span class="loading loading-spinner loading-xs"></span>
                Syncing…
            {:else if syncStatus === "success"}
                ✅ Synced
            {:else if syncStatus === "failed"}
                ❌ {syncError || "Failed"}
            {:else}
                🔄 Full Sync
            {/if}
        </button>
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

    <!-- Hero Section with Backdrop -->
    {#if data.movie.backdropUrl}
        <div
            class="relative rounded-2xl overflow-hidden border border-base-300"
        >
            <img
                src={data.movie.backdropUrl}
                alt=""
                class="w-full h-56 md:h-72 object-cover opacity-30"
            />
            <div
                class="absolute inset-0 bg-gradient-to-t from-base-100 via-base-100/80 to-transparent"
            ></div>
            <div class="absolute bottom-0 left-0 right-0 p-6 flex gap-6">
                {#if data.movie.posterUrl}
                    <HeartBorder
                        show={!!data.movie.is_favorite &&
                            data.settings?.heartBorderMovies}
                        class="rounded-xl"
                    >
                        <img
                            src={imgUrl(data.movie.posterUrl)}
                            alt={data.movie.title}
                            class="w-32 md:w-40 rounded-xl shadow-2xl shrink-0 -mt-20"
                        />
                    </HeartBorder>
                {/if}
                <div class="space-y-2 min-w-0 self-end">
                    <h1
                        class="text-3xl md:text-4xl font-bold leading-tight flex items-center gap-2"
                    >
                        {data.movie.title}
                        <FavoriteButton
                            type="media"
                            id={data.movie.id}
                            isFavorite={!!data.movie.is_favorite}
                        />
                    </h1>
                    <div
                        class="flex flex-wrap items-center gap-2 text-sm text-base-content/60"
                    >
                        {#if data.movie.release_year}
                            <span>{data.movie.release_year}</span>
                        {/if}
                        {#if data.movie.runtime_minutes || lazyRuntime}
                            <span
                                >· {formatRuntime(
                                    data.movie.runtime_minutes || lazyRuntime,
                                )}</span
                            >
                        {/if}
                        <span class="badge {badge.cls} badge-sm"
                            >{badge.label}</span
                        >
                        {#if data.movie.collection_status === "external"}
                            <span class="badge badge-warning badge-sm gap-1"
                                >📡 Not in library</span
                            >
                        {/if}
                    </div>
                    <ExternalLinks
                        tmdb_id={data.movie.tmdb_id}
                        imdb_id={data.movie.imdb_id}
                        tvdb_id={data.movie.tvdb_id}
                        jellyfin_id={data.movie.jellyfin_id}
                        jellyfin_url={data.jellyfinUrl}
                        arr_slug={data.movie.arr_slug}
                        arr_url={data.arrUrl}
                        arr_service={data.arrService}
                        wikipedia_url={data.movie.wikipedia_url}
                        mediaType="movie"
                    />
                    {#if data.movie.jellyfin_id}
                        <RemotePlayButton
                            jellyfinId={data.movie.jellyfin_id}
                            enabled={$page.data.remoteControlEnabled}
                            savedPlayers={$page.data.userPreferences
                                ?.savedPlayers || []}
                            defaultPlayerId={$page.data.userPreferences
                                ?.defaultPlayerId || ""}
                        />
                    {/if}
                </div>
            </div>
        </div>
    {:else}
        <!-- No backdrop fallback -->
        <div class="flex gap-6 items-start">
            {#if data.movie.posterUrl}
                <img
                    src={imgUrl(data.movie.posterUrl)}
                    alt={data.movie.title}
                    class="w-36 rounded-xl shadow-lg shrink-0"
                />
            {:else}
                <div
                    class="w-36 h-52 rounded-xl bg-base-300 flex items-center justify-center text-4xl shrink-0"
                >
                    🎬
                </div>
            {/if}
            <div class="space-y-3 min-w-0">
                <div>
                    <h1 class="text-3xl font-bold">{data.movie.title}</h1>
                    <div
                        class="flex flex-wrap items-center gap-2 text-sm text-base-content/60 mt-1"
                    >
                        {#if data.movie.release_year}
                            <span>{data.movie.release_year}</span>
                        {/if}
                        {#if data.movie.runtime_minutes || lazyRuntime}
                            <span
                                >· {formatRuntime(
                                    data.movie.runtime_minutes || lazyRuntime,
                                )}</span
                            >
                        {/if}
                        <span class="badge {badge.cls} badge-sm"
                            >{badge.label}</span
                        >
                    </div>
                </div>
                {#if data.movie.overview}
                    <p class="text-sm text-base-content/70 line-clamp-4">
                        {data.movie.overview}
                    </p>
                {/if}
            </div>
        </div>
    {/if}

    <!-- Overview (shown below backdrop layout) -->
    {#if data.movie.backdropUrl && data.movie.overview}
        <p class="text-sm text-base-content/70 leading-relaxed">
            {data.movie.overview}
        </p>
    {/if}

    <!-- Stats Grid -->
    <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div class="card bg-base-200/50 border border-base-300">
            <div class="card-body py-4 px-5">
                <p
                    class="text-xs text-base-content/50 uppercase tracking-wider"
                >
                    Total Plays
                </p>
                <p class="text-2xl font-bold text-primary">
                    {data.stats.totalPlays}
                </p>
            </div>
        </div>
        <div class="card bg-base-200/50 border border-base-300">
            <div class="card-body py-4 px-5">
                <p
                    class="text-xs text-base-content/50 uppercase tracking-wider"
                >
                    Runtime
                </p>
                <p class="text-2xl font-bold">
                    {formatRuntime(data.movie.runtime_minutes || lazyRuntime)}
                </p>
            </div>
        </div>
        {#if data.stats.totalPlays > 1}
            <div class="card bg-base-200/50 border border-base-300">
                <div class="card-body py-4 px-5">
                    <p
                        class="text-xs text-base-content/50 uppercase tracking-wider"
                    >
                        First Watched
                    </p>
                    <p class="text-lg font-bold">
                        {formatDate(data.stats.firstWatched)}
                    </p>
                    {#if data.stats.firstWatched}
                        <p class="text-xs text-base-content/40">
                            {timeAgo(data.stats.firstWatched)}
                        </p>
                    {/if}
                </div>
            </div>
            <div class="card bg-base-200/50 border border-base-300">
                <div class="card-body py-4 px-5">
                    <p
                        class="text-xs text-base-content/50 uppercase tracking-wider"
                    >
                        Last Watched
                    </p>
                    <p class="text-lg font-bold">
                        {formatDate(data.stats.lastWatched)}
                    </p>
                    {#if data.stats.lastWatched}
                        <p class="text-xs text-base-content/40">
                            {timeAgo(data.stats.lastWatched)}
                        </p>
                    {/if}
                </div>
            </div>
        {:else}
            <div class="card bg-base-200/50 border border-base-300">
                <div class="card-body py-4 px-5">
                    <p
                        class="text-xs text-base-content/50 uppercase tracking-wider"
                    >
                        Watched
                    </p>
                    <p class="text-lg font-bold">
                        {formatDate(data.stats.firstWatched)}
                    </p>
                    {#if data.stats.firstWatched}
                        <p class="text-xs text-base-content/40">
                            {timeAgo(data.stats.firstWatched)}
                        </p>
                    {/if}
                </div>
            </div>
        {/if}
    </div>

    <!-- Radarr Status -->
    <div class="card bg-base-200/50 border border-base-300">
        <div class="card-body py-4">
            <div class="flex items-center justify-between">
                <div class="flex items-center gap-2">
                    <span class="text-lg">📥</span>
                    <span class="font-semibold text-sm">Radarr</span>
                </div>
                {#if arrError}
                    <span class="text-xs text-error">{arrError}</span>
                {/if}
            </div>
            {#if data.movie.radarr_id}
                <div class="flex flex-wrap items-center gap-2 mt-1">
                    {#if data.arrUrl && data.movie.arr_slug}
                        <a
                            href="{data.arrUrl}/movie/{data.movie.arr_slug}"
                            target="_blank"
                            rel="noopener"
                            class="badge badge-success badge-sm gap-1 hover:brightness-110 cursor-pointer"
                        >
                            ✅ In Radarr ↗
                        </a>
                    {:else}
                        <span class="badge badge-success badge-sm gap-1"
                            >✅ In Radarr</span
                        >
                    {/if}
                    {#if arrMonitored}
                        <span class="badge badge-info badge-sm"
                            >📡 Monitored</span
                        >
                    {:else}
                        <span class="badge badge-ghost badge-sm"
                            >Unmonitored</span
                        >
                    {/if}
                    {#if data.movie.arr_has_file}
                        <span class="badge badge-success badge-sm gap-1"
                            >📁 Downloaded</span
                        >
                    {:else if data.movie.arr_status === "announced"}
                        <span class="badge badge-ghost badge-sm gap-1"
                            >📢 Announced</span
                        >
                    {:else if data.movie.arr_status === "inCinemas"}
                        <span class="badge badge-info badge-sm gap-1"
                            >🎬 In Cinemas</span
                        >
                    {:else}
                        <span class="badge badge-warning badge-sm gap-1"
                            >⏳ Missing</span
                        >
                    {/if}
                    {#if data.movie.arr_quality_profile}
                        <span class="badge badge-ghost badge-sm"
                            >{data.movie.arr_quality_profile}</span
                        >
                    {/if}
                </div>
                <div class="flex gap-2 mt-2">
                    <button
                        class="btn btn-xs btn-outline gap-1"
                        onclick={searchRadarr}
                        disabled={arrLoading === "search"}
                    >
                        {#if arrLoading === "search"}
                            <span class="loading loading-spinner loading-xs"
                            ></span>
                        {:else}
                            🔍
                        {/if}
                        Search
                    </button>
                    <button
                        class="btn btn-xs btn-outline gap-1"
                        onclick={toggleMonitorRadarr}
                        disabled={arrLoading === "monitor"}
                    >
                        {#if arrLoading === "monitor"}
                            <span class="loading loading-spinner loading-xs"
                            ></span>
                        {:else if arrMonitored}
                            📡
                        {:else}
                            📴
                        {/if}
                        {arrMonitored ? "Unmonitor" : "Monitor"}
                    </button>
                </div>
            {:else if data.movie.tmdb_id}
                <div class="flex items-center gap-2 mt-1">
                    <span class="text-xs text-base-content/50"
                        >Not in Radarr</span
                    >
                    <ArrAddDialog
                        service="radarr"
                        mediaParentId={data.movie.id}
                        onComplete={onArrAdded}
                    />
                </div>
            {:else}
                <p class="text-xs text-base-content/40 mt-1">
                    No TMDB ID — cannot link to Radarr
                </p>
            {/if}
        </div>
    </div>

    <!-- External Links -->
    <div class="card bg-base-200/50 border border-base-300">
        <div class="card-body">
            <h2 class="card-title text-lg">
                <svg
                    xmlns="http://www.w3.org/2000/svg"
                    class="h-5 w-5 text-info"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                >
                    <path
                        d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"
                    /><path
                        d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"
                    />
                </svg>
                Links & Metadata
            </h2>
            <div class="flex flex-wrap gap-3 mt-2">
                {#if data.movie.imdb_id}
                    <a
                        href="https://www.imdb.com/title/{data.movie.imdb_id}"
                        target="_blank"
                        rel="noopener"
                        class="btn btn-sm btn-outline gap-2"
                    >
                        <span class="text-[#F5C518] font-bold text-xs"
                            >IMDb</span
                        >
                        {data.movie.imdb_id}
                    </a>
                {/if}
                {#if data.movie.tmdb_id}
                    <a
                        href="https://www.themoviedb.org/movie/{data.movie
                            .tmdb_id}"
                        target="_blank"
                        rel="noopener"
                        class="btn btn-sm btn-outline gap-2"
                    >
                        <ServiceIcon
                            service="tmdb"
                            size="w-4 h-4"
                            class="text-[#01B4E4]"
                        />
                        TMDB
                    </a>
                {/if}
                {#if data.movie.tvdb_id}
                    <a
                        href="https://thetvdb.com/?id={data.movie
                            .tvdb_id}&tab=series"
                        target="_blank"
                        rel="noopener"
                        class="btn btn-sm btn-outline gap-2"
                    >
                        <ServiceIcon
                            service="tvdb"
                            size="w-4 h-4"
                            class="text-[#6CD491]"
                        />
                        TVDB
                    </a>
                {/if}
                {#if data.movie.jellyfin_id && data.jellyfinUrl}
                    <a
                        href="{data.jellyfinUrl}/web/index.html#!/details?id={data
                            .movie.jellyfin_id}"
                        target="_blank"
                        rel="noopener"
                        class="btn btn-sm btn-outline gap-2"
                    >
                        <ServiceIcon
                            service="jellyfin"
                            size="w-4 h-4"
                            class="text-[#00A4DC]"
                        />
                        Jellyfin
                    </a>
                {/if}
            </div>

            {#if data.movie.jellyfin_user_rating}
                <div class="mt-3 flex items-center gap-2">
                    <span class="text-sm text-base-content/50"
                        >Your rating:</span
                    >
                    <div class="flex items-center gap-1">
                        <span class="text-warning text-lg">★</span>
                        <span class="font-bold"
                            >{data.movie.jellyfin_user_rating}</span
                        >
                    </div>
                </div>
            {/if}

            <!-- External Ratings -->
            {#if externalRatings.length > 0}
                <div class="divider my-2"></div>
                <div class="flex flex-wrap items-center gap-3">
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
                    <button
                        class="btn btn-ghost btn-xs gap-1 text-base-content/40 hover:text-base-content"
                        onclick={refreshRatings}
                        disabled={ratingsLoading}
                        title="Refresh external ratings"
                    >
                        {#if ratingsLoading}
                            <span class="loading loading-spinner loading-xs"></span>
                        {:else}
                            ↻
                        {/if}
                    </button>
                </div>
            {:else}
                <div class="divider my-2"></div>
                <button
                    class="btn btn-ghost btn-xs gap-1"
                    onclick={refreshRatings}
                    disabled={ratingsLoading}
                >
                    {#if ratingsLoading}
                        <span class="loading loading-spinner loading-xs"></span>
                        Fetching ratings…
                    {:else}
                        📊 Fetch External Ratings
                    {/if}
                </button>
            {/if}
        </div>
    </div>

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
