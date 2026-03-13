<script>
    import StatCard from "$lib/components/StatCard.svelte";
    import DataTable from "$lib/components/DataTable.svelte";
    import Chart from "$lib/components/Chart.svelte";
    import DeleteToast from "$lib/components/DeleteToast.svelte";
    import ReasonTag from "$lib/components/ReasonTag.svelte";
    import ProgressCard from "$lib/components/ProgressCard.svelte";

    let { data } = $props();

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

    // Chart options (library view only)
    const albumBarOptions = data.topArtistsByAlbums.length > 0
        ? {
            title: { text: "Top 15 Artists by Album Count" },
            axisX: { labelAngle: -45, labelFontSize: 11 },
            axisY: { title: "Albums", titleFontColor: "#a6adba" },
            data: [{ type: "column", color: "#22d3ee", cornerRadius: 4, dataPoints: data.topArtistsByAlbums }],
        } : null;

    const collectionPieOptions = {
        title: { text: "Collection Status" },
        data: [{
            type: "pie", startAngle: 200,
            indexLabelFontColor: "#a6adba", indexLabelFontSize: 12,
            indexLabelFontFamily: "Inter, sans-serif",
            toolTipContent: "{label}: {y} artists",
            dataPoints: [
                { label: "Complete", y: data.collectionBuckets.complete, color: "#22d3ee" },
                { label: "Partial", y: data.collectionBuckets.partial, color: "#fb923c" },
                { label: "Missing", y: data.collectionBuckets.missing, color: "#ef4444" },
            ],
        }],
    };

    const playsBarOptions = data.topArtistsByPlays.length > 0
        ? {
            title: { text: "Most Played Artists" },
            axisX: { labelAngle: -45, labelFontSize: 11 },
            axisY: { title: "Play Count", titleFontColor: "#a6adba" },
            data: [{ type: "bar", color: "#a78bfa", cornerRadius: 4, dataPoints: data.topArtistsByPlays }],
        } : null;

    const distOptions = data.albumDistData.length > 0
        ? {
            title: { text: "Artists by Album Count" },
            data: [{ type: "column", color: "#f472b6", cornerRadius: 4, dataPoints: data.albumDistData }],
            axisX: { labelFontSize: 11 },
            axisY: { title: "Number of Artists", titleFontColor: "#a6adba" },
        } : null;

    const columns = [
        { key: "title", label: "Artist", class: "font-medium",
          render: (/** @type {any} */ row) => `<a href="/music/${row.id}" class="link link-hover link-primary">${row.title}</a>` },
        { key: "album_count", label: "Albums", class: "text-center w-24" },
        { key: "collection_pct", label: "Collected", class: "w-36",
          render: (/** @type {any} */ row) => {
            const pct = row.collection_pct || 0;
            const color = pct >= 100 ? "#22d3ee" : pct > 50 ? "#fb923c" : "#ef4444";
            const bgColor = pct >= 100 ? "rgba(0,0,0,0.15)" : "rgba(239, 68, 68, 0.2)";
            return `<div class="flex items-center gap-2"><div class="w-full rounded-full h-2" style="background: ${bgColor}"><div class="h-2 rounded-full" style="width: ${Math.min(100, pct)}%; background: ${color}"></div></div><span class="text-xs w-12 text-right">${pct}%</span></div>`;
        }},
        { key: "total_plays", label: "Total Plays", class: "text-center w-28" },
        { key: "musicbrainz_id", label: "MusicBrainz", class: "w-24", sortable: false,
          render: (/** @type {any} */ row) => row.musicbrainz_id
            ? `<a href="https://musicbrainz.org/artist/${row.musicbrainz_id}" target="_blank" class="link link-primary text-xs">View →</a>`
            : '<span class="text-base-content/30 text-xs">—</span>' },
    ];

    /** @param {any} row */
    function rowClass(row) {
        if (row.collection_status !== "wanted") return "";
        return ["continuing"].includes(row.arr_status) ? "arr-upcoming" : "arr-missing";
    }

    const p = data.pagination;
</script>

<svelte:head>
    <title>Mediajam — Music</title>
</svelte:head>

<div class="space-y-8">
    <DeleteToast />

    <!-- Header -->
    <div class="flex items-end justify-between">
        <div>
            <h1 class="text-3xl font-bold">Music</h1>
            <p class="text-base-content/50 text-sm mt-1">
                {data.totalArtists.toLocaleString()} artists · {data.totalAlbums.toLocaleString()} albums · {data.totalPlays.toLocaleString()} plays
            </p>
        </div>
        <button class="btn btn-ghost btn-sm" onclick={() => showLibrary = !showLibrary}>
            {showLibrary ? '← Back to Home' : 'Library & Stats →'}
        </button>
    </div>

    {#if showLibrary}
        <!-- ═══ LIBRARY VIEW ═══ -->
        <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard icon="🎤" label="Artists" value={data.totalArtists} sub="in your library" color="primary" />
            <StatCard icon="💿" label="Albums" value={data.totalAlbums} sub="collected" color="secondary" />
            <StatCard icon="📦" label="Collection" value="{data.collectionStats.overallPct}%" sub="{data.collectionStats.totalCollected} of {data.collectionStats.totalReleased} albums" color="info" />
            <StatCard icon="▶️" label="Total Plays" value={data.totalPlays} sub="across all albums" color="accent" />
        </div>

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
                    <div class="rounded-2xl bg-base-300/20 border border-base-content/5 p-4 flex items-center justify-center h-[350px]">
                        <p class="text-base-content/40 text-sm">No play data available yet</p>
                    </div>
                {/if}
            </div>
        {/if}

        <div class="space-y-3">
            <div class="flex items-center justify-between">
                <h2 class="text-xl font-bold">All Artists</h2>
                <form method="get" class="flex items-center gap-2">
                    <input type="text" name="q" value={data.search} placeholder="Search artists…" class="input input-bordered input-sm w-48" />
                    <select name="sort" class="select select-bordered select-sm" onchange={(e) => /** @type {any} */ (e.target).form.submit()}>
                        <option value="plays" selected={data.sort === "plays"}>Most Plays</option>
                        <option value="albums" selected={data.sort === "albums"}>Most Albums</option>
                        <option value="name" selected={data.sort === "name"}>Name A-Z</option>
                    </select>
                    <button type="submit" class="btn btn-sm btn-primary">Search</button>
                    {#if data.search}
                        <a href="/music" class="btn btn-sm btn-ghost">Clear</a>
                    {/if}
                </form>
            </div>

            <DataTable {columns} data={data.artists} pageSize={50} hideCollectedKey="collection_pct" {rowClass} />

            {#if p.totalPages > 1}
                <div class="flex items-center justify-center gap-2 pt-2">
                    {#if p.page > 1}
                        <a href="/music?page={p.page - 1}{data.search ? '&q=' + data.search : ''}{data.sort !== 'albums' ? '&sort=' + data.sort : ''}" class="btn btn-sm btn-ghost">← Prev</a>
                    {/if}
                    <span class="text-sm text-base-content/50">
                        Page {p.page} of {p.totalPages}
                        <span class="text-base-content/30">({p.total} artists)</span>
                    </span>
                    {#if p.page < p.totalPages}
                        <a href="/music?page={p.page + 1}{data.search ? '&q=' + data.search : ''}{data.sort !== 'albums' ? '&sort=' + data.sort : ''}" class="btn btn-sm btn-ghost">Next →</a>
                    {/if}
                </div>
            {/if}
        </div>
    {:else}
        <!-- ═══ SMART HOME VIEW ═══ -->

        <!-- Your Recent Listening -->
        {#if data.sections.recentListening.length > 0}
            <section class="smart-section">
                <h2 class="text-lg font-bold">Your Recent Listening</h2>
                <div class="poster-scroll">
                    {#each data.sections.recentListening as item}
                        <a href="/music/{item.artist_id}" class="poster-card">
                            {#if item.artist_poster}
                                <img src={item.artist_poster} alt={item.artist_name} class="poster-img" loading="lazy" />
                            {:else}
                                <div class="poster-img placeholder-poster">🎵</div>
                            {/if}
                            <div class="poster-label">
                                <span class="poster-title">{item.artist_name}</span>
                                <span class="poster-album">{item.album_title}</span>
                                <span class="poster-meta">{timeAgo(item.last_played)}</span>
                            </div>
                        </a>
                    {/each}
                </div>
            </section>
        {/if}

        <!-- New from Your Favorites -->
        {#if data.sections.newFromFavorites.length > 0}
            <section class="smart-section">
                <h2 class="text-lg font-bold">New from Your Favorites</h2>
                <p class="text-xs text-base-content/40 -mt-1">Unplayed albums from artists you've favorited</p>
                <div class="poster-scroll">
                    {#each data.sections.newFromFavorites as item}
                        <a href="/music/{item.artist_id}" class="poster-card">
                            {#if item.artist_poster}
                                <img src={item.artist_poster} alt={item.artist_name} class="poster-img" loading="lazy" />
                            {:else}
                                <div class="poster-img placeholder-poster">🎵</div>
                            {/if}
                            <div class="poster-label">
                                <span class="poster-title">{item.artist_name}</span>
                                <span class="poster-album">{item.album_title}</span>
                                <ReasonTag reason="★ Favorite Artist" />
                            </div>
                        </a>
                    {/each}
                </div>
            </section>
        {/if}

        <!-- Rediscover -->
        {#if data.sections.rediscover.length > 0}
            <section class="smart-section">
                <h2 class="text-lg font-bold">Rediscover</h2>
                <div class="progress-grid">
                    {#each data.sections.rediscover as artist}
                        <ProgressCard
                            title={artist.title}
                            watched={artist.played_albums}
                            total={artist.total_albums}
                            posterUrl={artist.poster_url}
                            link="/music/{artist.id}"
                            reason={artist.reason}
                        />
                    {/each}
                </div>
            </section>
        {/if}

        <!-- Quick Stats -->
        <section class="smart-section">
            <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
                <StatCard icon="🎤" label="Artists" value={data.totalArtists} sub="in your library" color="primary" />
                <StatCard icon="💿" label="Albums" value={data.totalAlbums} sub="collected" color="secondary" />
                <StatCard icon="📦" label="Collection" value="{data.collectionStats.overallPct}%" sub="{data.collectionStats.totalCollected} of {data.collectionStats.totalReleased}" color="info" />
                <StatCard icon="▶️" label="Total Plays" value={data.totalPlays} sub="across all albums" color="accent" />
            </div>
        </section>
    {/if}
</div>

<style>
    .smart-section {
        display: flex;
        flex-direction: column;
        gap: 10px;
    }

    .poster-scroll {
        display: flex;
        gap: 12px;
        overflow-x: auto;
        scrollbar-width: thin;
        padding-bottom: 4px;
    }

    .poster-card {
        flex-shrink: 0;
        width: 130px;
        text-decoration: none;
        color: inherit;
        transition: transform 0.15s;
    }

    .poster-card:hover {
        transform: translateY(-3px);
    }

    .poster-img {
        width: 100%;
        aspect-ratio: 1;
        border-radius: 10px;
        object-fit: cover;
        box-shadow: 0 2px 8px oklch(0 0 0 / 0.3);
    }

    .placeholder-poster {
        display: flex;
        align-items: center;
        justify-content: center;
        background: oklch(var(--b3));
        font-size: 2rem;
    }

    .poster-label {
        margin-top: 6px;
        display: flex;
        flex-direction: column;
        gap: 1px;
    }

    .poster-title {
        font-size: 0.75rem;
        font-weight: 600;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .poster-album {
        font-size: 0.65rem;
        color: oklch(var(--bc) / 0.5);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .poster-meta {
        font-size: 0.6rem;
        color: oklch(var(--bc) / 0.35);
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
