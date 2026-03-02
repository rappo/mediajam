<script>
    /** @type {{ entry: any, jellyfinUrl?: string }} */
    let { entry, jellyfinUrl = '' } = $props();

    function timeAgo(timestamp) {
        if (!timestamp) return '';
        const diff = Date.now() - new Date(timestamp).getTime();
        const minutes = Math.floor(diff / 60000);
        if (minutes < 1) return 'Just now';
        if (minutes < 60) return `${minutes}m ago`;
        const hours = Math.floor(minutes / 60);
        if (hours < 24) return `${hours}h ago`;
        const days = Math.floor(hours / 24);
        if (days < 7) return `${days}d ago`;
        return new Date(timestamp).toLocaleDateString();
    }

    function formatDuration(seconds) {
        if (!seconds) return '';
        if (seconds < 60) return `${seconds}s`;
        const mins = Math.floor(seconds / 60);
        if (mins < 60) return `${mins}m`;
        const hours = Math.floor(mins / 60);
        const remainMins = mins % 60;
        return `${hours}h ${remainMins}m`;
    }

    function getMediaIcon(type) {
        if (type === 'show') return '📺';
        if (type === 'artist') return '🎵';
        return '🎬';
    }

    function getSourceBadge(source) {
        switch (source) {
            case 'webhook': return { label: 'Live', class: 'badge-success' };
            case 'trakt': return { label: 'Trakt', class: 'badge-info' };
            case 'lastfm': return { label: 'Last.fm', class: 'badge-secondary' };
            case 'jellyfin_pr': return { label: 'Jellyfin', class: 'badge-primary' };
            case 'legacy': return { label: 'Legacy', class: 'badge-ghost' };
            default: return { label: source, class: 'badge-ghost' };
        }
    }

    function getTitle() {
        if (entry.media_type === 'show' && entry.season_number != null) {
            return `${entry.parent_title} — S${String(entry.season_number).padStart(2, '0')}E${String(entry.item_number).padStart(2, '0')} "${entry.item_title}"`;
        }
        if (entry.media_type === 'artist') {
            return `${entry.parent_title} — ${entry.item_title}`;
        }
        return entry.item_title || entry.parent_title;
    }

    const posterUrl = entry.poster_url || (entry.parent_jellyfin_id && jellyfinUrl
        ? `${jellyfinUrl}/Items/${entry.parent_jellyfin_id}/Images/Primary?maxHeight=80`
        : null);

    const sourceBadge = getSourceBadge(entry.source);
</script>

<div class="flex items-center gap-3 p-3 rounded-xl hover:bg-base-200/50 transition-colors group">
    <!-- Poster / Icon -->
    <div class="flex-shrink-0">
        {#if posterUrl}
            <img src={posterUrl} alt="" class="w-10 h-14 rounded-lg object-cover shadow-sm" />
        {:else}
            <div class="w-10 h-14 rounded-lg bg-base-300 flex items-center justify-center text-xl">
                {getMediaIcon(entry.media_type)}
            </div>
        {/if}
    </div>

    <!-- Content -->
    <div class="flex-1 min-w-0">
        <p class="font-medium text-sm text-base-content truncate">{getTitle()}</p>
        <div class="flex items-center gap-2 mt-0.5">
            <span class="badge {sourceBadge.class} badge-xs">{sourceBadge.label}</span>
            {#if entry.duration_consumed_seconds}
                <span class="text-xs text-base-content/50">{formatDuration(entry.duration_consumed_seconds)}</span>
            {/if}
            {#if entry.completion_pct != null}
                <span class="text-xs text-base-content/40">{Math.round(entry.completion_pct)}%</span>
            {/if}
        </div>
    </div>

    <!-- Timestamp -->
    <div class="flex-shrink-0 text-right">
        <span class="text-xs text-base-content/50">{timeAgo(entry.timestamp)}</span>
    </div>
</div>
