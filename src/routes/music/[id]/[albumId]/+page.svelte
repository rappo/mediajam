<script>
    let { data } = $props();

    /** @param {number} mins */
    function formatRuntime(mins) {
        if (!mins) return "—";
        if (mins < 60) return `${mins}m`;
        const h = Math.floor(mins / 60);
        const m = mins % 60;
        return m > 0 ? `${h}h ${m}m` : `${h}h`;
    }

    /** @param {string} timestamp */
    function timeAgo(timestamp) {
        if (!timestamp) return "—";
        const diff = Date.now() - new Date(timestamp).getTime();
        const minutes = Math.floor(diff / 60000);
        if (minutes < 1) return "Just now";
        if (minutes < 60) return `${minutes}m ago`;
        const hours = Math.floor(minutes / 60);
        if (hours < 24) return `${hours}h ago`;
        const days = Math.floor(hours / 24);
        if (days < 30) return `${days}d ago`;
        const months = Math.floor(days / 30);
        if (months < 12) return `${months}mo ago`;
        return new Date(timestamp).toLocaleDateString();
    }

    /** @param {number} ticks */
    function formatTicks(ticks) {
        if (!ticks) return "—";
        const totalSeconds = Math.floor(ticks / 10000000);
        const mins = Math.floor(totalSeconds / 60);
        const secs = totalSeconds % 60;
        return `${mins}:${String(secs).padStart(2, "0")}`;
    }
</script>

<svelte:head>
    <title>{data.album.title} — {data.artist.title} — Mediajam</title>
</svelte:head>

<div class="space-y-6 max-w-5xl mx-auto">
    <!-- Breadcrumb -->
    <div class="flex items-center gap-1 text-sm text-base-content/50">
        <a href="/music" class="link link-hover">Music</a>
        <span>›</span>
        <a href="/music/{data.artist.id}" class="link link-hover"
            >{data.artist.title}</a
        >
        <span>›</span>
        <span class="text-base-content">{data.album.title}</span>
    </div>

    <!-- Album Header -->
    <div class="flex gap-6 items-start">
        {#if data.album.artUrl}
            <img
                src={data.album.artUrl}
                alt={data.album.title}
                class="w-44 h-44 rounded-xl shadow-lg shrink-0 object-cover"
            />
        {:else}
            <div
                class="w-44 h-44 rounded-xl bg-base-300 flex items-center justify-center shrink-0"
            >
                <span class="text-6xl opacity-20">💿</span>
            </div>
        {/if}
        <div class="space-y-3 min-w-0">
            <div>
                <h1 class="text-3xl font-bold">{data.album.title}</h1>
                <a
                    href="/music/{data.artist.id}"
                    class="text-base-content/60 hover:text-primary transition-colors"
                >
                    {data.artist.title}
                </a>
            </div>
            <div class="flex flex-wrap gap-3">
                {#if data.album.release_year}
                    <div class="badge badge-lg badge-ghost gap-1">
                        📅 {data.album.release_year}
                    </div>
                {/if}
                {#if data.albumStats.totalPlays > 0}
                    <div class="badge badge-lg badge-accent gap-1">
                        ▶️ {data.albumStats.totalPlays} plays
                    </div>
                {/if}
                {#if data.albumStats.lastPlayed}
                    <div class="badge badge-lg badge-info gap-1">
                        🕐 {timeAgo(data.albumStats.lastPlayed)}
                    </div>
                {/if}
                {#if data.runtimeMinutes > 0}
                    <div class="badge badge-lg badge-ghost gap-1">
                        ⏱️ {formatRuntime(data.runtimeMinutes)}
                    </div>
                {/if}
                {#if data.artist.collection_status === "external"}
                    <div class="badge badge-lg badge-warning gap-1">
                        <svg
                            xmlns="http://www.w3.org/2000/svg"
                            class="w-4 h-4"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="2"
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            ><line x1="2" y1="2" x2="22" y2="22" /><path
                                d="M9 18V5l12-2v13"
                            /><circle cx="6" cy="18" r="3" /><circle
                                cx="18"
                                cy="16"
                                r="3"
                            /></svg
                        >
                        Not in library
                    </div>
                {/if}
                {#if data.isInLidarr}
                    <a
                        href="{data.arrUrl && data.arrSlug ? `${data.arrUrl}/artist/${data.arrSlug}` : '#'}"
                        target="_blank"
                        rel="noopener noreferrer"
                        class="badge badge-lg badge-outline gap-1 hover:brightness-125 transition-all"
                        style="border-color: #1db954; color: #1db954"
                    >
                        <img src="https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/lidarr.svg" alt="Lidarr" class="w-4 h-4" />
                        In Lidarr
                    </a>
                {/if}
            </div>
        </div>
    </div>

    <!-- Unmatched Warning -->
    {#if data.isUnmatched && !data.lidarrEnriched}
        <div class="alert alert-warning shadow-sm">
            <svg
                xmlns="http://www.w3.org/2000/svg"
                class="w-5 h-5 shrink-0"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                ><path
                    d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"
                /><line x1="12" y1="9" x2="12" y2="13" /><line
                    x1="12"
                    y1="17"
                    x2="12.01"
                    y2="17"
                /></svg
            >
            <div>
                <p class="font-semibold">Unmatched Album</p>
                <p class="text-sm opacity-80">
                    This album was imported from listening history but isn't in
                    your Jellyfin library. Track data is reconstructed from
                    scrobbles.
                </p>
            </div>
        </div>
    {/if}

    <!-- Overview / Description -->
    {#if data.album.overview}
        <div class="prose prose-sm max-w-none opacity-80">
            <p>{data.album.overview}</p>
        </div>
    {/if}

    <!-- Track Listing -->
    <div class="space-y-3">
        <h2 class="text-xl font-bold">
            Tracks
            {#if data.tracks.length > 0}
                <span class="text-base-content/40 text-sm font-normal"
                    >({data.tracks.length})</span
                >
            {:else if data.unmatchedTracks.length > 0}
                <span class="text-base-content/40 text-sm font-normal"
                    >({data.unmatchedTracks.length} from history)</span
                >
            {/if}
        </h2>

        {#if data.tracks.length > 0}
            <div
                class="card bg-base-200/20 border border-base-300/30 overflow-hidden"
            >
                <table class="table table-sm">
                    <thead>
                        <tr
                            class="text-xs text-base-content/40 border-b border-base-300/30"
                        >
                            <th class="w-10 text-center">#</th>
                            <th>Track</th>
                            <th class="w-20 text-right">Duration</th>
                            <th class="w-16 text-center">Plays</th>
                            <th class="w-24 text-right">Last Played</th>
                        </tr>
                    </thead>
                    <tbody>
                        {#each data.tracks as track, i}
                            {@const stats =
                                data.trackStatsMap[track.Name] || null}
                            <tr class="hover:bg-base-200/40 transition-colors">
                                <td
                                    class="text-center text-base-content/30 text-sm"
                                >
                                    {track.IndexNumber || i + 1}
                                </td>
                                <td class="text-sm font-medium">{track.Name}</td
                                >
                                <td
                                    class="text-right text-xs text-base-content/50"
                                >
                                    {formatTicks(track.RunTimeTicks)}
                                </td>
                                <td class="text-center">
                                    {#if stats?.play_count > 0}
                                        <span
                                            class="badge badge-xs badge-accent"
                                            >{stats.play_count}</span
                                        >
                                    {:else}
                                        <span class="text-base-content/15"
                                            >—</span
                                        >
                                    {/if}
                                </td>
                                <td
                                    class="text-right text-xs text-base-content/40"
                                >
                                    {#if stats?.last_played}
                                        {timeAgo(stats.last_played)}
                                    {:else}
                                        —
                                    {/if}
                                </td>
                            </tr>
                        {/each}
                    </tbody>
                </table>
            </div>
        {:else if data.unmatchedTracks.length > 0}
            <div
                class="card bg-base-200/20 border border-warning/20 overflow-hidden"
            >
                <table class="table table-sm">
                    <thead>
                        <tr
                            class="text-xs text-base-content/40 border-b border-base-300/30"
                        >
                            <th class="w-10 text-center">#</th>
                            <th>Track</th>
                            <th class="w-16 text-center">Plays</th>
                            <th class="w-24 text-right">Last Played</th>
                        </tr>
                    </thead>
                    <tbody>
                        {#each data.unmatchedTracks as track, i}
                            {@const stats =
                                data.trackStatsMap[track.Name] || null}
                            <tr class="hover:bg-base-200/40 transition-colors">
                                <td
                                    class="text-center text-base-content/30 text-sm"
                                >
                                    {i + 1}
                                </td>
                                <td class="text-sm font-medium">{track.Name}</td
                                >
                                <td class="text-center">
                                    {#if stats?.play_count > 0}
                                        <span
                                            class="badge badge-xs badge-accent"
                                            >{stats.play_count}</span
                                        >
                                    {:else}
                                        <span class="text-base-content/15"
                                            >—</span
                                        >
                                    {/if}
                                </td>
                                <td
                                    class="text-right text-xs text-base-content/40"
                                >
                                    {#if stats?.last_played}
                                        {timeAgo(stats.last_played)}
                                    {:else}
                                        —
                                    {/if}
                                </td>
                            </tr>
                        {/each}
                    </tbody>
                </table>
            </div>
        {:else}
            <div class="text-center py-12 text-base-content/40">
                <p class="text-4xl mb-2">🎵</p>
                {#if data.isUnmatched}
                    <p>
                        Unmatched album — no track data or listening history
                        available.
                    </p>
                {:else if data.artist.collection_status === "external"}
                    <p>External album — no local tracks available.</p>
                {:else}
                    <p>No tracks found for this album.</p>
                {/if}
            </div>
        {/if}
    </div>

    <!-- More by this Artist -->
    {#if data.siblingAlbums.length > 0}
        <div class="space-y-3">
            <h2 class="text-xl font-bold">More by {data.artist.title}</h2>
            <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                {#each data.siblingAlbums as sibling}
                    <a
                        href="/music/{data.artist.id}/{sibling.id}"
                        class="group rounded-xl border border-base-content/5 bg-base-200/30 hover:bg-base-200/60 transition-all overflow-hidden"
                    >
                        {#if sibling.artUrl}
                            <img
                                src={sibling.artUrl}
                                alt={sibling.title}
                                class="w-full aspect-square object-cover"
                            />
                        {:else}
                            <div
                                class="w-full aspect-square bg-base-300 flex items-center justify-center"
                            >
                                <span class="text-4xl opacity-20">💿</span>
                            </div>
                        {/if}
                        <div class="p-2.5">
                            <p
                                class="font-medium text-sm truncate group-hover:text-primary transition-colors"
                            >
                                {sibling.title}
                            </p>
                            <p class="text-xs text-base-content/50">
                                {sibling.release_year || "Unknown year"}
                            </p>
                        </div>
                    </a>
                {/each}
            </div>
        </div>
    {/if}
</div>
