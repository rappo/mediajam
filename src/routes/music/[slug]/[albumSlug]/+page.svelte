<script>
    import MdiIcon from "$lib/components/MdiIcon.svelte";
    import { mdiAlbum, mdiCalendar, mdiPlay, mdiClockOutline, mdiTimerSand, mdiDownload, mdiEye, mdiEyeOff, mdiMusic, mdiMusicOff, mdiAlert } from '@mdi/js';
    import { imgUrl } from "$lib/utils.js";
    import InteractiveSearchDialog from "$lib/components/InteractiveSearchDialog.svelte";

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

    let isHidden = $state(!!data.album.is_hidden);
    let toggling = $state(false);

    async function toggleHidden() {
        toggling = true;
        try {
            const res = await fetch(`/api/albums/${data.album.id}/hide`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ hidden: !isHidden })
            });
            if (res.ok) {
                isHidden = !isHidden;
            }
        } catch (e) {
            console.error('Failed to toggle hidden:', e);
        }
        toggling = false;
    }

    // ── Album download (auto search via Lidarr) ──
    let downloading = $state(false);
    let downloaded = $state(false);
    let downloadError = $state('');

    async function autoSearchAlbum() {
        if (!data.album.musicbrainz_id || !data.isInLidarr) return;
        downloading = true;
        downloadError = '';
        try {
            const res = await fetch('/api/arr/lidarr/search-album', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    mediaParentId: data.artist.id,
                    mbid: data.album.musicbrainz_id,
                    title: data.album.title,
                }),
            });
            if (!res.ok) {
                const r = await res.json();
                throw new Error(r.error || 'Failed');
            }
            downloaded = true;
        } catch (e) {
            downloadError = e instanceof Error ? e.message : 'Download failed';
            setTimeout(() => (downloadError = ''), 5000);
        }
        downloading = false;
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
                src={imgUrl(data.album.artUrl)}
                alt={data.album.title}
                class="w-44 h-44 rounded-xl shadow-lg shrink-0 object-cover"
            />
        {:else}
            <div
                class="w-44 h-44 rounded-xl bg-base-300 flex items-center justify-center shrink-0"
            >
                <span class="text-6xl opacity-20"><MdiIcon icon={mdiAlbum} size={48} /></span>
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
                        <MdiIcon icon={mdiCalendar} size={14} /> {data.album.release_year}
                    </div>
                {/if}
                {#if data.albumStats.totalPlays > 0}
                    <div class="badge badge-lg badge-accent gap-1">
                        <MdiIcon icon={mdiPlay} size={14} /> {data.albumStats.totalPlays} plays
                    </div>
                {/if}
                {#if data.albumStats.lastPlayed}
                    <div class="badge badge-lg badge-info gap-1">
                        <MdiIcon icon={mdiClockOutline} size={14} /> {timeAgo(data.albumStats.lastPlayed)}
                    </div>
                {/if}
                {#if data.runtimeMinutes > 0}
                    <div class="badge badge-lg badge-ghost gap-1">
                        <MdiIcon icon={mdiTimerSand} size={14} /> {formatRuntime(data.runtimeMinutes)}
                    </div>
                {/if}
                {#if data.artist.collection_status === "external"}
                    <div class="badge badge-lg badge-warning gap-1">
                        <MdiIcon icon={mdiMusicOff} size={16} />
                        Not downloaded
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
            <!-- Download actions (when no local files and artist is in Lidarr) -->
            {#if !data.album.jellyfin_id && data.isInLidarr && data.album.musicbrainz_id}
                <div class="flex flex-wrap items-center gap-2 mt-1">
                    {#if downloaded}
                        <span class="badge badge-success gap-1">✓ Search queued in Lidarr</span>
                    {:else}
                        <button
                            class="btn btn-sm btn-primary gap-1"
                            disabled={downloading}
                            onclick={autoSearchAlbum}
                        >
                            {#if downloading}
                                <span class="loading loading-spinner loading-xs"></span>
                            {:else}
                                <MdiIcon icon={mdiDownload} size={14} />
                            {/if}
                            Auto Search
                        </button>
                    {/if}
                    <InteractiveSearchDialog
                        service="lidarr"
                        mediaParentId={data.artist.id}
                        title="{data.album.title}"
                    />
                </div>
                {#if downloadError}
                    <div class="alert alert-error alert-sm mt-2 text-sm">{downloadError}</div>
                {/if}
            {/if}
        </div>
    </div>

    <!-- Hidden Album Banner -->
    {#if isHidden}
        <div class="alert alert-info shadow-sm">
            <MdiIcon icon={mdiEyeOff} size={20} class="shrink-0" />
            <div>
                <p class="font-semibold">This album is hidden</p>
                <p class="text-sm opacity-80">It won't appear on the artist page.</p>
            </div>
            <button class="btn btn-sm btn-ghost" disabled={toggling} onclick={toggleHidden}>
                {#if toggling}
                    <span class="loading loading-spinner loading-xs"></span>
                {:else}
                    <MdiIcon icon={mdiEye} size={16} /> Unhide
                {/if}
            </button>
        </div>
    {/if}

    <!-- Unmatched Warning -->
    {#if data.isUnmatched && !data.lidarrEnriched}
        <div class="alert alert-warning shadow-sm">
            <MdiIcon icon={mdiAlert} size={20} class="shrink-0" />
            <div>
                <p class="font-semibold">Unmatched Album</p>
                <p class="text-sm opacity-80">
                    This album was imported from listening history but isn't in
                    your Jellyfin library. Track data is reconstructed from
                    scrobbles.
                </p>
            </div>
            {#if !isHidden}
                <button class="btn btn-sm btn-ghost" disabled={toggling} onclick={toggleHidden}>
                    {#if toggling}
                        <span class="loading loading-spinner loading-xs"></span>
                    {:else}
                        <MdiIcon icon={mdiEyeOff} size={16} /> Hide
                    {/if}
                </button>
            {/if}
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
                <p class="text-4xl mb-2"><MdiIcon icon={mdiMusic} size={36} /></p>
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
                                src={imgUrl(sibling.artUrl)}
                                alt={sibling.title}
                                class="w-full aspect-square object-cover"
                            />
                        {:else}
                            <div
                                class="w-full aspect-square bg-base-300 flex items-center justify-center"
                            >
                                <span class="text-4xl opacity-20"><MdiIcon icon={mdiAlbum} size={36} /></span>
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
