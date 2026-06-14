<script>
    import { onMount } from 'svelte';
    import NowPlaying from "$lib/components/NowPlaying.svelte";
    import TimelineEntry from "$lib/components/TimelineEntry.svelte";
    import StatCard from "$lib/components/StatCard.svelte";
    import YearScrubber from "$lib/components/YearScrubber.svelte";
    import Skeleton from "$lib/components/Skeleton.svelte";
    import MdiIcon from "$lib/components/MdiIcon.svelte";
    import { mdiPlay, mdiBullseyeArrow, mdiCalendar, mdiTimerSand, mdiFire, mdiMagnify, mdiSortDescending, mdiSortAscending, mdiTelevision, mdiMovieOpen, mdiMusic, mdiPackageVariantRemove } from '@mdi/js';
    import { page } from "$app/stores";
    import { goto } from "$app/navigation";

    /** @type {{ data: import('./$types').PageData }} */
    let { data } = $props();

    // Deferred data loaded client-side
    let loaded = $state(false);
    let activeSessions = $state(/** @type {any[]} */ ([]));
    let timeline = $state(/** @type {any[]} */ ([]));
    let history = $state(/** @type {any[]} */ ([]));
    let yearMap = $state(/** @type {any[]} */ ([]));
    let stats = $state(/** @type {any} */ ({ totalPlays: 0, uniqueItems: 0, activeDays: 0, friendlyTime: '0', totalDaysSince: 0, activePct: 0, firstCheckInLabel: '', todayCount: 0, longestStreak: 0 }));
    let filters = $state(/** @type {any} */ ({ from: '', to: '', search: '', mediaType: '' }));

    async function loadData() {
        loaded = false;
        try {
            const qs = window.location.search;
            const res = await fetch('/api/pages/history' + qs);
            const d = await res.json();
            activeSessions = d.activeSessions;
            timeline = d.timeline;
            history = d.history;
            yearMap = d.yearMap;
            stats = d.stats;
            filters = d.filters;
            // Sync local filter state from response
            filterType = d.filters?.mediaType || 'all';
            searchText = d.filters?.search || '';
            fromDate = d.filters?.from || '';
            toDate = d.filters?.to || '';
            sortOrder = d.filters?.sort || 'desc';
            showDateRange = !!(d.filters?.from || d.filters?.to);
        } catch (e) {
            console.error('[history] Failed to load data:', e);
        }
        loaded = true;
    }

    onMount(loadData);

    // Local filter state
    let filterType = $state('all');
    let searchText = $state('');
    let fromDate = $state('');
    let toDate = $state('');
    let sortOrder = $state('desc');
    let searchTimer = $state(/** @type {ReturnType<typeof setTimeout>|null} */ (null));
    let showDateRange = $state(false);

    /**
     * Push filter params to the URL and refetch data
     */
    async function applyFilters() {
        const params = new URLSearchParams();
        if (filterType && filterType !== "all") params.set("type", filterType);
        if (searchText.trim()) params.set("q", searchText.trim());
        if (fromDate) params.set("from", fromDate);
        if (toDate) params.set("to", toDate);
        if (sortOrder === 'asc') params.set("sort", "asc");
        const qs = params.toString();
        // Update URL for bookmarkability (replaceState to avoid history spam)
        window.history.replaceState({}, '', `/history${qs ? "?" + qs : ""}`);
        // Refetch from API with new params
        loaded = false;
        try {
            const res = await fetch('/api/pages/history' + (qs ? '?' + qs : ''));
            const d = await res.json();
            timeline = d.timeline;
            history = d.history;
            stats = d.stats;
            activeSessions = d.activeSessions;
        } catch (e) {
            console.error('[history] Filter fetch failed:', e);
        }
        loaded = true;
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
        sortOrder = "desc";
        goto("/history", { keepFocus: true });
    }

    const hasActiveFilters = $derived(
        filterType !== "all" || searchText.trim() || fromDate || toDate,
    );

    /**
     * Group consecutive same-artist music tracks into artist groups with album sub-groups.
     * @param {any[]} entries
     * @returns {Array<{type: 'single', entry: any} | {type: 'artist_group', entry: any, albumGroups: Array<{albumTitle: string, albumArtUrl: string|null, albumId: number|null, tracks: any[]}>}>}
     */
    function groupEntries(entries) {
        /** @type {Array<{type: 'single', entry: any} | {type: 'artist_group', entry: any, albumGroups: Array<{albumTitle: string, albumArtUrl: string|null, albumId: number|null, tracks: any[]}>}>} */
        const result = [];
        let i = 0;
        while (i < entries.length) {
            const e = entries[i];
            if (e.media_type === "artist" && e.parent_id) {
                // Collect consecutive same-artist tracks
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
                    // Sub-group by album (media_id = album child)
                    /** @type {Array<{albumTitle: string, albumArtUrl: string|null, albumId: number|null, tracks: any[]}>} */
                    const albumGroups = [];
                    /** @type {{albumTitle: string, albumArtUrl: string|null, albumId: number|null, tracks: any[]}|null} */
                    let currentAlbum = null;

                    for (const track of run) {
                        const albumKey = track.media_id;
                        if (currentAlbum && currentAlbum.albumId === albumKey) {
                            currentAlbum.tracks.push(track);
                        } else {
                            currentAlbum = {
                                albumTitle: track.item_title || 'Unknown Album',
                                albumArtUrl: track.album_art_url || null,
                                albumId: albumKey,
                                tracks: [track],
                            };
                            albumGroups.push(currentAlbum);
                        }
                    }

                    result.push({
                        type: "artist_group",
                        entry: run[0],
                        albumGroups,
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
    {#if loaded && activeSessions.length > 0}
    <div class="mb-6">
        <NowPlaying
            sessions={activeSessions}
            jellyfinUrl={data.jellyfinUrl}
            remoteControlEnabled={$page.data.remoteControlEnabled}
        />
    </div>
    {/if}

    <!-- Stats Row -->
    {#if !loaded}
        <Skeleton type="stat-cards" />
    {:else}
    <div class="grid grid-cols-2 sm:grid-cols-5 gap-4 mb-8">
        <StatCard
            label="Total Plays"
            value={stats.totalPlays}
            color="primary"
        >
            <MdiIcon icon={mdiPlay} size={16} />
        </StatCard>
        <StatCard
            label="Unique Items"
            value={stats.uniqueItems}
            color="secondary"
        >
            <MdiIcon icon={mdiBullseyeArrow} size={16} />
        </StatCard>
        <StatCard
            label="Active Days"
            value={stats.activeDays}
            sub={stats.totalDaysSince ? `/${stats.totalDaysSince.toLocaleString()} (${stats.activePct}%) since ${stats.firstCheckInLabel}` : ''}
            color="accent"
        >
            <MdiIcon icon={mdiCalendar} size={16} />
        </StatCard>
        <StatCard
            label="Time Spent"
            value={stats.friendlyTime}
            color="info"
        >
            <MdiIcon icon={mdiTimerSand} size={16} />
        </StatCard>
        <StatCard
            label="Longest Streak"
            value={stats.longestStreak
                ? `${stats.longestStreak} days`
                : "0"}
            color="warning"
        >
            <MdiIcon icon={mdiFire} size={16} />
        </StatCard>
    </div>
    {/if}

    <!-- Filter Bar -->
    <div class="card bg-base-200/30 border border-base-300/30 mb-6">
        <div class="card-body p-3 gap-3">
            <!-- Row 1: Search + Date toggle + Type tabs -->
            <div class="flex flex-wrap items-center gap-3">
                <!-- Search -->
                <div class="relative flex-1 min-w-48">
                    <MdiIcon icon={mdiMagnify} size={16} class="absolute left-3 top-1/2 -translate-y-1/2 text-base-content/40" />
                    <input
                        id="history-search"
                        type="text"
                        placeholder="Search titles, episodes, tracks..."
                        class="input input-sm input-bordered w-full pl-9 bg-base-100/50"
                        value={searchText}
                        oninput={(e) => onSearchInput(e.currentTarget.value)}
                    />
                </div>

                <!-- Date picker toggle button -->
                <button
                    class="btn btn-sm btn-square {showDateRange || fromDate || toDate ? 'btn-primary' : 'btn-ghost'}"
                    onclick={() => showDateRange = !showDateRange}
                    title="Filter by date range"
                >
                    <MdiIcon icon={mdiCalendar} size={16} />
                </button>

                <!-- Reverse order toggle -->
                <button
                    class="btn btn-sm btn-square {sortOrder === 'asc' ? 'btn-primary' : 'btn-ghost'}"
                    onclick={() => { sortOrder = sortOrder === 'desc' ? 'asc' : 'desc'; applyFilters(); }}
                    title={sortOrder === 'desc' ? 'Showing newest first — click for oldest first' : 'Showing oldest first — click for newest first'}
                >
                    {#if sortOrder === 'desc'}
                        <MdiIcon icon={mdiSortDescending} size={16} />
                    {:else}
                        <MdiIcon icon={mdiSortAscending} size={16} />
                    {/if}
                </button>

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
                        <MdiIcon icon={mdiTelevision} size={14} /> TV
                    </button>
                    <button
                        role="tab"
                        class="tab tab-sm"
                        class:tab-active={filterType === "movie"}
                        onclick={() => setFilterType("movie")}
                    >
                        <MdiIcon icon={mdiMovieOpen} size={14} /> Movies
                    </button>
                    <button
                        role="tab"
                        class="tab tab-sm"
                        class:tab-active={filterType === "artist"}
                        onclick={() => setFilterType("artist")}
                    >
                        <MdiIcon icon={mdiMusic} size={14} /> Music
                    </button>
                </div>

                <div class="badge badge-ghost badge-sm shrink-0">
                    {stats.todayCount} today
                </div>
            </div>

            <!-- Row 2: Date range (collapsible) -->
            {#if showDateRange}
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
                    {#if fromDate || toDate}
                        <button
                            class="btn btn-xs btn-ghost text-error"
                            onclick={() => { fromDate = ''; toDate = ''; applyFilters(); }}
                        >
                            ✕ Clear dates
                        </button>
                    {/if}
                </div>
            {/if}

            {#if hasActiveFilters}
                <div class="flex justify-end">
                    <button
                        class="btn btn-xs btn-ghost text-error"
                        onclick={clearFilters}
                    >
                        ✕ Clear all filters
                    </button>
                </div>
            {/if}
        </div>
    </div>

    <!-- Timeline -->
    {#if !loaded}
        <Skeleton type="timeline" />
    {:else if timeline.length === 0}
        <div class="card bg-base-200/30 border border-base-300/50">
            <div class="card-body items-center text-center py-16">
                {#if hasActiveFilters}
                    <div class="text-5xl mb-4"><MdiIcon icon={mdiMagnify} size={48} /></div>
                    <h2 class="text-xl font-bold">No results</h2>
                    <p class="text-base-content/60 max-w-md">
                        No history entries match your filters.
                    </p>
                    <button
                        class="btn btn-sm btn-primary mt-4"
                        onclick={clearFilters}>Clear filters</button
                    >
                {:else}
                    <div class="text-5xl mb-4"><MdiIcon icon={mdiPackageVariantRemove} size={48} /></div>
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
            {#each timeline as group (group.date)}
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
                            {#each groupEntries(group.entries) as item, idx (item.type === "artist_group" ? `group-${item.entry.id}-${idx}` : item.entry.id)}
                                {#if item.type === "artist_group"}
                                    <TimelineEntry
                                        entry={item.entry}
                                        jellyfinUrl={data.jellyfinUrl}
                                        albumGroups={item.albumGroups}
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
{#if loaded}
    <YearScrubber yearMap={yearMap} />
{/if}
