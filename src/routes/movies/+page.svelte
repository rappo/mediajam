<script>
    import StatCard from "$lib/components/StatCard.svelte";
    import DataTable from "$lib/components/DataTable.svelte";
    import Chart from "$lib/components/Chart.svelte";

    let { data } = $props();

    const total =
        data.movieStats.watched +
        data.movieStats.unwatched +
        data.movieStats.inProgress;
    const watchPct = (
        (data.movieStats.watched / Math.max(total, 1)) *
        100
    ).toFixed(1);

    const watchPieOptions = {
        title: { text: "Watch Status" },
        data: [
            {
                type: "doughnut",
                startAngle: 240,
                indexLabelFontColor: "#a6adba",
                indexLabelFontSize: 12,
                indexLabelFontFamily: "Inter, sans-serif",
                toolTipContent: "{label}: {y} movies",
                dataPoints: [
                    {
                        label: "Watched",
                        y: data.movieStats.watched,
                        color: "#36d399",
                    },
                    {
                        label: "Unwatched",
                        y: data.movieStats.unwatched,
                        color: "#6b7280",
                    },
                    {
                        label: "In Progress",
                        y: data.movieStats.inProgress,
                        color: "#fbbd23",
                    },
                ],
            },
        ],
    };

    const decadeBarOptions = {
        title: { text: "Movies by Decade" },
        axisX: { labelFontSize: 11 },
        axisY: { title: "Count", titleFontColor: "#a6adba" },
        data: [
            {
                type: "column",
                color: "#f472b6",
                cornerRadius: 4,
                dataPoints: data.moviesByDecade.map((d) => ({
                    label: `${d.decade}s`,
                    y: d.count,
                })),
            },
        ],
    };

    const yearBarOptions = {
        title: { text: "Movies by Year" },
        axisX: {
            title: "Year",
            titleFontColor: "#a6adba",
            labelFontSize: 11,
            interval: 2,
            valueFormatString: "####",
        },
        axisY: { title: "Count", titleFontColor: "#a6adba" },
        data: [
            {
                type: "column",
                color: "#f472b6",
                cornerRadius: 4,
                dataPoints: data.moviesByYear.map((d) => ({
                    x: d.year,
                    y: d.count,
                })),
            },
        ],
    };

    const rewatchedBarOptions =
        data.mostRewatched.length > 0
            ? {
                  title: { text: "Most Rewatched" },
                  axisX: { labelAngle: -45, labelFontSize: 11 },
                  axisY: { title: "Play Count", titleFontColor: "#a6adba" },
                  data: [
                      {
                          type: "bar",
                          color: "#a78bfa",
                          cornerRadius: 4,
                          dataPoints: data.mostRewatched.map((m) => ({
                              label:
                                  m.title.length > 25
                                      ? m.title.substring(0, 23) + "…"
                                      : m.title,
                              y: m.play_count,
                          })),
                      },
                  ],
              }
            : null;

    function watchBadge(status) {
        const map = {
            watched:
                '<span class="badge badge-success badge-sm">Watched</span>',
            in_progress:
                '<span class="badge badge-warning badge-sm">In Progress</span>',
            unwatched:
                '<span class="badge badge-ghost badge-sm">Unwatched</span>',
        };
        return map[status] || map.unwatched;
    }

    const columns = [
        {
            key: "title",
            label: "Title",
            class: "font-medium",
            render: (row) =>
                `<a href="/movies/${row.id}" class="link link-hover link-primary">${row.title}</a>`,
        },
        { key: "release_year", label: "Year", class: "text-center w-20" },
        {
            key: "watch_status",
            label: "Status",
            class: "text-center w-28",
            render: (row) => watchBadge(row.watch_status),
        },
        {
            key: "runtime_minutes",
            label: "Runtime",
            class: "text-center w-24",
            render: (row) => {
                const mins = row.runtime_minutes || 0;
                if (mins === 0) return "—";
                const h = Math.floor(mins / 60);
                const m = Math.round(mins % 60);
                return h > 0 ? `${h}h ${m}m` : `${m}m`;
            },
        },
        { key: "play_count", label: "Plays", class: "text-center w-20" },
        {
            key: "last_watched",
            label: "Last Watched",
            class: "text-center w-32",
            render: (row) => {
                if (!row.last_watched) return "—";
                const d = new Date(row.last_watched);
                const now = new Date();
                const diff = Math.floor((now - d) / 86400000);
                if (diff === 0) return "Today";
                if (diff === 1) return "Yesterday";
                if (diff < 30) return `${diff}d ago`;
                if (diff < 365) return `${Math.floor(diff / 30)}mo ago`;
                return `${Math.floor(diff / 365)}y ago`;
            },
        },
    ];
</script>

<svelte:head>
    <title>Mediajam — Movies</title>
</svelte:head>

<div class="space-y-6">
    <div>
        <h1 class="text-3xl font-bold">Movies</h1>
        <p class="text-base-content/50 text-sm mt-1">
            Your complete film collection
        </p>
    </div>

    <!-- Stat Cards -->
    <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
            icon="🎬"
            label="Movies"
            value={data.totalMovies}
            sub="in your library"
            color="primary"
        />
        <StatCard
            icon="✅"
            label="Watched"
            value={data.movieStats.watched}
            sub="{watchPct}% of collection"
            color="success"
        />
        <StatCard
            icon="👀"
            label="Unwatched"
            value={data.movieStats.unwatched}
            sub="still to watch"
            color="warning"
        />
        <StatCard
            icon="⏱️"
            label="Runtime"
            value="{data.runtimeHours.toLocaleString()}h"
            sub="total watch time"
            color="secondary"
        />
    </div>

    <!-- Charts -->
    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Chart options={watchPieOptions} height={320} />
        <Chart options={decadeBarOptions} height={320} />
    </div>

    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Chart options={yearBarOptions} height={320} />
        {#if rewatchedBarOptions}
            <Chart options={rewatchedBarOptions} height={320} />
        {:else}
            <div
                class="rounded-2xl bg-base-300/20 border border-base-content/5 p-4 flex items-center justify-center h-[320px]"
            >
                <p class="text-base-content/40 text-sm">
                    No rewatched movies yet
                </p>
            </div>
        {/if}
    </div>

    <!-- Movies Table -->
    <div class="space-y-2">
        <h2 class="text-xl font-bold">All Movies</h2>
        <DataTable
            {columns}
            data={data.movies}
            searchKey="title"
            pageSize={25}
            hideCollectedKey="collection_pct"
        />
    </div>
</div>
