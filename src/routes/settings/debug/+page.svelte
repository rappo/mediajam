<script>
    /** @type {{ data: import('./$types').PageData }} */
    let { data } = $props();

    let expandedSections = $state({
        metadata: false,
        posters: false,
        uncollected: false,
        orphaned: false,
        mismatched: false,
    });

    function toggle(section) {
        expandedSections[section] = !expandedSections[section];
    }

    function mediaIcon(type) {
        if (type === "show") return "📺";
        if (type === "movie") return "🎬";
        if (type === "artist") return "🎵";
        return "📁";
    }
</script>

<div class="space-y-6">
    <!-- Overview Stats -->
    <div class="card bg-base-200/50 border border-base-300">
        <div class="card-body">
            <h2 class="card-title text-lg">
                <svg
                    xmlns="http://www.w3.org/2000/svg"
                    class="h-5 w-5 text-info"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                >
                    <path
                        d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 002 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0022 16z"
                    />
                    <polyline points="7.5 4.21 12 6.81 16.5 4.21" /><polyline
                        points="7.5 19.79 7.5 14.6 3 12"
                    /><polyline points="21 12 16.5 14.6 16.5 19.79" /><polyline
                        points="3.27 6.96 12 12.01 20.73 6.96"
                    /><line x1="12" y1="22.08" x2="12" y2="12" />
                </svg>
                Database Overview
            </h2>
            <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-2">
                <div class="stat bg-base-300/30 rounded-xl p-3">
                    <div class="stat-title text-xs">Media Parents</div>
                    <div class="stat-value text-lg">
                        {data.stats.totalParents.toLocaleString()}
                    </div>
                    <div class="stat-desc text-xs">Shows, movies, artists</div>
                </div>
                <div class="stat bg-base-300/30 rounded-xl p-3">
                    <div class="stat-title text-xs">Media Children</div>
                    <div class="stat-value text-lg">
                        {data.stats.totalChildren.toLocaleString()}
                    </div>
                    <div class="stat-desc text-xs">Episodes, albums</div>
                </div>
                <div class="stat bg-base-300/30 rounded-xl p-3">
                    <div class="stat-title text-xs">Tracks</div>
                    <div class="stat-value text-lg">
                        {data.stats.totalTracks.toLocaleString()}
                    </div>
                    <div class="stat-desc text-xs">Individual songs</div>
                </div>
                <div class="stat bg-base-300/30 rounded-xl p-3">
                    <div class="stat-title text-xs">Play History</div>
                    <div class="stat-value text-lg">
                        {data.stats.totalHistory.toLocaleString()}
                    </div>
                    <div class="stat-desc text-xs">Timeline entries</div>
                </div>
            </div>
        </div>
    </div>

    <!-- Data Gaps Summary -->
    <div class="card bg-base-200/50 border border-base-300">
        <div class="card-body">
            <h2 class="card-title text-lg">
                <svg
                    xmlns="http://www.w3.org/2000/svg"
                    class="h-5 w-5 text-warning"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                >
                    <path
                        d="M12 9v2m0 4h.01M5.07 19h13.86c1.54 0 2.5-1.67 1.73-3L13.73 4c-.77-1.33-2.69-1.33-3.46 0L3.34 16c-.77 1.33.19 3 1.73 3z"
                    />
                </svg>
                Data Gaps
            </h2>
            <p class="text-sm text-base-content/60">
                Issues that may affect display quality or data accuracy.
            </p>

            <div class="space-y-2 mt-3">
                <!-- Missing External IDs -->
                <button
                    class="w-full flex items-center justify-between p-3 bg-base-300/30 rounded-xl hover:bg-base-300/50 transition-colors text-left"
                    onclick={() => toggle("metadata")}
                >
                    <div class="flex items-center gap-3">
                        <span class="text-lg">🏷️</span>
                        <div>
                            <p class="font-medium text-sm">
                                Missing External IDs
                            </p>
                            <p class="text-xs text-base-content/50">
                                Items with no TVDB, TMDB, IMDB, or MusicBrainz
                                ID
                            </p>
                        </div>
                    </div>
                    <div class="flex items-center gap-2">
                        <span
                            class="badge {data.missingMetadata.total > 0
                                ? 'badge-warning'
                                : 'badge-success'} badge-sm"
                        >
                            {data.missingMetadata.total}
                        </span>
                        <svg
                            xmlns="http://www.w3.org/2000/svg"
                            class="h-4 w-4 text-base-content/30 transition-transform {expandedSections.metadata
                                ? 'rotate-180'
                                : ''}"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="2"
                            ><polyline points="6 9 12 15 18 9" /></svg
                        >
                    </div>
                </button>
                {#if expandedSections.metadata && data.missingMetadata.items.length > 0}
                    <div class="ml-10 space-y-1 pb-2">
                        {#each data.missingMetadata.items as item}
                            <div class="text-xs flex items-center gap-2 py-0.5">
                                <span>{mediaIcon(item.media_type)}</span>
                                <span class="text-base-content/70"
                                    >{item.title}</span
                                >
                                {#if item.release_year}<span
                                        class="text-base-content/30"
                                        >({item.release_year})</span
                                    >{/if}
                            </div>
                        {/each}
                        {#if data.missingMetadata.total > 100}
                            <p class="text-xs text-base-content/40 italic">
                                ...and {data.missingMetadata.total - 100} more
                            </p>
                        {/if}
                    </div>
                {/if}

                <!-- Missing Posters -->
                <button
                    class="w-full flex items-center justify-between p-3 bg-base-300/30 rounded-xl hover:bg-base-300/50 transition-colors text-left"
                    onclick={() => toggle("posters")}
                >
                    <div class="flex items-center gap-3">
                        <span class="text-lg">🖼️</span>
                        <div>
                            <p class="font-medium text-sm">
                                Missing Poster Art
                            </p>
                            <p class="text-xs text-base-content/50">
                                Items with no poster or cover image
                            </p>
                        </div>
                    </div>
                    <div class="flex items-center gap-2">
                        <span
                            class="badge {data.missingPosters.total > 0
                                ? 'badge-warning'
                                : 'badge-success'} badge-sm"
                        >
                            {data.missingPosters.total}
                        </span>
                        <svg
                            xmlns="http://www.w3.org/2000/svg"
                            class="h-4 w-4 text-base-content/30 transition-transform {expandedSections.posters
                                ? 'rotate-180'
                                : ''}"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="2"
                            ><polyline points="6 9 12 15 18 9" /></svg
                        >
                    </div>
                </button>
                {#if expandedSections.posters && data.missingPosters.items.length > 0}
                    <div class="ml-10 space-y-1 pb-2">
                        {#each data.missingPosters.items as item}
                            <div class="text-xs flex items-center gap-2 py-0.5">
                                <span>{mediaIcon(item.media_type)}</span>
                                <span class="text-base-content/70"
                                    >{item.title}</span
                                >
                                {#if item.release_year}<span
                                        class="text-base-content/30"
                                        >({item.release_year})</span
                                    >{/if}
                            </div>
                        {/each}
                        {#if data.missingPosters.total > 100}
                            <p class="text-xs text-base-content/40 italic">
                                ...and {data.missingPosters.total - 100} more
                            </p>
                        {/if}
                    </div>
                {/if}

                <!-- Missing Overviews (summary only) -->
                <div
                    class="flex items-center justify-between p-3 bg-base-300/30 rounded-xl"
                >
                    <div class="flex items-center gap-3">
                        <span class="text-lg">📝</span>
                        <div>
                            <p class="font-medium text-sm">
                                Missing Descriptions
                            </p>
                            <p class="text-xs text-base-content/50">
                                Items with no overview or synopsis
                            </p>
                        </div>
                    </div>
                    <span
                        class="badge {data.missingOverview.total > 0
                            ? 'badge-warning'
                            : 'badge-success'} badge-sm"
                    >
                        {data.missingOverview.total}
                    </span>
                </div>

                <!-- Uncollected Children -->
                <button
                    class="w-full flex items-center justify-between p-3 bg-base-300/30 rounded-xl hover:bg-base-300/50 transition-colors text-left"
                    onclick={() => toggle("uncollected")}
                >
                    <div class="flex items-center gap-3">
                        <span class="text-lg">📭</span>
                        <div>
                            <p class="font-medium text-sm">
                                Missing from Collection
                            </p>
                            <p class="text-xs text-base-content/50">
                                Episodes/albums that exist but aren't on disk
                            </p>
                        </div>
                    </div>
                    <div class="flex items-center gap-2">
                        <span
                            class="badge {data.uncollected.total > 0
                                ? 'badge-info'
                                : 'badge-success'} badge-sm"
                        >
                            {data.uncollected.total}
                        </span>
                        <svg
                            xmlns="http://www.w3.org/2000/svg"
                            class="h-4 w-4 text-base-content/30 transition-transform {expandedSections.uncollected
                                ? 'rotate-180'
                                : ''}"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="2"
                            ><polyline points="6 9 12 15 18 9" /></svg
                        >
                    </div>
                </button>
                {#if expandedSections.uncollected && data.uncollected.items.length > 0}
                    <div class="ml-10 space-y-1 pb-2">
                        {#each data.uncollected.items as item}
                            <div class="text-xs flex items-center gap-2 py-0.5">
                                <span>{mediaIcon(item.media_type)}</span>
                                <span class="text-base-content/70"
                                    >{item.parent_title}</span
                                >
                                <span class="text-base-content/40">
                                    {#if item.season_number != null}S{String(
                                            item.season_number,
                                        ).padStart(2, "0")}E{String(
                                            item.item_number,
                                        ).padStart(2, "0")}{/if}
                                </span>
                                <span class="text-base-content/50"
                                    >{item.title}</span
                                >
                            </div>
                        {/each}
                        {#if data.uncollected.total > 100}
                            <p class="text-xs text-base-content/40 italic">
                                ...and {data.uncollected.total - 100} more
                            </p>
                        {/if}
                    </div>
                {/if}

                <!-- Mismatched Episode/Album Counts -->
                <button
                    class="w-full flex items-center justify-between p-3 bg-base-300/30 rounded-xl hover:bg-base-300/50 transition-colors text-left"
                    onclick={() => toggle("mismatched")}
                >
                    <div class="flex items-center gap-3">
                        <span class="text-lg">📊</span>
                        <div>
                            <p class="font-medium text-sm">
                                Incomplete Collections
                            </p>
                            <p class="text-xs text-base-content/50">
                                Shows/artists with fewer collected than released
                            </p>
                        </div>
                    </div>
                    <div class="flex items-center gap-2">
                        <span
                            class="badge {data.mismatchedCounts.total > 0
                                ? 'badge-info'
                                : 'badge-success'} badge-sm"
                        >
                            {data.mismatchedCounts.total}
                        </span>
                        <svg
                            xmlns="http://www.w3.org/2000/svg"
                            class="h-4 w-4 text-base-content/30 transition-transform {expandedSections.mismatched
                                ? 'rotate-180'
                                : ''}"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="2"
                            ><polyline points="6 9 12 15 18 9" /></svg
                        >
                    </div>
                </button>
                {#if expandedSections.mismatched && data.mismatchedCounts.items.length > 0}
                    <div class="ml-10 space-y-1 pb-2">
                        {#each data.mismatchedCounts.items as item}
                            <div class="text-xs flex items-center gap-2 py-0.5">
                                <span>{mediaIcon(item.media_type)}</span>
                                <span class="text-base-content/70"
                                    >{item.title}</span
                                >
                                <span class="badge badge-xs badge-ghost">
                                    {item.collected_children}/{item.total_released_children}
                                    collected
                                </span>
                                <span class="badge badge-xs badge-ghost">
                                    {item.watched_children} watched
                                </span>
                            </div>
                        {/each}
                        {#if data.mismatchedCounts.total > 100}
                            <p class="text-xs text-base-content/40 italic">
                                ...and {data.mismatchedCounts.total - 100} more
                            </p>
                        {/if}
                    </div>
                {/if}

                <!-- Orphaned History -->
                <button
                    class="w-full flex items-center justify-between p-3 bg-base-300/30 rounded-xl hover:bg-base-300/50 transition-colors text-left"
                    onclick={() => toggle("orphaned")}
                >
                    <div class="flex items-center gap-3">
                        <span class="text-lg">👻</span>
                        <div>
                            <p class="font-medium text-sm">
                                Orphaned Play History
                            </p>
                            <p class="text-xs text-base-content/50">
                                Plays pointing to non-existent media items
                            </p>
                        </div>
                    </div>
                    <div class="flex items-center gap-2">
                        <span
                            class="badge {data.orphanedHistory.total > 0
                                ? 'badge-error'
                                : 'badge-success'} badge-sm"
                        >
                            {data.orphanedHistory.total}
                        </span>
                        <svg
                            xmlns="http://www.w3.org/2000/svg"
                            class="h-4 w-4 text-base-content/30 transition-transform {expandedSections.orphaned
                                ? 'rotate-180'
                                : ''}"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="2"
                            ><polyline points="6 9 12 15 18 9" /></svg
                        >
                    </div>
                </button>
                {#if expandedSections.orphaned && data.orphanedHistory.items.length > 0}
                    <div class="ml-10 space-y-1 pb-2">
                        {#each data.orphanedHistory.items as item}
                            <div class="text-xs flex items-center gap-2 py-0.5">
                                <span class="badge badge-xs badge-ghost"
                                    >{item.source}</span
                                >
                                <span class="text-base-content/70"
                                    >{item.track_name ||
                                        `media_id: ${item.media_id}`}</span
                                >
                                <span class="text-base-content/30"
                                    >{new Date(
                                        item.timestamp,
                                    ).toLocaleDateString()}</span
                                >
                            </div>
                        {/each}
                        {#if data.orphanedHistory.total > 100}
                            <p class="text-xs text-base-content/40 italic">
                                ...and {data.orphanedHistory.total - 100} more
                            </p>
                        {/if}
                    </div>
                {/if}

                <!-- Last.fm Scrobble Matching -->
                <div
                    class="flex items-center justify-between p-3 bg-base-300/30 rounded-xl"
                >
                    <div class="flex items-center gap-3">
                        <span class="text-lg">🎧</span>
                        <div>
                            <p class="font-medium text-sm">
                                Last.fm Scrobble Coverage
                            </p>
                            <p class="text-xs text-base-content/50">
                                {data.scrobbles.matched.toLocaleString()} history
                                entries from {data.scrobbles.total.toLocaleString()}
                                raw scrobbles
                            </p>
                        </div>
                    </div>
                    <span class="badge badge-ghost badge-sm">
                        {data.scrobbles.total > 0
                            ? Math.round(
                                  (data.scrobbles.matched /
                                      data.scrobbles.total) *
                                      100,
                              )
                            : 100}%
                    </span>
                </div>
            </div>
        </div>
    </div>
</div>
