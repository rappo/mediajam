<script>
    let { data } = $props();

    function statusColor(status) {
        if (status === "watched") return "var(--color-success, #22c55e)";
        if (status === "in_progress") return "var(--color-warning, #f59e0b)";
        return "var(--color-base-300, #2a2e37)";
    }

    function statusClass(status, isCollected) {
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
</script>

<svelte:head>
    <title>{data.show.title} — Mediajam</title>
</svelte:head>

<div class="space-y-6 max-w-6xl mx-auto">
    <!-- Back link -->
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
                    {#if data.show.tvdb_id}
                        · <a
                            href="https://thetvdb.com/?id={data.show
                                .tvdb_id}&tab=series"
                            target="_blank"
                            class="link link-primary">TVDB</a
                        >
                    {/if}
                    {#if data.show.imdb_id}
                        · <a
                            href="https://imdb.com/title/{data.show.imdb_id}"
                            target="_blank"
                            class="link link-primary">IMDB</a
                        >
                    {/if}
                </p>
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
                                    )}"
                                    title="S{season.number}E{ep.item_number}: {ep.title}{ep.is_collected
                                        ? ep.play_count > 0
                                            ? ` (${ep.play_count}x)`
                                            : ''
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
        border: 2px dashed rgba(239, 68, 68, 0.7);
    }

    .ep-missing .ep-num {
        opacity: 0.4;
    }

    :global(.ep-unwatched-legend) {
        background: rgba(100, 116, 139, 0.6);
    }

    :global(.ep-missing-legend) {
        background: rgba(100, 116, 139, 0.6);
        border: 2px dashed rgba(239, 68, 68, 0.7);
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
