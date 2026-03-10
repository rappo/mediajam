<script>
    let { data } = $props();
    import { invalidateAll, goto } from "$app/navigation";
    import DataTable from "$lib/components/DataTable.svelte";
    import ExternalLinks from "$lib/components/ExternalLinks.svelte";
    import ArrAddDialog from "$lib/components/ArrAddDialog.svelte";
    import HeartBorder from "$lib/components/HeartBorder.svelte";
    import FavoriteButton from "$lib/components/FavoriteButton.svelte";
    import MediaDetailHeader from "$lib/components/MediaDetailHeader.svelte";
    import { imgUrl } from "$lib/utils.js";


    function statusColor(status) {
        if (status === "watched") return "var(--color-success, #22c55e)";
        if (status === "in_progress") return "var(--color-warning, #f59e0b)";
        return "var(--color-base-300, #2a2e37)";
    }

    function statusClass(status, isCollected, premiereDate) {
        // Upcoming: not collected and premiere date is in the future (or no premiere date but not aired)
        if (
            !isCollected &&
            premiereDate &&
            new Date(premiereDate) > new Date()
        ) {
            return "ep-upcoming";
        }
        let cls = "";
        if (status === "watched") cls = "ep-watched";
        else if (status === "in_progress") cls = "ep-progress";
        else cls = "ep-unwatched";
        if (!isCollected) cls += " ep-missing";
        return cls;
    }

    function formatRuntime(ticks) {
        if (!ticks) return "";
        const mins = Math.round(ticks / 600000000);
        return `${mins}m`;
    }

    let syncing = $state(false);
    let syncStatus = $state(""); // "", "success", "failed"
    let syncError = $state("");

    // *arr state
    let arrLoading = $state("");
    let arrError = $state("");
    let arrMonitored = $state(!!data.show.arr_monitored);

    /** @type {'map' | 'list' | 'ratings'} */
    let episodeView = $state('map');
    let showWatchStatus = $state(false);

    /**
     * Get watch-status border class for rating cells
     * @param {any} ep
     * @returns {string}
     */
    function watchBorderClass(ep) {
        if (!ep.is_collected) return 'border-2 border-dashed !border-error/70';
        if (ep.watch_status === 'watched') return 'border-2 !border-white/80';
        if (ep.watch_status === 'in_progress') return 'border-2 !border-amber-300';
        return '';
    }

    /**
     * Get rating color class based on score
     * @param {number|null} rating
     * @returns {string}
     */
    function ratingColor(rating) {
        if (rating === null || rating === undefined) return 'bg-base-300/30 text-base-content/20';
        if (rating >= 9) return 'bg-[#0d6e3f] text-white'; // Outstanding - deep emerald
        if (rating >= 8) return 'bg-[#2d9d5c] text-white'; // Excellent - emerald
        if (rating >= 7) return 'bg-[#8cc152] text-black'; // Solid - lime
        if (rating >= 6) return 'bg-[#c9a833] text-black'; // Fair - gold
        if (rating >= 4) return 'bg-[#d35430] text-white'; // Poor - burnt orange
        return 'bg-[#6b4226] text-white'; // Awful - poop brown
    }

    async function onArrAdded() {
        await invalidateAll();
    }

    async function searchSonarr() {
        arrLoading = "search";
        arrError = "";
        try {
            const res = await fetch("/api/arr/sonarr/search", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ mediaParentId: data.show.id }),
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

    async function toggleMonitorSonarr() {
        const newState = !arrMonitored;
        arrLoading = "monitor";
        arrError = "";
        try {
            const res = await fetch("/api/arr/sonarr/monitor", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    mediaParentId: data.show.id,
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
                body: JSON.stringify({ jellyfinId: data.show.jellyfin_id }),
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
            const res = await fetch(`/api/media/${data.show.id}`, { method: 'DELETE' });
            const result = await res.json();
            if (result.success) {
                const params = new URLSearchParams({ deleted: result.title, undoToken: result.undoToken, undoId: String(data.show.id) });
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
</script>

<svelte:head>
    <title>{data.show.title} — Mediajam</title>
</svelte:head>

<div class="space-y-6 max-w-6xl mx-auto">
        <!-- ═══ NEW LAYOUT (Option B) ═══ -->
        <MediaDetailHeader
            mediaType="show"
            backHref="/tv"
            backLabel="Shows"
            title={data.show.title}
            posterUrl={data.show.posterUrl || (data.show.poster_url ? imgUrl(data.show.poster_url) : null)}
            backdropUrl={data.show.backdropUrl}
            year={data.show.release_year}
            overview={data.show.overview}
            isFavorite={!!data.show.is_favorite}
            favoriteType="media"
            favoriteId={data.show.id}
            heartBorderEnabled={!!data.settings?.heartBorderShows}
            heroBadges={[
                { label: `${data.seasons.length} seasons` },
                { label: `${data.totalWatched}/${data.totalEpisodes} watched` },
                ...(data.show.collection_pct !== null ? [{ label: `${data.show.collection_pct}% collected` }] : []),
            ]}
            stats={[
                { label: (data.show.total_plays ?? 0) === 1 ? 'play' : 'total plays', value: data.show.total_plays ?? 0 },
                ...(data.totalMissing > 0 ? [{ label: 'missing', value: data.totalMissing }] : []),
                ...(data.totalUpcoming > 0 ? [{ label: 'upcoming', value: data.totalUpcoming }] : []),
            ]}
            externalLinks={{
                tmdb_id: data.show.tmdb_id,
                imdb_id: data.show.imdb_id,
                tvdb_id: data.show.tvdb_id,
                jellyfin_id: data.show.jellyfin_id,
                jellyfin_url: data.jellyfinUrl,
                arr_slug: data.show.arr_slug,
                arr_url: data.arrUrl,
                arr_service: data.arrService,
                trakt_slug: data.show.trakt_slug,
                wikipedia_url: data.show.wikipedia_url,
                mediaType: 'show'
            }}
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
                {#if data.show.sonarr_id}
                    <button
                        class="btn btn-xs btn-ghost gap-1"
                        onclick={searchSonarr}
                        disabled={arrLoading === 'search'}
                    >
                        {#if arrLoading === 'search'}<span class="loading loading-spinner loading-xs"></span>{:else}🔍{/if} Search
                    </button>
                    <button
                        class="btn btn-xs btn-ghost gap-1"
                        onclick={toggleMonitorSonarr}
                        disabled={arrLoading === 'monitor'}
                    >
                        {#if arrLoading === 'monitor'}<span class="loading loading-spinner loading-xs"></span>{/if}
                        {arrMonitored ? 'Unmonitor' : 'Monitor'}
                    </button>
                {:else if data.show.tvdb_id}
                    <ArrAddDialog
                        service="sonarr"
                        mediaParentId={data.show.id}
                        onComplete={onArrAdded}
                    />
                {/if}
            {/snippet}
        </MediaDetailHeader>

    <!-- Episode Grid / List -->
    <div class="space-y-2">
        <div class="flex items-center justify-between">
            <h2 class="text-xl font-bold">Episodes</h2>
            <div class="join">
                <button
                    class="join-item btn btn-xs gap-1 {episodeView === 'map' ? 'btn-primary' : 'btn-ghost'}"
                    onclick={() => episodeView = 'map'}
                ><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" class="w-3.5 h-3.5" fill="currentColor"><path d="M3 3h4v4H3V3m6 0h4v4H9V3m6 0h4v4h-4V3M3 9h4v4H3V9m6 0h4v4H9V9m6 0h4v4h-4V9M3 15h4v4H3v-4m6 0h4v4H9v-4m6 0h4v4h-4v-4Z"/></svg>Grid</button>
                <button
                    class="join-item btn btn-xs gap-1 {episodeView === 'ratings' ? 'btn-primary' : 'btn-ghost'}"
                    onclick={() => episodeView = 'ratings'}
                ><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" class="w-3.5 h-3.5" fill="currentColor"><path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/></svg>Ratings</button>
                <button
                    class="join-item btn btn-xs gap-1 {episodeView === 'list' ? 'btn-primary' : 'btn-ghost'}"
                    onclick={() => episodeView = 'list'}
                ><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" class="w-3.5 h-3.5" fill="currentColor"><path d="M3 4h2v2H3V4m4 0h14v2H7V4M3 10h2v2H3v-2m4 0h14v2H7v-2M3 16h2v2H3v-2m4 0h14v2H7v-2Z"/></svg>List</button>
            </div>
        </div>

        {#if episodeView === 'map'}
            <p class="text-xs text-base-content/50">
                <span
                    class="inline-block w-3 h-3 rounded-sm bg-success mr-1 align-middle"
                ></span>
                Watched
                <span
                    class="inline-block w-3 h-3 rounded-sm bg-warning mr-1 ml-3 align-middle"
                ></span>
                In Progress
                <span
                    class="inline-block w-3 h-3 rounded-sm ep-unwatched-legend mr-1 ml-3 align-middle"
                ></span>
                Not Watched
                <span
                    class="inline-block w-3 h-3 rounded-sm ep-missing-legend mr-1 ml-3 align-middle"
                ></span>
                Missing
                <span
                    class="inline-block w-3 h-3 rounded-sm ep-upcoming-legend mr-1 ml-3 align-middle"
                ></span>
                Upcoming
            </p>

            <div class="overflow-x-auto">
                <div class="grid-container">
                    {#each data.seasons as season}
                        <div class="grid-row">
                            <div
                                class="season-label"
                                title="Season {season.number}"
                            >
                                {#if season.number === 0}
                                    <span class="text-xs">SP</span>
                                {:else}
                                    <span class="text-xs">S{season.number}</span>
                                {/if}
                            </div>
                            <div class="episode-cells">
                                {#each season.episodes as ep}
                                    <div
                                        class="tooltip"
                                        data-tip="S{season.number}E{ep.item_number} {ep.title}"
                                    >
                                    <a
                                        href="/tv/{data.show.id}/episode/{ep.id}"
                                        class="ep-cell {statusClass(
                                            ep.watch_status,
                                            ep.is_collected,
                                            ep.premiere_date,
                                        )}"
                                    >
                                        <span class="ep-num">{ep.item_number}</span>
                                    </a>
                                    </div>
                                {/each}
                            </div>
                            <div class="season-stat">
                                <span class="text-xs text-base-content/50">
                                    {season.collected}/{season.total}
                                </span>
                            </div>
                        </div>
                    {/each}
                </div>
            </div>
        {:else if episodeView === 'ratings'}
            <!-- Ratings Heatmap -->
            <div class="flex flex-wrap items-center gap-x-4 gap-y-0.5 text-xs text-base-content/60 mb-2">
                <span class="flex items-center gap-1"><span class="inline-block w-3 h-3 rounded-sm bg-[#0d6e3f]"></span> Outstanding (9+)</span>
                <span class="flex items-center gap-1"><span class="inline-block w-3 h-3 rounded-sm bg-[#2d9d5c]"></span> Excellent (8+)</span>
                <span class="flex items-center gap-1"><span class="inline-block w-3 h-3 rounded-sm bg-[#8cc152]"></span> Solid (7+)</span>
                <span class="flex items-center gap-1"><span class="inline-block w-3 h-3 rounded-sm bg-[#c9a833]"></span> Fair (6+)</span>
                <span class="flex items-center gap-1"><span class="inline-block w-3 h-3 rounded-sm bg-[#d35430]"></span> Poor (4+)</span>
                <span class="flex items-center gap-1"><span class="inline-block w-3 h-3 rounded-sm bg-[#6b4226]"></span> Awful (&lt;4)</span>
                <label class="flex items-center gap-1.5 ml-auto cursor-pointer">
                    <input type="checkbox" class="toggle toggle-xs toggle-success" bind:checked={showWatchStatus} />
                    <span>Watch Status</span>
                </label>
            </div>

            <div class="overflow-x-auto">
                <div class="grid-container">
                    {#each data.seasons as season}
                        <div class="grid-row">
                            <div
                                class="season-label"
                                title="Season {season.number}"
                            >
                                {#if season.number === 0}
                                    <span class="text-xs">SP</span>
                                {:else}
                                    <span class="text-xs">S{season.number}</span>
                                {/if}
                            </div>
                            <div class="episode-cells">
                                {#each season.episodes as ep}
                                    <div
                                        class="tooltip"
                                        data-tip="S{season.number}E{ep.item_number} {ep.title}"
                                    >
                                    <a
                                        href="/tv/{data.show.id}/episode/{ep.id}"
                                        class="ep-cell {ratingColor(ep.community_rating)} {showWatchStatus ? watchBorderClass(ep) : ''}"
                                    >
                                        <span class="ep-rating">{ep.community_rating != null ? ep.community_rating.toFixed(1) : '—'}</span>
                                    </a>
                                    </div>
                                {/each}
                            </div>
                            {#each [season.episodes.filter(e => e.community_rating != null)] as rated}
                                <div class="season-stat">
                                    <span class="text-xs text-base-content/50">
                                        {rated.length > 0 ? (rated.reduce((s, e) => s + e.community_rating, 0) / rated.length).toFixed(1) : '—'}
                                    </span>
                                </div>
                            {/each}
                        </div>
                    {/each}
                </div>
            </div>
        {:else}
            <!-- List view with accordion -->
            <div class="join join-vertical w-full">
                {#each data.seasons as season, i}
                    <div class="collapse collapse-arrow join-item bg-base-200/50 border border-base-300">
                        <input type="checkbox" name="season-accordion-{i}" />
                        <div class="collapse-title font-medium text-sm">
                            {season.number === 0
                                ? "Specials"
                                : `Season ${season.number}`}
                            <span class="text-base-content/50 ml-2">
                                ({season.collected}/{season.total} collected
                                {#if season.missing > 0}
                                    · <span class="text-error"
                                        >{season.missing} missing</span
                                    >
                                {/if}
                                {#if season.upcoming > 0}
                                    · <span class="text-base-content/40"
                                        >{season.upcoming} upcoming</span
                                    >
                                {/if})
                            </span>
                        </div>
                        <div class="collapse-content">
                            <div class="overflow-x-auto">
                                <table class="table table-sm">
                                    <thead>
                                        <tr class="text-xs text-base-content/50">
                                            <th class="w-12">#</th>
                                            <th>Title</th>
                                            <th class="w-24">Status</th>
                                            <th class="w-16">Plays</th>
                                            <th class="w-16">Duration</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {#each season.episodes as ep}
                                            <tr
                                                class="hover:bg-base-300/20"
                                                class:ep-row-missing={!ep.is_collected}
                                            >
                                                <td class="text-base-content/50"
                                                    >{ep.item_number}</td
                                                >
                                                <td class="font-medium">
                                                    <a
                                                        href="/tv/{data.show
                                                            .id}/episode/{ep.id}"
                                                        class="hover:text-primary transition-colors"
                                                    >
                                                        {ep.title}
                                                    </a>
                                                    {#if !ep.is_collected}
                                                        <span
                                                            class="badge badge-error badge-xs ml-1"
                                                            >MISSING</span
                                                        >
                                                    {/if}
                                                </td>
                                                <td>
                                                    {#if !ep.is_collected}
                                                        <span
                                                            class="badge badge-error badge-sm"
                                                            >✗</span
                                                        >
                                                    {:else if ep.watch_status === "watched"}
                                                        <span
                                                            class="badge badge-success badge-sm"
                                                            >✓</span
                                                        >
                                                    {:else if ep.watch_status === "in_progress"}
                                                        <span
                                                            class="badge badge-warning badge-sm"
                                                            >⏳</span
                                                        >
                                                    {:else}
                                                        <span
                                                            class="badge badge-ghost badge-sm"
                                                            >—</span
                                                        >
                                                    {/if}
                                                </td>
                                                <td class="text-base-content/50"
                                                    >{ep.is_collected
                                                        ? ep.play_count || "—"
                                                        : "—"}</td
                                                >
                                                <td class="text-base-content/50"
                                                    >{ep.is_collected
                                                        ? formatRuntime(
                                                              ep.runtime_ticks,
                                                          )
                                                        : ""}</td
                                                >
                                            </tr>
                                        {/each}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                {/each}
            </div>
        {/if}
    </div>

    <!-- Cast & Crew -->
    {#if data.cast.length > 0 || data.crew.length > 0}
        <div class="card bg-base-200/50 border border-base-300">
            <div class="card-body">
                <h2 class="card-title text-lg">🎭 Cast & Crew</h2>

                {#if data.cast.length > 0}
                    <div class="flex gap-4 overflow-x-auto pb-2 -mx-2 px-2">
                        {#each data.cast as person}
                            <a
                                href="/people/{person.id}"
                                class="flex flex-col items-center gap-1 shrink-0 w-28 group"
                            >
                                {#if person.photo_url}
                                    <img
                                        src={imgUrl(person.photo_url, 200)}
                                        alt={person.name}
                                        class="w-24 h-24 rounded-full object-cover border-2 border-base-300 group-hover:border-primary transition-colors"
                                    />
                                {:else}
                                    <div
                                        class="w-24 h-24 rounded-full bg-base-300 flex items-center justify-center text-2xl"
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
                {/if}

                {#if data.crew.length > 0}
                    <h3 class="text-sm font-semibold text-base-content/60 mt-3">
                        Crew
                    </h3>
                    <div class="flex flex-wrap gap-2 mt-1">
                        {#each data.crew as person}
                            <a
                                href="/people/{person.id}"
                                class="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-base-300/50 hover:bg-base-300 transition-colors text-sm group"
                            >
                                {#if person.photo_url}
                                    <img
                                        src={imgUrl(person.photo_url, 80)}
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
                {/if}
            </div>
        </div>
    {/if}
</div>

<!-- TODO: Discovery — show related shows from TMDb/TVDb not in your library -->
<div class="container mx-auto px-6 py-8 opacity-30">
    <div class="card bg-base-200/30 border border-dashed border-base-300/50">
        <div class="card-body items-center text-center py-6">
            <div class="text-3xl mb-2">🔍</div>
            <h3 class="font-semibold text-base-content/50">Discover More</h3>
            <p class="text-sm text-base-content/30 max-w-md">
                Related shows discovery coming soon — browse similar series and
                spin-offs from TMDb and add to Sonarr.
            </p>
        </div>
    </div>
</div>

<!-- Delete Confirmation Modal -->
{#if showDeleteConfirm}
    <div class="modal modal-open">
        <div class="modal-box">
            <h3 class="font-bold text-lg">Delete "{data.show.title}"?</h3>
            <p class="py-4 text-base-content/70">
                This will remove this show and all its episodes, watch history, and ratings.
                {#if data.show.jellyfin_id}
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
    .grid-container {
        display: flex;
        flex-direction: column;
        gap: 2px;
    }

    .grid-row {
        display: flex;
        align-items: center;
        gap: 4px;
    }

    .season-label {
        width: 32px;
        text-align: right;
        color: oklch(var(--bc) / 0.5);
        flex-shrink: 0;
    }

    .episode-cells {
        display: flex;
        gap: 2px;
        flex-wrap: wrap;
    }

    .ep-cell {
        width: 24px;
        height: 24px;
        border-radius: 4px;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: default;
        transition:
            transform 0.15s,
            box-shadow 0.15s;
        position: relative;
    }

    .ep-cell:hover {
        transform: scale(1.3);
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
        z-index: 10;
    }

    .ep-num {
        font-size: 8px;
        font-weight: 600;
        opacity: 0.6;
    }

    .ep-watched {
        background: oklch(var(--su, 0.75 0.18 140));
    }

    .ep-progress {
        background: oklch(var(--wa, 0.8 0.15 75));
    }

    .ep-unwatched {
        background: rgba(100, 116, 139, 0.6);
    }

    .ep-missing {
        background: rgba(239, 68, 68, 0.15);
        border: 2px dashed rgba(239, 68, 68, 0.8);
    }

    .ep-missing .ep-num {
        opacity: 0.5;
        color: rgba(239, 68, 68, 0.9);
    }

    :global(.ep-unwatched-legend) {
        background: rgba(100, 116, 139, 0.6);
    }

    :global(.ep-missing-legend) {
        background: rgba(239, 68, 68, 0.15);
        border: 2px dashed rgba(239, 68, 68, 0.8);
    }

    .ep-upcoming {
        background: rgba(100, 116, 139, 0.6);
        border: 2px dashed oklch(var(--wa, 0.8 0.15 75));
    }

    .ep-upcoming .ep-num {
        opacity: 0.4;
    }

    :global(.ep-upcoming-legend) {
        background: rgba(100, 116, 139, 0.6);
        border: 2px dashed oklch(var(--wa, 0.8 0.15 75));
    }

    .ep-row-missing {
        opacity: 0.5;
    }

    .season-stat {
        flex-shrink: 0;
        width: 48px;
        text-align: right;
    }

    .ep-rating {
        font-size: 9px;
        font-weight: 700;
        opacity: 0.9;
        line-height: 1;
    }
</style>
