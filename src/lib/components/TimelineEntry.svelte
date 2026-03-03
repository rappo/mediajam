<script>
    /** @type {{ entry: any, jellyfinUrl?: string }} */
    let { entry, jellyfinUrl = "" } = $props();

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

    /** @param {string} type */
    function getMediaIcon(type) {
        if (type === "show") return "📺";
        if (type === "artist") return "🎵";
        return "🎬";
    }

    /** @param {string} source */
    function getSourceBadge(source) {
        /** @type {Record<string, {label: string, cls: string}>} */
        const badges = {
            webhook: { label: "Live", cls: "badge-success" },
            trakt: { label: "Trakt", cls: "badge-info" },
            lastfm: { label: "Last.fm", cls: "badge-secondary" },
            jellyfin_pr: { label: "Jellyfin", cls: "badge-primary" },
            legacy: { label: "Legacy", cls: "badge-ghost" },
            seed: { label: "Seed", cls: "badge-ghost" },
        };
        return badges[source] || { label: source, cls: "badge-ghost" };
    }

    function getTitle() {
        if (entry.media_type === "artist") {
            const trackDisplay = entry.track_name || entry.item_title;
            return { primary: entry.parent_title, secondary: trackDisplay };
        }
        if (entry.media_type === "show" && entry.season_number != null) {
            const ep = `S${String(entry.season_number).padStart(2, "0")}E${String(entry.item_number).padStart(2, "0")}`;
            return {
                primary: entry.parent_title,
                secondary: `${ep} "${entry.item_title}"`,
            };
        }
        return {
            primary: entry.item_title || entry.parent_title,
            secondary: null,
        };
    }

    function getLink() {
        if (
            entry.media_type === "artist" &&
            entry.parent_id &&
            entry.media_id
        ) {
            return `/music/${entry.parent_id}/${entry.media_id}`;
        }
        if (entry.media_type === "artist" && entry.parent_id) {
            return `/music/${entry.parent_id}`;
        }
        if (entry.media_type === "show") return `/tv`;
        if (entry.media_type === "movie") return `/movies`;
        return null;
    }

    const posterUrl =
        entry.album_art_url ||
        entry.poster_url ||
        (entry.parent_jellyfin_id && jellyfinUrl
            ? `${jellyfinUrl}/Items/${entry.parent_jellyfin_id}/Images/Primary?maxHeight=60`
            : null);

    const sourceBadge = getSourceBadge(entry.source);
    const link = getLink();
    const title = getTitle();
    const isExternal = entry.collection_status === "external";
</script>

{#snippet content()}
    <!-- Poster / Icon — compact -->
    <div class="flex-shrink-0">
        {#if posterUrl}
            <img src={posterUrl} alt="" class="w-8 h-8 rounded object-cover" />
        {:else}
            <div
                class="w-8 h-8 rounded bg-base-300 flex items-center justify-center text-sm"
            >
                {getMediaIcon(entry.media_type)}
            </div>
        {/if}
    </div>

    <!-- Content — single line condensed -->
    <div class="flex-1 min-w-0 flex items-center gap-1.5">
        <span
            class="font-medium text-sm truncate group-hover:text-primary transition-colors"
        >
            {title.primary}
        </span>
        {#if title.secondary}
            <span class="text-base-content/40 text-sm">—</span>
            <span class="text-sm text-base-content/70 truncate"
                >{title.secondary}</span
            >
        {/if}
    </div>

    <!-- Badges + timestamp — right side -->
    <div class="flex-shrink-0 flex items-center gap-2">
        <span class="badge {sourceBadge.cls} badge-xs">{sourceBadge.label}</span
        >
        {#if isExternal}
            <span class="badge badge-warning badge-xs">📡</span>
        {/if}
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
