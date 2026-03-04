<script>
    let { data } = $props();
    import { invalidateAll } from "$app/navigation";
    import ExternalLinks from "$lib/components/ExternalLinks.svelte";
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

    async function fullSync() {
        syncing = true;
        syncStatus = "";
        syncError = "";
        try {
            const res = await fetch("/api/sync/item", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ jellyfinId: data.show.jellyfin_id }),
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
    <title>{data.show.title} — Mediajam</title>
</svelte:head>

<div class="space-y-6 max-w-6xl mx-auto">
    <!-- Back link -->
    <div class="flex items-center justify-between">
        <a href="/tv" class="btn btn-ghost btn-sm gap-1">
            <svg
                xmlns="http://www.w3.org/2000/svg"
                class="h-4 w-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"><polyline points="15 18 9 12 15 6" /></svg
            >
            All Shows
        </a>
        <button
            class="btn btn-ghost btn-xs gap-1"
            class:btn-success={syncStatus === "success"}
            class:btn-error={syncStatus === "failed"}
            disabled={syncing}
            onclick={fullSync}
            title="Re-fetch all data from Jellyfin for this show"
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

    <!-- Header -->
    <div class="flex gap-6 items-start">
        {#if data.show.poster_url}
            <img
                src={data.show.poster_url}
                alt={data.show.title}
                class="w-36 rounded-xl shadow-lg shrink-0"
            />
        {/if}
        <div class="space-y-3 min-w-0">
            <div>
                <h1 class="text-3xl font-bold">{data.show.title}</h1>
                <p class="text-base-content/50 text-sm mt-1">
                    {data.show.release_year || ""}
                </p>
                <ExternalLinks
                    tmdb_id={data.show.tmdb_id}
                    imdb_id={data.show.imdb_id}
                    tvdb_id={data.show.tvdb_id}
                    mediaType="show"
                    class="mt-1"
                />
            </div>
            {#if data.show.overview}
                <p class="text-sm text-base-content/70 line-clamp-3">
                    {data.show.overview}
                </p>
            {/if}
            <div class="flex flex-wrap gap-3">
                <div class="badge badge-lg badge-info gap-1">
                    📺 {data.seasons.length} seasons
                </div>
                <div class="badge badge-lg badge-success gap-1">
                    ✅ {data.totalWatched}/{data.totalEpisodes} watched
                </div>
                {#if data.totalInProgress > 0}
                    <div class="badge badge-lg badge-warning gap-1">
                        ⏳ {data.totalInProgress} in progress
                    </div>
                {/if}
                {#if data.totalMissing > 0}
                    <div class="badge badge-lg badge-error gap-1">
                        📭 {data.totalMissing} missing
                    </div>
                {/if}
                {#if data.totalUpcoming > 0}
                    <div class="badge badge-lg badge-ghost gap-1">
                        🔮 {data.totalUpcoming} upcoming
                    </div>
                {/if}
                {#if data.show.collection_pct !== null}
                    <div class="badge badge-lg badge-secondary gap-1">
                        📦 {data.show.collection_pct}% collected
                    </div>
                {/if}
            </div>
        </div>
    </div>

    <!-- Episode Grid -->
    <div class="space-y-2">
        <h2 class="text-xl font-bold">Episode Map</h2>
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

        <div class="overflow-x-auto">
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
                                    class="ep-cell {statusClass(
                                        ep.watch_status,
                                        ep.is_collected,
                                        ep.premiere_date,
                                    )}"
                                    title="S{season.number}E{ep.item_number}: {ep.title}{ep.is_collected
                                        ? ep.play_count > 0
                                            ? ` (${ep.play_count}x)`
                                            : ''
                                        : ep.premiere_date &&
                                            new Date(ep.premiere_date) >
                                                new Date()
                                          ? ` [UPCOMING ${new Date(ep.premiere_date).toLocaleDateString()}]`
                                          : ' [MISSING]'}"
                                >
                                    <span class="ep-num">{ep.item_number}</span>
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
    </div>

    <!-- Season Breakdown -->
    <div class="space-y-2">
        <h2 class="text-xl font-bold">Season Breakdown</h2>
        <div class="space-y-2">
            {#each data.seasons as season}
                {@const pct =
                    season.total > 0
                        ? Math.round((season.collected / season.total) * 100)
                        : 0}
                <div class="flex items-center gap-3">
                    <span
                        class="w-12 text-sm text-right text-base-content/60 shrink-0"
                    >
                        {season.number === 0 ? "Specials" : `S${season.number}`}
                    </span>
                    <div
                        class="flex-1 bg-base-300 rounded-full h-4 overflow-hidden"
                    >
                        <div
                            class="h-full rounded-full transition-all duration-500"
                            style="width: {pct}%; background: {pct >= 100
                                ? 'var(--color-success, #22c55e)'
                                : pct > 50
                                  ? 'var(--color-info, #22d3ee)'
                                  : 'var(--color-warning, #f59e0b)'}"
                        ></div>
                    </div>
                    <span class="w-28 text-xs text-base-content/50 shrink-0">
                        {season.collected}/{season.total} ({pct}%)
                        {#if season.missing > 0}
                            <span class="text-error">-{season.missing}</span>
                        {/if}
                        {#if season.upcoming > 0}
                            <span class="text-base-content/40"
                                >+{season.upcoming} upcoming</span
                            >
                        {/if}
                    </span>
                </div>
            {/each}
        </div>
    </div>

    <!-- Episode List -->
    <div class="space-y-2">
        <h2 class="text-xl font-bold">All Episodes</h2>
        {#each data.seasons as season}
            <details
                class="collapse collapse-arrow bg-base-200/50 border border-base-300 rounded-xl"
            >
                <summary class="collapse-title font-medium text-sm">
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
                </summary>
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
                                            {ep.title}
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
                                    </tr>
                                {/each}
                            </tbody>
                        </table>
                    </div>
                </div>
            </details>
        {/each}
    </div>

    <!-- Cast & Crew -->
    {#if data.cast.length > 0 || data.crew.length > 0}
        <div class="card bg-base-200/50 border border-base-300">
            <div class="card-body">
                <h2 class="card-title text-lg">🎭 Cast & Crew</h2>

                {#if data.cast.length > 0}
                    <div class="flex gap-4 overflow-x-auto pb-2 -mx-2 px-2">
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
</div>

<style>
    .grid-container {
        display: flex;
        flex-direction: column;
        gap: 2px;
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
    }

    .ep-progress {
        background: oklch(var(--wa, 0.8 0.15 75));
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
</style>
