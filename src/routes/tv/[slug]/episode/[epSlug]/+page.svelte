<script>
    /** @type {{ data: any }} */
    let { data } = $props();
    import { imgUrl } from "$lib/utils.js";
    import MediaDetailHeader from "$lib/components/MediaDetailHeader.svelte";
    import CollectionStatusBanner from "$lib/components/CollectionStatusBanner.svelte";
    import InteractiveSearchDialog from "$lib/components/InteractiveSearchDialog.svelte";
    import { invalidateAll } from '$app/navigation';

    const ep = data.episode;
    const show = data.show;
    const jf = data.jellyfinData;

    function formatRuntime(/** @type {number|null} */ minutes) {
        if (!minutes) return null;
        const h = Math.floor(minutes / 60);
        const m = Math.round(minutes % 60);
        return h > 0 ? `${h}h ${m}m` : `${m}m`;
    }

    function formatDate(/** @type {string|null} */ d) {
        if (!d) return "—";
        return new Date(d).toLocaleDateString("en-US", {
            year: "numeric",
            month: "short",
            day: "numeric",
        });
    }

    function timeAgo(/** @type {string|null} */ timestamp) {
        if (!timestamp) return "";
        const diff = Date.now() - new Date(timestamp).getTime();
        const days = Math.floor(diff / 86400000);
        if (days === 0) return "today";
        if (days === 1) return "yesterday";
        if (days < 30) return `${days} days ago`;
        const months = Math.floor(days / 30);
        return months === 1 ? "1 month ago" : `${months} months ago`;
    }

    const statusConfig = {
        watched: { icon: "✅", label: "Watched", cls: "badge-success" },
        in_progress: { icon: "▶️", label: "In Progress", cls: "badge-warning" },
        unwatched: { icon: "⬜", label: "Unwatched", cls: "badge-ghost" },
    };
    const status = statusConfig[ep.watch_status] || statusConfig.unwatched;

    const epCode = `S${String(ep.season_number).padStart(2, '0')}E${String(ep.item_number).padStart(2, '0')}`;
</script>

<svelte:head>
    <title>
        {epCode} {ep.title} — {show.title} — Mediajam
    </title>
</svelte:head>

<div class="space-y-6 max-w-6xl mx-auto">

    <!-- Hero: MediaDetailHeader with series poster/backdrop + episode info -->
    <MediaDetailHeader
        mediaType="show"
        backHref="/tv/{show.id}"
        backLabel={show.title}
        title={ep.title}
        subtitle="{epCode} · {show.title}"
        posterUrl={data.posterUrl || null}
        backdropUrl={data.backdropUrl || jf?.screenshotUrl || data.screenshotUrl || null}
        year={show.release_year}
        overview={jf?.overview || null}
        overviewSource="Synopsis"
        watchStatusBadge={{ label: `${status.icon} ${status.label}`, cls: status.cls }}
        heroBadges={[
            { label: `Season ${ep.season_number}` },
            { label: `Episode ${ep.item_number}` },
            ...(ep.is_special ? [{ label: 'Special', cls: 'badge-secondary' }] : []),
            ...(formatRuntime(ep.runtime_minutes) ? [{ label: `🕐 ${formatRuntime(ep.runtime_minutes)}` }] : []),
            ...(ep.premiere_date ? [{ label: `📅 ${formatDate(ep.premiere_date)}` }] : []),
            ...(jf?.communityRating ? [{ label: `★ ${jf.communityRating.toFixed(1)}`, cls: 'badge-warning' }] : []),
            ...(jf?.officialRating ? [{ label: jf.officialRating }] : []),
        ]}
        stats={[
            { label: ep.play_count === 1 ? 'play' : 'plays', value: ep.play_count || 0 },
            ...(data.stats.firstWatched ? [{ label: 'first watched', value: timeAgo(data.stats.firstWatched) }] : []),
            ...(data.stats.lastWatched && data.stats.totalPlays > 1 ? [{ label: 'last watched', value: timeAgo(data.stats.lastWatched) }] : []),
        ]}
        externalLinks={{
            jellyfin_id: ep.jellyfin_id,
            jellyfin_url: data.jellyfinUrl,
            mediaType: 'show'
        }}
    >
        {#snippet actions()}
            {#if show.sonarr_id}
                <InteractiveSearchDialog
                    service="sonarr"
                    mediaParentId={show.id}
                    episodeId={ep.id}
                    title="{show.title} {epCode}"
                />
            {/if}
        {/snippet}
    </MediaDetailHeader>

    <!-- Collection Status Banner for missing episodes -->
    {#if !ep.is_collected && show.sonarr_id}
        <CollectionStatusBanner
            mediaParentId={show.id}
            mediaType="show"
            title="{show.title} {epCode}"
            collectionStatus={ep.is_collected ? 'collected' : 'wanted'}
            arrHasFile={ep.is_collected}
            arrId={show.sonarr_id}
            arrMonitored={show.arr_monitored || true}
            releaseYear={show.release_year}
            premiereDate={ep.premiere_date}
            service="sonarr"
            jellyfinId={ep.jellyfin_id}
            tmdbId={show.tmdb_id}
            onStatusChange={() => invalidateAll()}
        />
    {/if}

    <!-- Episode Navigation (Prev/Next) -->
    <div class="flex items-center justify-between">
        {#if data.prevEpisode}
            <a
                href="/tv/{show.id}/episode/{data.prevEpisode.id}"
                class="btn btn-ghost btn-sm gap-1"
            >
                ← S{data.prevEpisode.season_number}E{data.prevEpisode.item_number}
            </a>
        {:else}
            <div></div>
        {/if}
        {#if data.nextEpisode}
            <a
                href="/tv/{show.id}/episode/{data.nextEpisode.id}"
                class="btn btn-ghost btn-sm gap-1"
            >
                S{data.nextEpisode.season_number}E{data.nextEpisode.item_number} →
            </a>
        {/if}
    </div>

    <!-- Directors & Writers -->
    {#if jf?.directors?.length || jf?.writers?.length}
        <div class="flex flex-wrap gap-4">
            {#if jf.directors?.length}
                <div class="flex items-center gap-2">
                    <span class="text-sm font-semibold text-base-content/60">Directed by</span>
                    <span class="text-sm">{jf.directors.join(", ")}</span>
                </div>
            {/if}
            {#if jf.writers?.length}
                <div class="flex items-center gap-2">
                    <span class="text-sm font-semibold text-base-content/60">Written by</span>
                    <span class="text-sm">{jf.writers.join(", ")}</span>
                </div>
            {/if}
        </div>
    {/if}

    <!-- Guest Stars (from Jellyfin/TMDb) -->
    {#if jf?.guestStars?.length}
        <div class="space-y-3">
            <h2 class="text-xl font-bold">Guest Stars</h2>
            <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
                {#each jf.guestStars as guest}
                    {@const guestHref = guest.personSlug ? `/people/${guest.personSlug}` : guest.personId ? `/people/${guest.personId}` : null}
                    {@const Tag = guestHref ? "a" : "div"}
                    <svelte:element
                        this={Tag}
                        href={guestHref || undefined}
                        class="flex items-center gap-3 bg-base-200 rounded-lg p-2 {guestHref ? 'hover:bg-base-300 transition-colors' : ''}"
                    >
                        {#if guest.photoUrl}
                            <img src={imgUrl(guest.photoUrl)} alt={guest.name} class="w-10 h-10 rounded-full object-cover shrink-0" />
                        {:else}
                            <div class="w-10 h-10 rounded-full bg-base-300 flex items-center justify-center text-sm shrink-0">👤</div>
                        {/if}
                        <div class="min-w-0">
                            <div class="font-medium text-sm truncate">{guest.name}</div>
                            {#if guest.role}
                                <div class="text-xs text-base-content/50 truncate">{guest.role}</div>
                            {/if}
                        </div>
                    </svelte:element>
                {/each}
            </div>
        </div>
    {/if}

    <!-- Series Cast -->
    {#if data.cast.length}
        <div class="space-y-3">
            <h2 class="text-xl font-bold">Series Cast</h2>
            <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
                {#each data.cast.slice(0, 15) as person}
                    <a href="/people/{person.slug || person.id}" class="flex items-center gap-3 bg-base-200 rounded-lg p-2 hover:bg-base-300 transition-colors">
                        {#if person.photo_url}
                            <img src={imgUrl(person.photo_url)} alt={person.name} class="w-10 h-10 rounded-full object-cover shrink-0" />
                        {:else}
                            <div class="w-10 h-10 rounded-full bg-base-300 flex items-center justify-center text-sm shrink-0">👤</div>
                        {/if}
                        <div class="min-w-0">
                            <div class="font-medium text-sm truncate">{person.name}</div>
                            {#if person.character_name}
                                <div class="text-xs text-base-content/50 truncate">{person.character_name}</div>
                            {/if}
                        </div>
                    </a>
                {/each}
            </div>
            {#if data.cast.length > 15}
                <a href="/tv/{show.id}" class="btn btn-ghost btn-sm">
                    View all {data.cast.length} cast members →
                </a>
            {/if}
        </div>
    {/if}

    <!-- Crew -->
    {#if data.crew.length}
        <div class="space-y-3">
            <h2 class="text-xl font-bold">Crew</h2>
            <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                {#each data.crew as person}
                    <a href="/people/{person.slug || person.id}" class="flex items-center gap-3 bg-base-200 rounded-lg p-2 hover:bg-base-300 transition-colors">
                        {#if person.photo_url}
                            <img src={imgUrl(person.photo_url)} alt={person.name} class="w-10 h-10 rounded-full object-cover shrink-0" />
                        {:else}
                            <div class="w-10 h-10 rounded-full bg-base-300 flex items-center justify-center text-sm shrink-0">👤</div>
                        {/if}
                        <div class="min-w-0">
                            <div class="font-medium text-sm truncate">{person.name}</div>
                            <div class="text-xs text-base-content/50 truncate capitalize">{person.role_type}</div>
                        </div>
                    </a>
                {/each}
            </div>
        </div>
    {/if}

    <!-- Playback History -->
    {#if data.history.length}
        <div class="space-y-3">
            <h2 class="text-xl font-bold">Playback History</h2>
            <div class="overflow-x-auto">
                <table class="table table-sm">
                    <thead>
                        <tr>
                            <th>Date</th>
                            <th>Source</th>
                            <th>Duration</th>
                            <th>Completion</th>
                        </tr>
                    </thead>
                    <tbody>
                        {#each data.history as entry}
                            <tr>
                                <td>{formatDate(entry.timestamp)}</td>
                                <td>
                                    <span class="badge badge-ghost badge-xs capitalize">{entry.source || "unknown"}</span>
                                </td>
                                <td>
                                    {#if entry.duration_consumed_seconds}
                                        {Math.round(entry.duration_consumed_seconds / 60)}m
                                    {:else}
                                        —
                                    {/if}
                                </td>
                                <td>
                                    {#if entry.completion_pct != null}
                                        <div class="flex items-center gap-2">
                                            <progress class="progress progress-primary w-16" value={entry.completion_pct} max="100"></progress>
                                            <span class="text-xs">{Math.round(entry.completion_pct)}%</span>
                                        </div>
                                    {:else}
                                        —
                                    {/if}
                                </td>
                            </tr>
                        {/each}
                    </tbody>
                </table>
            </div>
        </div>
    {/if}
</div>
