<script>
    import { onMount } from 'svelte';
    import StatCard from "$lib/components/StatCard.svelte";
    import DataTable from "$lib/components/DataTable.svelte";
    import Chart from "$lib/components/Chart.svelte";
    import DeleteToast from "$lib/components/DeleteToast.svelte";
    import Skeleton from "$lib/components/Skeleton.svelte";
    import { imgUrl } from "$lib/utils.js";

    let { data } = $props();

    const total =
        data.movieStats.watched +
        data.movieStats.unwatched +
        data.movieStats.inProgress;
    const watchPct = (
        (data.movieStats.watched / Math.max(total, 1)) *
        100
    ).toFixed(1);

    let showLibrary = $state(false);

    // Deferred data loaded client-side
    let loaded = $state(false);
    let movies = $state([]);
    let moviesByDecade = $state([]);
    let moviesByYear = $state([]);
    let mostRewatched = $state([]);
    let sections = $state({ hero: null, recommended: [], personRecs: [], recentlyWatched: [], unwatched: [] });

    onMount(async () => {
        try {
            const res = await fetch('/api/pages/movies');
            const d = await res.json();
            movies = d.movies;
            moviesByDecade = d.moviesByDecade;
            moviesByYear = d.moviesByYear;
            mostRewatched = d.mostRewatched;
            sections = d.sections;
        } catch (e) {
            console.error('[movies] Failed to load sections:', e);
        }
        loaded = true;
    });

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

    // Chart options are reactive since data loads async
    let watchPieOptions = $derived({
        title: { text: "Watch Status" },
        data: [{
            type: "doughnut", startAngle: 240,
            indexLabelFontColor: "#a6adba", indexLabelFontSize: 12,
            indexLabelFontFamily: "Inter, sans-serif",
            toolTipContent: "{label}: {y} movies",
            dataPoints: [
                { label: "Watched", y: data.movieStats.watched, color: "#36d399" },
                { label: "Unwatched", y: data.movieStats.unwatched, color: "#6b7280" },
                { label: "In Progress", y: data.movieStats.inProgress, color: "#fbbd23" },
            ],
        }],
    });

    let decadeBarOptions = $derived({
        title: { text: "Movies by Decade" },
        axisX: { labelFontSize: 11 },
        axisY: { title: "Count", titleFontColor: "#a6adba" },
        data: [{
            type: "column", color: "#f472b6", cornerRadius: 4,
            dataPoints: moviesByDecade.map((/** @type {any} */ d) => ({ label: `${d.decade}s`, y: d.count })),
        }],
    });

    let yearBarOptions = $derived({
        title: { text: "Movies by Year" },
        axisX: { title: "Year", titleFontColor: "#a6adba", labelFontSize: 11, interval: 2, valueFormatString: "####" },
        axisY: { title: "Count", titleFontColor: "#a6adba" },
        data: [{
            type: "column", color: "#f472b6", cornerRadius: 4,
            dataPoints: moviesByYear.map((/** @type {any} */ d) => ({ x: d.year, y: d.count })),
        }],
    });

    let rewatchedBarOptions = $derived(mostRewatched.length > 0
        ? {
            title: { text: "Most Rewatched" },
            axisX: { labelAngle: -45, labelFontSize: 11 },
            axisY: { title: "Play Count", titleFontColor: "#a6adba" },
            data: [{
                type: "bar", color: "#a78bfa", cornerRadius: 4,
                dataPoints: mostRewatched.map((/** @type {any} */ m) => ({
                    label: m.title.length > 25 ? m.title.substring(0, 23) + "…" : m.title,
                    y: m.play_count,
                })),
            }],
        } : null);

    /** @param {string} status */
    function watchBadge(status) {
        /** @type {Record<string, string>} */
        const map = {
            watched: '<span class="badge badge-success badge-sm">Watched</span>',
            in_progress: '<span class="badge badge-warning badge-sm">In Progress</span>',
            unwatched: '<span class="badge badge-ghost badge-sm">Unwatched</span>',
            wanted: '<span class="badge badge-error badge-sm">Missing</span>',
        };
        return map[status] || map.unwatched;
    }

    /** @param {any} row */
    function rowClass(row) {
        if (row.collection_status !== "wanted") return "";
        const upcoming = ["announced", "inCinemas"].includes(row.arr_status);
        return upcoming ? "arr-upcoming" : "arr-missing";
    }

    const columns = [
        { key: "title", label: "Title", class: "font-medium",
          render: (/** @type {any} */ row) => `<a href="/movies/${row.id}" class="link link-hover link-primary">${row.title}</a>` },
        { key: "release_year", label: "Year", class: "text-center w-20" },
        { key: "watch_status", label: "Status", class: "text-center w-28",
          render: (/** @type {any} */ row) => {
            if (row.collection_status === "wanted") {
                return ["announced", "inCinemas"].includes(row.arr_status)
                    ? '<span class="badge badge-warning badge-sm">Upcoming</span>'
                    : '<span class="badge badge-error badge-sm">Missing</span>';
            }
            return watchBadge(row.watch_status);
        }},
        { key: "runtime_minutes", label: "Runtime", class: "text-center w-24",
          render: (/** @type {any} */ row) => {
            const mins = row.runtime_minutes || 0;
            if (mins === 0) return "—";
            const h = Math.floor(mins / 60);
            const m = Math.round(mins % 60);
            return h > 0 ? `${h}h ${m}m` : `${m}m`;
        }},
        { key: "play_count", label: "Plays", class: "text-center w-20" },
        { key: "last_watched", label: "Last Watched", class: "text-center w-32",
          render: (/** @type {any} */ row) => {
            if (!row.last_watched) return "—";
            const d = new Date(row.last_watched);
            const now = new Date();
            const diff = Math.floor((now.getTime() - d.getTime()) / 86400000);
            if (diff === 0) return "Today";
            if (diff === 1) return "Yesterday";
            if (diff < 30) return `${diff}d ago`;
            if (diff < 365) return `${Math.floor(diff / 30)}mo ago`;
            return `${Math.floor(diff / 365)}y ago`;
        }},
    ];
</script>

<svelte:head>
    <title>Mediajam — Movies</title>
</svelte:head>

<div class="page-wrap max-w-6xl mx-auto">
    <DeleteToast />

    <!-- Header -->
    <div class="page-header">
        <div>
            <h1 class="page-title">Movies</h1>
            <p class="page-sub">
                {data.totalMovies.toLocaleString()} films · {data.movieStats.watched.toLocaleString()} watched · {data.runtimeHours.toLocaleString()}h total runtime
            </p>
        </div>
        <button class="btn btn-ghost btn-sm" onclick={() => showLibrary = !showLibrary}>
            {showLibrary ? '← Back to Home' : 'Library & Stats →'}
        </button>
    </div>

    {#if showLibrary}
        <!-- ═══ LIBRARY VIEW ═══ -->
        {#if !loaded}
            <Skeleton type="stat-cards" />
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Skeleton type="chart" />
                <Skeleton type="chart" />
            </div>
            <Skeleton type="table" />
        {:else}
        <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard icon="🎬" label="Movies" value={data.totalMovies} sub="in your library" color="primary" />
            <StatCard icon="✅" label="Watched" value={data.movieStats.watched} sub="{watchPct}% of collection" color="success" />
            <StatCard icon="👀" label="Unwatched" value={data.movieStats.unwatched} sub="still to watch" color="warning" />
            <StatCard icon="⏱️" label="Runtime" value="{data.runtimeHours.toLocaleString()}h" sub="total watch time" color="secondary" />
        </div>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Chart options={watchPieOptions} height={320} />
            {#if moviesByDecade.length > 0}
                <Chart options={decadeBarOptions} height={320} />
            {:else}
                <Skeleton type="chart" />
            {/if}
        </div>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            {#if moviesByYear.length > 0}
                <Chart options={yearBarOptions} height={320} />
            {:else}
                <Skeleton type="chart" />
            {/if}
            {#if rewatchedBarOptions}
                <Chart options={rewatchedBarOptions} height={320} />
            {:else}
                <div class="rounded-2xl bg-base-300/20 border border-base-content/5 p-4 flex items-center justify-center h-[320px]">
                    <p class="text-base-content/40 text-sm">No rewatched movies yet</p>
                </div>
            {/if}
        </div>
        <div class="space-y-2">
            <h2 class="text-xl font-bold">All Movies</h2>
            <DataTable {columns} data={movies} searchKey="title" pageSize={25} hideCollectedKey="collection_pct" {rowClass} />
        </div>
        {/if}
    {:else}
        <!-- ═══ SMART HOME VIEW ═══ -->

        {#if !loaded}
            <!-- Skeleton placeholders while sections load -->
            <Skeleton type="poster-row" />
            <Skeleton type="poster-row" />
            <Skeleton type="poster-row" />
        {:else}

        <!-- ▌HERO: Pattern Detection ──────────────────────────────── -->
        {#if sections.hero && sections.hero.items.length > 0}
            <section class="hero-banner">
                <!-- Background faded poster -->
                {#if sections.hero.items[0]?.poster_url}
                    <div class="hero-bg" style="background-image: url('{imgUrl(sections.hero.items[0].poster_url)}')"></div>
                {/if}
                <div class="hero-overlay"></div>
                <div class="hero-body">
                    <h2 class="hero-title">{sections.hero.title}</h2>
                    <p class="hero-subtitle">{sections.hero.subtitle}</p>
                    <div class="hero-posters">
                        {#each sections.hero.items.slice(0, 6) as item}
                            <a href="/movies/{item.id}" class="poster-card" title={item.title}>
                                {#if item.poster_url}
                                    <img src={imgUrl(item.poster_url)} alt={item.title} class="poster-img" loading="lazy" />
                                {:else}
                                    <div class="poster-img poster-placeholder">🎬</div>
                                {/if}
                                <div class="poster-meta">
                                    <span class="poster-name">{item.title}</span>
                                    <span class="poster-year">{item.release_year || ''}</span>
                                </div>
                            </a>
                        {/each}
                    </div>
                </div>
            </section>
        {/if}

        <!-- ▌RECOMMENDED FOR YOU ──────────────────────────────────── -->
        {#if sections.recommended.length > 0}
            <section class="smart-section">
                <div class="section-header">
                    <h2 class="section-title">🎯 Recommended For You</h2>
                    <span class="section-count">based on what you watch</span>
                </div>
                <div class="poster-scroll">
                    {#each sections.recommended as item}
                        <a href="/movies/{item.id}" class="poster-card" title={item.title}>
                            <span class="uwb">unwatched</span>
                            {#if item.poster_url}
                                <img src={imgUrl(item.poster_url)} alt={item.title} class="poster-img" loading="lazy" />
                            {:else}
                                <div class="poster-img poster-placeholder">🎬</div>
                            {/if}
                            <div class="poster-meta">
                                <span class="poster-name">{item.title}</span>
                                {#if item.reason}
                                    <span class="poster-reason">{item.reason}</span>
                                {/if}
                            </div>
                        </a>
                    {/each}
                </div>
            </section>
        {/if}

        <!-- ▌PERSON RECOMMENDATIONS ────────────────────────────── -->
        {#each sections.personRecs as section}
            <section class="smart-section">
                <div class="section-header">
                    <h2 class="section-title">{section.sectionTitle || `More from ${section.person}`}</h2>
                    <span class="section-count">{section.totalInLibrary} films in library · {section.items.length} unwatched</span>
                </div>
                <div class="poster-scroll">
                    {#each section.items as item}
                        <a href="/movies/{item.id}" class="poster-card" title={item.title}>
                            <span class="uwb">unwatched</span>
                            {#if item.poster_url}
                                <img src={imgUrl(item.poster_url)} alt={item.title} class="poster-img" loading="lazy" />
                            {:else}
                                <div class="poster-img poster-placeholder">🎬</div>
                            {/if}
                            <div class="poster-meta">
                                <span class="poster-name">{item.title}</span>
                                <span class="poster-reason">{item.reason}</span>
                            </div>
                        </a>
                    {/each}
                </div>
            </section>
        {/each}

        <!-- ▌RECENTLY WATCHED ─────────────────────────────────────── -->
        {#if sections.recentlyWatched.length > 0}
            <section class="smart-section recently-watched-section">
                <div class="section-header">
                    <h2 class="section-title">Recently Watched</h2>
                </div>
                <div class="poster-scroll">
                    {#each sections.recentlyWatched as item}
                        <a href="/movies/{item.id}" class="poster-card" title={item.title}>
                            <span class="wb">watched</span>
                            {#if item.poster_url}
                                <img src={imgUrl(item.poster_url)} alt={item.title} class="poster-img" loading="lazy" />
                            {:else}
                                <div class="poster-img poster-placeholder">🎬</div>
                            {/if}
                            <div class="poster-meta">
                                <span class="poster-name">{item.title}</span>
                                <span class="poster-year">{timeAgo(item.last_watched)}</span>
                            </div>
                        </a>
                    {/each}
                </div>
            </section>
        {/if}

        <!-- ▌UNWATCHED IN LIBRARY ─────────────────────────────────── -->
        {#if sections.unwatched.length > 0}
            <section class="smart-section">
                <div class="section-header">
                    <h2 class="section-title">Unwatched in Your Library</h2>
                    <span class="section-count">{data.movieStats.unwatched} total</span>
                </div>
                <div class="poster-scroll">
                    {#each sections.unwatched as item}
                        <a href="/movies/{item.id}" class="poster-card" title={item.title}>
                            {#if item.poster_url}
                                <img src={imgUrl(item.poster_url)} alt={item.title} class="poster-img" loading="lazy" />
                            {:else}
                                <div class="poster-img poster-placeholder">🎬</div>
                            {/if}
                            <div class="poster-meta">
                                <span class="poster-name">{item.title}</span>
                                <span class="poster-year">{item.release_year || ''}</span>
                            </div>
                        </a>
                    {/each}
                </div>
            </section>
        {/if}
        {/if} <!-- end loaded -->
    {/if}
</div>

<style>
    /* ── Page Layout ── */
    .page-wrap {
        display: flex;
        flex-direction: column;
        gap: 2rem;
        padding: 0 1.5rem;
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

    /* ── Hero Banner ── */
    .hero-banner {
        position: relative;
        border-radius: 1rem;
        overflow: hidden;
        min-height: 280px;
        display: flex;
        flex-direction: column;
        justify-content: flex-end;
    }
    .hero-bg {
        position: absolute;
        inset: 0;
        background-size: cover;
        background-position: center top;
        filter: blur(16px) brightness(0.45) saturate(1.1);
        transform: scale(1.15);
    }
    .hero-overlay {
        position: absolute;
        inset: 0;
        background: linear-gradient(
            180deg,
            oklch(var(--b1) / 0.2) 0%,
            oklch(var(--b1) / 0.65) 40%,
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
        font-size: 1.75rem;
        font-weight: 800;
        letter-spacing: -0.02em;
        margin-bottom: 0.25rem;
    }
    .hero-subtitle {
        font-size: 0.85rem;
        color: oklch(var(--bc) / 0.5);
        margin-bottom: 1.25rem;
    }
    .hero-posters {
        display: flex;
        gap: 14px;
        justify-content: center;
        flex-wrap: wrap;
    }

    /* ── Smart Sections ── */
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
    .section-count {
        font-size: 0.7rem;
        color: oklch(var(--bc) / 0.35);
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
        transition: transform 0.2s ease, box-shadow 0.2s ease;
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

    /* Poster meta text */
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
    .poster-reason {
        font-size: 0.58rem;
        color: oklch(var(--p) / 0.8);
        font-weight: 500;
    }

    /* Unwatched badge */
    .uwb {
        position: absolute;
        top: 6px;
        right: 6px;
        z-index: 2;
        font-size: 0.5rem;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        padding: 2px 7px;
        border-radius: 6px;
        background: oklch(var(--er) / 0.85);
        color: oklch(var(--erc));
        backdrop-filter: blur(4px);
        text-shadow: 0 1px 2px rgba(0,0,0,0.6);
        border: 1px solid rgba(0,0,0,0.15);
    }

    /* Watched badge */
    .wb {
        position: absolute;
        top: 6px;
        right: 6px;
        z-index: 2;
        font-size: 0.5rem;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        padding: 2px 7px;
        border-radius: 6px;
        background: oklch(0.65 0.2 145 / 0.85);
        color: #fff;
        backdrop-filter: blur(4px);
        text-shadow: 0 1px 2px rgba(0,0,0,0.6);
        border: 1px solid rgba(0,0,0,0.15);
    }

    /* Recently watched section has darker bg */
    .recently-watched-section {
        background: oklch(var(--b2) / 0.4);
        margin: 0 -1.5rem;
        padding: 1.25rem 1.5rem;
        border-radius: 1rem;
    }

    :global(.arr-missing) {
        border-left: 3px dashed rgba(239, 68, 68, 0.8);
    }
    :global(.arr-upcoming) {
        border-left: 3px dashed oklch(0.8 0.15 75);
    }
</style>
