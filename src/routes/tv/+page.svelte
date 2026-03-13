<script>
    import StatCard from "$lib/components/StatCard.svelte";
    import DataTable from "$lib/components/DataTable.svelte";
    import Chart from "$lib/components/Chart.svelte";
    import DeleteToast from "$lib/components/DeleteToast.svelte";
    import CalendarStrip from "$lib/components/CalendarStrip.svelte";
    import { imgUrl } from "$lib/utils.js";

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
</script>

<svelte:head>
    <title>Mediajam — TV Shows</title>
</svelte:head>

<div class="page-wrap">
    <DeleteToast />

    <!-- Header -->
    <div class="page-header">
        <div>
            <h1 class="page-title">TV Shows</h1>
            <p class="page-sub">
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

        <!-- ▌AIRING THIS WEEK ─────────────────────────────────────── -->
        <section class="smart-section">
            <h2 class="section-title">Airing This Week</h2>
            <CalendarStrip days={data.sections.airingThisWeek} />
        </section>

        <!-- ▌UNWATCHED IN YOUR LIBRARY (behind on shows with poster cards) ── -->
        {#if data.sections.behindOn.length > 0}
            <section class="smart-section">
                <div class="section-header">
                    <h2 class="section-title">Unwatched in Your Library</h2>
                </div>
                <div class="poster-scroll">
                    {#each data.sections.behindOn as show}
                        <a href="/tv/{show.id}" class="poster-card" title="{show.title} — {show.total - show.watched} unwatched">
                            {#if show.poster_url}
                                <img src={imgUrl(show.poster_url)} alt={show.title} class="poster-img" loading="lazy" />
                            {:else}
                                <div class="poster-img poster-placeholder">📺</div>
                            {/if}
                            <span class="count-badge">{show.total - show.watched}</span>
                            <div class="poster-meta">
                                <span class="poster-name">{show.title}</span>
                            </div>
                            <div class="poster-progress">
                                <div class="poster-progress-fill" style="width: {Math.round((show.watched / Math.max(show.total, 1)) * 100)}%"></div>
                            </div>
                        </a>
                    {/each}
                </div>
            </section>
        {/if}

        <!-- ▌NEW UNWATCHED EPISODES ───────────────────────────────── -->
        {#if data.sections.newUnwatched.length > 0}
            <section class="smart-section">
                <h2 class="section-title">New Episodes — Unwatched</h2>
                <div class="episode-list">
                    {#each data.sections.newUnwatched as ep}
                        <a href="/tv/{ep.show_id}" class="episode-row" title="{ep.show_title} {epCode(ep)} — {ep.episode_title}">
                            {#if ep.poster_url}
                                <img src={imgUrl(ep.poster_url)} alt="" class="ep-poster" loading="lazy" />
                            {:else}
                                <div class="ep-poster ep-placeholder">📺</div>
                            {/if}
                            <div class="ep-details">
                                <span class="ep-show-name">{ep.show_title}</span>
                                <span class="ep-episode">{epCode(ep)} — {ep.episode_title || 'TBA'}</span>
                            </div>
                            <div class="ep-right">
                                <span class="ep-date">{formatAirDate(ep.premiere_date)}</span>
                                {#if ep.status === 'downloaded'}
                                    <span class="status-pill downloaded">✓ Downloaded</span>
                                {:else}
                                    <span class="status-pill available">✓ Available</span>
                                {/if}
                            </div>
                        </a>
                    {/each}
                </div>
            </section>
        {/if}

        <!-- ▌COMING UP ────────────────────────────────────────────── -->
        {#if data.sections.comingUp.length > 0}
            <section class="smart-section">
                <h2 class="section-title">Coming Up</h2>
                <div class="episode-list">
                    {#each data.sections.comingUp as ep}
                        <a href="/tv/{ep.show_id}" class="episode-row" title="{ep.show_title} {epCode(ep)}">
                            {#if ep.poster_url}
                                <img src={imgUrl(ep.poster_url)} alt="" class="ep-poster" loading="lazy" />
                            {:else}
                                <div class="ep-poster ep-placeholder">📺</div>
                            {/if}
                            <div class="ep-details">
                                <span class="ep-show-name">
                                    {ep.show_title}
                                    {#if ep.isSeasonPremiere}
                                        <span class="premiere-badge">NEW SEASON</span>
                                    {/if}
                                </span>
                                <span class="ep-episode">{epCode(ep)} — {ep.episode_title || 'TBA'}</span>
                            </div>
                            <span class="ep-date">{formatAirDate(ep.premiere_date)}</span>
                        </a>
                    {/each}
                </div>
            </section>
        {/if}
    {/if}
</div>

<style>
    /* ── Page Layout ── */
    .page-wrap {
        display: flex;
        flex-direction: column;
        gap: 2rem;
    }
    .page-header {
        display: flex;
        align-items: flex-end;
        justify-content: space-between;
    }
    .page-title {
        font-size: 1.75rem;
        font-weight: 800;
        letter-spacing: -0.02em;
    }
    .page-sub {
        font-size: 0.8rem;
        color: oklch(var(--bc) / 0.45);
        margin-top: 2px;
    }

    /* ── Sections ── */
    .smart-section {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
    }
    .section-header {
        display: flex;
        align-items: baseline;
        gap: 10px;
    }
    .section-title {
        font-size: 1.1rem;
        font-weight: 700;
    }

    /* ── Poster Scroll (Unwatched in Library shows) ── */
    .poster-scroll {
        display: flex;
        gap: 14px;
        overflow-x: auto;
        scrollbar-width: none;
        -ms-overflow-style: none;
        padding-bottom: 4px;
    }
    .poster-scroll::-webkit-scrollbar { display: none; }

    .poster-card {
        flex-shrink: 0;
        width: 130px;
        text-decoration: none;
        color: inherit;
        transition: transform 0.2s ease;
        position: relative;
    }
    .poster-card:hover {
        transform: translateY(-4px) scale(1.03);
    }
    .poster-img {
        width: 100%;
        aspect-ratio: 2/3;
        border-radius: 10px;
        object-fit: cover;
        box-shadow: 0 4px 14px oklch(0 0 0 / 0.35);
    }
    .poster-placeholder {
        display: flex;
        align-items: center;
        justify-content: center;
        background: oklch(var(--b3));
        font-size: 2rem;
    }

    /* Episode count badge (e.g. "32") */
    .count-badge {
        position: absolute;
        bottom: 46px;
        right: 6px;
        background: oklch(var(--p) / 0.9);
        color: oklch(var(--pc));
        font-size: 0.65rem;
        font-weight: 700;
        padding: 2px 7px;
        border-radius: 6px;
        backdrop-filter: blur(4px);
        line-height: 1.4;
    }

    .poster-meta {
        margin-top: 5px;
        display: flex;
        flex-direction: column;
        gap: 1px;
    }
    .poster-name {
        font-size: 0.72rem;
        font-weight: 600;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    /* Mini progress bar under poster */
    .poster-progress {
        height: 3px;
        border-radius: 2px;
        background: oklch(var(--bc) / 0.1);
        margin-top: 3px;
        overflow: hidden;
    }
    .poster-progress-fill {
        height: 100%;
        border-radius: 2px;
        background: oklch(var(--p));
        transition: width 0.3s ease;
    }

    /* ── Episode List (New Unwatched + Coming Up) ── */
    .episode-list {
        display: flex;
        flex-direction: column;
        gap: 2px;
        background: oklch(var(--b2) / 0.35);
        border-radius: 12px;
        overflow: hidden;
        border: 1px solid oklch(var(--bc) / 0.04);
    }

    .episode-row {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 10px 14px;
        text-decoration: none;
        color: inherit;
        transition: background 0.15s;
    }
    .episode-row:hover {
        background: oklch(var(--bc) / 0.05);
    }

    .ep-poster {
        width: 36px;
        height: 52px;
        border-radius: 6px;
        object-fit: cover;
        flex-shrink: 0;
        box-shadow: 0 2px 6px oklch(0 0 0 / 0.2);
    }
    .ep-placeholder {
        display: flex;
        align-items: center;
        justify-content: center;
        background: oklch(var(--b3));
        font-size: 1rem;
    }

    .ep-details {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 2px;
    }
    .ep-show-name {
        font-size: 0.85rem;
        font-weight: 600;
        display: flex;
        align-items: center;
        gap: 8px;
    }
    .ep-episode {
        font-size: 0.72rem;
        color: oklch(var(--bc) / 0.5);
    }

    .ep-right {
        display: flex;
        flex-direction: column;
        align-items: flex-end;
        gap: 4px;
        flex-shrink: 0;
    }
    .ep-date {
        font-size: 0.7rem;
        color: oklch(var(--bc) / 0.4);
        flex-shrink: 0;
    }

    .status-pill {
        font-size: 0.6rem;
        padding: 2px 8px;
        border-radius: 10px;
        font-weight: 600;
        white-space: nowrap;
    }
    .status-pill.downloaded {
        background: oklch(var(--su) / 0.15);
        color: oklch(var(--su));
    }
    .status-pill.available {
        background: oklch(var(--wa) / 0.15);
        color: oklch(var(--wa));
    }

    .premiere-badge {
        font-size: 0.55rem;
        padding: 1px 6px;
        border-radius: 6px;
        background: oklch(var(--p) / 0.2);
        color: oklch(var(--p));
        font-weight: 700;
        letter-spacing: 0.05em;
    }

    :global(.arr-missing) {
        border-left: 3px dashed rgba(239, 68, 68, 0.8);
    }
    :global(.arr-upcoming) {
        border-left: 3px dashed oklch(0.8 0.15 75);
    }
</style>
