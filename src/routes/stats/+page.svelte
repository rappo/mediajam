<script>
    import { onMount, onDestroy } from 'svelte';
    import StatCard from '$lib/components/StatCard.svelte';
    import SankeyChart from '$lib/components/SankeyChart.svelte';
    import TreemapChart from '$lib/components/TreemapChart.svelte';
    import StackedBarChart from '$lib/components/StackedBarChart.svelte';
    import Chart from '$lib/components/Chart.svelte';
    import MdiIcon from '$lib/components/MdiIcon.svelte';
    import { mdiBookshelf, mdiMovieOpen, mdiMusic, mdiTimerOutline, mdiCalendar, mdiTrendingUp, mdiChartBar, mdiTelevision } from '@mdi/js';

    let loaded = $state(false);
    let loadError = $state('');
    /** @type {any} */
    let stats = $state(null);
    let viewMode = $state('sankey');

    /** @type {any} */
    let breakdown = $state(null);
    /** @type {ReturnType<typeof setTimeout>|null} */
    let breakdownPoll = null;

    async function fetchBreakdown() {
        try {
            const res = await fetch('/api/pages/stats/breakdown');
            if (!res.ok) return;
            breakdown = await res.json();
            // Cold cache: TV resolution builds in the background — poll until it lands
            if (breakdown.building && !breakdown.tv?.resolution) {
                breakdownPoll = setTimeout(fetchBreakdown, 15_000);
            }
        } catch { /* charts just stay hidden */ }
    }

    onMount(async () => {
        fetchBreakdown();
        try {
            const res = await fetch('/api/pages/stats');
            if (res.ok) {
                stats = await res.json();
            } else {
                const text = await res.text();
                loadError = `API error ${res.status}: ${text.slice(0, 200)}`;
                console.error('[stats]', loadError);
            }
        } catch (e) {
            loadError = e instanceof Error ? e.message : 'Network error';
            console.error('[stats] Failed to load:', e);
        }
        loaded = true;
    });
    onDestroy(() => { if (breakdownPoll) clearTimeout(breakdownPoll); });

    const PIE_PALETTE = ['#7c3aed', '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#14b8a6', '#f97316', '#8b5cf6', '#84cc16', '#6b7280'];

    /**
     * CanvasJS-style doughnut options for Chart.svelte from [{label, value}] rows.
     * @param {any[]} rows
     */
    function pieOptions(rows) {
        return {
            data: [{
                type: 'doughnut',
                dataPoints: rows.map((r, i) => ({
                    label: r.label,
                    y: r.value,
                    color: PIE_PALETTE[i % PIE_PALETTE.length],
                })),
            }],
        };
    }

    /** @param {any[]} rows */
    function pieTotal(rows) {
        return Math.round(rows.reduce((s, r) => s + r.value, 0) * 10) / 10;
    }

    /**
     * @param {number} hours
     * @returns {string}
     */
    function formatHours(hours) {
        if (!hours) return '0h';
        if (hours < 24) return `${hours}h`;
        const days = Math.floor(hours / 24);
        const rem = hours % 24;
        if (days >= 365) {
            const yrs = Math.floor(days / 365);
            const mo = Math.floor((days % 365) / 30);
            return mo > 0 ? `${yrs}y ${mo}mo` : `${yrs}y`;
        }
        if (days >= 30) {
            const mo = Math.floor(days / 30);
            const d = days % 30;
            return d > 0 ? `${mo}mo ${d}d` : `${mo}mo`;
        }
        return rem > 0 ? `${days}d ${rem}h` : `${days}d`;
    }
</script>

<svelte:head>
    <title>Stats — Mediajam</title>
</svelte:head>

<div class="max-w-5xl mx-auto p-6 py-10">
    <div class="mb-8">
        <h1 class="text-3xl font-bold mb-1">Stats</h1>
        <p class="text-base-content/60">Library composition at a glance</p>
    </div>

    {#if !loaded}
        <div class="flex items-center justify-center py-16">
            <span class="loading loading-spinner loading-lg"></span>
        </div>
    {:else if stats}
        <!-- ── Overview Cards ── -->
        <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-10">
            <StatCard label="Total Items" value={stats.cards.total} color="primary">
                <MdiIcon icon={mdiBookshelf} size={16} />
            </StatCard>
            <StatCard label="Movies" value={stats.cards.movies} sub="{stats.cards.shows} shows" color="secondary">
                <MdiIcon icon={mdiMovieOpen} size={16} />
            </StatCard>
            <StatCard label="Music" value={stats.cards.artists} sub="{stats.cards.albums} albums" color="accent">
                <MdiIcon icon={mdiMusic} size={16} />
            </StatCard>
            <StatCard label="Play Time" value={formatHours(stats.cards.watchHours)} color="info">
                <MdiIcon icon={mdiTimerOutline} size={16} />
            </StatCard>
            <StatCard label="This Month" value={stats.cards.thisMonth} sub="items played" color="warning">
                <MdiIcon icon={mdiCalendar} size={16} />
            </StatCard>
            <StatCard label="Growth" value="+{stats.cards.growthRate}/wk" sub={stats.cards.avgRating ? `avg ${stats.cards.avgRating}★` : ''} color="error">
                <MdiIcon icon={mdiTrendingUp} size={16} />
            </StatCard>
        </div>

        <!-- ── Library Composition ── -->
        <section>
            <div class="flex items-center justify-between mb-3">
                <h2 class="text-lg font-semibold flex items-center gap-2">
                    <MdiIcon icon={mdiChartBar} size={18} /> Library Composition
                </h2>
                <div class="join">
                    <button class="join-item btn btn-xs" class:btn-active={viewMode === 'sankey'} onclick={() => viewMode = 'sankey'}>Flow</button>
                    <button class="join-item btn btn-xs" class:btn-active={viewMode === 'treemap'} onclick={() => viewMode = 'treemap'}>Treemap</button>
                    <button class="join-item btn btn-xs" class:btn-active={viewMode === 'bars'} onclick={() => viewMode = 'bars'}>Bars</button>
                </div>
            </div>
            <div class="card bg-base-200/30 border border-base-300/30 p-4">
                {#if stats.sankey.nodes.length > 0}
                    {#if viewMode === 'sankey'}
                        <SankeyChart
                            nodes={stats.sankey.nodes}
                            links={stats.sankey.links}
                        />
                    {:else if viewMode === 'treemap'}
                        <TreemapChart
                            nodes={stats.sankey.nodes}
                            links={stats.sankey.links}
                        />
                    {:else}
                        <StackedBarChart
                            nodes={stats.sankey.nodes}
                            links={stats.sankey.links}
                        />
                    {/if}
                {:else}
                    <div class="flex flex-col items-center justify-center py-16 text-base-content/40">
                        <span class="text-4xl mb-4"><MdiIcon icon={mdiChartBar} size={40} /></span>
                        <p>No data yet. Sync your library to see the flow.</p>
                    </div>
                {/if}
            </div>
        </section>

        <!-- ── Per-media-type breakdowns ── -->
        {#snippet pieCard(/** @type {string} */ title, /** @type {any[]|null} */ rows, /** @type {string} */ unit)}
            <div class="card bg-base-200/30 border border-base-300/30 p-4">
                <h3 class="text-sm font-semibold mb-1 text-base-content/80">{title}</h3>
                {#if rows === null}
                    <div class="flex flex-col items-center justify-center flex-1 py-10 text-base-content/40 text-xs gap-2">
                        <span class="loading loading-spinner loading-sm"></span>
                        <span>Analyzing files…</span>
                    </div>
                {:else if rows.length === 0}
                    <div class="flex items-center justify-center flex-1 py-10 text-base-content/40 text-xs">No data</div>
                {:else}
                    <Chart options={pieOptions(rows)} height={190} />
                    <div class="pie-legend">
                        {#each rows as row, i}
                            <div class="pie-legend-row" title="{row.label}: {row.value}{unit}">
                                <span class="pie-legend-dot" style="background: {PIE_PALETTE[i % PIE_PALETTE.length]}"></span>
                                <span class="pie-legend-label">{row.label}</span>
                                <span class="pie-legend-value">{row.value}{unit}</span>
                            </div>
                        {/each}
                    </div>
                {/if}
            </div>
        {/snippet}

        {#if breakdown}
            <section class="mt-10">
                <h2 class="text-lg font-semibold flex items-center gap-2 mb-3">
                    <MdiIcon icon={mdiMovieOpen} size={18} /> Movies
                </h2>
                <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                    {@render pieCard('By Quality Profile', breakdown.movies.qualityProfile, '')}
                    {@render pieCard('By Resolution', breakdown.movies.resolution, '')}
                    {@render pieCard('By Codec', breakdown.movies.codec, '')}
                    {@render pieCard('HDR vs SDR', breakdown.movies.hdr, '')}
                </div>
            </section>

            <section class="mt-10">
                <h2 class="text-lg font-semibold flex items-center gap-2 mb-3">
                    <MdiIcon icon={mdiTelevision} size={18} /> TV
                </h2>
                <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                    {@render pieCard('By Episode Count', breakdown.tv.episodeCount, ' eps')}
                    {@render pieCard('By Size on Disk', breakdown.tv.sizeOnDisk, ' GB')}
                    {@render pieCard('By Resolution', breakdown.tv.resolution, ' eps')}
                    {@render pieCard('By Quality Profile', breakdown.tv.qualityProfile, '')}
                </div>
            </section>

            <section class="mt-10">
                <h2 class="text-lg font-semibold flex items-center gap-2 mb-3">
                    <MdiIcon icon={mdiMusic} size={18} /> Music
                </h2>
                <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                    {@render pieCard('By Size on Disk', breakdown.music.sizeOnDisk, ' GB')}
                    {@render pieCard('By Quality Profile', breakdown.music.qualityProfile, '')}
                </div>
            </section>
        {/if}
    {:else if loadError}
        <div class="alert alert-error text-sm">
            <span>Failed to load stats: {loadError}</span>
            <button class="btn btn-sm btn-ghost" onclick={() => location.reload()}>Retry</button>
        </div>
    {:else}
        <div class="card bg-base-200/30 border border-base-300/50">
            <div class="card-body items-center text-center py-16">
                <div class="text-5xl mb-4"><MdiIcon icon={mdiChartBar} size={48} /></div>
                <h2 class="text-xl font-bold">No stats yet</h2>
                <p class="text-base-content/60 max-w-md">
                    Start watching and listening to build your stats. Sync your library in Settings to get started.
                </p>
            </div>
        </div>
    {/if}
</div>

<style>
    .pie-legend {
        display: flex;
        flex-direction: column;
        gap: 0.15rem;
        margin-top: 0.6rem;
        max-height: 9rem;
        overflow-y: auto;
    }
    .pie-legend-row {
        display: flex;
        align-items: center;
        gap: 0.4rem;
        font-size: 0.68rem;
        line-height: 1.3;
        color: color-mix(in oklab, var(--color-base-content) 70%, transparent);
    }
    .pie-legend-dot {
        width: 8px;
        height: 8px;
        border-radius: 2px;
        flex-shrink: 0;
    }
    .pie-legend-label {
        flex: 1;
        min-width: 0;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }
    .pie-legend-value {
        color: color-mix(in oklab, var(--color-base-content) 45%, transparent);
        font-variant-numeric: tabular-nums;
        white-space: nowrap;
    }
</style>
