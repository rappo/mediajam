<script>
    import StatCard from "$lib/components/StatCard.svelte";
    import DataTable from "$lib/components/DataTable.svelte";
    import Chart from "$lib/components/Chart.svelte";
    import DeleteToast from "$lib/components/DeleteToast.svelte";
    import CalendarStrip from "$lib/components/CalendarStrip.svelte";
    import PosterRow from "$lib/components/PosterRow.svelte";
    import ProgressCard from "$lib/components/ProgressCard.svelte";

    let { data } = $props();

    let showLibrary = $state(false);

    /**
     * @param {string} dateStr
     */
    function formatAirDate(dateStr) {
        if (!dateStr) return '';
        const d = new Date(dateStr);
        const now = new Date();
        const diffDays = Math.round((d.getTime() - now.getTime()) / 86400000);
        if (diffDays === 0) return 'Today';
        if (diffDays === 1) return 'Tomorrow';
        if (diffDays === -1) return 'Yesterday';
        if (diffDays > 0 && diffDays <= 7) return d.toLocaleDateString('en-US', { weekday: 'long' });
        return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }

    /**
     * @param {any} ep
     */
    function epCode(ep) {
        return `S${String(ep.season_number).padStart(2, '0')}E${String(ep.item_number).padStart(2, '0')}`;
    }

    // Chart options (only used in library view)
    const watchPieOptions = {
        title: { text: "Episode Watch Status" },
        data: [{
            type: "doughnut", startAngle: 240,
            indexLabelFontColor: "#a6adba", indexLabelFontSize: 12,
            indexLabelFontFamily: "Inter, sans-serif",
            toolTipContent: "{label}: {y}",
            dataPoints: [
                { label: "Watched", y: data.episodeStats.watched, color: "#36d399" },
                { label: "Unwatched", y: data.episodeStats.unwatched, color: "#6b7280" },
                { label: "In Progress", y: data.episodeStats.inProgress, color: "#fbbd23" },
            ],
        }],
    };

    const topShowsBarOptions = {
        title: { text: "Top 15 Shows by Watch Count" },
        axisX: { labelAngle: -45, labelFontSize: 11 },
        axisY: { title: "Watches", titleFontColor: "#a6adba" },
        data: [{ type: "column", color: "#7c3aed", cornerRadius: 4, dataPoints: data.topShowsByWatchCount }],
    };

    const completionPieOptions = {
        title: { text: "Watch Completion" },
        data: [{
            type: "pie", startAngle: 240,
            indexLabelFontColor: "#a6adba", indexLabelFontSize: 12,
            indexLabelFontFamily: "Inter, sans-serif",
            toolTipContent: "{label}: {y} shows",
            dataPoints: [
                { label: "Fully Watched", y: data.completionBuckets.full, color: "#36d399" },
                { label: "Partially Watched", y: data.completionBuckets.partial, color: "#fbbd23" },
                { label: "Not Started", y: data.completionBuckets.none, color: "#6b7280" },
            ],
        }],
    };

    const collectionPieOptions = {
        title: { text: "Collection Status" },
        data: [{
            type: "pie", startAngle: 200,
            indexLabelFontColor: "#a6adba", indexLabelFontSize: 12,
            indexLabelFontFamily: "Inter, sans-serif",
            toolTipContent: "{label}: {y} shows",
            dataPoints: [
                { label: "Complete", y: data.collectionBuckets.complete, color: "#22d3ee" },
                { label: "Partial", y: data.collectionBuckets.partial, color: "#fb923c" },
                { label: "Missing", y: data.collectionBuckets.missing, color: "#ef4444" },
            ],
        }],
    };

    const showsByYearOptions = {
        title: { text: "Shows by Premiere Year" },
        axisX: { title: "Year", titleFontColor: "#a6adba", labelFontSize: 11, interval: 5, valueFormatString: "####" },
        axisY: { title: "Count", titleFontColor: "#a6adba" },
        data: [{ type: "column", color: "#7c3aed", cornerRadius: 4,
            dataPoints: data.showsByYear.map((/** @type {any} */ d) => ({ x: d.year, y: d.count })) }],
    };

    const columns = [
        { key: "title", label: "Title", class: "font-medium",
          render: (/** @type {any} */ row) => `<a href="/tv/${row.id}" class="link link-hover link-primary">${row.title}</a>` },
        { key: "release_year", label: "Year", class: "text-center w-20" },
        { key: "collected_children", label: "Episodes", class: "text-center w-24" },
        { key: "collection_pct", label: "Collected", class: "w-36",
          render: (/** @type {any} */ row) => {
            const pct = row.collection_pct || 0;
            const color = pct >= 100 ? "#22d3ee" : pct > 50 ? "#fb923c" : "#ef4444";
            const bgColor = pct >= 100 ? "rgba(0,0,0,0.15)" : "rgba(239, 68, 68, 0.2)";
            return `<div class="flex items-center gap-2"><div class="w-full rounded-full h-2" style="background: ${bgColor}"><div class="h-2 rounded-full" style="width: ${Math.min(100, pct)}%; background: ${color}"></div></div><span class="text-xs w-12 text-right">${pct}%</span></div>`;
        }},
        { key: "completion", label: "Watched", class: "w-36",
          render: (/** @type {any} */ row) => {
            const pct = row.completion || 0;
            const color = pct >= 100 ? "#36d399" : pct > 0 ? "#fbbd23" : "#6b7280";
            return `<div class="flex items-center gap-2"><div class="w-full bg-base-300 rounded-full h-2"><div class="h-2 rounded-full" style="width: ${Math.min(100, pct)}%; background: ${color}"></div></div><span class="text-xs w-12 text-right">${pct}%</span></div>`;
        }},
        { key: "watched_children", label: "W/C", class: "text-center w-20",
          render: (/** @type {any} */ row) => `${row.watched_children || 0}/${row.collected_children || 0}` },
        { key: "last_watched", label: "Last Watched", class: "text-center w-32",
          render: (/** @type {any} */ row) => {
            if (!row.last_watched) return "—";
            const d = new Date(row.last_watched);
            const diff = Math.floor((Date.now() - d.getTime()) / 86400000);
            if (diff === 0) return "Today";
            if (diff === 1) return "Yesterday";
            if (diff < 30) return `${diff}d ago`;
            if (diff < 365) return `${Math.floor(diff / 30)}mo ago`;
            return `${Math.floor(diff / 365)}y ago`;
        }},
    ];

    /** @param {any} row */
    function rowClass(row) {
        if (row.collection_status !== "wanted") return "";
        return ["continuing"].includes(row.arr_status) ? "arr-upcoming" : "arr-missing";
    }

    // ── Transform episode data for PosterRow ──
    // Group unwatched episodes by show for a poster view
    const unwatchedByShow = (() => {
        /** @type {Map<number, {show_id: number, show_title: string, poster_url: string, episodes: any[]}>} */
        const map = new Map();
        for (const ep of data.sections.newUnwatched) {
            if (!map.has(ep.show_id)) {
                map.set(ep.show_id, {
                    show_id: ep.show_id,
                    show_title: ep.show_title,
                    poster_url: ep.poster_url,
                    episodes: [],
                });
            }
            map.get(ep.show_id)?.episodes.push(ep);
        }
        return [...map.values()];
    })();

    const unwatchedPosterItems = unwatchedByShow.map(show => ({
        href: `/tv/${show.show_id}`,
        poster_url: show.poster_url,
        title: show.show_title,
        subtitle: show.episodes.length === 1
            ? epCode(show.episodes[0])
            : `${show.episodes.length} new episodes`,
        icon: '📺',
        badge: show.episodes.some((/** @type {any} */ e) => !e.is_collected) ? '↓' : undefined,
    }));

    const comingUpPosterItems = (() => {
        /** @type {Map<number, {show_id: number, show_title: string, poster_url: string, episodes: any[]}>} */
        const map = new Map();
        for (const ep of data.sections.comingUp) {
            if (!map.has(ep.show_id)) {
                map.set(ep.show_id, {
                    show_id: ep.show_id,
                    show_title: ep.show_title,
                    poster_url: ep.poster_url,
                    episodes: [],
                });
            }
            map.get(ep.show_id)?.episodes.push(ep);
        }
        return [...map.values()].map(show => ({
            href: `/tv/${show.show_id}`,
            poster_url: show.poster_url,
            title: show.show_title,
            subtitle: formatAirDate(show.episodes[0].premiere_date),
            icon: '📺',
            badge: show.episodes.some((/** @type {any} */ e) => e.isSeasonPremiere) ? 'NEW' : undefined,
        }));
    })();
</script>

<svelte:head>
    <title>Mediajam — TV Shows</title>
</svelte:head>

<div class="space-y-8">
    <DeleteToast />

    <!-- Header -->
    <div class="flex items-end justify-between">
        <div>
            <h1 class="text-3xl font-bold">TV Shows</h1>
            <p class="text-base-content/50 text-sm mt-1">
                {data.totalShows} shows · {data.episodeStats.total.toLocaleString()} episodes · {data.runtimeHours.toLocaleString()}h total
            </p>
        </div>
        <button class="btn btn-ghost btn-sm" onclick={() => showLibrary = !showLibrary}>
            {showLibrary ? '← Back to Home' : 'Library & Stats →'}
        </button>
    </div>

    {#if showLibrary}
        <!-- ═══ LIBRARY VIEW ═══ -->
        <div class="grid grid-cols-2 md:grid-cols-5 gap-4">
            <StatCard icon="📺" label="Shows" value={data.totalShows} sub="in your library" color="primary" />
            <StatCard icon="🎬" label="Episodes" value={data.episodeStats.total} sub="{data.runtimeHours.toLocaleString()}h runtime" color="secondary" />
            <StatCard icon="📦" label="Collection" value="{data.collectionStats.overallPct}%" sub="{data.collectionStats.totalCollected.toLocaleString()} of {data.collectionStats.totalReleased.toLocaleString()} eps" color="info" />
            <StatCard icon="✅" label="Watched" value={data.episodeStats.watched} sub="{((data.episodeStats.watched / Math.max(data.episodeStats.total, 1)) * 100).toFixed(1)}% of episodes" color="success" />
            <StatCard icon="⏸️" label="In Progress" value={data.episodeStats.inProgress} sub="{data.completionBuckets.partial} shows started" color="warning" />
        </div>

        <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Chart options={watchPieOptions} height={320} />
            <Chart options={collectionPieOptions} height={320} />
            <Chart options={completionPieOptions} height={320} />
        </div>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Chart options={topShowsBarOptions} height={350} />
            <Chart options={showsByYearOptions} height={350} />
        </div>

        <div class="space-y-2">
            <h2 class="text-xl font-bold">All Shows</h2>
            <DataTable {columns} data={data.shows} searchKey="title" pageSize={25} hideCollectedKey="collection_pct" {rowClass} />
        </div>
    {:else}
        <!-- ═══ SMART HOME VIEW ═══ -->

        <!-- Airing This Week -->
        <section class="smart-section">
            <h2 class="text-lg font-bold">Airing This Week</h2>
            <CalendarStrip days={data.sections.airingThisWeek} />
        </section>

        <!-- New Episodes — Unwatched (Poster Row) -->
        <PosterRow title="New Episodes — Unwatched" items={unwatchedPosterItems} />

        <!-- Behind On -->
        {#if data.sections.behindOn.length > 0}
            <section class="smart-section">
                <h2 class="text-lg font-bold">Behind On</h2>
                <div class="progress-grid">
                    {#each data.sections.behindOn as show}
                        <ProgressCard
                            title={show.title}
                            watched={show.watched}
                            total={show.total}
                            posterUrl={show.poster_url}
                            link="/tv/{show.id}"
                        />
                    {/each}
                </div>
            </section>
        {/if}

        <!-- Coming Up (Poster Row) -->
        <PosterRow title="Coming Up" items={comingUpPosterItems} />
    {/if}
</div>

<style>
    .smart-section {
        display: flex;
        flex-direction: column;
        gap: 10px;
    }

    .progress-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
        gap: 8px;
    }

    :global(.arr-missing) {
        border-left: 3px dashed rgba(239, 68, 68, 0.8);
    }
    :global(.arr-upcoming) {
        border-left: 3px dashed oklch(0.8 0.15 75);
    }
</style>
