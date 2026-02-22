<script>
    import StatCard from "$lib/components/StatCard.svelte";
    import DataTable from "$lib/components/DataTable.svelte";
    import Chart from "$lib/components/Chart.svelte";

    let { data } = $props();

    const albumBarOptions = {
        title: { text: "Top 15 Artists by Album Count" },
        axisX: { labelAngle: -45, labelFontSize: 11 },
        axisY: { title: "Albums", titleFontColor: "#a6adba" },
        data: [
            {
                type: "column",
                color: "#22d3ee",
                cornerRadius: 4,
                dataPoints: data.topArtistsByAlbums,
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
                toolTipContent: "{label}: {y} artists",
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

    const playsBarOptions =
        data.topArtistsByPlays.length > 0
            ? {
                  title: { text: "Most Played Artists" },
                  axisX: { labelAngle: -45, labelFontSize: 11 },
                  axisY: { title: "Play Count", titleFontColor: "#a6adba" },
                  data: [
                      {
                          type: "bar",
                          color: "#a78bfa",
                          cornerRadius: 4,
                          dataPoints: data.topArtistsByPlays,
                      },
                  ],
              }
            : null;

    const distOptions = {
        title: { text: "Artists by Album Count" },
        data: [
            {
                type: "column",
                color: "#f472b6",
                cornerRadius: 4,
                dataPoints: data.albumDistData,
            },
        ],
        axisX: { labelFontSize: 11 },
        axisY: { title: "Number of Artists", titleFontColor: "#a6adba" },
    };

    const columns = [
        { key: "title", label: "Artist", class: "font-medium" },
        { key: "album_count", label: "Albums", class: "text-center w-24" },
        {
            key: "collection_pct",
            label: "Collected",
            class: "w-36",
            render: (row) => {
                const pct = row.collection_pct || 0;
                const color =
                    pct >= 100 ? "#22d3ee" : pct > 50 ? "#fb923c" : "#ef4444";
                return `<div class="flex items-center gap-2">
                    <div class="w-full bg-base-300 rounded-full h-2">
                        <div class="h-2 rounded-full" style="width: ${Math.min(100, pct)}%; background: ${color}"></div>
                    </div>
                    <span class="text-xs w-12 text-right">${pct}%</span>
                </div>`;
            },
        },
        { key: "total_plays", label: "Total Plays", class: "text-center w-28" },
        {
            key: "musicbrainz_id",
            label: "MusicBrainz",
            class: "w-24",
            sortable: false,
            render: (row) =>
                row.musicbrainz_id
                    ? `<a href="https://musicbrainz.org/artist/${row.musicbrainz_id}" target="_blank" class="link link-primary text-xs">View →</a>`
                    : '<span class="text-base-content/30 text-xs">—</span>',
        },
    ];
</script>

<svelte:head>
    <title>Mediajam — Music</title>
</svelte:head>

<div class="space-y-6">
    <div>
        <h1 class="text-3xl font-bold">Music</h1>
        <p class="text-base-content/50 text-sm mt-1">
            Your music library collection
        </p>
    </div>

    <!-- Stat Cards -->
    <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
            icon="🎤"
            label="Artists"
            value={data.totalArtists}
            sub="in your library"
            color="primary"
        />
        <StatCard
            icon="💿"
            label="Albums"
            value={data.totalAlbums}
            sub="collected"
            color="secondary"
        />
        <StatCard
            icon="📦"
            label="Collection"
            value="{data.collectionStats.overallPct}%"
            sub="{data.collectionStats.totalCollected} of {data.collectionStats
                .totalReleased} albums"
            color="info"
        />
        <StatCard
            icon="▶️"
            label="Total Plays"
            value={data.totalPlays}
            sub="across all albums"
            color="accent"
        />
    </div>

    <!-- Charts -->
    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Chart options={albumBarOptions} height={350} />
        <Chart options={collectionPieOptions} height={350} />
    </div>

    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Chart options={distOptions} height={350} />
        {#if playsBarOptions}
            <Chart options={playsBarOptions} height={350} />
        {:else}
            <div
                class="rounded-2xl bg-base-300/20 border border-base-content/5 p-4 flex items-center justify-center h-[350px]"
            >
                <p class="text-base-content/40 text-sm">
                    No play data available yet
                </p>
            </div>
        {/if}
    </div>

    <!-- Artists Table -->
    <div class="space-y-2">
        <h2 class="text-xl font-bold">All Artists</h2>
        <DataTable
            {columns}
            data={data.artists}
            searchKey="title"
            pageSize={25}
            hideCollectedKey="collection_pct"
        />
    </div>
</div>
