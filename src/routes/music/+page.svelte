<script>
    import StatCard from "$lib/components/StatCard.svelte";
    import DataTable from "$lib/components/DataTable.svelte";
    import Chart from "$lib/components/Chart.svelte";
    import DeleteToast from "$lib/components/DeleteToast.svelte";

    let { data } = $props();

    const albumBarOptions =
        data.topArtistsByAlbums.length > 0
            ? {
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
              }
            : null;

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

    const distOptions =
        data.albumDistData.length > 0
            ? {
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
                  axisY: {
                      title: "Number of Artists",
                      titleFontColor: "#a6adba",
                  },
              }
            : null;

    const columns = [
        {
            key: "title",
            label: "Artist",
            class: "font-medium",
            render: (/** @type {any} */ row) =>
                `<a href="/music/${row.id}" class="link link-hover link-primary">${row.title}</a>`,
        },
        { key: "album_count", label: "Albums", class: "text-center w-24" },
        {
            key: "collection_pct",
            label: "Collected",
            class: "w-36",
            render: (/** @type {any} */ row) => {
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
        { key: "total_plays", label: "Total Plays", class: "text-center w-28" },
        {
            key: "musicbrainz_id",
            label: "MusicBrainz",
            class: "w-24",
            sortable: false,
            render: (/** @type {any} */ row) =>
                row.musicbrainz_id
                    ? `<a href="https://musicbrainz.org/artist/${row.musicbrainz_id}" target="_blank" class="link link-primary text-xs">View →</a>`
                    : '<span class="text-base-content/30 text-xs">—</span>',
        },
    ];

    /** @param {any} row */
    function rowClass(row) {
        if (row.collection_status !== "wanted") return "";
        const upcoming = ["continuing"].includes(row.arr_status);
        return upcoming ? "arr-upcoming" : "arr-missing";
    }

    const p = data.pagination;
</script>

<svelte:head>
    <title>Mediajam — Music</title>
</svelte:head>

<div class="space-y-6">
    <DeleteToast />
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

    <!-- Charts (only page 1, no search) -->
    {#if albumBarOptions || distOptions}
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            {#if albumBarOptions}
                <Chart options={albumBarOptions} height={350} />
            {/if}
            <Chart options={collectionPieOptions} height={350} />
        </div>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            {#if distOptions}
                <Chart options={distOptions} height={350} />
            {/if}
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
    {/if}

    <!-- Artists Table with Server Pagination -->
    <div class="space-y-3">
        <div class="flex items-center justify-between">
            <h2 class="text-xl font-bold">All Artists</h2>
            <!-- Search -->
            <form method="get" class="flex items-center gap-2">
                <input
                    type="text"
                    name="q"
                    value={data.search}
                    placeholder="Search artists…"
                    class="input input-bordered input-sm w-48"
                />
                <select
                    name="sort"
                    class="select select-bordered select-sm"
                    onchange={(e) =>
                        /** @type {any} */ (e.target).form.submit()}
                >
                    <option value="plays" selected={data.sort === "plays"}
                        >Most Plays</option
                    >
                    <option value="albums" selected={data.sort === "albums"}
                        >Most Albums</option
                    >
                    <option value="name" selected={data.sort === "name"}
                        >Name A-Z</option
                    >
                </select>
                <button type="submit" class="btn btn-sm btn-primary"
                    >Search</button
                >
                {#if data.search}
                    <a href="/music" class="btn btn-sm btn-ghost">Clear</a>
                {/if}
            </form>
        </div>

        <DataTable
            {columns}
            data={data.artists}
            pageSize={50}
            hideCollectedKey="collection_pct"
            {rowClass}
        />

        <!-- Server Pagination -->
        {#if p.totalPages > 1}
            <div class="flex items-center justify-center gap-2 pt-2">
                {#if p.page > 1}
                    <a
                        href="/music?page={p.page - 1}{data.search
                            ? '&q=' + data.search
                            : ''}{data.sort !== 'albums'
                            ? '&sort=' + data.sort
                            : ''}"
                        class="btn btn-sm btn-ghost">← Prev</a
                    >
                {/if}
                <span class="text-sm text-base-content/50">
                    Page {p.page} of {p.totalPages}
                    <span class="text-base-content/30">({p.total} artists)</span
                    >
                </span>
                {#if p.page < p.totalPages}
                    <a
                        href="/music?page={p.page + 1}{data.search
                            ? '&q=' + data.search
                            : ''}{data.sort !== 'albums'
                            ? '&sort=' + data.sort
                            : ''}"
                        class="btn btn-sm btn-ghost">Next →</a
                    >
                {/if}
            </div>
        {/if}
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
