<script>
    import NowPlaying from '$lib/components/NowPlaying.svelte';
    import TimelineEntry from '$lib/components/TimelineEntry.svelte';
    import StatCard from '$lib/components/StatCard.svelte';

    /** @type {{ data: import('./$types').PageData }} */
    let { data } = $props();

    let filterType = $state('all');

    const filteredTimeline = $derived(
        filterType === 'all'
            ? data.timeline
            : data.timeline
                .map(group => ({
                    ...group,
                    entries: group.entries.filter(e => e.media_type === filterType)
                }))
                .filter(group => group.entries.length > 0)
    );
</script>

<svelte:head>
    <title>History — Mediajam</title>
</svelte:head>

<div class="max-w-4xl mx-auto p-6 py-10">
    <!-- Header -->
    <div class="mb-8">
        <h1 class="text-3xl font-bold mb-1">History</h1>
        <p class="text-base-content/60">Your media timeline</p>
    </div>

    <!-- Now Playing -->
    <div class="mb-6">
        <NowPlaying sessions={data.activeSessions} jellyfinUrl={data.jellyfinUrl} />
    </div>

    <!-- Stats Row -->
    <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
        <StatCard icon="▶" label="Total Plays" value={data.stats.totalPlays} color="primary" />
        <StatCard icon="🎯" label="Unique Items" value={data.stats.uniqueItems} color="secondary" />
        <StatCard icon="📅" label="Active Days" value={data.stats.activeDays} color="accent" />
        <StatCard icon="⏱" label="Hours Played" value={data.stats.totalHours} color="info" />
    </div>

    <!-- Filter Tabs -->
    <div class="flex items-center justify-between mb-6">
        <div role="tablist" class="tabs tabs-boxed bg-base-200/50">
            <button role="tab" class="tab tab-sm" class:tab-active={filterType === 'all'} onclick={() => filterType = 'all'}>
                All
            </button>
            <button role="tab" class="tab tab-sm" class:tab-active={filterType === 'show'} onclick={() => filterType = 'show'}>
                📺 TV
            </button>
            <button role="tab" class="tab tab-sm" class:tab-active={filterType === 'movie'} onclick={() => filterType = 'movie'}>
                🎬 Movies
            </button>
            <button role="tab" class="tab tab-sm" class:tab-active={filterType === 'artist'} onclick={() => filterType = 'artist'}>
                🎵 Music
            </button>
        </div>
        <div class="badge badge-ghost badge-sm">
            {data.stats.todayCount} today
        </div>
    </div>

    <!-- Timeline -->
    {#if filteredTimeline.length === 0}
        <div class="card bg-base-200/30 border border-base-300/50">
            <div class="card-body items-center text-center py-16">
                <div class="text-5xl mb-4">📭</div>
                <h2 class="text-xl font-bold">No history yet</h2>
                <p class="text-base-content/60 max-w-md">
                    Set up the Jellyfin Webhook Plugin to point to <code class="text-xs bg-base-300 px-1.5 py-0.5 rounded">/api/ingest</code>
                    or import your history from Trakt / Last.fm in Settings.
                </p>
            </div>
        </div>
    {:else}
        <div class="space-y-6">
            {#each filteredTimeline as group (group.date)}
                <div>
                    <!-- Date Header -->
                    <div class="flex items-center gap-3 mb-2">
                        <h3 class="text-sm font-semibold text-base-content/50 uppercase tracking-wider">{group.date}</h3>
                        <div class="flex-1 h-px bg-base-300/50"></div>
                        <span class="text-xs text-base-content/40">{group.entries.length} {group.entries.length === 1 ? 'play' : 'plays'}</span>
                    </div>

                    <!-- Entries -->
                    <div class="card bg-base-200/20 border border-base-300/30">
                        <div class="divide-y divide-base-300/20">
                            {#each group.entries as entry (entry.id)}
                                <TimelineEntry {entry} jellyfinUrl={data.jellyfinUrl} />
                            {/each}
                        </div>
                    </div>
                </div>
            {/each}
        </div>
    {/if}
</div>
