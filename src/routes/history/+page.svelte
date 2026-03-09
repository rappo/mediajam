<script>
    import NowPlaying from "$lib/components/NowPlaying.svelte";
    import TimelineEntry from "$lib/components/TimelineEntry.svelte";
    import StatCard from "$lib/components/StatCard.svelte";
    import YearScrubber from "$lib/components/YearScrubber.svelte";
    import { page } from "$app/stores";
    import { goto } from "$app/navigation";

    /** @type {{ data: import('./$types').PageData }} */
    let { data } = $props();

    // Local filter state (synced from URL)
    let filterType = $state(data.filters?.mediaType || "all");
    let searchText = $state(data.filters?.search || "");
    let fromDate = $state(data.filters?.from || "");
    let toDate = $state(data.filters?.to || "");
    let searchTimer = $state(/** @type {ReturnType<typeof setTimeout>|null} */ (null));

    /**
     * Push filter params to the URL (triggers server reload)
     */
    function applyFilters() {
        const params = new URLSearchParams();
        if (filterType && filterType !== "all") params.set("type", filterType);
        if (searchText.trim()) params.set("q", searchText.trim());
        if (fromDate) params.set("from", fromDate);
        if (toDate) params.set("to", toDate);
        const qs = params.toString();
        goto(`/history${qs ? "?" + qs : ""}`, { keepFocus: true });
    }

    /**
     * Debounced search
     * @param {string} val
     */
    function onSearchInput(val) {
        searchText = val;
        if (searchTimer) clearTimeout(searchTimer);
        searchTimer = setTimeout(() => applyFilters(), 400);
    }

    /** @param {string} type */
    function setFilterType(type) {
        filterType = type;
        applyFilters();
    }

    function clearFilters() {
        filterType = "all";
        searchText = "";
        fromDate = "";
        toDate = "";
        goto("/history", { keepFocus: true });
    }

    const hasActiveFilters = $derived(
        filterType !== "all" || searchText.trim() || fromDate || toDate,
    );

    /**
     * Group consecutive same-album music tracks (3+) into combined entries.
     * @param {any[]} entries
     * @returns {Array<{type: 'single', entry: any} | {type: 'album', entry: any, tracks: any[]}>}
     */
    function groupEntries(entries) {
        /** @type {Array<{type: 'single', entry: any} | {type: 'album', entry: any, tracks: any[]}>} */
        const result = [];
        let i = 0;
        while (i < entries.length) {
            const e = entries[i];
            if (e.media_type === "artist" && e.parent_id) {
                let j = i + 1;
                while (
                    j < entries.length &&
                    entries[j].media_type === "artist" &&
                    entries[j].parent_id === e.parent_id
                ) {
                    j++;
                }
                const run = entries.slice(i, j);
                if (run.length > 2) {
                    result.push({
                        type: "album",
                        entry: run[0],
                        tracks: run,
                    });
                    i = j;
                    continue;
                }
            }
            result.push({ type: "single", entry: e });
            i++;
        }
        return result;
    }
</script>

<svelte:head>
    <title>History — Mediajam</title>
</svelte:head>

<div class="max-w-4xl mx-auto p-6 py-10 pr-16">
    <!-- Header -->
    <div class="mb-8">
        <h1 class="text-3xl font-bold mb-1">History</h1>
        <p class="text-base-content/60">Your media timeline</p>
    </div>

    <!-- Now Playing -->
    <div class="mb-6">
        <NowPlaying
            sessions={data.activeSessions}
            jellyfinUrl={data.jellyfinUrl}
            remoteControlEnabled={$page.data.remoteControlEnabled}
        />
    </div>

    <!-- Stats Row -->
    <div class="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-8">
        <StatCard
            icon="▶"
            label="Total Plays"
            value={data.stats.totalPlays}
            color="primary"
        />
        <StatCard
            icon="🎯"
            label="Unique Items"
            value={data.stats.uniqueItems}
            color="secondary"
        />
        <StatCard
            icon="📅"
            label="Active Days"
            value={data.stats.activeDays}
            sub={data.stats.totalDaysSince ? `/${data.stats.totalDaysSince.toLocaleString()} (${data.stats.activePct}%) since ${data.stats.firstCheckInLabel}` : ''}
            color="accent"
        />
        <StatCard
            icon="⏱"
            label="Time Spent"
            value={data.stats.friendlyTime}
            color="info"
        />
        <StatCard
            icon="🔥"
            label="Longest Streak"
            value={data.stats.longestStreak
                ? `${data.stats.longestStreak} days`
                : "0"}
            color="warning"
        />
    </div>

    <!-- Filter Bar -->
    <div class="card bg-base-200/30 border border-base-300/30 mb-6">
        <div class="card-body p-3 gap-3">
            <!-- Row 1: Search + Type tabs -->
            <div class="flex flex-wrap items-center gap-3">
                <!-- Search -->
                <div class="relative flex-1 min-w-48">
                    <svg
                        class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-base-content/40"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                    >
                        <path
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            stroke-width="2"
                            d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                        />
                    </svg>
                    <input
                        id="history-search"
                        type="text"
                        placeholder="Search titles, episodes, tracks..."
                        class="input input-sm input-bordered w-full pl-9 bg-base-100/50"
                        value={searchText}
                        oninput={(e) => onSearchInput(e.currentTarget.value)}
                    />
                </div>

                <!-- Type tabs -->
                <div
                    role="tablist"
                    class="tabs tabs-boxed tabs-sm bg-base-200/50 shrink-0"
                >
                    <button
                        role="tab"
                        class="tab tab-sm"
                        class:tab-active={filterType === "all"}
                        onclick={() => setFilterType("all")}
                    >
                        All
                    </button>
                    <button
                        role="tab"
                        class="tab tab-sm"
                        class:tab-active={filterType === "show"}
                        onclick={() => setFilterType("show")}
                    >
                        📺 TV
                    </button>
                    <button
                        role="tab"
                        class="tab tab-sm"
                        class:tab-active={filterType === "movie"}
                        onclick={() => setFilterType("movie")}
                    >
                        🎬 Movies
                    </button>
                    <button
                        role="tab"
                        class="tab tab-sm"
                        class:tab-active={filterType === "artist"}
                        onclick={() => setFilterType("artist")}
                    >
                        🎵 Music
                    </button>
                </div>

                <div class="badge badge-ghost badge-sm shrink-0">
                    {data.stats.todayCount} today
                </div>
            </div>

            <!-- Row 2: Date range -->
            <div class="flex flex-wrap items-center gap-2">
                <span class="text-xs text-base-content/50 font-medium"
                    >Date range:</span
                >
                <input
                    id="history-date-from"
                    type="date"
                    class="input input-xs input-bordered bg-base-100/50 w-36"
                    value={fromDate}
                    onchange={(e) => {
                        fromDate = e.currentTarget.value;
                        applyFilters();
                    }}
                />
                <span class="text-xs text-base-content/40">→</span>
                <input
                    id="history-date-to"
                    type="date"
                    class="input input-xs input-bordered bg-base-100/50 w-36"
                    value={toDate}
                    onchange={(e) => {
                        toDate = e.currentTarget.value;
                        applyFilters();
                    }}
                />
                {#if hasActiveFilters}
                    <button
                        class="btn btn-xs btn-ghost text-error"
                        onclick={clearFilters}
                    >
                        ✕ Clear
                    </button>
                {/if}
            </div>
        </div>
    </div>

    <!-- Timeline -->
    {#if data.timeline.length === 0}
        <div class="card bg-base-200/30 border border-base-300/50">
            <div class="card-body items-center text-center py-16">
                {#if hasActiveFilters}
                    <div class="text-5xl mb-4">🔍</div>
                    <h2 class="text-xl font-bold">No results</h2>
                    <p class="text-base-content/60 max-w-md">
                        No history entries match your filters.
                    </p>
                    <button
                        class="btn btn-sm btn-primary mt-4"
                        onclick={clearFilters}>Clear filters</button
                    >
                {:else}
                    <div class="text-5xl mb-4">📭</div>
                    <h2 class="text-xl font-bold">No history yet</h2>
                    <p class="text-base-content/60 max-w-md">
                        Set up the Jellyfin Webhook Plugin to point to <code
                            class="text-xs bg-base-300 px-1.5 py-0.5 rounded"
                            >/api/ingest</code
                        >
                        or import your history from Trakt / Last.fm in Settings.
                    </p>
                {/if}
            </div>
        </div>
    {:else}
        <div class="space-y-6">
            {#each data.timeline as group (group.date)}
                <div>
                    <!-- Date Header -->
                    <div class="flex items-center gap-3 mb-2">
                        <h3
                            class="text-sm font-semibold text-base-content/50 uppercase tracking-wider"
                        >
                            {group.date}
                        </h3>
                        <div class="flex-1 h-px bg-base-300/50"></div>
                        <span class="text-xs text-base-content/40"
                            >{group.entries.length}
                            {group.entries.length === 1
                                ? "play"
                                : "plays"}</span
                        >
                    </div>

                    <!-- Entries -->
                    <div
                        class="card bg-base-200/20 border border-base-300/30"
                    >
                        <div class="divide-y divide-base-300/20">
                            {#each groupEntries(group.entries) as item, idx (item.type === "album" ? `album-${item.entry.id}` : item.entry.id)}
                                {#if item.type === "album"}
                                    <TimelineEntry
                                        entry={item.entry}
                                        jellyfinUrl={data.jellyfinUrl}
                                        albumGroup={item.tracks}
                                    />
                                {:else}
                                    <TimelineEntry
                                        entry={item.entry}
                                        jellyfinUrl={data.jellyfinUrl}
                                    />
                                {/if}
                            {/each}
                        </div>
                    </div>
                </div>
            {/each}
        </div>
    {/if}
</div>

<!-- Year Scrubber -->
<YearScrubber yearMap={data.yearMap} />
