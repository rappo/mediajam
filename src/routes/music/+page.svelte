<script>
    import { onMount } from 'svelte';
    import StatCard from "$lib/components/StatCard.svelte";
    import DataTable from "$lib/components/DataTable.svelte";
    import Chart from "$lib/components/Chart.svelte";
    import DeleteToast from "$lib/components/DeleteToast.svelte";
    import PosterRow from "$lib/components/PosterRow.svelte";
    import ProgressCard from "$lib/components/ProgressCard.svelte";
    import Skeleton from "$lib/components/Skeleton.svelte";
    import CalendarStrip from "$lib/components/CalendarStrip.svelte";

    let { data } = $props();

    let showLibrary = $state(false);

    // Calendar state
    let calendarDays = $state(/** @type {any[]} */ ([]));
    let calendarOffset = $state(0);
    let calendarLoading = $state(false);

    // Smart sections — loaded on mount
    let sectionsLoaded = $state(false);
    let sections = $state(/** @type {any} */ ({ recentListening: [], newFromFavorites: [], rediscover: [], heavyRotation: [], unplayedAlbums: [], itsBeenAWhile: [] }));
    let timeFilters = $state(/** @type {any} */ ({ rotationTime: '30', recentTime: '0', awhileTime: '6' }));

    // Library data — loaded lazily on toggle
    let libraryLoaded = $state(false);
    let libraryLoading = $state(false);
    let artists = $state(/** @type {any[]} */ ([]));
    let topArtistsByAlbums = $state(/** @type {any[]} */ ([]));
    let topArtistsByPlays = $state(/** @type {any[]} */ ([]));
    let albumDistData = $state(/** @type {any[]} */ ([]));
    let collectionBuckets = $state(/** @type {any} */ ({}));
    let collectionStats = $state(/** @type {any} */ ({ totalCollected: 0, totalReleased: 0, overallPct: 100 }));
    let pagination = $state(/** @type {any} */ ({ page: 1, perPage: 50, total: 0, totalPages: 0 }));
    let searchVal = $state('');
    let sortVal = $state('plays');

    /** @param {number} newOffset */
    async function navigateCalendar(newOffset) {
        calendarOffset = newOffset;
        calendarLoading = true;
        try {
            const res = await fetch(`/api/calendar/music?offset=${newOffset}`);
            if (res.ok) {
                const result = await res.json();
                calendarDays = result.days;
            }
        } catch (e) {
            console.error('[music] Failed to fetch calendar:', e);
        }
        calendarLoading = false;
    }

    onMount(async () => {
        // Load calendar independently
        fetch('/api/calendar/music')
            .then(r => r.json())
            .then(d => { calendarDays = d.days || []; })
            .catch(e => console.error('[music] Failed to load calendar:', e));

        // Try loading all sections at once (fast when cached)
        const qs = window.location.search;
        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 3000);
            const res = await fetch('/api/pages/music' + qs, { signal: controller.signal });
            clearTimeout(timeout);
            const d = await res.json();
            sections = d.sections;
            timeFilters = d.timeFilters;
            sectionsLoaded = true;
        } catch {
            // Timed out or failed — load each section individually in parallel
            const sectionNames = ['recentListening', 'heavyRotation', 'newFromFavorites', 'rediscover', 'unplayedAlbums', 'itsBeenAWhile'];
            sectionsLoaded = true; // show UI immediately with empty sections
            await Promise.allSettled(sectionNames.map(async (name) => {
                try {
                    const sep = qs ? '&' : '?';
                    const res = await fetch(`/api/pages/music${qs}${sep}section=${name}`);
                    const d = await res.json();
                    if (d.sections?.[name]) {
                        sections = { ...sections, [name]: d.sections[name] };
                    }
                    if (d.timeFilters) timeFilters = d.timeFilters;
                } catch (e) {
                    console.error(`[music] Failed to load section ${name}:`, e);
                }
            }));
        }
    });

    async function loadLibrary() {
        if (libraryLoaded || libraryLoading) return;
        libraryLoading = true;
        try {
            const qs = window.location.search;
            const sep = qs ? '&' : '?';
            const res = await fetch(`/api/pages/music${qs}${sep}view=library`);
            const d = await res.json();
            artists = d.artists;
            topArtistsByAlbums = d.topArtistsByAlbums;
            topArtistsByPlays = d.topArtistsByPlays;
            albumDistData = d.albumDistData;
            collectionBuckets = d.collectionBuckets;
            collectionStats = d.collectionStats;
            pagination = d.pagination;
            searchVal = d.search || '';
            sortVal = d.sort || 'plays';
            libraryLoaded = true;
        } catch (e) {
            console.error('[music] Failed to load library:', e);
        }
        libraryLoading = false;
    }

    function toggleLibrary() {
        showLibrary = !showLibrary;
        if (showLibrary && !libraryLoaded) loadLibrary();
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

    // Chart options — reactive since data loads async
    let albumBarOptions = $derived(topArtistsByAlbums.length > 0
        ? {
            title: { text: "Top 15 Artists by Album Count" },
            axisX: { labelAngle: -45, labelFontSize: 11 },
            axisY: { title: "Albums", titleFontColor: "#a6adba" },
            data: [{ type: "column", color: "#22d3ee", cornerRadius: 4, dataPoints: topArtistsByAlbums }],
        } : null);

    let collectionPieOptions = $derived({
        title: { text: "Collection Status" },
        data: [{
            type: "pie", startAngle: 200,
            indexLabelFontColor: "#a6adba", indexLabelFontSize: 12,
            indexLabelFontFamily: "Inter, sans-serif",
            toolTipContent: "{label}: {y} artists",
            dataPoints: [
                { label: "Complete", y: collectionBuckets.complete || 0, color: "#22d3ee" },
                { label: "Partial", y: collectionBuckets.partial || 0, color: "#fb923c" },
                { label: "Missing", y: collectionBuckets.missing || 0, color: "#ef4444" },
            ],
        }],
    });

    let playsBarOptions = $derived(topArtistsByPlays.length > 0
        ? {
            title: { text: "Most Played Artists" },
            axisX: { labelAngle: -45, labelFontSize: 11 },
            axisY: { title: "Play Count", titleFontColor: "#a6adba" },
            data: [{ type: "bar", color: "#a78bfa", cornerRadius: 4, dataPoints: topArtistsByPlays }],
        } : null);

    let distOptions = $derived(albumDistData.length > 0
        ? {
            title: { text: "Artists by Album Count" },
            data: [{ type: "column", color: "#f472b6", cornerRadius: 4, dataPoints: albumDistData }],
            axisX: { labelFontSize: 11 },
            axisY: { title: "Number of Artists", titleFontColor: "#a6adba" },
        } : null);

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

    // ── Transform data for PosterRow (square aspect for music) ──
    let recentPosterItems = $derived(sections.recentListening.map((/** @type {any} */ i) => ({
        href: `/music/${i.artist_id}/${i.album_id}`,
        poster_url: i.album_art,
        title: i.album_title,
        subtitle: `${i.artist_name} · ${timeAgo(i.last_played)}`,
        icon: '🎵',
    })));

    let favoritePosterItems = $derived(sections.newFromFavorites.map((/** @type {any} */ i) => ({
        href: `/music/${i.artist_id}/${i.album_id}`,
        poster_url: i.album_art,
        title: i.album_title,
        subtitle: i.artist_name,
        icon: '🎵',
        badge: '★',
    })));

    let heavyRotationItems = $derived(sections.heavyRotation.map((/** @type {any} */ i) => ({
        href: `/music/${i.artist_id}/${i.album_id}`,
        poster_url: i.album_art,
        title: i.album_title,
        subtitle: `${i.artist_name} · ${i.recent_plays} plays`,
        icon: '🔥',
    })));

    let unplayedItems = $derived(sections.unplayedAlbums.map((/** @type {any} */ i) => ({
        href: `/music/${i.artist_id}/${i.album_id}`,
        poster_url: i.album_art,
        title: i.album_title,
        subtitle: i.artist_name,
        icon: '💿',
    })));

    let itsBeenAWhileItems = $derived(sections.itsBeenAWhile.map((/** @type {any} */ i) => ({
        href: `/music/${i.artist_id}/${i.album_id}`,
        poster_url: i.album_art,
        title: i.album_title,
        subtitle: `${i.artist_name} · ${i.total_plays} plays`,
        icon: '⏰',
    })));

    // Time filter option sets
    const ROTATION_OPTIONS = [
        { label: 'Past Week', value: '7' },
        { label: '1 Month', value: '30' },
        { label: '3 Months', value: '90' },
        { label: '6 Months', value: '180' },
        { label: '1 Year', value: '365' },
    ];
    const RECENT_OPTIONS = [
        { label: 'All Time', value: '0' },
        { label: 'Past Week', value: '7' },
        { label: '1 Month', value: '30' },
        { label: '3 Months', value: '90' },
        { label: '1 Year', value: '365' },
    ];
    const AWHILE_OPTIONS = [
        { label: '3 Months', value: '3' },
        { label: '6 Months', value: '6' },
        { label: '1 Year', value: '12' },
        { label: '2 Years', value: '24' },
    ];
</script>

<svelte:head>
    <title>Mediajam — Music</title>
</svelte:head>

<div class="space-y-8 max-w-6xl mx-auto">
    <DeleteToast />

    <!-- Header -->
    <div class="flex items-end justify-between">
        <div>
            <h1 class="text-3xl font-bold">Music</h1>
            <p class="text-base-content/50 text-sm mt-1">
                {data.totalArtists.toLocaleString()} artists · {data.totalAlbums.toLocaleString()} albums · {data.totalPlays.toLocaleString()} plays
            </p>
        </div>
        <button class="btn btn-ghost btn-sm" onclick={toggleLibrary}>
            {showLibrary ? '← Back to Home' : 'Library & Stats →'}
        </button>
    </div>

    {#if showLibrary}
        <!-- ═══ LIBRARY VIEW ═══ -->
        {#if libraryLoading || !libraryLoaded}
            <Skeleton type="stat-cards" />
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Skeleton type="chart" />
                <Skeleton type="chart" />
            </div>
            <Skeleton type="table" />
        {:else}
        <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard icon="🎤" label="Artists" value={data.totalArtists} sub="in your library" color="primary" />
            <StatCard icon="💿" label="Albums" value={data.totalAlbums} sub="collected" color="secondary" />
            <StatCard icon="📦" label="Collection" value="{collectionStats.overallPct}%" sub="{collectionStats.totalCollected} of {collectionStats.totalReleased} albums" color="info" />
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
                    <input type="text" name="q" value={searchVal} placeholder="Search artists…" class="input input-bordered input-sm w-48" />
                    <select name="sort" class="select select-bordered select-sm" onchange={(e) => /** @type {any} */ (e.target).form.submit()}>
                        <option value="plays" selected={sortVal === "plays"}>Most Plays</option>
                        <option value="albums" selected={sortVal === "albums"}>Most Albums</option>
                        <option value="name" selected={sortVal === "name"}>Name A-Z</option>
                    </select>
                    <button type="submit" class="btn btn-sm btn-primary">Search</button>
                    {#if searchVal}
                        <a href="/music" class="btn btn-sm btn-ghost">Clear</a>
                    {/if}
                </form>
            </div>

            <DataTable {columns} data={artists} pageSize={50} hideCollectedKey="collection_pct" {rowClass} />

            {#if pagination.totalPages > 1}
                <div class="flex items-center justify-center gap-2 pt-2">
                    {#if pagination.page > 1}
                        <a href="/music?page={pagination.page - 1}{searchVal ? '&q=' + searchVal : ''}{sortVal !== 'albums' ? '&sort=' + sortVal : ''}" class="btn btn-sm btn-ghost">← Prev</a>
                    {/if}
                    <span class="text-sm text-base-content/50">
                        Page {pagination.page} of {pagination.totalPages}
                        <span class="text-base-content/30">({pagination.total} artists)</span>
                    </span>
                    {#if pagination.page < pagination.totalPages}
                        <a href="/music?page={pagination.page + 1}{searchVal ? '&q=' + searchVal : ''}{sortVal !== 'albums' ? '&sort=' + sortVal : ''}" class="btn btn-sm btn-ghost">Next →</a>
                    {/if}
                </div>
            {/if}
        </div>
        {/if}
    {:else}
        <!-- ═══ SMART HOME VIEW ═══ -->

        {#if !sectionsLoaded}
            <Skeleton type="poster-row" />
            <Skeleton type="poster-row" />
            <Skeleton type="poster-row" />
        {:else}

        <!-- ▌UPCOMING RELEASES ─────────────────────────────────────── -->
        {#if calendarDays.some(d => d.episodes?.length > 0)}
        <section class="smart-section">
            <div class="section-header">
                <h2 class="section-title">
                    Upcoming Releases
                    {#if calendarLoading}
                        <span class="loading loading-spinner loading-sm" style="margin-left: 8px; vertical-align: middle;"></span>
                    {/if}
                </h2>
            </div>
            <CalendarStrip mode="music" days={calendarDays} weekOffset={calendarOffset} onNavigate={navigateCalendar} />
        </section>
        {/if}

        <!-- Heavy Rotation -->
        {#if heavyRotationItems.length > 0}
            <PosterRow title="🔥 Heavy Rotation" items={heavyRotationItems} square
                timeFilter={{ paramName: 'rotation_time', value: timeFilters.rotationTime, options: ROTATION_OPTIONS }} />
        {/if}

        <!-- Your Recent Listening -->
        <PosterRow title="Your Recent Listening" items={recentPosterItems} square
            timeFilter={{ paramName: 'recent_time', value: timeFilters.recentTime, options: RECENT_OPTIONS }} />

        <!-- Unlisted from Your Favorites -->
        <PosterRow title="Unlisted from Your Favorites" items={favoritePosterItems} square />

        <!-- It's Been a While -->
        {#if itsBeenAWhileItems.length > 0}
            <PosterRow title="⏰ It's Been a While" items={itsBeenAWhileItems} square
                timeFilter={{ paramName: 'awhile_time', value: timeFilters.awhileTime, options: AWHILE_OPTIONS }} />
        {/if}

        <!-- Unplayed Albums -->
        {#if unplayedItems.length > 0}
            <PosterRow title="💿 Unplayed in Your Library" items={unplayedItems} square />
        {/if}

        <!-- Rediscover -->
        {#if sections.rediscover.length > 0}
            <section class="smart-section">
                <div class="section-header"><h2 class="section-title">Rediscover</h2></div>
                <div class="progress-grid">
                    {#each sections.rediscover as artist}
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
        <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard icon="🎤" label="Artists" value={data.totalArtists} sub="in your library" color="primary" />
            <StatCard icon="💿" label="Albums" value={data.totalAlbums} sub="collected" color="secondary" />
            <StatCard icon="▶️" label="Total Plays" value={data.totalPlays} sub="across all albums" color="accent" />
        </div>
        {/if} <!-- end loaded -->
    {/if}
</div>

<style>
    .smart-section {
        display: flex;
        flex-direction: column;
        gap: 10px;
    }
    .section-header {
        display: flex;
        align-items: center;
        gap: 10px;
    }
    .section-header::after {
        content: '';
        flex: 1;
        height: 1px;
        background: currentColor;
        opacity: 0.12;
        min-width: 2rem;
        margin-left: 0.5rem;
    }
    .section-title {
        font-size: 1.1rem;
        font-weight: 700;
        white-space: nowrap;
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
