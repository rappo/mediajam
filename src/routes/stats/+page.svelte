<script>
    import { onMount } from 'svelte';
    import StatCard from '$lib/components/StatCard.svelte';
    import SankeyChart from '$lib/components/SankeyChart.svelte';

    let loaded = $state(false);
    let loadError = $state('');
    /** @type {any} */
    let stats = $state(null);

    onMount(async () => {
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
    <!-- Header -->
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
            <StatCard icon="📚" label="Total Items" value={stats.cards.total} color="primary" />
            <StatCard icon="🎬" label="Movies" value={stats.cards.movies} sub="{stats.cards.shows} shows · {stats.cards.artists} artists" color="secondary" />
            <StatCard icon="💿" label="Albums" value={stats.cards.albums} sub="{stats.cards.episodes.toLocaleString()} episodes" color="accent" />
            <StatCard icon="⏱" label="Watch Time" value={formatHours(stats.cards.watchHours)} color="info" />
            <StatCard icon="📅" label="This Month" value={stats.cards.thisMonth} sub="items watched" color="warning" />
            <StatCard icon="📈" label="Growth" value="+{stats.cards.growthRate}/wk" sub={stats.cards.avgRating ? `avg ${stats.cards.avgRating}★` : ''} color="error" />
        </div>

        <!-- ── Sankey Diagram ── -->
        <section>
            <h2 class="text-lg font-semibold mb-3 flex items-center gap-2">
                <span>📊</span> Library Composition
            </h2>
            <div class="card bg-base-200/30 border border-base-300/30 p-4">
                {#if stats.sankey.nodes.length > 0}
                    <SankeyChart
                        nodes={stats.sankey.nodes}
                        links={stats.sankey.links}
                    />
                {:else}
                    <div class="flex flex-col items-center justify-center py-16 text-base-content/40">
                        <span class="text-4xl mb-4">📊</span>
                        <p>No data yet. Sync your library to see the flow.</p>
                    </div>
                {/if}
            </div>
        </section>
    {:else if loadError}
        <div class="alert alert-error text-sm">
            <span>Failed to load stats: {loadError}</span>
            <button class="btn btn-sm btn-ghost" onclick={() => location.reload()}>Retry</button>
        </div>
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
