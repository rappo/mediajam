<script>
    import { invalidateAll, goto } from "$app/navigation";
    import ExternalLinks from "$lib/components/ExternalLinks.svelte";
    import ArrAddDialog from "$lib/components/ArrAddDialog.svelte";
    import HeartBorder from "$lib/components/HeartBorder.svelte";
    import MediaDetailHeader from "$lib/components/MediaDetailHeader.svelte";
    import InteractiveSearchDialog from "$lib/components/InteractiveSearchDialog.svelte";
    import RemotePlayButton from "$lib/components/RemotePlayButton.svelte";
    import { page } from "$app/stores";
    let { data } = $props();
    let expandedAlbum = $state(null);
    let albumTracks = $state({});
    let loadingTracks = $state(null);
    /** @type {'list' | 'grid'} */
    let viewMode = $state("grid");
    let showHiddenAlbums = $state(false);
    let hiddenCount = $derived(data.albums.filter((/** @type {any} */ a) => a.is_hidden).length);
    let visibleAlbums = $derived(
        showHiddenAlbums ? data.albums : data.albums.filter((/** @type {any} */ a) => !a.is_hidden)
    );

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
        return d.toLocaleDateString();
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
                body: JSON.stringify({
                    jellyfinId: data.artist.jellyfin_id || undefined,
                    mediaParentId: data.artist.id,
                    musicbrainzId: data.artist.musicbrainz_id || undefined,
                }),
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
    let showAllMembers = $state(false);
    let showAllCrew = $state(false);
    let syncingMembers = $state(false);
    let memberSyncResult = $state('');

    async function syncMembers() {
        syncingMembers = true;
        memberSyncResult = '';
        try {
            const res = await fetch(`/api/music/${data.artist.id}/sync-members`, { method: 'POST' });
            const result = await res.json();
            if (result.success) {
                memberSyncResult = `✅ Synced ${result.members} members`;
                // Reload the page to show new member data
                setTimeout(() => window.location.reload(), 1500);
            } else {
                memberSyncResult = `❌ ${result.error || 'Unknown error'}`;
            }
        } catch (e) {
            memberSyncResult = `❌ ${e instanceof Error ? e.message : 'Network error'}`;
        }
        syncingMembers = false;
    }

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

    // ── Discovery Lidarr download state ──
    /** @type {any} */
    let discDownloadItem = $state(null);
    let discDownloading = $state(/** @type {string|null} */ (null));
    let discDownloaded = $state(/** @type {Set<string>} */ (new Set()));
    let discDownloadError = $state("");

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

    /** @param {any} item */
    function promptDownload(item) {
        discDownloadItem = item;
    }

    async function confirmDownload() {
        if (!discDownloadItem) return;
        const item = discDownloadItem;
        discDownloadItem = null;
        discDownloading = item.mbid;
        discDownloadError = "";
        try {
            const res = await fetch('/api/arr/lidarr/search-album', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    mediaParentId: data.artist.id,
                    mbid: item.mbid,
                    title: item.title,
                }),
            });
            if (!res.ok) {
                const r = await res.json();
                throw new Error(r.error || 'Failed');
            }
            const next = new Set(discDownloaded);
            next.add(item.mbid);
            discDownloaded = next;
        } catch (e) {
            discDownloadError = e instanceof Error ? e.message : 'Download failed';
            setTimeout(() => (discDownloadError = ''), 5000);
        }
        discDownloading = null;
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

    /** @param {number} albumId @param {string} albumTitle */
    async function deleteAlbum(albumId, albumTitle) {
        if (!confirm(`Delete "${albumTitle}"? This cannot be undone.`)) return;
        try {
            const res = await fetch(`/api/media/child/${albumId}`, { method: 'DELETE' });
            if (res.ok) location.reload();
            else alert(`Failed: ${(await res.json()).error}`);
        } catch (e) { alert(`Error: ${e}`); }
    }

    /** @param {number} albumId @param {string} albumTitle */
    async function mergeAlbum(albumId, albumTitle) {
        const siblings = data.albums.filter((/** @type {any} */ a) => a.id !== albumId && a.jellyfin_id);
        if (siblings.length === 0) { alert('No Jellyfin-linked albums to merge into.'); return; }
        const options = siblings.map((/** @type {any} */ a, /** @type {number} */ i) => `${i + 1}. ${a.title} (${a.release_year || '?'})`).join('\n');
        const choice = prompt(`Merge "${albumTitle}" into which album?\n\n${options}\n\nEnter number:`);
        if (!choice) return;
        const idx = parseInt(choice) - 1;
        if (isNaN(idx) || idx < 0 || idx >= siblings.length) { alert('Invalid choice'); return; }
        const target = siblings[idx];
        if (!confirm(`Merge "${albumTitle}" into "${target.title}"? History & tracks will be moved.`)) return;
        try {
            const res = await fetch(`/api/media/child/${albumId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ mergeInto: target.id })
            });
            if (res.ok) location.reload();
            else alert(`Failed: ${(await res.json()).error}`);
        } catch (e) { alert(`Error: ${e}`); }
    }
</script>

<svelte:head>
    <title>{data.artist.title} — Mediajam</title>
</svelte:head>

<div class="space-y-6 max-w-6xl mx-auto">
        <!-- ═══ ARTIST HEADER ═══ -->
        <MediaDetailHeader
            mediaType="artist"
            backHref="/music"
            backLabel="Artists"
            title={data.artist.title}
            posterUrl={data.artist.imageUrl}
            backdropUrl={data.artist.backdropUrl}
            isFavorite={!!data.artist.is_favorite}
            favoriteType="media"
            favoriteId={data.artist.id}
            heartBorderEnabled={!!data.settings?.heartBorderMusic}
            stats={[
                { label: 'albums', value: data.albums.length },
                { label: data.artist.total_plays === 1 ? 'play' : 'plays', value: data.artist.total_plays },
                ...(data.artist.collection_pct !== null ? [{ label: 'collected', value: `${data.artist.collection_pct}%` }] : []),
            ]}
            externalLinks={{
                musicbrainz_id: data.artist.musicbrainz_id,
                jellyfin_id: data.artist.jellyfin_id,
                jellyfin_url: data.jellyfinUrl,
                arr_slug: data.artist.arr_slug,
                arr_url: data.arrUrl,
                arr_service: data.arrService,
                wikipedia_url: data.artist.wikipedia_url,
                mediaType: 'artist'
            }}
            extraBadges={[
                ...(!data.artist.jellyfin_id ? [{ label: '📡 External', cls: 'badge-warning' }] : []),
            ]}
        >
            {#snippet actions()}
                <button
                    class="btn btn-xs btn-ghost gap-1"
                    class:btn-success={syncStatus === 'success'}
                    class:btn-error={syncStatus === 'failed'}
                    disabled={syncing}
                    onclick={fullSync}
                >
                    {#if syncing}
                        <span class="loading loading-spinner loading-xs"></span> Syncing…
                    {:else if syncStatus === 'success'}
                        ✅ Synced
                    {:else if syncStatus === 'failed'}
                        ❌ Failed
                    {:else}
                        🔄 Full Sync
                    {/if}
                </button>
                {#if data.artist.lidarr_id}
                    <InteractiveSearchDialog
                        service="lidarr"
                        mediaParentId={data.artist.id}
                        title="{data.artist.title}"
                    />
                    <button
                        class="btn btn-xs btn-ghost gap-1"
                        onclick={toggleMonitorLidarr}
                        disabled={arrLoading === 'monitor'}
                    >
                        {#if arrLoading === 'monitor'}<span class="loading loading-spinner loading-xs"></span>{/if}
                        {arrMonitored ? 'Unmonitor' : 'Monitor'}
                    </button>
                {:else if data.artist.musicbrainz_id}
                    <ArrAddDialog
                        service="lidarr"
                        mediaParentId={data.artist.id}
                        onComplete={onArrAdded}
                    />
                {/if}
                {#if data.artist.jellyfin_id}
                    <RemotePlayButton
                        jellyfinId={data.artist.jellyfin_id}
                        enabled={$page.data.remoteControlEnabled}
                        savedPlayers={$page.data.userPreferences?.savedPlayers || []}
                        defaultPlayerId={$page.data.userPreferences?.defaultPlayerId || ''}
                    />
                {/if}

            {/snippet}
        </MediaDetailHeader>

    <!-- Albums -->
    <div class="space-y-3">
        <div class="flex items-center justify-between">
            <h2 class="text-xl font-bold flex items-center gap-2">
                Discography
                {#if hiddenCount > 0}
                    <button
                        class="btn btn-xs btn-ghost gap-1 text-base-content/50"
                        onclick={() => showHiddenAlbums = !showHiddenAlbums}
                        title="{showHiddenAlbums ? 'Hide' : 'Show'} {hiddenCount} hidden album{hiddenCount === 1 ? '' : 's'}"
                    >
                        🙈 {hiddenCount} hidden
                        <input type="checkbox" class="toggle toggle-xs" checked={showHiddenAlbums} />
                    </button>
                {/if}
            </h2>
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
            {#if !data.artist.jellyfin_id && data.artist.collection_status === 'wanted'}
                <div class="alert alert-info bg-info/10 border-info/20 text-sm py-6 text-center">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 shrink-0 opacity-60" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                    <div>
                        <p class="font-semibold">No local files</p>
                        <p class="opacity-60">This artist is monitored in Lidarr but no music has been downloaded yet.</p>
                    </div>
                </div>
            {:else}
                <p class="text-base-content/40 text-sm py-8 text-center">
                    No albums found for this artist.
                </p>
            {/if}
        {:else if viewMode === "grid"}
            <div class="album-grid">
                {#each visibleAlbums as album}
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
                        {#if !album.jellyfin_id}
                            <div class="absolute top-1 right-1 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                <button
                                    class="btn btn-xs btn-circle btn-ghost bg-base-300/80"
                                    title="Merge into another album"
                                    onclick={(e) => { e.preventDefault(); e.stopPropagation(); mergeAlbum(album.id, album.title); }}
                                >🔀</button>
                                <button
                                    class="btn btn-xs btn-circle btn-ghost bg-base-300/80"
                                    title="Delete this album"
                                    onclick={(e) => { e.preventDefault(); e.stopPropagation(); deleteAlbum(album.id, album.title); }}
                                >🗑</button>
                            </div>
                        {/if}
                    </a>
                {/each}
            </div>
        {:else}
            <div class="space-y-3">
                {#each visibleAlbums as album}
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
                            {#if !album.jellyfin_id}
                                <div class="flex items-center gap-1 shrink-0">
                                    <button
                                        class="btn btn-xs btn-ghost"
                                        title="Merge into another album"
                                        onclick={(e) => { e.preventDefault(); e.stopPropagation(); mergeAlbum(album.id, album.title); }}
                                    >🔀</button>
                                    <button
                                        class="btn btn-xs btn-ghost"
                                        title="Delete this album"
                                        onclick={(e) => { e.preventDefault(); e.stopPropagation(); deleteAlbum(album.id, album.title); }}
                                    >🗑</button>
                                </div>
                            {/if}
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

    <!-- Listening History -->
    {#if data.listeningHistory && data.listeningHistory.length > 0}
        <div class="space-y-3">
            <h2 class="text-xl font-bold">🎧 Listening History</h2>
            <div class="listening-history">
                {#each data.listeningHistory as entry}
                    <a
                        href="/music/{data.artist.id}/{entry.album_id}"
                        class="history-entry"
                    >
                        <div class="history-art">
                            {#if entry.album_art}
                                <img src={entry.album_art} alt="" loading="lazy" />
                            {:else}
                                <div class="history-art-fallback">🎵</div>
                            {/if}
                        </div>
                        <div class="history-info">
                            <span class="history-track">{entry.track_name || 'Unknown Track'}</span>
                            <span class="history-album">{entry.album_title}</span>
                        </div>
                        <span class="history-time">{timeAgo(entry.timestamp)}</span>
                    </a>
                {/each}
            </div>
        </div>
    {/if}

    <!-- Band Members & Credits -->
    {#if data.members.length > 0 || data.crew.length > 0 || data.artist.musicbrainz_id}
        {@const MEMBER_LIMIT = 16}
        {@const CREW_LIMIT = 16}
        <div class="card bg-base-200/50 border border-base-300">
            <div class="card-body">
                <div class="flex items-center justify-between">
                    <h2 class="card-title text-lg">🎸 Members & Credits</h2>
                    {#if data.artist.musicbrainz_id}
                        <button
                            class="btn btn-ghost btn-xs gap-1"
                            onclick={syncMembers}
                            disabled={syncingMembers}
                            title="Sync band members from MusicBrainz"
                        >
                            {#if syncingMembers}
                                <span class="loading loading-spinner loading-xs"></span> Syncing…
                            {:else}
                                🔄 Sync Members
                            {/if}
                        </button>
                    {/if}
                </div>
                {#if memberSyncResult}
                    <div class="text-xs mt-1 {memberSyncResult.startsWith('✅') ? 'text-success' : 'text-error'}">
                        {memberSyncResult}
                    </div>
                {/if}

                {#if data.members.length === 0 && data.crew.length === 0}
                    <p class="text-sm text-base-content/40 mt-2">No member data yet. Click "Sync Members" to fetch from MusicBrainz.</p>
                {/if}

                {#if data.members.length > 0}
                    <h3 class="text-sm font-semibold text-base-content/60 mt-2">Members</h3>
                    <div class="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-3">
                        {#each (showAllMembers ? data.members : data.members.slice(0, MEMBER_LIMIT)) as person}
                            <a
                                href="/people/{person.id}"
                                class="flex flex-col items-center gap-1 group"
                            >
                                {#if person.photo_url}
                                    <img
                                        src={person.photo_url}
                                        alt={person.name}
                                        class="w-20 h-20 rounded-full object-cover border-2 border-base-300 group-hover:border-primary transition-colors"
                                    />
                                {:else}
                                    <div
                                        class="w-20 h-20 rounded-full bg-base-300 flex items-center justify-center text-2xl"
                                    >
                                        👤
                                    </div>
                                {/if}
                                <span
                                    class="text-xs font-medium text-center leading-tight truncate w-full group-hover:text-primary transition-colors"
                                    >{person.name}</span
                                >
                                {#if person.character_name}
                                    <span
                                        class="text-[10px] text-base-content/40 text-center leading-tight truncate w-full"
                                        >{person.character_name}</span
                                    >
                                {/if}
                            </a>
                        {/each}
                    </div>
                    {#if data.members.length > MEMBER_LIMIT}
                        <button
                            class="text-xs text-primary/70 hover:text-primary mt-1 self-start"
                            onclick={() => showAllMembers = !showAllMembers}
                        >
                            {showAllMembers ? '← Show less' : `Show all ${data.members.length} →`}
                        </button>
                    {/if}
                {/if}

                {#if data.crew.length > 0}
                    <h3 class="text-sm font-semibold text-base-content/60 mt-3">Credits</h3>
                    <div class="flex flex-wrap gap-2 mt-1">
                        {#each (showAllCrew ? data.crew : data.crew.slice(0, CREW_LIMIT)) as person}
                            <a
                                href="/people/{person.id}"
                                class="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-base-300/50 hover:bg-base-300 transition-colors text-sm group"
                            >
                                {#if person.photo_url}
                                    <img
                                        src={person.photo_url}
                                        alt={person.name}
                                        class="w-6 h-6 rounded-full object-cover"
                                    />
                                {:else}
                                    <div
                                        class="w-6 h-6 rounded-full bg-base-300 flex items-center justify-center text-xs"
                                    >
                                        👤
                                    </div>
                                {/if}
                                <span
                                    class="group-hover:text-primary transition-colors"
                                    >{person.name}</span
                                >
                                <span
                                    class="badge badge-ghost badge-xs capitalize"
                                    >{person.role_type}</span
                                >
                            </a>
                        {/each}
                    </div>
                    {#if data.crew.length > CREW_LIMIT}
                        <button
                            class="text-xs text-primary/70 hover:text-primary mt-1 self-start"
                            onclick={() => showAllCrew = !showAllCrew}
                        >
                            {showAllCrew ? '← Show less' : `Show all ${data.crew.length} →`}
                        </button>
                    {/if}
                {/if}
            </div>
        </div>
    {/if}
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
                            {#if data.artist.lidarr_id}
                                <button
                                    class="absolute top-1 right-1 btn btn-xs btn-circle {discDownloaded.has(item.mbid) ? 'btn-success' : 'btn-ghost bg-base-300/80'} {discDownloading === item.mbid ? '' : 'opacity-0 group-hover:opacity-100'} transition-opacity z-10"
                                    title="Download via Lidarr"
                                    disabled={discDownloading === item.mbid || discDownloaded.has(item.mbid)}
                                    onclick={(e) => { e.stopPropagation(); promptDownload(item); }}
                                >
                                    {#if discDownloading === item.mbid}
                                        <span class="loading loading-spinner loading-xs"></span>
                                    {:else if discDownloaded.has(item.mbid)}
                                        ✅
                                    {:else}
                                        ⬇️
                                    {/if}
                                </button>
                            {/if}
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
            {#if discDownloadError}
                <div class="alert alert-error text-sm mt-2">{discDownloadError}</div>
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

<!-- Lidarr Download Confirmation Dialog -->
{#if discDownloadItem}
    <div class="modal modal-open">
        <div class="modal-box">
            <h3 class="font-bold text-lg">Download via Lidarr</h3>
            <div class="flex items-center gap-4 mt-4">
                <img
                    src={discDownloadItem.cover_url}
                    alt={discDownloadItem.title}
                    class="w-20 h-20 rounded-lg object-cover shadow"
                    onerror={(e) => { e.target.style.display = 'none'; }}
                />
                <div>
                    <p class="font-semibold text-lg">{discDownloadItem.title}</p>
                    <p class="text-sm text-base-content/60">
                        {data.artist.title}
                        {#if discDownloadItem.release_year} · {discDownloadItem.release_year}{/if}
                        {#if discDownloadItem.type !== 'Album'}
                            <span class="badge badge-xs badge-outline ml-1">{discDownloadItem.type}</span>
                        {/if}
                    </p>
                </div>
            </div>
            <p class="text-sm text-base-content/50 mt-3">This will monitor the album in Lidarr and trigger a search for downloads.</p>
            <div class="modal-action">
                <button class="btn" onclick={() => (discDownloadItem = null)}>Cancel</button>
                <button class="btn btn-primary gap-1" onclick={confirmDownload}>
                    <img src="https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/lidarr.svg" alt="" class="w-4 h-4" />
                    Search & Download
                </button>
            </div>
        </div>
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div class="modal-backdrop" onclick={() => (discDownloadItem = null)}></div>
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

    /* ── Listening History ── */
    .listening-history {
        display: flex;
        flex-direction: column;
        gap: 2px;
        max-height: 500px;
        overflow-y: auto;
        border-radius: 12px;
        background: oklch(0.18 0.005 260);
        border: 1px solid oklch(0.25 0.005 260);
    }

    .history-entry {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 8px 12px;
        text-decoration: none;
        color: oklch(var(--bc) / 0.85);
        transition: background 0.12s;
    }
    .history-entry:hover {
        background: oklch(0.22 0.01 260);
    }
    .history-entry:not(:last-child) {
        border-bottom: 1px solid oklch(0.22 0.003 260);
    }

    .history-art {
        flex-shrink: 0;
        width: 36px;
        height: 36px;
        border-radius: 6px;
        overflow: hidden;
        background: oklch(0.15 0 0);
    }
    .history-art img {
        width: 100%;
        height: 100%;
        object-fit: cover;
    }
    .history-art-fallback {
        width: 100%;
        height: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 0.75rem;
        color: oklch(var(--bc) / 0.2);
    }

    .history-info {
        display: flex;
        flex-direction: column;
        gap: 1px;
        min-width: 0;
        flex: 1;
    }
    .history-track {
        font-size: 0.8rem;
        font-weight: 600;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .history-album {
        font-size: 0.65rem;
        color: oklch(var(--bc) / 0.4);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .history-time {
        flex-shrink: 0;
        font-size: 0.65rem;
        color: oklch(var(--bc) / 0.35);
        white-space: nowrap;
    }
</style>
