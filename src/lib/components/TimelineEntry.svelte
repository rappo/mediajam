<script>
    import ServiceIcon from "$lib/components/ServiceIcon.svelte";

    /** @type {{ entry: any, jellyfinUrl?: string, albumGroups?: Array<{albumTitle: string, albumArtUrl: string|null, albumId: number|null, tracks: any[]}> | null }} */
    let { entry, jellyfinUrl = "", albumGroups = null } = $props();

    /** @param {string} timestamp */
    function timeAgo(timestamp) {
        if (!timestamp) return "";
        const diff = Date.now() - new Date(timestamp).getTime();
        const minutes = Math.floor(diff / 60000);
        if (minutes < 1) return "Just now";
        if (minutes < 60) return `${minutes}m ago`;
        const hours = Math.floor(minutes / 60);
        if (hours < 24) return `${hours}h ago`;
        const days = Math.floor(hours / 24);
        if (days < 7) return `${days}d ago`;
        return new Date(timestamp).toLocaleDateString();
    }

    /** @param {string} timestamp */
    function formatTime(timestamp) {
        if (!timestamp) return "";
        return new Date(timestamp).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
        });
    }

    /**
     * Format runtime ticks to friendly duration
     * @param {number|null|undefined} ticks
     * @returns {string}
     */
    function formatRuntime(ticks) {
        if (!ticks) return "";
        const totalSeconds = Math.round(ticks / 10000000);
        const mins = Math.floor(totalSeconds / 60);
        const secs = totalSeconds % 60;
        if (mins > 0) return `${mins}:${String(secs).padStart(2, '0')}`;
        return `0:${String(secs).padStart(2, '0')}`;
    }

    /**
     * Format seconds to friendly duration
     * @param {number|null|undefined} seconds
     * @returns {string}
     */
    function formatSeconds(seconds) {
        if (!seconds) return "";
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        if (h > 0) return `${h}h ${m}m`;
        return `${m}m`;
    }

    /** @param {string} type */
    function getMediaIcon(type) {
        if (type === "show") return "📺";
        if (type === "artist") return "🎵";
        return "🎬";
    }

    /** @param {string} source */
    function getSourceStyle(source) {
        /** @type {Record<string, {bg: string, service: string|null}>} */
        const styles = {
            webhook: { bg: "#22c55e", service: null },
            trakt: { bg: "#ED1C24", service: "trakt" },
            lastfm: { bg: "#D51007", service: "lastfm" },
            jellyfin_pr: { bg: "#00A4DC", service: "jellyfin" },
            legacy: { bg: "#6b7280", service: null },
            seed: { bg: "#6b7280", service: null },
        };
        return styles[source] || { bg: "#6b7280", service: null };
    }

    /** @param {any} e */
    function getTitle(e) {
        if (e.media_type === "artist") {
            const trackDisplay = e.track_name || e.item_title;
            return { primary: e.parent_title, secondary: trackDisplay };
        }
        if (e.media_type === "show" && e.season_number != null) {
            const ep = `S${String(e.season_number).padStart(2, "0")}E${String(e.item_number).padStart(2, "0")}`;
            return {
                primary: e.parent_title,
                secondary: `${ep} "${e.item_title}"`,
            };
        }
        return {
            primary: e.item_title || e.parent_title,
            secondary: null,
        };
    }

    /** @param {any} e */
    function getLink(e) {
        if (e.media_type === "artist" && e.parent_id && e.media_id) {
            return `/music/${e.parent_id}/${e.media_id}`;
        }
        if (e.media_type === "artist" && e.parent_id) {
            return `/music/${e.parent_id}`;
        }
        if (e.media_type === "show" && e.parent_id) return `/tv/${e.parent_id}`;
        if (e.media_type === "movie" && e.parent_id)
            return `/movies/${e.parent_id}`;
        return null;
    }

    /** @param {any} e */
    function getPosterUrl(e) {
        return (
            e.album_art_url ||
            e.poster_url ||
            (e.parent_jellyfin_id && jellyfinUrl
                ? `${jellyfinUrl}/Items/${e.parent_jellyfin_id}/Images/Primary?maxHeight=120`
                : null)
        );
    }

    /**
     * Get track runtime string
     * @param {any} e
     * @returns {string}
     */
    function getTrackRuntime(e) {
        // Prefer track-level ticks, fall back to consumed seconds
        if (e.track_runtime_ticks) return formatRuntime(e.track_runtime_ticks);
        if (e.duration_consumed_seconds) return formatSeconds(e.duration_consumed_seconds);
        // For video, use child_runtime_ticks (episode/movie runtime)
        if (e.child_runtime_ticks) return formatRuntime(e.child_runtime_ticks);
        return "";
    }

    const posterUrl = getPosterUrl(entry);
    const link = getLink(entry);
    const title = getTitle(entry);
    const isExternal = entry.collection_status === "external";

    // Is this a movie or TV entry? -> larger poster
    const isVideoMedia =
        entry.media_type === "movie" || entry.media_type === "show";
    // Is this an artist group with album sub-groups?
    const isGroup = albumGroups && albumGroups.length > 0;
</script>

{#snippet sourceBadge(src)}
    {@const style = getSourceStyle(src)}
    <span
        class="inline-flex items-center justify-center w-[18px] h-[18px] rounded-full"
        style="background: {style.bg}"
        title={src}
    >
        {#if style.service}
            <ServiceIcon
                service={style.service}
                size="w-2.5 h-2.5"
                class="text-white"
            />
        {:else if src === "webhook"}
            <svg
                xmlns="http://www.w3.org/2000/svg"
                class="w-2.5 h-2.5 text-white"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="3"><circle cx="12" cy="12" r="4" /></svg
            >
        {:else}
            <svg
                xmlns="http://www.w3.org/2000/svg"
                class="w-2.5 h-2.5 text-white"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"><circle cx="12" cy="12" r="10" /></svg
            >
        {/if}
    </span>
{/snippet}

{#snippet externalBadge(mediaType)}
    <span
        class="inline-flex items-center justify-center w-[18px] h-[18px] rounded-full bg-warning/80"
        title="Not in library"
    >
        {#if mediaType === "artist"}
            <svg
                xmlns="http://www.w3.org/2000/svg"
                class="w-2.5 h-2.5 text-warning-content"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2.5"
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
        {:else if mediaType === "movie"}
            <svg
                xmlns="http://www.w3.org/2000/svg"
                class="w-2.5 h-2.5 text-warning-content"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2.5"
                stroke-linecap="round"
                stroke-linejoin="round"
                ><line x1="2" y1="2" x2="22" y2="22" /><rect
                    x="2"
                    y="4"
                    width="20"
                    height="16"
                    rx="2"
                /><path d="M7 4v4l-3-2v8l3-2v4" /></svg
            >
        {:else}
            <svg
                xmlns="http://www.w3.org/2000/svg"
                class="w-2.5 h-2.5 text-warning-content"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2.5"
                stroke-linecap="round"
                stroke-linejoin="round"
                ><line x1="2" y1="2" x2="22" y2="22" /><rect
                    x="2"
                    y="6"
                    width="20"
                    height="14"
                    rx="2"
                /><path d="M7 2l5 5 5-5" /></svg
            >
        {/if}
    </span>
{/snippet}

<!-- ═══ ARTIST GROUP MODE (with album sub-groups) ═══ -->
{#if isGroup}
    {@const artistLink = entry.parent_id ? `/music/${entry.parent_id}` : null}
    {@const artistPoster = getPosterUrl(entry)}
    {@const totalTracks = albumGroups.reduce((sum, g) => sum + g.tracks.length, 0)}
    {@const latestTimestamp = entry.timestamp}

    <div class="px-3 py-2.5">
        <!-- Artist header -->
        <div class="flex items-center gap-3 mb-2">
            {#if artistPoster && albumGroups.length <= 1}
                <img
                    src={artistPoster}
                    alt=""
                    class="w-14 h-14 rounded-lg object-cover shadow-sm shrink-0"
                />
            {:else}
                <div class="w-10 h-10 rounded-lg bg-base-300 flex items-center justify-center text-lg shrink-0">🎵</div>
            {/if}
            <div class="flex-1 min-w-0">
                {#if artistLink}
                    <a href={artistLink} class="font-semibold text-sm hover:text-primary transition-colors truncate block">
                        {entry.parent_title}
                    </a>
                {:else}
                    <span class="font-semibold text-sm truncate block">{entry.parent_title}</span>
                {/if}
                <span class="text-xs text-base-content/40">{totalTracks} {totalTracks === 1 ? 'track' : 'tracks'}</span>
            </div>
            <span class="text-xs text-base-content/40 shrink-0">{timeAgo(latestTimestamp)}</span>
        </div>

        <!-- Album sub-groups -->
        <div class="space-y-1.5 ml-1">
            {#each albumGroups as albumGroup}
                {@const albumLink = entry.parent_id && albumGroup.albumId ? `/music/${entry.parent_id}/${albumGroup.albumId}` : null}
                <div class="rounded-lg bg-base-300/20 overflow-hidden">
                    <!-- Album header (if multiple albums or multiple tracks) -->
                    {#if albumGroups.length > 1 || albumGroup.tracks.length > 1}
                        <div class="flex items-center gap-2.5 px-2.5 py-1.5">
                            {#if albumGroup.albumArtUrl && albumGroups.length > 1}
                                <img
                                    src={albumGroup.albumArtUrl}
                                    alt=""
                                    class="w-9 h-9 rounded object-cover shadow-sm shrink-0"
                                />
                            {/if}
                            {#if albumLink}
                                <a href={albumLink} class="text-xs font-medium text-base-content/60 hover:text-primary transition-colors truncate">
                                    {albumGroup.albumTitle}
                                </a>
                            {:else}
                                <span class="text-xs font-medium text-base-content/60 truncate">{albumGroup.albumTitle}</span>
                            {/if}
                            <span class="text-[10px] text-base-content/30 shrink-0">{albumGroup.tracks.length} {albumGroup.tracks.length === 1 ? 'track' : 'tracks'}</span>
                        </div>
                    {/if}

                    <!-- Track list -->
                    <div class="space-y-0">
                        {#each albumGroup.tracks as track}
                            {@const runtime = getTrackRuntime(track)}
                            <div class="flex items-center gap-2 px-2.5 py-0.5 text-xs text-base-content/70 hover:bg-base-300/30 transition-colors">
                                <span class="truncate flex-1">
                                    {track.track_name || track.item_title}
                                    {#if runtime && albumGroup.tracks.length > 1}
                                        <span class="text-base-content/30 ml-1">{runtime}</span>
                                    {/if}
                                </span>
                                <div class="shrink-0">
                                    {@render sourceBadge(track.source)}
                                </div>
                            </div>
                        {/each}
                    </div>
                </div>
            {/each}
        </div>
    </div>

    <!-- ═══ SINGLE ENTRY MODE ═══ -->
{:else}
    {#snippet content()}
        <!-- Poster / Icon -->
        <div class="flex-shrink-0">
            {#if posterUrl}
                <img
                    src={posterUrl}
                    alt=""
                    class="{isVideoMedia
                        ? 'w-16 h-24'
                        : 'w-8 h-8'} rounded-lg object-cover shadow-sm"
                />
            {:else}
                <div
                    class="{isVideoMedia
                        ? 'w-16 h-24'
                        : 'w-8 h-8'} rounded-lg bg-base-300 flex items-center justify-center {isVideoMedia
                        ? 'text-2xl'
                        : 'text-sm'}"
                >
                    {getMediaIcon(entry.media_type)}
                </div>
            {/if}
        </div>

        <!-- Content -->
        <div
            class="flex-1 min-w-0 {isVideoMedia
                ? 'flex flex-col justify-center gap-0.5'
                : 'flex flex-col justify-center'}"
        >
            <div class="flex items-center gap-1.5">
                <span
                    class="font-medium {isVideoMedia
                        ? 'text-base'
                        : 'text-sm'} truncate group-hover:text-primary transition-colors"
                >
                    {title.primary}
                </span>
                {#if title.secondary && !isVideoMedia}
                    <span class="text-base-content/40 text-sm">—</span>
                    <span class="text-sm text-base-content/70 truncate">{title.secondary}</span>
                {/if}
            </div>
            {#if title.secondary && isVideoMedia}
                <span class="text-sm text-base-content/70 truncate">{title.secondary}</span>
            {/if}
            <!-- Runtime subtitle for single entries -->
            {#if getTrackRuntime(entry)}
                <span class="text-xs text-base-content/30">{getTrackRuntime(entry)}</span>
            {/if}
        </div>

        <!-- Badges + timestamp — right side -->
        <div class="flex-shrink-0 flex items-center gap-2">
            <div class="avatar-group -space-x-2">
                <div class="avatar placeholder">
                    {@render sourceBadge(entry.source)}
                </div>
                {#if isExternal}
                    <div class="avatar placeholder">
                        {@render externalBadge(entry.media_type)}
                    </div>
                {/if}
            </div>
            <span class="text-xs text-base-content/40 w-16 text-right"
                >{timeAgo(entry.timestamp)}</span
            >
            {#if link}
                <svg
                    xmlns="http://www.w3.org/2000/svg"
                    class="h-3 w-3 text-base-content/15 group-hover:text-primary/50 transition-colors"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                >
                    <polyline points="9 18 15 12 9 6" />
                </svg>
            {/if}
        </div>
    {/snippet}

    {#if link}
        <a
            href={link}
            class="flex items-center gap-2.5 px-3 py-1.5 hover:bg-base-200/50 transition-colors group no-underline text-inherit"
        >
            {@render content()}
        </a>
    {:else}
        <div
            class="flex items-center gap-2.5 px-3 py-1.5 hover:bg-base-200/50 transition-colors group"
        >
            {@render content()}
        </div>
    {/if}
{/if}
