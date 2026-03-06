<script>
    import StatCard from "$lib/components/StatCard.svelte";
    import DataTable from "$lib/components/DataTable.svelte";
    import Chart from "$lib/components/Chart.svelte";

    let { data } = $props();

    const watchPieOptions = {
        title: { text: "Episode Watch Status" },
        data: [
            {
                type: "doughnut",
                startAngle: 240,
                indexLabelFontColor: "#a6adba",
                indexLabelFontSize: 12,
                indexLabelFontFamily: "Inter, sans-serif",
                toolTipContent: "{label}: {y} ({percentage}%)",
                dataPoints: [
                    {
                        label: "Watched",
                        y: data.episodeStats.watched,
                        color: "#36d399",
                        percentage: (
                            (data.episodeStats.watched /
                                Math.max(data.episodeStats.total, 1)) *
                            100
                        ).toFixed(1),
                    },
                    {
                        label: "Unwatched",
                        y: data.episodeStats.unwatched,
                        color: "#6b7280",
                        percentage: (
                            (data.episodeStats.unwatched /
                                Math.max(data.episodeStats.total, 1)) *
                            100
                        ).toFixed(1),
                    },
                    {
                        label: "In Progress",
                        y: data.episodeStats.inProgress,
                        color: "#fbbd23",
                        percentage: (
                            (data.episodeStats.inProgress /
                                Math.max(data.episodeStats.total, 1)) *
                            100
                        ).toFixed(1),
                    },
                ],
            },
        ],
    };

    const topShowsBarOptions = {
        title: { text: "Top 15 Shows by Watch Count" },
        axisX: { labelAngle: -45, labelFontSize: 11 },
        axisY: { title: "Watches", titleFontColor: "#a6adba" },
        data: [
            {
                type: "column",
                color: "#7c3aed",
                cornerRadius: 4,
                dataPoints: data.topShowsByWatchCount,
            },
        ],
    };

    const completionPieOptions = {
        title: { text: "Watch Completion" },
        data: [
            {
                type: "pie",
                startAngle: 240,
                indexLabelFontColor: "#a6adba",
                indexLabelFontSize: 12,
                indexLabelFontFamily: "Inter, sans-serif",
                toolTipContent: "{label}: {y} shows",
                dataPoints: [
                    {
                        label: "Fully Watched",
                        y: data.completionBuckets.full,
                        color: "#36d399",
                    },
                    {
                        label: "Partially Watched",
                        y: data.completionBuckets.partial,
                        color: "#fbbd23",
                    },
                    {
                        label: "Not Started",
                        y: data.completionBuckets.none,
                        color: "#6b7280",
                    },
                ],
            },
        ],
    };

    const collectionPieOptions = {
        title: { text: "Collection Status" },
        data: [
            {
                type: "pie",
                startAngle: 200,
                indexLabelFontColor: "#a6adba",
                indexLabelFontSize: 12,
                indexLabelFontFamily: "Inter, sans-serif",
                toolTipContent: "{label}: {y} shows",
                dataPoints: [
                    {
                        label: "Complete",
                        y: data.collectionBuckets.complete,
                        color: "#22d3ee",
                    },
                    {
                        label: "Partial",
                        y: data.collectionBuckets.partial,
                        color: "#fb923c",
                    },
                    {
                        label: "Missing",
                        y: data.collectionBuckets.missing,
                        color: "#ef4444",
                    },
                ],
            },
        ],
    };

    const showsByYearOptions = {
        title: { text: "Shows by Premiere Year" },
        axisX: {
            title: "Year",
            titleFontColor: "#a6adba",
            labelFontSize: 11,
            interval: 5,
            valueFormatString: "####",
        },
        axisY: { title: "Count", titleFontColor: "#a6adba" },
        data: [
            {
                type: "column",
                color: "#7c3aed",
                cornerRadius: 4,
                dataPoints: data.showsByYear.map((d) => ({
                    x: d.year,
                    y: d.count,
                })),
            },
        ],
    };

    const columns = [
        {
            key: "title",
            label: "Title",
            class: "font-medium",
            render: (row) =>
                `<a href="/tv/${row.id}" class="link link-hover link-primary">${row.title}</a>`,
        },
        { key: "release_year", label: "Year", class: "text-center w-20" },
        {
            key: "collected_children",
            label: "Episodes",
            class: "text-center w-24",
        },
        {
            key: "collection_pct",
            label: "Collected",
            class: "w-36",
            render: (row) => {
                const pct = row.collection_pct || 0;
                const color =
                    pct >= 100 ? "#22d3ee" : pct > 50 ? "#fb923c" : "#ef4444";
                const bgColor =
                    pct >= 100 ? "rgba(0,0,0,0.15)" : "rgba(239, 68, 68, 0.2)";
                return `<div class="flex items-center gap-2">
                    <div class="w-full rounded-full h-2" style="background: ${bgColor}">
                        <div class="h-2 rounded-full" style="width: ${Math.min(100, pct)}%; background: ${color}"></div>
                    </div>
                    <span class="text-xs w-12 text-right">${pct}%</span>
                </div>`;
            },
        },
        {
            key: "completion",
            label: "Watched",
            class: "w-36",
            render: (row) => {
                const pct = row.completion || 0;
                const color =
                    pct >= 100 ? "#36d399" : pct > 0 ? "#fbbd23" : "#6b7280";
                return `<div class="flex items-center gap-2">
                    <div class="w-full bg-base-300 rounded-full h-2">
                        <div class="h-2 rounded-full" style="width: ${Math.min(100, pct)}%; background: ${color}"></div>
                    </div>
                    <span class="text-xs w-12 text-right">${pct}%</span>
                </div>`;
            },
        },
        {
            key: "watched_children",
            label: "W/C",
            class: "text-center w-20",
            render: (row) =>
                `${row.watched_children || 0}/${row.collected_children || 0}`,
        },
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

    /** @param {any} row */
    function rowClass(row) {
        if (row.collection_status !== "wanted") return "";
        const upcoming = ["continuing"].includes(row.arr_status);
        return upcoming ? "arr-upcoming" : "arr-missing";
    }
</script>

<svelte:head>
    <title>Mediajam — TV Shows</title>
</svelte:head>

<div class="space-y-6">
    <div>
        <h1 class="text-3xl font-bold">TV Shows</h1>
        <p class="text-base-content/50 text-sm mt-1">
            Your complete television collection at a glance
        </p>
    </div>

    <!-- Stat Cards -->
    <div class="grid grid-cols-2 md:grid-cols-5 gap-4">
        <StatCard
            icon="📺"
            label="Shows"
            value={data.totalShows}
            sub="in your library"
            color="primary"
        />
        <StatCard
            icon="🎬"
            label="Episodes"
            value={data.episodeStats.total}
            sub="{data.runtimeHours.toLocaleString()}h runtime"
            color="secondary"
        />
        <StatCard
            icon="📦"
            label="Collection"
            value="{data.collectionStats.overallPct}%"
            sub="{data.collectionStats.totalCollected.toLocaleString()} of {data.collectionStats.totalReleased.toLocaleString()} eps"
            color="info"
        />
        <StatCard
            icon="✅"
            label="Watched"
            value={data.episodeStats.watched}
            sub="{(
                (data.episodeStats.watched /
                    Math.max(data.episodeStats.total, 1)) *
                100
            ).toFixed(1)}% of episodes"
            color="success"
        />
        <StatCard
            icon="⏸️"
            label="In Progress"
            value={data.episodeStats.inProgress}
            sub="{data.completionBuckets.partial} shows started"
            color="warning"
        />
    </div>

    <!-- Charts Row -->
    <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Chart options={watchPieOptions} height={320} />
        <Chart options={collectionPieOptions} height={320} />
        <Chart options={completionPieOptions} height={320} />
    </div>

    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Chart options={topShowsBarOptions} height={350} />
        <Chart options={showsByYearOptions} height={350} />
    </div>

    <!-- Shows Table -->
    <div class="space-y-2">
        <h2 class="text-xl font-bold">All Shows</h2>
        <DataTable
            {columns}
            data={data.shows}
            searchKey="title"
            pageSize={25}
            hideCollectedKey="collection_pct"
            {rowClass}
        />
    </div>
</div>

<style>
    :global(.arr-missing) {
        border-left: 3px dashed rgba(239, 68, 68, 0.8);
    }
    :global(.arr-upcoming) {
        border-left: 3px dashed oklch(0.8 0.15 75);
    }
</style>
