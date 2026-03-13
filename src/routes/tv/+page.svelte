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

    /** @param {string} ts */
    function timeAgo(ts) {
        if (!ts) return '';
        const d = new Date(ts);
        const diff = Math.floor((Date.now() - d.getTime()) / 86400000);
        if (diff === 0) return 'Today';
        if (diff === 1) return 'Yesterday';
        if (diff < 7) return `${diff}d ago`;
        if (diff < 30) return `${Math.floor(diff / 7)}w ago`;
        if (diff < 365) return `${Math.floor(diff / 30)}mo ago`;
        return `${Math.floor(diff / 365)}y ago`;
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

        <!-- ▌CONTINUE WATCHING (hero banner with progress rings) ─────── -->
        {#if data.sections.behindOn.length > 0}
            <section class="hero-banner">
                <!-- Blurred backdrop from first show -->
                {#if data.sections.behindOn[0]?.poster_url}
                    <div class="hero-bg" style="background-image: url('{imgUrl(data.sections.behindOn[0].poster_url)}')"></div>
                {/if}
                <div class="hero-overlay"></div>
                <div class="hero-body">
                    <h2 class="hero-title">Continue Watching</h2>
                    <p class="hero-subtitle">{data.sections.behindOn.length} shows in progress</p>
                    <div class="hero-posters">
                        {#each data.sections.behindOn as show}
                            <a href="/tv/{show.id}" class="progress-card" title="{show.title} — {show.total - show.watched} unwatched">
                                {#if show.poster_url}
                                    <img src={imgUrl(show.poster_url)} alt={show.title} class="progress-poster" loading="lazy" />
                                {:else}
                                    <div class="progress-poster poster-placeholder">📺</div>
                                {/if}
                                <!-- Thin progress bar at bottom of poster -->
                                <div class="progress-bar-track">
                                    <div class="progress-bar-fill" style="width: {Math.round((show.watched / Math.max(show.total, 1)) * 100)}%"></div>
                                </div>
                                <div class="progress-meta">
                                    <span class="progress-name">{show.title}</span>
                                    <span class="progress-count">{show.watched}/{show.total}</span>
                                </div>
                            </a>
                        {/each}
                    </div>
                </div>
            </section>
        {/if}

        <!-- ▌RECENTLY WATCHED ──────────────────────────────────────── -->
        {#if data.sections.recentlyWatched.length > 0}
            <section class="smart-section recently-watched-section">
                <div class="section-header">
                    <h2 class="section-title">Recently Watched</h2>
                </div>
                <div class="poster-scroll">
                    {#each data.sections.recentlyWatched as show}
                        <a href="/tv/{show.id}" class="poster-card" title={show.title}>
                            {#if show.poster_url}
                                <img src={imgUrl(show.poster_url)} alt={show.title} class="poster-img" loading="lazy" />
                            {:else}
                                <div class="poster-img poster-placeholder">📺</div>
                            {/if}
                            <div class="poster-meta">
                                <span class="poster-name">{show.title}</span>
                                <span class="poster-year">{timeAgo(show.last_watched)}</span>
                            </div>
                        </a>
                    {/each}
                </div>
            </section>
        {/if}

        <!-- ▌AIRING THIS WEEK ─────────────────────────────────────── -->
        <section class="smart-section">
            <h2 class="section-title">Airing This Week</h2>
            <CalendarStrip days={data.sections.airingThisWeek} />
        </section>

        <!-- ▌NEW EPISODES (poster scroll with NEW badges) ──────────── -->
        {#if data.sections.newUnwatched.length > 0}
            <section class="smart-section">
                <h2 class="section-title">New Episodes</h2>
                <div class="poster-scroll">
                    {#each data.sections.newUnwatched as ep}
                        <a href="/tv/{ep.show_id}" class="poster-card" title="{ep.show_title} {epCode(ep)} — {ep.episode_title}">
                            <span class="new-badge">NEW</span>
                            {#if ep.poster_url}
                                <img src={imgUrl(ep.poster_url)} alt={ep.show_title} class="poster-img" loading="lazy" />
                            {:else}
                                <div class="poster-img poster-placeholder">📺</div>
                            {/if}
                            <div class="poster-meta">
                                <span class="poster-name">{ep.show_title}</span>
                                <span class="poster-ep">{epCode(ep)} — {ep.episode_title || 'TBA'}</span>
                            </div>
                            {#if ep.status === 'downloaded'}
                                <span class="dl-pill downloaded">✓ Downloaded</span>
                            {:else}
                                <span class="dl-pill available">✓ Available</span>
                            {/if}
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

    /* ── Hero Banner (Continue Watching) ── */
    .hero-banner {
        position: relative;
        border-radius: 1rem;
        overflow: hidden;
        min-height: 260px;
        display: flex;
        flex-direction: column;
        justify-content: flex-end;
    }
    .hero-bg {
        position: absolute;
        inset: 0;
        background-size: cover;
        background-position: center top;
        filter: blur(20px) brightness(0.4) saturate(1.2);
        transform: scale(1.2);
    }
    .hero-overlay {
        position: absolute;
        inset: 0;
        background: linear-gradient(
            180deg,
            oklch(var(--b1) / 0.15) 0%,
            oklch(var(--b1) / 0.6) 35%,
            oklch(var(--b1) / 0.92) 100%
        );
    }
    .hero-body {
        position: relative;
        z-index: 1;
        padding: 2rem 1.75rem 1.5rem;
        text-align: center;
    }
    .hero-title {
        font-size: 1.5rem;
        font-weight: 800;
        letter-spacing: -0.02em;
        margin-bottom: 0.2rem;
    }
    .hero-subtitle {
        font-size: 0.8rem;
        color: oklch(var(--bc) / 0.5);
        margin-bottom: 1.25rem;
    }
    .hero-posters {
        display: flex;
        gap: 16px;
        justify-content: center;
        overflow-x: auto;
        scrollbar-width: none;
        padding-bottom: 4px;
    }
    .hero-posters::-webkit-scrollbar { display: none; }

    /* ── Progress Card (within hero) ── */
    .progress-card {
        flex-shrink: 0;
        width: 110px;
        text-decoration: none;
        color: inherit;
        transition: transform 0.2s ease;
        position: relative;
        display: flex;
        flex-direction: column;
        align-items: center;
    }
    .progress-card:hover {
        transform: translateY(-4px) scale(1.04);
    }
    .progress-poster {
        width: 100%;
        aspect-ratio: 2/3;
        border-radius: 10px;
        object-fit: cover;
        box-shadow: 0 4px 16px oklch(0 0 0 / 0.4);
    }

    /* Thin progress bar overlaid at bottom of poster */
    .progress-bar-track {
        position: absolute;
        bottom: 28px;
        left: 4px;
        right: 4px;
        height: 3px;
        border-radius: 2px;
        background: oklch(var(--bc) / 0.15);
        overflow: hidden;
    }
    .progress-bar-fill {
        height: 100%;
        border-radius: 2px;
        background: oklch(var(--su));
        transition: width 0.4s ease;
    }

    .progress-meta {
        margin-top: 5px;
        text-align: center;
        width: 100%;
    }
    .progress-name {
        font-size: 0.68rem;
        font-weight: 600;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        display: block;
    }
    .progress-count {
        font-size: 0.55rem;
        color: oklch(var(--bc) / 0.4);
        display: block;
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

    /* Recently watched section (darker bg) */
    .recently-watched-section {
        background: oklch(var(--b2) / 0.4);
        margin: 0 -1.5rem;
        padding: 1.25rem 1.5rem;
        border-radius: 1rem;
    }

    /* ── Poster Scroll & Cards ── */
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

    .poster-meta {
        margin-top: 6px;
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
        line-height: 1.3;
    }
    .poster-year {
        font-size: 0.62rem;
        color: oklch(var(--bc) / 0.4);
    }
    .poster-ep {
        font-size: 0.58rem;
        color: oklch(var(--bc) / 0.45);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    /* NEW badge */
    .new-badge {
        position: absolute;
        top: 6px;
        right: 6px;
        z-index: 2;
        font-size: 0.5rem;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        padding: 2px 7px;
        border-radius: 6px;
        background: oklch(var(--p) / 0.88);
        color: oklch(var(--pc));
        backdrop-filter: blur(4px);
    }

    /* Download status pill */
    .dl-pill {
        display: block;
        margin-top: 4px;
        font-size: 0.52rem;
        padding: 2px 8px;
        border-radius: 8px;
        font-weight: 600;
        white-space: nowrap;
        text-align: center;
    }
    .dl-pill.downloaded {
        background: oklch(var(--su) / 0.12);
        color: oklch(var(--su));
    }
    .dl-pill.available {
        background: oklch(var(--wa) / 0.12);
        color: oklch(var(--wa));
    }

    /* ── Episode List (Coming Up) ── */
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

    .ep-date {
        font-size: 0.7rem;
        color: oklch(var(--bc) / 0.4);
        flex-shrink: 0;
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
