<script>
    /**
     * Conflict resolution dialog — shows pending MusicBrainz ID conflicts.
     * Appears when the notification badge is clicked in the navbar.
     *
     * @component
     */
    import { invalidateAll } from "$app/navigation";

    let open = $state(false);
    let loading = $state(false);
    /** @type {any[]} */
    let conflicts = $state([]);
    let resolving = $state(/** @type {number|null} */ (null));
    let error = $state("");
    /** @type {Set<number>} */
    let expandedIds = $state(new Set());

    export async function show() {
        open = true;
        await fetchConflicts();
    }

    async function fetchConflicts() {
        loading = true;
        error = "";
        try {
            const res = await fetch("/api/conflicts");
            if (!res.ok) throw new Error("Failed to fetch conflicts");
            const data = await res.json();
            conflicts = data.conflicts || [];
        } catch (e) {
            error = e instanceof Error ? e.message : "Failed";
        }
        loading = false;
    }

    /** @param {number} id */
    function toggleDetails(id) {
        const next = new Set(expandedIds);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        expandedIds = next;
    }

    /**
     * @param {number} conflictId
     * @param {number} primaryId
     */
    async function resolve(conflictId, primaryId) {
        resolving = conflictId;
        error = "";
        try {
            const res = await fetch("/api/conflicts", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    conflictId,
                    resolution: "merge",
                    primaryId,
                }),
            });
            const result = await res.json();
            if (!res.ok) throw new Error(result.error || "Failed");

            conflicts = conflicts.filter((c) => c.id !== conflictId);
            if (conflicts.length === 0) {
                open = false;
                invalidateAll();
            }
        } catch (e) {
            error = e instanceof Error ? e.message : "Failed";
        }
        resolving = null;
    }

    function close() {
        open = false;
        error = "";
        invalidateAll();
    }
</script>

{#if open}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="modal modal-open" onclick={close}>
        <div class="modal-box max-w-2xl" onclick={(e) => e.stopPropagation()}>
            <h3 class="font-bold text-lg flex items-center gap-2">
                ⚠️ Artist Conflicts
                {#if conflicts.length > 0}
                    <span class="badge badge-warning badge-sm"
                        >{conflicts.length}</span
                    >
                {/if}
            </h3>
            <p class="text-sm text-base-content/60 mt-1">
                These artists share a MusicBrainz ID. Click the one to keep as
                primary — the other's albums will merge into it.
            </p>

            {#if loading}
                <div class="flex justify-center py-8">
                    <span class="loading loading-spinner loading-md"></span>
                </div>
            {:else if conflicts.length === 0}
                <div class="text-center py-8 text-base-content/50">
                    ✅ No conflicts to resolve
                </div>
            {:else}
                <div class="space-y-4 mt-4 max-h-[70vh] overflow-y-auto">
                    {#each conflicts as conflict}
                        <div
                            class="card bg-base-200 card-compact border border-base-300"
                        >
                            <div class="card-body">
                                <div
                                    class="flex items-center gap-3 justify-between"
                                >
                                    <!-- Primary artist option -->
                                    {#snippet artistOption(
                                        side,
                                        id,
                                        title,
                                        poster,
                                        albumCount,
                                        source,
                                    )}
                                        <button
                                            class="flex-1 flex items-center gap-2 p-2 rounded-lg hover:bg-primary/10 border-2 border-transparent hover:border-primary transition-all cursor-pointer"
                                            onclick={() =>
                                                resolve(conflict.id, id)}
                                            disabled={resolving === conflict.id}
                                        >
                                            {#if poster}
                                                <img
                                                    src={poster}
                                                    alt=""
                                                    class="w-12 h-12 rounded object-cover shrink-0"
                                                />
                                            {:else}
                                                <div
                                                    class="w-12 h-12 rounded bg-base-300 flex items-center justify-center text-lg shrink-0"
                                                >
                                                    🎵
                                                </div>
                                            {/if}
                                            <div class="text-left min-w-0">
                                                <div
                                                    class="font-medium text-sm truncate"
                                                >
                                                    {title}
                                                </div>
                                                <div
                                                    class="text-xs text-base-content/50"
                                                >
                                                    {albumCount} albums
                                                </div>
                                                <div
                                                    class="badge badge-xs mt-0.5"
                                                    class:badge-info={source ===
                                                        "Jellyfin"}
                                                    class:badge-ghost={source !==
                                                        "Jellyfin"}
                                                >
                                                    {source}
                                                </div>
                                            </div>
                                        </button>
                                    {/snippet}

                                    {@render artistOption(
                                        "primary",
                                        conflict.primary_id,
                                        conflict.primary_title,
                                        conflict.primary_poster,
                                        conflict.primary_album_count,
                                        conflict.primary_source,
                                    )}

                                    <span
                                        class="text-xs text-base-content/30 font-bold shrink-0"
                                        >OR</span
                                    >

                                    {@render artistOption(
                                        "secondary",
                                        conflict.secondary_id,
                                        conflict.secondary_title,
                                        conflict.secondary_poster,
                                        conflict.secondary_album_count,
                                        conflict.secondary_source,
                                    )}
                                </div>

                                <!-- Expandable details -->
                                <button
                                    class="btn btn-xs btn-ghost gap-1 self-start mt-1"
                                    onclick={() => toggleDetails(conflict.id)}
                                >
                                    <svg
                                        xmlns="http://www.w3.org/2000/svg"
                                        class="h-3 w-3 transition-transform"
                                        class:rotate-90={expandedIds.has(
                                            conflict.id,
                                        )}
                                        viewBox="0 0 24 24"
                                        fill="none"
                                        stroke="currentColor"
                                        stroke-width="2"
                                    >
                                        <polyline points="9 18 15 12 9 6" />
                                    </svg>
                                    Compare details
                                </button>

                                {#if expandedIds.has(conflict.id)}
                                    <div class="overflow-x-auto mt-1">
                                        <table class="table table-xs">
                                            <thead>
                                                <tr>
                                                    <th></th>
                                                    <th
                                                        >{conflict.primary_title}</th
                                                    >
                                                    <th
                                                        >{conflict.secondary_title}</th
                                                    >
                                                </tr>
                                            </thead>
                                            <tbody>
                                                <tr>
                                                    <td
                                                        class="font-medium text-base-content/60"
                                                        >Source</td
                                                    >
                                                    <td
                                                        ><span
                                                            class="badge badge-xs"
                                                            class:badge-info={conflict.primary_source ===
                                                                "Jellyfin"}
                                                            >{conflict.primary_source}</span
                                                        ></td
                                                    >
                                                    <td
                                                        ><span
                                                            class="badge badge-xs"
                                                            class:badge-info={conflict.secondary_source ===
                                                                "Jellyfin"}
                                                            >{conflict.secondary_source}</span
                                                        ></td
                                                    >
                                                </tr>
                                                <tr>
                                                    <td
                                                        class="font-medium text-base-content/60"
                                                        >Jellyfin ID</td
                                                    >
                                                    <td
                                                        class="text-xs font-mono"
                                                        >{conflict.primary_jellyfin_id ||
                                                            "—"}</td
                                                    >
                                                    <td
                                                        class="text-xs font-mono"
                                                        >{conflict.secondary_jellyfin_id ||
                                                            "—"}</td
                                                    >
                                                </tr>
                                                <tr>
                                                    <td
                                                        class="font-medium text-base-content/60"
                                                        >MusicBrainz ID</td
                                                    >
                                                    <td
                                                        class="text-xs font-mono"
                                                        >{conflict.primary_mbid ||
                                                            "—"}</td
                                                    >
                                                    <td
                                                        class="text-xs font-mono"
                                                        >{conflict.secondary_mbid ||
                                                            "—"}</td
                                                    >
                                                </tr>
                                                <tr>
                                                    <td
                                                        class="font-medium text-base-content/60"
                                                        >Status</td
                                                    >
                                                    <td
                                                        >{conflict.primary_status ||
                                                            "—"}</td
                                                    >
                                                    <td
                                                        >{conflict.secondary_status ||
                                                            "—"}</td
                                                    >
                                                </tr>
                                                <tr>
                                                    <td
                                                        class="font-medium text-base-content/60 align-top"
                                                        >Albums</td
                                                    >
                                                    <td>
                                                        {#each conflict.primary_albums || [] as album}
                                                            <div
                                                                class="text-xs flex items-center gap-1"
                                                            >
                                                                {#if album.hasJellyfin}<span
                                                                        class="text-success text-[10px]"
                                                                        >●</span
                                                                    >{:else}<span
                                                                        class="text-base-content/20 text-[10px]"
                                                                        >○</span
                                                                    >{/if}
                                                                {album.title}
                                                            </div>
                                                        {/each}
                                                        {#if !conflict.primary_albums?.length}<span
                                                                class="text-xs text-base-content/30"
                                                                >None</span
                                                            >{/if}
                                                    </td>
                                                    <td>
                                                        {#each conflict.secondary_albums || [] as album}
                                                            <div
                                                                class="text-xs flex items-center gap-1"
                                                            >
                                                                {#if album.hasJellyfin}<span
                                                                        class="text-success text-[10px]"
                                                                        >●</span
                                                                    >{:else}<span
                                                                        class="text-base-content/20 text-[10px]"
                                                                        >○</span
                                                                    >{/if}
                                                                {album.title}
                                                            </div>
                                                        {/each}
                                                        {#if !conflict.secondary_albums?.length}<span
                                                                class="text-xs text-base-content/30"
                                                                >None</span
                                                            >{/if}
                                                    </td>
                                                </tr>
                                            </tbody>
                                        </table>
                                    </div>
                                {/if}

                                {#if resolving === conflict.id}
                                    <div class="flex justify-center pt-2">
                                        <span
                                            class="loading loading-spinner loading-sm"
                                        ></span>
                                        <span
                                            class="text-xs text-base-content/50 ml-2"
                                            >Merging...</span
                                        >
                                    </div>
                                {/if}
                            </div>
                        </div>
                    {/each}
                </div>
            {/if}

            {#if error}
                <div class="alert alert-error text-sm mt-3">{error}</div>
            {/if}

            <div class="modal-action">
                <button class="btn btn-sm btn-ghost" onclick={close}
                    >Close</button
                >
            </div>
        </div>
    </div>
{/if}
