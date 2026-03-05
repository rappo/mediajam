<script>
    import FavoriteButton from "$lib/components/FavoriteButton.svelte";
    import ExternalLinks from "$lib/components/ExternalLinks.svelte";
    import HeartBorder from "$lib/components/HeartBorder.svelte";
    import RemotePlayButton from "$lib/components/RemotePlayButton.svelte";
    import StatCard from "$lib/components/StatCard.svelte";
    import ServiceIcon from "$lib/components/ServiceIcon.svelte";
    import { invalidateAll } from "$app/navigation";
    import { page } from "$app/stores";
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

    async function fullSync() {
        syncing = true;
        syncStatus = "";
        syncError = "";
        try {
            const res = await fetch("/api/sync/item", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ jellyfinId: data.movie.jellyfin_id }),
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
                            src={data.movie.posterUrl}
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
                        {#if data.movie.runtime_minutes}
                            <span
                                >· {formatRuntime(
                                    data.movie.runtime_minutes,
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
                    src={data.movie.posterUrl}
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
                        {#if data.movie.runtime_minutes}
                            <span
                                >· {formatRuntime(
                                    data.movie.runtime_minutes,
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
                    {formatRuntime(data.movie.runtime_minutes)}
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
                                class="flex flex-col items-center gap-1 shrink-0 w-20 group"
                            >
                                {#if person.photo_url}
                                    <img
                                        src={person.photo_url +
                                            "?maxHeight=120"}
                                        alt={person.name}
                                        class="w-16 h-16 rounded-full object-cover border-2 border-base-300 group-hover:border-primary transition-colors"
                                    />
                                {:else}
                                    <div
                                        class="w-16 h-16 rounded-full bg-base-300 flex items-center justify-center text-xl"
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
                                        src={person.photo_url + "?maxHeight=80"}
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
