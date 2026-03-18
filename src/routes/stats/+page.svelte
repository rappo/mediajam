<script>
    import { onMount } from 'svelte';
    import StatCard from '$lib/components/StatCard.svelte';
    import Heatmap from '$lib/components/Heatmap.svelte';
    import ClockChart from '$lib/components/ClockChart.svelte';
    import Chart from '$lib/components/Chart.svelte';
    import Skeleton from '$lib/components/Skeleton.svelte';
    import { imgUrl } from '$lib/utils.js';

    let loaded = $state(false);
    /** @type {any} */
    let stats = $state(null);

    onMount(async () => {
        try {
            const res = await fetch('/api/pages/stats');
            if (res.ok) stats = await res.json();
        } catch (e) {
            console.error('[stats] Failed to load:', e);
        }
        loaded = true;
    });

    // Chart configs (derived from data)
    const dowLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const dowChart = $derived(stats ? {
        data: [{
            type: 'column',
            color: 'oklch(0.65 0.25 280)',
            cornerRadius: 4,
            dataPoints: dowLabels.map((label, i) => ({
                label,
                y: stats.dowDistribution.find(/** @param {any} d */ (d) => d.dow === i)?.count || 0
            }))
        }],
        title: { text: 'Day of Week' },
    } : null);

    const decadeChart = $derived(stats ? {
        data: [{
            type: 'bar',
            color: 'oklch(0.7 0.2 150)',
            cornerRadius: 4,
            dataPoints: stats.decadeDistribution.map(/** @param {any} d */ (d) => ({
                label: `${d.decade}s`,
                y: d.count,
            }))
        }],
        title: { text: 'Library by Decade' },
    } : null);

    /**
     * @param {number} ticks
     * @returns {string}
     */
    function ticksToTime(ticks) {
        if (!ticks) return '?';
        const mins = Math.round(ticks / 10000000 / 60);
        const h = Math.floor(mins / 60);
        const m = mins % 60;
        return h > 0 ? `${h}h ${m}m` : `${m}m`;
    }

    /** @param {any} item @param {string} type */
    function itemHref(item, type) {
        if (!item?.slug) return '#';
        if (type === 'movie') return `/movies/${item.slug}`;
        if (type === 'show') return `/tv/${item.slug}`;
        if (type === 'artist') return `/music/${item.slug}`;
        return '#';
    }
</script>

<svelte:head>
    <title>Stats — Mediajam</title>
</svelte:head>

<div class="max-w-5xl mx-auto p-6 py-10">
    <!-- Header -->
    <div class="mb-8">
        <h1 class="text-3xl font-bold mb-1">Stats</h1>
        <p class="text-base-content/60">Your library at a glance</p>
    </div>

    {#if !loaded}
        <Skeleton type="stat-cards" />
    {:else if stats}
        <!-- ── Library Overview Cards ── -->
        <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-10">
            <StatCard icon="🎬" label="Movies" value={stats.library.movies} sub="{stats.library.watchedMovies} watched" color="primary" />
            <StatCard icon="📺" label="TV Shows" value={stats.library.shows} sub="{stats.library.episodes.toLocaleString()} episodes" color="secondary" />
            <StatCard icon="🎵" label="Artists" value={stats.library.artists} sub="{stats.library.albums.toLocaleString()} albums" color="accent" />
            <StatCard icon="▶" label="Total Plays" value={stats.playback.totalPlays} color="info" />
            <StatCard icon="⏱" label="Time Spent" value={stats.playback.friendlyTime} color="warning" />
            <StatCard icon="🔥" label="Streak" value="{stats.playback.longestStreak} days" color="error" />
        </div>

        <!-- ── Watch Heatmap ── -->
        <section class="mb-10">
            <h2 class="text-lg font-semibold mb-3 flex items-center gap-2">
                <span>🗓️</span> Activity Heatmap
            </h2>
            <div class="card bg-base-200/30 border border-base-300/30 p-4">
                <Heatmap data={stats.heatmap} />
            </div>
        </section>

        <!-- ── Clock + Day-of-Week ── -->
        <section class="mb-10 grid md:grid-cols-2 gap-6">
            <div>
                <h2 class="text-lg font-semibold mb-3 flex items-center gap-2">
                    <span>🕐</span> When You Watch
                </h2>
                <div class="card bg-base-200/30 border border-base-300/30 p-4">
                    <ClockChart data={stats.hourDistribution} />
                </div>
            </div>
            <div>
                <h2 class="text-lg font-semibold mb-3 flex items-center gap-2">
                    <span>📅</span> Busiest Days
                </h2>
                <div class="card bg-base-200/30 border border-base-300/30 p-2">
                    {#if dowChart}
                        <Chart options={dowChart} height={260} />
                    {/if}
                </div>
            </div>
        </section>

        <!-- ── Decade Distribution ── -->
        {#if stats.decadeDistribution.length > 0}
            <section class="mb-10">
                <h2 class="text-lg font-semibold mb-3 flex items-center gap-2">
                    <span>📊</span> Library by Decade
                </h2>
                <div class="card bg-base-200/30 border border-base-300/30 p-2">
                    {#if decadeChart}
                        <Chart options={decadeChart} height={220} />
                    {/if}
                </div>
            </section>
        {/if}

        <!-- ── Personal Records ── -->
        <section class="mb-10">
            <h2 class="text-lg font-semibold mb-3 flex items-center gap-2">
                <span>🏆</span> Personal Records
            </h2>
            <div class="grid sm:grid-cols-3 gap-4">
                {#if stats.records.longestMovie}
                    <div class="card bg-base-200/30 border border-base-300/30 p-4 flex flex-row items-center gap-3">
                        {#if stats.records.longestMovie.poster_url}
                            <img src={imgUrl(stats.records.longestMovie.poster_url)} alt="" class="w-12 h-16 rounded object-cover shrink-0" />
                        {/if}
                        <div class="min-w-0">
                            <div class="text-[10px] uppercase tracking-wider text-base-content/40 font-semibold">Longest Movie</div>
                            <div class="font-bold text-sm truncate">{stats.records.longestMovie.title}</div>
                            <div class="text-xs text-primary font-semibold">{ticksToTime(stats.records.longestMovie.runtime_ticks)}</div>
                        </div>
                    </div>
                {/if}
                {#if stats.records.mostRewatched}
                    <div class="card bg-base-200/30 border border-base-300/30 p-4 flex flex-row items-center gap-3">
                        {#if stats.records.mostRewatched.poster_url}
                            <img src={imgUrl(stats.records.mostRewatched.poster_url)} alt="" class="w-12 h-16 rounded object-cover shrink-0" />
                        {/if}
                        <div class="min-w-0">
                            <div class="text-[10px] uppercase tracking-wider text-base-content/40 font-semibold">Most Rewatched</div>
                            <div class="font-bold text-sm truncate">{stats.records.mostRewatched.title}</div>
                            <div class="text-xs text-secondary font-semibold">{stats.records.mostRewatched.plays} plays</div>
                        </div>
                    </div>
                {/if}
                {#if stats.records.fastestBinge}
                    <div class="card bg-base-200/30 border border-base-300/30 p-4 flex flex-row items-center gap-3">
                        {#if stats.records.fastestBinge.poster_url}
                            <img src={imgUrl(stats.records.fastestBinge.poster_url)} alt="" class="w-12 h-16 rounded object-cover shrink-0" />
                        {/if}
                        <div class="min-w-0">
                            <div class="text-[10px] uppercase tracking-wider text-base-content/40 font-semibold">Fastest Binge</div>
                            <div class="font-bold text-sm truncate">{stats.records.fastestBinge.title}</div>
                            <div class="text-xs text-accent font-semibold">
                                {stats.records.fastestBinge.eps_watched} eps in {stats.records.fastestBinge.days_span} day{stats.records.fastestBinge.days_span !== 1 ? 's' : ''}
                            </div>
                        </div>
                    </div>
                {/if}
            </div>
        </section>

        <!-- ── Top People ── -->
        {#if stats.topPeople.length > 0}
            <section class="mb-10">
                <h2 class="text-lg font-semibold mb-3 flex items-center gap-2">
                    <span>🎭</span> Most Watched People
                </h2>
                <div class="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-5 gap-3">
                    {#each stats.topPeople.slice(0, 10) as person}
                        <a
                            href="/people/{person.slug || person.id}"
                            class="card bg-base-200/30 border border-base-300/30 hover:border-primary/30 transition-all p-3 flex flex-col items-center gap-2 text-center group"
                        >
                            {#if person.photo_url}
                                <img
                                    src={imgUrl(person.photo_url)}
                                    alt={person.name}
                                    class="w-14 h-14 rounded-full object-cover border-2 border-base-300 group-hover:border-primary/50 transition-colors"
                                />
                            {:else}
                                <div class="w-14 h-14 rounded-full bg-base-300 flex items-center justify-center text-xl">
                                    👤
                                </div>
                            {/if}
                            <div class="min-w-0 w-full">
                                <div class="font-medium text-xs truncate">{person.name}</div>
                                <div class="text-[10px] text-base-content/40 capitalize">{person.role_type}</div>
                                <div class="text-[10px] text-primary font-semibold">{person.play_count} plays</div>
                            </div>
                        </a>
                    {/each}
                </div>
            </section>
        {/if}

        <!-- ── Rewatch Index ── -->
        {#if stats.rewatchIndex.length > 0}
            <section class="mb-10">
                <h2 class="text-lg font-semibold mb-3 flex items-center gap-2">
                    <span>🔄</span> Most Rewatched
                </h2>
                <div class="card bg-base-200/30 border border-base-300/30 divide-y divide-base-300/20">
                    {#each stats.rewatchIndex as item, idx}
                        <a href={itemHref(item, item.media_type)} class="flex items-center gap-3 p-3 hover:bg-base-300/20 transition-colors">
                            <span class="text-base-content/30 text-sm font-mono w-6 text-right shrink-0">{idx + 1}</span>
                            {#if item.poster_url}
                                <img src={imgUrl(item.poster_url)} alt="" class="w-8 h-11 rounded object-cover shrink-0" />
                            {:else}
                                <div class="w-8 h-11 rounded bg-base-300 flex items-center justify-center text-sm">
                                    {item.media_type === 'movie' ? '🎬' : item.media_type === 'show' ? '📺' : '🎵'}
                                </div>
                            {/if}
                            <div class="flex-1 min-w-0">
                                <div class="text-sm font-medium truncate">{item.title}</div>
                                <div class="text-[10px] text-base-content/40 capitalize">{item.media_type}</div>
                            </div>
                            <div class="flex items-center gap-1.5 shrink-0">
                                <div class="h-1.5 rounded-full bg-primary/20 w-16 overflow-hidden">
                                    <div
                                        class="h-full rounded-full bg-primary transition-all"
                                        style="width: {Math.min(100, (item.plays / stats.rewatchIndex[0].plays) * 100)}%"
                                    ></div>
                                </div>
                                <span class="text-xs font-semibold text-primary tabular-nums">{item.plays}×</span>
                            </div>
                        </a>
                    {/each}
                </div>
            </section>
        {/if}
    {:else}
        <div class="card bg-base-200/30 border border-base-300/50">
            <div class="card-body items-center text-center py-16">
                <div class="text-5xl mb-4">📊</div>
                <h2 class="text-xl font-bold">No stats yet</h2>
                <p class="text-base-content/60 max-w-md">
                    Start watching and listening to build your stats. Sync your library in Settings to get started.
                </p>
            </div>
        </div>
    {/if}
</div>
