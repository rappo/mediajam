<script>
    import { invalidateAll, goto } from "$app/navigation";
    import ExternalLinks from "$lib/components/ExternalLinks.svelte";
    import ArrAddDialog from "$lib/components/ArrAddDialog.svelte";
    import HeartBorder from "$lib/components/HeartBorder.svelte";
    let { data } = $props();
    let expandedAlbum = $state(null);
    let albumTracks = $state({});
    let loadingTracks = $state(null);
    /** @type {'list' | 'grid'} */
    let viewMode = $state("list");

    async function toggleAlbum(album) {
        if (expandedAlbum === album.id) {
            expandedAlbum = null;
            return;
        }
        expandedAlbum = album.id;
        if (albumTracks[album.id]) return; // Already loaded
        loadingTracks = album.id;
        try {
            const res = await fetch(`/api/tracks/${album.jellyfin_id}`);
            if (res.ok) {
                const tracks = await res.json();
                albumTracks = { ...albumTracks, [album.id]: tracks };
            }
        } catch (e) {
            console.error("Failed to load tracks:", e);
        }
        loadingTracks = null;
    }

    function formatRuntime(mins) {
        if (!mins) return "—";
        if (mins < 60) return `${mins}m`;
        const h = Math.floor(mins / 60);
        const m = mins % 60;
        return m > 0 ? `${h}h ${m}m` : `${h}h`;
    }

    let syncing = $state(false);
    let syncStatus = $state("");
    let syncError = $state("");

    // *arr state
    let arrLoading = $state("");
    let arrError = $state("");
    let arrMonitored = $state(!!data.artist.arr_monitored);

    async function onArrAdded() {
        await invalidateAll();
    }

    async function searchLidarr() {
        arrLoading = "search";
        arrError = "";
        try {
            const res = await fetch("/api/arr/lidarr/search", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ mediaParentId: data.artist.id }),
            });
            if (!res.ok) {
                const r = await res.json();
                throw new Error(r.error || "Failed");
            }
        } catch (e) {
            arrError = e instanceof Error ? e.message : "Failed";
            setTimeout(() => (arrError = ""), 5000);
        }
        arrLoading = "";
    }

    async function toggleMonitorLidarr() {
        const newState = !arrMonitored;
        arrLoading = "monitor";
        arrError = "";
        try {
            const res = await fetch("/api/arr/lidarr/monitor", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    mediaParentId: data.artist.id,
                    monitored: newState,
                }),
            });
            if (!res.ok) {
                const r = await res.json();
                throw new Error(r.error || "Failed");
            }
            arrMonitored = newState;
        } catch (e) {
            arrError = e instanceof Error ? e.message : "Failed";
            setTimeout(() => (arrError = ""), 5000);
        }
        arrLoading = "";
    }

    async function fullSync() {
        syncing = true;
        syncStatus = "";
        syncError = "";
        try {
            const res = await fetch("/api/sync/item", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ jellyfinId: data.artist.jellyfin_id }),
            });
            const result = await res.json();
            if (result.success) {
                syncStatus = "success";
                await invalidateAll();
            } else {
                syncStatus = "failed";
                syncError = result.error || `HTTP ${res.status}`;
                console.error("[sync]", syncError);
            }
            setTimeout(() => {
                syncStatus = "";
                syncError = "";
            }, 5000);
        } catch (e) {
            console.error("[sync] Error:", e);
            syncStatus = "failed";
            syncError = e instanceof Error ? e.message : "Network error";
            setTimeout(() => {
                syncStatus = "";
                syncError = "";
            }, 5000);
        }
        syncing = false;
    }

    let showDeleteConfirm = $state(false);
    let deleting = $state(false);

    async function deleteItem() {
        deleting = true;
        try {
            const res = await fetch(`/api/media/${data.artist.id}`, { method: 'DELETE' });
            const result = await res.json();
            if (result.success) {
                const params = new URLSearchParams({ deleted: result.title, undoToken: result.undoToken, undoId: String(data.artist.id) });
                goto(`/${result.route}?${params.toString()}`);
            } else {
                alert(result.error || 'Failed to delete');
            }
        } catch (e) {
            alert(e instanceof Error ? e.message : 'Network error');
        }
        deleting = false;
        showDeleteConfirm = false;
    }

    // ── Discovery state ──
    let discoveryLoading = $state(false);
    let discoveryLoaded = $state(false);
    let discoveryError = $state("");
    /** @type {any[]} */
    let discoveryItems = $state([]);
    let discoveryFilter = $state("Album");
    let discoveryLimit = $state(24);
    let showInLibrary = $state(false);
    /** @type {any[]} */
    let discoveryInLibrary = $state([]);
    /** @type {string|null} */
    let navigatingItem = $state(null);

    let filteredDiscovery = $derived(
        (discoveryFilter === "all"
            ? discoveryItems
            : discoveryItems.filter((i) => i.type === discoveryFilter)
        ),
    );

    async function loadDiscovery() {
        discoveryLoading = true;
        discoveryError = "";
        try {
            const res = await fetch(`/api/discover/artist/${data.artist.id}`);
            if (!res.ok) {
                const r = await res.json();
                throw new Error(r.error || "Failed");
            }
            const result = await res.json();
            discoveryItems = result.discography || [];
            discoveryInLibrary = result.inLibrary || [];
            discoveryLoaded = true;
        } catch (e) {
            discoveryError =
                e instanceof Error ? e.message : "Discovery failed";
        }
        discoveryLoading = false;
    }

    /** @param {any} item */
    async function openDiscoveryItem(item) {
        if (navigatingItem === item.mbid) return;
        navigatingItem = item.mbid;
        try {
            const res = await fetch("/api/discover/add-album", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    artistId: data.artist.id,
                    title: item.title,
                    release_year: item.release_year || null,
                    mbid: item.mbid,
                    cover_url: item.cover_url,
                }),
            });
            const result = await res.json();
            if (result.albumId) {
                goto(`/music/${data.artist.id}/${result.albumId}`);
            }
        } catch (e) {
            console.error("Failed to create album stub:", e);
        } finally {
            navigatingItem = null;
        }
    }

    // ── Lidarr add state ──
    /** @type {string|null} */
    let addingToArr = $state(null);
    let addedToArr = $state(/** @type {Set<string>} */ (new Set()));
    let addArrError = $state("");
    let showProfileDialog = $state(false);
    /** @type {any} */
    let pendingItem = $state(null);
    /** @type {any[]} */
    let availableProfiles = $state([]);
    /** @type {any[]} */
    let availableRootFolders = $state([]);
    let selectedProfileId = $state(/** @type {number|null} */ (null));
    let selectedRootFolder = $state(/** @type {string|null} */ (null));
    let profilesLoading = $state(false);

    async function addToLidarr() {
        if (!data.artist.musicbrainz_id) {
            addArrError = "Artist has no MusicBrainz ID — cannot add to Lidarr";
            setTimeout(() => (addArrError = ""), 5000);
            return;
        }
        // Fetch profiles
        profilesLoading = true;
        try {
            const res = await fetch("/api/arr/profiles");
            if (!res.ok) throw new Error("Failed to fetch profiles");
            const options = await res.json();
            const serviceOptions = options.lidarr;
            if (!serviceOptions) throw new Error("Lidarr not configured");
            availableProfiles = serviceOptions.profiles || [];
            availableRootFolders = serviceOptions.rootFolders || [];
            selectedProfileId = availableProfiles[0]?.id || null;
            selectedRootFolder = availableRootFolders[0]?.path || null;
            showProfileDialog = true;
        } catch (e) {
            addArrError = e instanceof Error ? e.message : "Failed";
            setTimeout(() => (addArrError = ""), 5000);
        }
        profilesLoading = false;
    }

    async function confirmAddToLidarr() {
        if (!selectedProfileId) return;
        showProfileDialog = false;
        addingToArr = 'lidarr';
        addArrError = "";
        try {
            const arrRes = await fetch(`/api/arr/lidarr/add`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    mediaParentId: data.artist.id,
                    qualityProfileId: selectedProfileId,
                    rootFolderPath: selectedRootFolder,
                }),
            });
            if (!arrRes.ok) {
                const r = await arrRes.json();
                throw new Error(r.error || "Failed to add to Lidarr");
            }
            const next = new Set(addedToArr);
            next.add('lidarr');
            addedToArr = next;
        } catch (e) {
            addArrError = e instanceof Error ? e.message : "Failed";
            setTimeout(() => (addArrError = ""), 5000);
        }
        addingToArr = null;
    }

    /** Count discovery items by type */
    function countByType(type) {
        return discoveryItems.filter((i) => i.type === type).length;
    }
</script>

<svelte:head>
    <title>{data.artist.title} — Mediajam</title>
</svelte:head>

<div class="space-y-6 max-w-6xl mx-auto">
    <!-- Back link -->
    <div class="flex items-center justify-between">
        <a href="/music" class="btn btn-ghost btn-sm gap-1">
            <svg
                xmlns="http://www.w3.org/2000/svg"
                class="h-4 w-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"><polyline points="15 18 9 12 15 6" /></svg
            >
            All Artists
        </a>
        {#if data.artist.jellyfin_id}
            <button
                class="btn btn-ghost btn-xs gap-1"
                class:btn-success={syncStatus === "success"}
                class:btn-error={syncStatus === "failed"}
                disabled={syncing}
                onclick={fullSync}
                title="Re-fetch all data from Jellyfin for this artist"
            >
                {#if syncing}
                    <span class="loading loading-spinner loading-xs"></span>
                    Syncing…
                {:else if syncStatus === "success"}
                    ✅ Synced
                {:else if syncStatus === "failed"}
                    ❌ {syncError || "Failed"}
                {:else}
                    🔄 Full Sync
                {/if}
            </button>
        {#if !data.artist.jellyfin_id}
        <button
            class="btn btn-ghost btn-xs gap-1 text-error/60 hover:text-error"
            onclick={() => (showDeleteConfirm = true)}
            title="Delete this artist"
        >
            🗑️
        </button>
        {/if}
        {/if}
    </div>

    <!-- Header -->
    <div class="flex gap-6 items-start">
        {#if data.artist.imageUrl}
            <HeartBorder
                show={!!data.artist.is_favorite &&
                    data.settings?.heartBorderMusic}
                class="rounded-xl"
            >
                <img
                    src={data.artist.imageUrl}
                    alt={data.artist.title}
                    class="w-40 h-40 rounded-xl shadow-lg shrink-0 object-cover"
                />
            </HeartBorder>
        {/if}
        <div class="space-y-3 min-w-0">
            <div>
                <h1 class="text-3xl font-bold">{data.artist.title}</h1>
                <ExternalLinks
                    musicbrainz_id={data.artist.musicbrainz_id}
                    jellyfin_id={data.artist.jellyfin_id}
                    jellyfin_url={data.jellyfinUrl}
                    arr_slug={data.artist.arr_slug}
                    arr_url={data.arrUrl}
                    arr_service={data.arrService}
                    wikipedia_url={data.artist.wikipedia_url}
                    mediaType="artist"
                    class="mt-1"
                />
            </div>
            <div class="flex flex-wrap gap-3">
                {#if !data.artist.jellyfin_id}
                    <div class="badge badge-lg badge-warning gap-1">
                        📡 External
                    </div>
                {/if}
                <div class="badge badge-lg badge-info gap-1">
                    💿 {data.albums.length} albums
                </div>
                <div class="badge badge-lg badge-secondary gap-1">
                    ▶️ {data.artist.total_plays} plays
                </div>
                <div class="badge badge-lg badge-accent gap-1">
                    ⏱️ {formatRuntime(data.totalRuntimeMinutes)}
                </div>
                {#if data.artist.collection_pct !== null}
                    <div class="badge badge-lg badge-primary gap-1">
                        📦 {data.artist.collection_pct}% collected
                    </div>
                {/if}
            </div>
        </div>
    </div>

    <!-- Lidarr Status -->
    <div class="card bg-base-200/50 border border-base-300">
        <div class="card-body py-4">
            <div class="flex items-center justify-between">
                <div class="flex items-center gap-2">
                    <span class="text-lg">🎵</span>
                    <span class="font-semibold text-sm">Lidarr</span>
                </div>
                {#if arrError}
                    <span class="text-xs text-error">{arrError}</span>
                {/if}
            </div>
            {#if data.artist.lidarr_id}
                <div class="flex flex-wrap items-center gap-2 mt-1">
                    {#if data.arrUrl && data.artist.arr_slug}
                        <a
                            href="{data.arrUrl}/artist/{data.artist.arr_slug}"
                            target="_blank"
                            rel="noopener"
                            class="badge badge-success badge-sm gap-1 hover:brightness-110 cursor-pointer"
                        >
                            ✅ In Lidarr ↗
                        </a>
                    {:else}
                        <span class="badge badge-success badge-sm gap-1"
                            >✅ In Lidarr</span
                        >
                    {/if}
                    {#if arrMonitored}
                        <span class="badge badge-info badge-sm"
                            >📡 Monitored</span
                        >
                    {:else}
                        <span class="badge badge-ghost badge-sm"
                            >Unmonitored</span
                        >
                    {/if}
                    {#if data.artist.arr_has_file}
                        <span class="badge badge-success badge-sm gap-1"
                            >📁 Has Files</span
                        >
                    {/if}
                    {#if data.artist.arr_quality_profile}
                        <span class="badge badge-ghost badge-sm"
                            >{data.artist.arr_quality_profile}</span
                        >
                    {/if}
                </div>
                <div class="flex gap-2 mt-2">
                    <button
                        class="btn btn-xs btn-outline gap-1"
                        onclick={searchLidarr}
                        disabled={arrLoading === "search"}
                    >
                        {#if arrLoading === "search"}<span
                                class="loading loading-spinner loading-xs"
                            ></span>{:else}🔍{/if} Search
                    </button>
                    <button
                        class="btn btn-xs btn-outline gap-1"
                        onclick={toggleMonitorLidarr}
                        disabled={arrLoading === "monitor"}
                    >
                        {#if arrLoading === "monitor"}<span
                                class="loading loading-spinner loading-xs"
                            ></span>{:else if arrMonitored}📡{:else}📴{/if}
                        {arrMonitored ? "Unmonitor" : "Monitor"}
                    </button>
                </div>
            {:else if data.artist.musicbrainz_id}
                <div class="flex items-center gap-2 mt-1">
                    <span class="text-xs text-base-content/50"
                        >Not in Lidarr</span
                    >
                    <ArrAddDialog
                        service="lidarr"
                        mediaParentId={data.artist.id}
                        onComplete={onArrAdded}
                    />
                </div>
            {:else}
                <p class="text-xs text-base-content/40 mt-1">
                    No MusicBrainz ID — cannot link to Lidarr
                </p>
            {/if}
        </div>
    </div>

    <!-- Albums -->
    <div class="space-y-3">
        <div class="flex items-center justify-between">
            <h2 class="text-xl font-bold">Discography</h2>
            <div class="join">
                <button
                    class="join-item btn btn-xs"
                    class:btn-active={viewMode === "list"}
                    onclick={() => (viewMode = "list")}
                    title="List view"
                >
                    <svg
                        xmlns="http://www.w3.org/2000/svg"
                        class="h-3.5 w-3.5"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                        ><line x1="8" y1="6" x2="21" y2="6" /><line
                            x1="8"
                            y1="12"
                            x2="21"
                            y2="12"
                        /><line x1="8" y1="18" x2="21" y2="18" /><line
                            x1="3"
                            y1="6"
                            x2="3.01"
                            y2="6"
                        /><line x1="3" y1="12" x2="3.01" y2="12" /><line
                            x1="3"
                            y1="18"
                            x2="3.01"
                            y2="18"
                        /></svg
                    >
                </button>
                <button
                    class="join-item btn btn-xs"
                    class:btn-active={viewMode === "grid"}
                    onclick={() => (viewMode = "grid")}
                    title="Grid view"
                >
                    <svg
                        xmlns="http://www.w3.org/2000/svg"
                        class="h-3.5 w-3.5"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                        ><rect x="3" y="3" width="7" height="7" /><rect
                            x="14"
                            y="3"
                            width="7"
                            height="7"
                        /><rect x="3" y="14" width="7" height="7" /><rect
                            x="14"
                            y="14"
                            width="7"
                            height="7"
                        /></svg
                    >
                </button>
            </div>
        </div>

        {#if data.albums.length === 0}
            <p class="text-base-content/40 text-sm py-8 text-center">
                No albums found for this artist.
            </p>
        {:else if viewMode === "grid"}
            <div class="album-grid">
                {#each data.albums as album}
                    <a
                        href="/music/{data.artist.id}/{album.id}"
                        class="album-tile group"
                        class:album-tile--not-collected={!album.jellyfin_id && !album.is_collected}
                    >
                        {#if album.artUrl}
                            <img
                                src={album.artUrl}
                                alt={album.title}
                                class="album-tile-img"
                            />
                        {:else}
                            <div class="album-tile-placeholder">
                                <span class="text-4xl opacity-20">💿</span>
                            </div>
                        {/if}
                        <div class="album-tile-overlay">
                            <p
                                class="font-semibold text-sm leading-tight line-clamp-2"
                            >
                                {album.title}
                            </p>
                            <p class="text-xs opacity-70 mt-0.5">
                                {album.release_year || ""}
                                {#if album.play_count > 0}
                                    · {album.play_count} plays
                                {/if}
                            </p>
                        </div>
                    </a>
                {/each}
            </div>
        {:else}
            <div class="space-y-3">
                {#each data.albums as album}
                    <!-- Album Card -->
                    <a href="/music/{data.artist.id}/{album.id}" class="block">
                        <div
                            class="flex items-center gap-4 p-3 rounded-xl border bg-base-200/30 hover:bg-base-200/60 transition-all"
                            style={!album.jellyfin_id && !album.is_collected
                                ? 'border-color: oklch(var(--wa) / 0.5); border-style: dashed;'
                                : 'border-color: oklch(var(--bc) / 0.05);'}
                        >
                            {#if album.artUrl}
                                <img
                                    src={album.artUrl}
                                    alt={album.title}
                                    class="w-16 h-16 rounded-lg shadow-md shrink-0 object-cover"
                                />
                            {:else}
                                <div
                                    class="w-16 h-16 rounded-lg bg-base-300 flex items-center justify-center shrink-0"
                                >
                                    <span class="text-2xl opacity-30">💿</span>
                                </div>
                            {/if}
                            <div class="flex-1 min-w-0">
                                <p class="font-semibold truncate">
                                    {album.title}
                                </p>
                                <p class="text-xs text-base-content/50">
                                    {album.release_year || "Unknown year"}
                                    · {formatRuntime(album.runtimeMinutes)}
                                </p>
                            </div>
                            <div class="flex items-center gap-3 shrink-0">
                                {#if album.play_count > 0}
                                    <span class="badge badge-sm badge-accent"
                                        >{album.play_count} plays</span
                                    >
                                {/if}
                                <svg
                                    xmlns="http://www.w3.org/2000/svg"
                                    class="h-4 w-4 text-base-content/30"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    stroke-width="2"
                                    ><polyline points="9 18 15 12 9 6" /></svg
                                >
                            </div>
                        </div>
                    </a>

                    <!-- Expanded Track List -->
                    {#if expandedAlbum === album.id}
                        <div
                            class="ml-20 border-l-2 border-primary/20 pl-4 pb-2 animate-fade-in"
                        >
                            {#if loadingTracks === album.id}
                                <p class="text-sm text-base-content/40 py-3">
                                    <span
                                        class="loading loading-spinner loading-xs"
                                    ></span>
                                    Loading tracks...
                                </p>
                            {:else if albumTracks[album.id] && albumTracks[album.id].length > 0}
                                <table class="table table-xs">
                                    <thead>
                                        <tr
                                            class="text-xs text-base-content/40"
                                        >
                                            <th class="w-8">#</th>
                                            <th>Track</th>
                                            <th class="w-16 text-right"
                                                >Duration</th
                                            >
                                            <th class="w-16 text-center"
                                                >Plays</th
                                            >
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {#each albumTracks[album.id] as track}
                                            <tr class="hover:bg-base-300/10">
                                                <td class="text-base-content/40"
                                                    >{track.IndexNumber ||
                                                        "—"}</td
                                                >
                                                <td class="text-sm"
                                                    >{track.Name}</td
                                                >
                                                <td
                                                    class="text-right text-xs text-base-content/40"
                                                >
                                                    {track.RunTimeTicks
                                                        ? `${Math.floor(track.RunTimeTicks / 600000000)}:${String(Math.floor((track.RunTimeTicks % 600000000) / 10000000)).padStart(2, "0")}`
                                                        : "—"}
                                                </td>
                                                <td class="text-center">
                                                    {#if track.UserData?.PlayCount > 0}
                                                        <span
                                                            class="badge badge-xs badge-accent"
                                                            >{track.UserData
                                                                .PlayCount}</span
                                                        >
                                                    {:else}
                                                        <span
                                                            class="text-base-content/20"
                                                            >—</span
                                                        >
                                                    {/if}
                                                </td>
                                            </tr>
                                        {/each}
                                    </tbody>
                                </table>
                            {:else if albumTracks[album.id]}
                                <p class="text-sm text-base-content/40 py-2">
                                    No tracks found.
                                </p>
                            {/if}
                        </div>
                    {/if}
                {/each}
            </div>
        {/if}
    </div>
</div>

<!-- Discovery: Full Discography from MusicBrainz -->
<div class="max-w-6xl mx-auto space-y-4 mt-6">
    {#if !discoveryLoaded && !discoveryLoading}
        <button
            class="btn btn-outline btn-sm gap-2 w-full"
            onclick={loadDiscovery}
        >
            🔍 Discover Full Discography
        </button>
    {:else if discoveryLoading}
        <div class="flex items-center justify-center gap-2 py-8">
            <span class="loading loading-spinner loading-md"></span>
            <span class="text-base-content/50">Fetching discography from MusicBrainz…</span>
        </div>
    {:else if discoveryError}
        <div class="alert alert-error text-sm">{discoveryError}</div>
    {:else}
        <div class="space-y-4">
            <div class="flex flex-wrap items-center justify-between gap-2">
                <h2 class="text-xl font-bold flex items-center gap-2">
                    🔍 Discography Discovery
                    <span class="badge badge-sm badge-ghost">{filteredDiscovery.length} not in library</span>
                </h2>
                <div class="flex items-center gap-2">
                    <div class="join">
                        <button
                            class="join-item btn btn-xs"
                            class:btn-active={discoveryFilter === "all"}
                            onclick={() => (discoveryFilter = "all")}>All</button
                        >
                        <button
                            class="join-item btn btn-xs"
                            class:btn-active={discoveryFilter === "Album"}
                            onclick={() => (discoveryFilter = "Album")}>Albums{#if countByType('Album') > 0}<span class="ml-1 opacity-50">{countByType('Album')}</span>{/if}</button
                        >
                        <button
                            class="join-item btn btn-xs"
                            class:btn-active={discoveryFilter === "EP"}
                            onclick={() => (discoveryFilter = "EP")}>EPs{#if countByType('EP') > 0}<span class="ml-1 opacity-50">{countByType('EP')}</span>{/if}</button
                        >
                        <button
                            class="join-item btn btn-xs"
                            class:btn-active={discoveryFilter === "Single"}
                            onclick={() => (discoveryFilter = "Single")}>Singles{#if countByType('Single') > 0}<span class="ml-1 opacity-50">{countByType('Single')}</span>{/if}</button
                        >
                    </div>
                    {#if discoveryInLibrary.length > 0}
                        <label class="label cursor-pointer gap-1.5">
                            <span class="text-xs text-base-content/50">Show owned</span>
                            <input type="checkbox" class="toggle toggle-xs" bind:checked={showInLibrary} />
                        </label>
                    {/if}
                    {#if !data.artist.lidarr_id}
                        <button
                            class="btn btn-xs btn-primary gap-1"
                            disabled={addingToArr === 'lidarr' || addedToArr.has('lidarr')}
                            onclick={addToLidarr}
                        >
                            {#if addingToArr === 'lidarr'}
                                <span class="loading loading-spinner loading-xs"></span>
                            {:else if addedToArr.has('lidarr')}
                                ✅ Added
                            {:else}
                                ➕ Lidarr
                            {/if}
                        </button>
                    {/if}
                </div>
            </div>

            {#if filteredDiscovery.length === 0 && !showInLibrary}
                <div class="card bg-base-200/30 border border-base-300/50">
                    <div class="card-body items-center text-center py-8">
                        <div class="text-3xl mb-2">🎉</div>
                        <p>You have all the {discoveryFilter === 'all' ? 'releases' : discoveryFilter.toLowerCase() + 's'}! Nothing to discover.</p>
                    </div>
                </div>
            {:else}
                <div class="discovery-grid">
                    {#each filteredDiscovery.slice(0, discoveryLimit) as item}
                        <!-- svelte-ignore a11y_click_events_have_key_events -->
                        <!-- svelte-ignore a11y_no_static_element_interactions -->
                        <div
                            class="discovery-tile group cursor-pointer"
                            onclick={() => openDiscoveryItem(item)}
                        >
                            {#if navigatingItem === item.mbid}
                                <div class="discovery-tile-img bg-base-300 flex items-center justify-center">
                                    <span class="loading loading-spinner loading-md text-primary"></span>
                                </div>
                            {:else}
                                <img
                                    src={item.cover_url}
                                    alt={item.title}
                                    class="discovery-tile-img"
                                    onerror={(e) => { e.target.style.display = 'none'; e.target.nextElementSibling.style.display = 'flex'; }}
                                />
                                <div class="discovery-tile-placeholder" style="display:none">
                                    <span class="text-3xl opacity-20">💿</span>
                                </div>
                            {/if}
                            <div class="discovery-tile-overlay">
                                <p class="font-semibold text-sm leading-tight line-clamp-2">{item.title}</p>
                                <p class="text-xs opacity-70 mt-0.5">
                                    {item.release_year || ''}
                                    {#if item.type !== 'Album'}
                                        <span class="badge badge-xs badge-outline ml-1">{item.type}</span>
                                    {/if}
                                </p>
                                {#if item.disambiguation}
                                    <p class="text-xs opacity-50 italic">{item.disambiguation}</p>
                                {/if}
                            </div>
                        </div>
                    {/each}

                    {#if showInLibrary}
                        {#each discoveryInLibrary.filter(i => discoveryFilter === 'all' || i.type === discoveryFilter) as item}
                            <a
                                href="/music/{data.artist.id}/{item.library_id}"
                                class="discovery-tile group opacity-60 ring-2 ring-success/30"
                            >
                                <img
                                    src={item.cover_url}
                                    alt={item.title}
                                    class="discovery-tile-img"
                                    onerror={(e) => { e.target.style.display = 'none'; e.target.nextElementSibling.style.display = 'flex'; }}
                                />
                                <div class="discovery-tile-placeholder" style="display:none">
                                    <span class="text-3xl opacity-20">💿</span>
                                </div>
                                <div class="discovery-tile-overlay">
                                    <div class="flex items-center gap-1">
                                        <span class="badge badge-xs badge-success">✓ Owned</span>
                                    </div>
                                    <p class="font-semibold text-sm leading-tight line-clamp-2">{item.title}</p>
                                    <p class="text-xs opacity-70 mt-0.5">{item.release_year || ''}</p>
                                </div>
                            </a>
                        {/each}
                    {/if}
                </div>

                {#if filteredDiscovery.length > discoveryLimit}
                    <div class="text-center">
                        <button
                            class="btn btn-ghost btn-sm"
                            onclick={() => (discoveryLimit += 24)}
                        >
                            Show more ({filteredDiscovery.length - discoveryLimit} remaining)
                        </button>
                    </div>
                {/if}
            {/if}

            {#if addArrError}
                <div class="alert alert-error text-sm mt-2">{addArrError}</div>
            {/if}
        </div>
    {/if}
</div>

<!-- Lidarr Quality Profile Dialog -->
{#if showProfileDialog}
    <div class="modal modal-open">
        <div class="modal-box">
            <h3 class="font-bold text-lg">Add to Lidarr</h3>
            <p class="text-sm text-base-content/60 mt-1">{data.artist.title}</p>
            <div class="space-y-3 mt-4">
                <div class="form-control">
                    <label class="label" for="quality-profile"><span class="label-text">Quality Profile</span></label>
                    <select id="quality-profile" class="select select-bordered" bind:value={selectedProfileId}>
                        {#each availableProfiles as profile}
                            <option value={profile.id}>{profile.name}</option>
                        {/each}
                    </select>
                </div>
                <div class="form-control">
                    <label class="label" for="root-folder"><span class="label-text">Root Folder</span></label>
                    <select id="root-folder" class="select select-bordered" bind:value={selectedRootFolder}>
                        {#each availableRootFolders as folder}
                            <option value={folder.path}>{folder.path}</option>
                        {/each}
                    </select>
                </div>
            </div>
            <div class="modal-action">
                <button class="btn" onclick={() => (showProfileDialog = false)}>Cancel</button>
                <button class="btn btn-primary" onclick={confirmAddToLidarr} disabled={!selectedProfileId}>
                    Add to Lidarr
                </button>
            </div>
        </div>
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div class="modal-backdrop" onclick={() => (showProfileDialog = false)}></div>
    </div>
{/if}

<!-- Delete Confirmation Modal -->
{#if showDeleteConfirm}
    <div class="modal modal-open">
        <div class="modal-box">
            <h3 class="font-bold text-lg">Delete "{data.artist.title}"?</h3>
            <p class="py-4 text-base-content/70">
                This will remove this artist and all its albums, play history, and ratings.
                {#if data.artist.jellyfin_id}
                    <br /><span class="text-warning text-sm">⚠️ This item is in Jellyfin and will reappear on the next sync.</span>
                {/if}
            </p>
            <div class="modal-action">
                <button class="btn" onclick={() => (showDeleteConfirm = false)}>Cancel</button>
                <button class="btn btn-error" onclick={deleteItem} disabled={deleting}>
                    {#if deleting}
                        <span class="loading loading-spinner loading-xs"></span>
                    {/if}
                    Delete
                </button>
            </div>
        </div>
        <div class="modal-backdrop" onclick={() => (showDeleteConfirm = false)}></div>
    </div>
{/if}

<style>
    .animate-fade-in {
        animation: fadeIn 0.2s ease-out;
    }
    @keyframes fadeIn {
        from {
            opacity: 0;
            transform: translateY(-4px);
        }
        to {
            opacity: 1;
            transform: translateY(0);
        }
    }
    .album-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
        gap: 1rem;
    }
    .album-tile {
        position: relative;
        border-radius: 0.75rem;
        overflow: hidden;
        aspect-ratio: 1;
        display: block;
        transition:
            transform 0.15s,
            box-shadow 0.15s;
    }
    .album-tile--not-collected {
        outline: 2px dashed oklch(var(--wa) / 0.5);
        outline-offset: -2px;
    }
    .album-tile:hover {
        transform: scale(1.03);
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
    }
    .album-tile-img {
        width: 100%;
        height: 100%;
        object-fit: cover;
    }
    .album-tile-placeholder {
        width: 100%;
        height: 100%;
        background: oklch(var(--b3));
        display: flex;
        align-items: center;
        justify-content: center;
    }
    .album-tile-overlay {
        position: absolute;
        bottom: 0;
        left: 0;
        right: 0;
        padding: 0.5rem 0.6rem;
        background: linear-gradient(
            to top,
            rgba(0, 0, 0, 0.85) 0%,
            rgba(0, 0, 0, 0.4) 70%,
            transparent 100%
        );
        color: white;
    }

    /* Discovery grid */
    .discovery-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
        gap: 0.75rem;
    }
    .discovery-tile {
        position: relative;
        border-radius: 0.75rem;
        overflow: hidden;
        aspect-ratio: 1;
        display: block;
        background: oklch(var(--b3));
        transition:
            transform 0.15s,
            box-shadow 0.15s;
    }
    .discovery-tile:hover {
        transform: scale(1.03);
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
    }
    .discovery-tile-img {
        width: 100%;
        height: 100%;
        object-fit: cover;
    }
    .discovery-tile-placeholder {
        width: 100%;
        height: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        position: absolute;
        top: 0;
        left: 0;
    }
    .discovery-tile-overlay {
        position: absolute;
        bottom: 0;
        left: 0;
        right: 0;
        padding: 0.4rem 0.5rem;
        background: linear-gradient(
            to top,
            rgba(0, 0, 0, 0.85) 0%,
            rgba(0, 0, 0, 0.4) 70%,
            transparent 100%
        );
        color: white;
    }
</style>
