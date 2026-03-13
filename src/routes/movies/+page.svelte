<script>
    import StatCard from "$lib/components/StatCard.svelte";
    import DataTable from "$lib/components/DataTable.svelte";
    import Chart from "$lib/components/Chart.svelte";
    import DeleteToast from "$lib/components/DeleteToast.svelte";
    import PosterRow from "$lib/components/PosterRow.svelte";

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

    const watchPieOptions = {
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
    };

    const decadeBarOptions = {
        title: { text: "Movies by Decade" },
        axisX: { labelFontSize: 11 },
        axisY: { title: "Count", titleFontColor: "#a6adba" },
        data: [{
            type: "column", color: "#f472b6", cornerRadius: 4,
            dataPoints: data.moviesByDecade.map((d) => ({ label: `${d.decade}s`, y: d.count })),
        }],
    };

    const yearBarOptions = {
        title: { text: "Movies by Year" },
        axisX: { title: "Year", titleFontColor: "#a6adba", labelFontSize: 11, interval: 2, valueFormatString: "####" },
        axisY: { title: "Count", titleFontColor: "#a6adba" },
        data: [{
            type: "column", color: "#f472b6", cornerRadius: 4,
            dataPoints: data.moviesByYear.map((d) => ({ x: d.year, y: d.count })),
        }],
    };

    const rewatchedBarOptions = data.mostRewatched.length > 0
        ? {
            title: { text: "Most Rewatched" },
            axisX: { labelAngle: -45, labelFontSize: 11 },
            axisY: { title: "Play Count", titleFontColor: "#a6adba" },
            data: [{
                type: "bar", color: "#a78bfa", cornerRadius: 4,
                dataPoints: data.mostRewatched.map((m) => ({
                    label: m.title.length > 25 ? m.title.substring(0, 23) + "…" : m.title,
                    y: m.play_count,
                })),
            }],
        } : null;

    /** @param {string} status */
    function watchBadge(status) {
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

    // ── Transform data for PosterRow ──

    /** @param {any} item @param {string} [sub] */
    function moviePoster(item, sub) {
        return {
            href: `/movies/${item.id}`,
            poster_url: item.poster_url,
            title: item.title,
            subtitle: sub || (item.release_year ? String(item.release_year) : ''),
            icon: '🎬',
        };
    }

    const heroItems = data.sections.hero
        ? data.sections.hero.items.map(
            (/** @type {any} */ i) => moviePoster(i, data.sections.hero.reason)
          )
        : [];

    const recentItems = data.sections.recentlyWatched.map(
        (/** @type {any} */ i) => ({
            ...moviePoster(i),
            subtitle: timeAgo(i.last_watched),
        })
    );

    const unwatchedItems = data.sections.unwatched.map(
        (/** @type {any} */ i) => moviePoster(i)
    );
</script>

<svelte:head>
    <title>Mediajam — Movies</title>
</svelte:head>

<div class="space-y-8">
    <DeleteToast />

    <!-- Header -->
    <div class="flex items-end justify-between">
        <div>
            <h1 class="text-3xl font-bold">Movies</h1>
            <p class="text-base-content/50 text-sm mt-1">
                {data.totalMovies.toLocaleString()} films · {data.movieStats.watched.toLocaleString()} watched · {data.runtimeHours.toLocaleString()}h total runtime
            </p>
        </div>
        <button class="btn btn-ghost btn-sm" onclick={() => showLibrary = !showLibrary}>
            {showLibrary ? '← Back to Home' : 'Library & Stats →'}
        </button>
    </div>

    {#if showLibrary}
        <!-- ═══ LIBRARY VIEW (stats, charts, table) ═══ -->
        <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard icon="🎬" label="Movies" value={data.totalMovies} sub="in your library" color="primary" />
            <StatCard icon="✅" label="Watched" value={data.movieStats.watched} sub="{watchPct}% of collection" color="success" />
            <StatCard icon="👀" label="Unwatched" value={data.movieStats.unwatched} sub="still to watch" color="warning" />
            <StatCard icon="⏱️" label="Runtime" value="{data.runtimeHours.toLocaleString()}h" sub="total watch time" color="secondary" />
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Chart options={watchPieOptions} height={320} />
            <Chart options={decadeBarOptions} height={320} />
        </div>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Chart options={yearBarOptions} height={320} />
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
            <DataTable {columns} data={data.movies} searchKey="title" pageSize={25} hideCollectedKey="collection_pct" {rowClass} />
        </div>
    {:else}
        <!-- ═══ SMART HOME VIEW ═══ -->

        <!-- Hero: Pattern Detection -->
        {#if data.sections.hero && heroItems.length > 0}
            <section class="hero-banner">
                <div class="hero-inner">
                    <h2 class="text-xl font-bold">{data.sections.hero.title}</h2>
                    <p class="text-base-content/50 text-sm">{data.sections.hero.subtitle}</p>
                </div>
                <PosterRow title="" items={heroItems} />
            </section>
        {/if}

        <!-- Because You Love [person] -->
        {#each data.sections.becauseYouLove as section}
            <PosterRow
                title="Because You Love {section.person}"
                items={section.items.map((/** @type {any} */ i) => moviePoster(i, section.reason))}
            />
        {/each}

        <!-- Recently Watched -->
        <PosterRow title="Recently Watched" items={recentItems} />

        <!-- Unwatched in Library -->
        <PosterRow title="Unwatched in Your Library" items={unwatchedItems} />

        <!-- Quick Stats -->
        <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard icon="🎬" label="Movies" value={data.totalMovies} sub="in your library" color="primary" />
            <StatCard icon="✅" label="Watched" value={data.movieStats.watched} sub="{watchPct}%" color="success" />
            <StatCard icon="👀" label="Unwatched" value={data.movieStats.unwatched} sub="still to watch" color="warning" />
            <StatCard icon="⏱️" label="Runtime" value="{data.runtimeHours.toLocaleString()}h" sub="total watch time" color="secondary" />
        </div>
    {/if}
</div>

<style>
    .hero-banner {
        background: linear-gradient(135deg, oklch(var(--b2)) 0%, oklch(var(--b3)) 100%);
        border: 1px solid oklch(var(--bc) / 0.06);
        border-radius: 1rem;
        padding: 1.25rem 1.5rem 0.5rem;
    }
    .hero-inner {
        margin-bottom: 0.5rem;
    }

    :global(.arr-missing) {
        border-left: 3px dashed rgba(239, 68, 68, 0.8);
    }
    :global(.arr-upcoming) {
        border-left: 3px dashed oklch(0.8 0.15 75);
    }
</style>
