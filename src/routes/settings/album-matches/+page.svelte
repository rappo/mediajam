<script>
    import MdiIcon from "$lib/components/MdiIcon.svelte";
    import { mdiLinkVariant, mdiCheckCircle, mdiMusic, mdiAlbum, mdiInformation, mdiAlert, mdiPartyPopper } from '@mdi/js';

    let { data } = $props();

    let suggestions = $state(data.suggestions);
    let stats = $state(data.stats);
    let totalSuggestions = $state(data.totalSuggestions);

    let merging = $state(new Set());
    let autoMerging = $state(false);
    let autoMergeResult = $state(null);
    let autoMergingMedium = $state(false);
    let autoMergeMediumResult = $state(null);
    let toastMessage = $state("");

    // Manual override: unmatchedKey -> { id, title } of the chosen album
    let overrides = $state({});
    // Cache of artist albums: artistId -> [{id, title}]
    let artistAlbumsCache = $state({});
    let loadingArtist = $state({});

    async function loadArtistAlbums(artistId) {
        if (artistAlbumsCache[artistId]) return;
        loadingArtist[artistId] = true;
        loadingArtist = { ...loadingArtist };
        try {
            const res = await fetch(
                `/api/albums/match/artist-albums?artistId=${artistId}`,
            );
            const albums = await res.json();
            artistAlbumsCache[artistId] = albums;
            artistAlbumsCache = { ...artistAlbumsCache };
        } catch (err) {
            console.error("Failed to load artist albums:", err);
        } finally {
            loadingArtist[artistId] = false;
            loadingArtist = { ...loadingArtist };
        }
    }

    function showToast(msg) {
        toastMessage = msg;
        setTimeout(() => (toastMessage = ""), 3000);
    }

    function confidenceBadge(confidence) {
        const map = {
            exact: "badge-success",
            high: "badge-info",
            medium: "badge-warning",
        };
        return map[confidence] || "badge-ghost";
    }

    async function mergeSuggestion(suggestion) {
        const key = suggestion.unmatchedIds.join(",");
        const override = overrides[key];
        merging.add(key);
        merging = new Set(merging);
        let totalMigrated = 0;

        try {
            for (const uid of suggestion.unmatchedIds) {
                const res = await fetch("/api/albums/match", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        action: "merge",
                        unmatchedId: uid,
                        matchedId: override
                            ? override.id
                            : suggestion.matchedId,
                    }),
                });
                if (!res.ok) {
                    const text = await res.text();
                    console.error("Merge failed:", res.status, text);
                    showToast(`Error merging: ${res.status}`);
                    return;
                }
                const result = await res.json();
                if (result.success) totalMigrated += result.migratedPlays;
            }

            // Remove from UI
            suggestions = suggestions.filter(
                (s) => s.unmatchedIds.join(",") !== key,
            );
            totalSuggestions--;
            stats = {
                ...stats,
                totalUnmatched:
                    stats.totalUnmatched - suggestion.unmatchedIds.length,
                withSuggestions: totalSuggestions,
                exactMatches:
                    stats.exactMatches -
                    (suggestion.confidence === "exact" ? 1 : 0),
            };
            const targetTitle = override
                ? override.title
                : suggestion.matchedTitle;
            showToast(
                `Merged "${suggestion.unmatchedTitle}" → "${targetTitle}" (${totalMigrated} plays migrated)`,
            );
        } catch (err) {
            console.error("Merge error:", err);
            showToast(`Merge failed: ${err.message}`);
        } finally {
            merging.delete(key);
            merging = new Set(merging);
        }
    }

    async function autoMergeAll() {
        autoMerging = true;
        autoMergeResult = null;

        try {
            const res = await fetch("/api/albums/match", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "auto-merge" }),
            });
            if (!res.ok) {
                const text = await res.text();
                console.error("Auto-merge failed:", res.status, text);
                showToast(`Auto-merge failed: ${res.status}`);
                return;
            }
            const result = await res.json();
            autoMergeResult = result;

            // Refresh data
            const refreshRes = await fetch(
                `/api/albums/match?limit=50&offset=0`,
            );
            const refreshData = await refreshRes.json();
            suggestions = refreshData.suggestions;
            stats = refreshData.stats;
            totalSuggestions = refreshData.totalSuggestions;

            showToast(
                `Auto-merged ${result.merged} albums, migrated ${result.totalPlays} plays`,
            );
        } catch (err) {
            console.error("Auto-merge error:", err);
            showToast(`Auto-merge failed: ${err.message}`);
        } finally {
            autoMerging = false;
        }
    }

    async function autoMergeAllMediumPlus() {
        autoMergingMedium = true;
        autoMergeMediumResult = null;

        try {
            const res = await fetch("/api/albums/match", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "auto-merge-medium-plus" }),
            });
            if (!res.ok) {
                const text = await res.text();
                console.error("Auto-merge medium+ failed:", res.status, text);
                showToast(`Auto-merge failed: ${res.status}`);
                return;
            }
            const result = await res.json();
            autoMergeMediumResult = result;

            // Refresh data
            const refreshRes = await fetch(
                `/api/albums/match?limit=50&offset=0`,
            );
            const refreshData = await refreshRes.json();
            suggestions = refreshData.suggestions;
            stats = refreshData.stats;
            totalSuggestions = refreshData.totalSuggestions;

            showToast(
                `Auto-merged ${result.merged} albums (medium+), migrated ${result.totalPlays} plays`,
            );
        } catch (err) {
            console.error("Auto-merge medium+ error:", err);
            showToast(`Auto-merge failed: ${err.message}`);
        } finally {
            autoMergingMedium = false;
        }
    }
</script>

<svelte:head>
    <title>Album Matches — Settings — Mediajam</title>
</svelte:head>

<div class="space-y-6 max-w-5xl mx-auto">
    <!-- Header -->
    <div class="flex items-center justify-between">
        <div>
            <h1 class="text-2xl font-bold flex items-center gap-2">
                <MdiIcon icon={mdiLinkVariant} size={24} /> Album Matching
            </h1>
            <p class="text-sm text-base-content/60 mt-1">
                Match imported albums from Last.fm to your Jellyfin library.
                Merging migrates all play history.
            </p>
        </div>
        <a href="/settings/account" class="btn btn-ghost btn-sm"
            >← Back to Settings</a
        >
    </div>

    <!-- Stats -->
    <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div class="card bg-base-200/50 border border-base-300">
            <div class="card-body py-3 px-4">
                <p
                    class="text-xs text-base-content/50 uppercase tracking-wider"
                >
                    Unmatched
                </p>
                <p class="text-2xl font-bold">
                    {stats.totalUnmatched.toLocaleString()}
                </p>
                <p class="text-xs text-base-content/40">albums</p>
            </div>
        </div>
        <div class="card bg-base-200/50 border border-base-300">
            <div class="card-body py-3 px-4">
                <p
                    class="text-xs text-base-content/50 uppercase tracking-wider"
                >
                    Suggestions
                </p>
                <p class="text-2xl font-bold">{totalSuggestions}</p>
                <p class="text-xs text-base-content/40">match candidates</p>
            </div>
        </div>
        <div class="card bg-base-200/50 border border-base-300">
            <div class="card-body py-3 px-4">
                <p
                    class="text-xs text-base-content/50 uppercase tracking-wider"
                >
                    Exact
                </p>
                <p class="text-2xl font-bold text-success">
                    {stats.exactMatches}
                </p>
                <p class="text-xs text-base-content/40">auto-mergeable</p>
            </div>
        </div>
        <div class="card bg-base-200/50 border border-base-300">
            <div class="card-body py-3 px-4">
                <p
                    class="text-xs text-base-content/50 uppercase tracking-wider"
                >
                    Artists
                </p>
                <p class="text-2xl font-bold">
                    {stats.uniqueArtists.toLocaleString()}
                </p>
                <p class="text-xs text-base-content/40">with unmatched</p>
            </div>
        </div>
    </div>

    <!-- Auto-merge button -->
    {#if stats.exactMatches > 0}
        <div class="alert alert-success shadow-sm">
            <MdiIcon icon={mdiInformation} size={20} class="shrink-0" />
            <div class="flex-1">
                <p class="font-semibold">
                    {stats.exactMatches} exact matches ready to auto-merge
                </p>
                <p class="text-sm opacity-80">
                    These have identical normalized titles (after stripping
                    smart quotes, suffixes, etc.) and can be safely merged
                    automatically.
                </p>
            </div>
            <button
                class="btn btn-sm btn-success"
                disabled={autoMerging}
                onclick={autoMergeAll}
            >
                {#if autoMerging}
                    <span class="loading loading-spinner loading-xs"></span>
                    Merging...
                {:else}
                    Auto-merge Exact Matches
                {/if}
            </button>
        </div>
    {/if}

    <!-- Auto-merge medium+ button -->
    {#if totalSuggestions > 0}
        <div class="alert alert-warning shadow-sm">
            <MdiIcon icon={mdiAlert} size={20} class="shrink-0" />
            <div class="flex-1">
                <p class="font-semibold">
                    {totalSuggestions} suggestions with medium+ confidence
                </p>
                <p class="text-sm opacity-80">
                    Merges all exact, high, and medium confidence matches. Fuzzy
                    matches may occasionally be wrong — review first if unsure.
                </p>
            </div>
            <button
                class="btn btn-sm btn-warning"
                disabled={autoMergingMedium}
                onclick={autoMergeAllMediumPlus}
            >
                {#if autoMergingMedium}
                    <span class="loading loading-spinner loading-xs"></span>
                    Merging...
                {:else}
                    Auto-merge All Medium+
                {/if}
            </button>
        </div>
    {/if}

    {#if autoMergeResult}
        <div class="alert alert-info shadow-sm">
            <span
                ><MdiIcon icon={mdiCheckCircle} size={16} /> Auto-merged <strong>{autoMergeResult.merged}</strong>
                albums, migrated <strong>{autoMergeResult.totalPlays}</strong> plays.</span
            >
        </div>
    {/if}

    {#if autoMergeMediumResult}
        <div class="alert alert-info shadow-sm">
            <span
                ><MdiIcon icon={mdiCheckCircle} size={16} /> Auto-merged <strong>{autoMergeMediumResult.merged}</strong>
                albums (medium+), migrated
                <strong>{autoMergeMediumResult.totalPlays}</strong> plays.</span
            >
        </div>
    {/if}

    <!-- Suggestions Table -->
    {#if suggestions.length > 0}
        <div
            class="card bg-base-200/20 border border-base-300/30 overflow-hidden"
        >
            <table class="table table-sm">
                <thead>
                    <tr
                        class="text-xs text-base-content/40 border-b border-base-300/30"
                    >
                        <th>Artist</th>
                        <th>Unmatched Album</th>
                        <th class="text-center">→</th>
                        <th>Suggested Match</th>
                        <th>Override</th>
                        <th class="text-center">Confidence</th>
                        <th class="text-right">Actions</th>
                    </tr>
                </thead>
                <tbody>
                    {#each suggestions as suggestion}
                        {@const key = suggestion.unmatchedIds.join(",")}
                        <tr
                            class="hover:bg-base-200/40 transition-colors"
                            class:opacity-50={merging.has(key)}
                        >
                            <td class="text-sm">
                                <a
                                    href="/music/{suggestion.artistId}"
                                    class="link link-hover font-medium"
                                    >{suggestion.artistName}</a
                                >
                            </td>
                            <td class="text-sm">
                                <div>
                                    <span class="font-medium text-error/80"
                                        >{suggestion.unmatchedTitle}</span
                                    >
                                    {#if suggestion.unmatchedVariants.length > 1}
                                        <div
                                            class="text-xs text-base-content/40 mt-0.5"
                                        >
                                            + {suggestion.unmatchedVariants
                                                .length - 1} variant{suggestion
                                                .unmatchedVariants.length > 2
                                                ? "s"
                                                : ""}
                                        </div>
                                    {/if}
                                </div>
                            </td>
                            <td class="text-center text-base-content/30 text-lg"
                                >→</td
                            >
                            <td class="text-sm">
                                <span
                                    class="font-medium text-success/80"
                                    class:line-through={overrides[key]}
                                    class:opacity-40={overrides[key]}
                                    >{suggestion.matchedTitle}</span
                                >
                                {#if suggestion.duplicateCount > 1}
                                    <span
                                        class="text-xs text-base-content/40 ml-1"
                                        >({suggestion.duplicateCount} dupes)</span
                                    >
                                {/if}
                            </td>
                            <td class="text-sm">
                                <select
                                    class="select select-xs select-bordered w-full max-w-[200px]"
                                    onfocus={() =>
                                        loadArtistAlbums(suggestion.artistId)}
                                    onchange={(e) => {
                                        const val = e.target.value;
                                        if (val) {
                                            const album = artistAlbumsCache[
                                                suggestion.artistId
                                            ]?.find(
                                                (a) => a.id === parseInt(val),
                                            );
                                            if (album) {
                                                overrides[key] = album;
                                                overrides = { ...overrides };
                                            }
                                        } else {
                                            delete overrides[key];
                                            overrides = { ...overrides };
                                        }
                                    }}
                                >
                                    <option value="">— use suggested —</option>
                                    {#if loadingArtist[suggestion.artistId]}
                                        <option disabled>Loading...</option>
                                    {:else if artistAlbumsCache[suggestion.artistId]}
                                        {#each artistAlbumsCache[suggestion.artistId] as album}
                                            <option
                                                value={album.id}
                                                selected={overrides[key]?.id ===
                                                    album.id}
                                                >{album.title}</option
                                            >
                                        {/each}
                                    {/if}
                                </select>
                            </td>
                            <td class="text-center">
                                <span
                                    class="badge badge-xs {overrides[key]
                                        ? 'badge-accent'
                                        : confidenceBadge(
                                              suggestion.confidence,
                                          )} capitalize"
                                >
                                    {overrides[key]
                                        ? "manual"
                                        : suggestion.confidence}
                                </span>
                                {#if !overrides[key] && suggestion.matchType}
                                    <div
                                        class="text-[10px] text-base-content/40 mt-0.5"
                                    >
                                        {#if suggestion.matchType === "track"}<MdiIcon icon={mdiMusic} size={10} />{:else}<MdiIcon icon={mdiAlbum} size={10} />{/if}
                                        {suggestion.matchType}
                                        {#if suggestion.trackOverlap}
                                            ({suggestion.trackOverlap})
                                        {/if}
                                    </div>
                                {/if}
                            </td>
                            <td class="text-right">
                                <button
                                    class="btn btn-xs btn-success gap-1"
                                    disabled={merging.has(key)}
                                    onclick={() => mergeSuggestion(suggestion)}
                                >
                                    {#if merging.has(key)}
                                        <span
                                            class="loading loading-spinner loading-xs"
                                        ></span>
                                    {:else}
                                        <MdiIcon icon={mdiCheckCircle} size={12} /> Merge
                                    {/if}
                                </button>
                            </td>
                        </tr>
                    {/each}
                </tbody>
            </table>
        </div>

        {#if totalSuggestions > suggestions.length}
            <p class="text-sm text-base-content/50 text-center">
                Showing {suggestions.length} of {totalSuggestions} suggestions. More
                will appear as you merge.
            </p>
        {/if}
    {:else}
        <div class="text-center py-16 text-base-content/40">
            <p class="text-5xl mb-3"><MdiIcon icon={mdiPartyPopper} size={48} /></p>
            <p class="text-lg font-medium">No match suggestions</p>
            <p class="text-sm mt-1">
                {#if stats.totalUnmatched > 0}
                    {stats.totalUnmatched.toLocaleString()} unmatched albums remain
                    but have no close title matches in your Jellyfin library.
                {:else}
                    All albums are matched!
                {/if}
            </p>
        </div>
    {/if}
</div>

<!-- Toast -->
{#if toastMessage}
    <div class="toast toast-end z-50">
        <div class="alert alert-success shadow-lg">
            <span>{toastMessage}</span>
        </div>
    </div>
{/if}
