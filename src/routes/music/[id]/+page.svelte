<script>
    import { invalidateAll } from "$app/navigation";
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
                            class="flex items-center gap-4 p-3 rounded-xl border border-base-content/5 bg-base-200/30 hover:bg-base-200/60 transition-all"
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

<!-- TODO: Discovery — fetch full discography from MusicBrainz/Lidarr and show albums not in your library -->
<div class="container mx-auto px-6 py-8 opacity-30">
    <div class="card bg-base-200/30 border border-dashed border-base-300/50">
        <div class="card-body items-center text-center py-6">
            <div class="text-3xl mb-2">🔍</div>
            <h3 class="font-semibold text-base-content/50">Discover More</h3>
            <p class="text-sm text-base-content/30 max-w-md">
                Full discography discovery coming soon — browse albums from
                MusicBrainz that aren't in your library and add them to Lidarr.
            </p>
        </div>
    </div>
</div>

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
</style>
