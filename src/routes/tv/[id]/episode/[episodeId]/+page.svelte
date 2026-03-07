<script>
    /** @type {{ data: any }} */
    let { data } = $props();
    import { imgUrl } from "$lib/utils.js";

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
</script>

<svelte:head>
    <title
        >S{ep.season_number}E{ep.item_number}
        {ep.title} — {show.title} — Mediajam</title
    >
</svelte:head>

<div class="space-y-6 max-w-5xl mx-auto">
    <!-- Breadcrumb nav -->
    <div class="flex items-center gap-2 text-sm">
        <a href="/tv" class="btn btn-ghost btn-xs">← TV Shows</a>
        <span class="text-base-content/30">›</span>
        <a href="/tv/{show.id}" class="btn btn-ghost btn-xs truncate max-w-48"
            >{show.title}</a
        >
        <span class="text-base-content/30">›</span>
        <span class="text-base-content/50"
            >S{ep.season_number}E{ep.item_number}</span
        >
    </div>

    <!-- Hero: Screenshot + Episode Info -->
    <div class="relative rounded-2xl overflow-hidden border border-base-300">
        {#if data.screenshotUrl}
            <img
                src={imgUrl(data.screenshotUrl)}
                alt=""
                class="w-full h-56 md:h-72 object-cover opacity-40"
            />
            <div
                class="absolute inset-0 bg-gradient-to-t from-base-100 via-base-100/80 to-transparent"
            ></div>
            <div class="absolute bottom-0 left-0 right-0 p-6">
                <div class="space-y-2">
                    <div class="flex items-center gap-2 flex-wrap">
                        <span class="badge badge-outline badge-sm"
                            >Season {ep.season_number}</span
                        >
                        <span class="badge badge-outline badge-sm"
                            >Episode {ep.item_number}</span
                        >
                        <span class="badge {status.cls} badge-sm gap-1">
                            {status.icon}
                            {status.label}
                        </span>
                        {#if ep.is_special}
                            <span class="badge badge-secondary badge-sm"
                                >Special</span
                            >
                        {/if}
                    </div>
                    <h1 class="text-3xl md:text-4xl font-bold leading-tight">
                        {ep.title}
                    </h1>
                    <div
                        class="flex items-center gap-3 text-sm text-base-content/60 flex-wrap"
                    >
                        {#if jf?.communityRating}
                            <span class="text-warning font-semibold"
                                >★ {jf.communityRating.toFixed(1)}</span
                            >
                        {/if}
                        {#if formatRuntime(ep.runtime_minutes)}
                            <span>🕐 {formatRuntime(ep.runtime_minutes)}</span>
                        {/if}
                        {#if ep.premiere_date}
                            <span>📅 {formatDate(ep.premiere_date)}</span>
                        {/if}
                        {#if jf?.officialRating}
                            <span class="badge badge-outline badge-xs"
                                >{jf.officialRating}</span
                            >
                        {/if}
                    </div>
                </div>
            </div>
        {:else}
            <!-- No screenshot fallback -->
            <div class="p-6 space-y-2">
                <div class="flex items-center gap-2 flex-wrap">
                    <span class="badge badge-outline badge-sm"
                        >Season {ep.season_number}</span
                    >
                    <span class="badge badge-outline badge-sm"
                        >Episode {ep.item_number}</span
                    >
                    <span class="badge {status.cls} badge-sm gap-1">
                        {status.icon}
                        {status.label}
                    </span>
                    {#if ep.is_special}
                        <span class="badge badge-secondary badge-sm"
                            >Special</span
                        >
                    {/if}
                </div>
                <h1 class="text-3xl md:text-4xl font-bold leading-tight">
                    {ep.title}
                </h1>
                <div
                    class="flex items-center gap-3 text-sm text-base-content/60 flex-wrap"
                >
                    {#if jf?.communityRating}
                        <span class="text-warning font-semibold"
                            >★ {jf.communityRating.toFixed(1)}</span
                        >
                    {/if}
                    {#if formatRuntime(ep.runtime_minutes)}
                        <span>🕐 {formatRuntime(ep.runtime_minutes)}</span>
                    {/if}
                    {#if ep.premiere_date}
                        <span>📅 {formatDate(ep.premiere_date)}</span>
                    {/if}
                    {#if jf?.officialRating}
                        <span class="badge badge-outline badge-xs"
                            >{jf.officialRating}</span
                        >
                    {/if}
                </div>
            </div>
        {/if}
    </div>

    <!-- Episode Navigation (Prev/Next) -->
    <div class="flex items-center justify-between">
        {#if data.prevEpisode}
            <a
                href="/tv/{show.id}/episode/{data.prevEpisode.id}"
                class="btn btn-ghost btn-sm gap-1"
            >
                ← S{data.prevEpisode.season_number}E{data.prevEpisode
                    .item_number}
            </a>
        {:else}
            <div></div>
        {/if}
        {#if data.nextEpisode}
            <a
                href="/tv/{show.id}/episode/{data.nextEpisode.id}"
                class="btn btn-ghost btn-sm gap-1"
            >
                S{data.nextEpisode.season_number}E{data.nextEpisode.item_number}
                →
            </a>
        {/if}
    </div>

    <!-- Synopsis -->
    {#if jf?.overview}
        <div class="card bg-base-200">
            <div class="card-body">
                <h2 class="card-title text-lg">Synopsis</h2>
                <p class="text-base-content/80 leading-relaxed">
                    {jf.overview}
                </p>
            </div>
        </div>
    {/if}

    <!-- Directors & Writers -->
    {#if jf?.directors?.length || jf?.writers?.length}
        <div class="flex flex-wrap gap-4">
            {#if jf.directors?.length}
                <div class="flex items-center gap-2">
                    <span class="text-sm font-semibold text-base-content/60"
                        >Directed by</span
                    >
                    <span class="text-sm">{jf.directors.join(", ")}</span>
                </div>
            {/if}
            {#if jf.writers?.length}
                <div class="flex items-center gap-2">
                    <span class="text-sm font-semibold text-base-content/60"
                        >Written by</span
                    >
                    <span class="text-sm">{jf.writers.join(", ")}</span>
                </div>
            {/if}
        </div>
    {/if}

    <!-- Stats Cards -->
    <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div class="stat bg-base-200 rounded-box p-4">
            <div class="stat-title text-xs">Status</div>
            <div class="stat-value text-lg">{status.icon} {status.label}</div>
        </div>
        <div class="stat bg-base-200 rounded-box p-4">
            <div class="stat-title text-xs">Play Count</div>
            <div class="stat-value text-lg">{ep.play_count}</div>
        </div>
        {#if data.stats.firstWatched}
            <div class="stat bg-base-200 rounded-box p-4">
                <div class="stat-title text-xs">First Watched</div>
                <div class="stat-value text-lg">
                    {timeAgo(data.stats.firstWatched)}
                </div>
                <div class="stat-desc">
                    {formatDate(data.stats.firstWatched)}
                </div>
            </div>
        {/if}
        {#if data.stats.lastWatched}
            <div class="stat bg-base-200 rounded-box p-4">
                <div class="stat-title text-xs">Last Watched</div>
                <div class="stat-value text-lg">
                    {timeAgo(data.stats.lastWatched)}
                </div>
                <div class="stat-desc">
                    {formatDate(data.stats.lastWatched)}
                </div>
            </div>
        {/if}
    </div>

    <!-- Guest Stars (from Jellyfin/TMDb) -->
    {#if jf?.guestStars?.length}
        <div class="space-y-3">
            <h2 class="text-xl font-bold">Guest Stars</h2>
            <div
                class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3"
            >
                {#each jf.guestStars as guest}
                    {@const Tag = guest.personId ? "a" : "div"}
                    <svelte:element
                        this={Tag}
                        href={guest.personId
                            ? `/people/${guest.personId}`
                            : undefined}
                        class="flex items-center gap-3 bg-base-200 rounded-lg p-2 {guest.personId
                            ? 'hover:bg-base-300 transition-colors'
                            : ''}"
                    >
                        {#if guest.photoUrl}
                            <img
                                src={imgUrl(guest.photoUrl)}
                                alt={guest.name}
                                class="w-10 h-10 rounded-full object-cover shrink-0"
                            />
                        {:else}
                            <div
                                class="w-10 h-10 rounded-full bg-base-300 flex items-center justify-center text-sm shrink-0"
                            >
                                👤
                            </div>
                        {/if}
                        <div class="min-w-0">
                            <div class="font-medium text-sm truncate">
                                {guest.name}
                            </div>
                            {#if guest.role}
                                <div
                                    class="text-xs text-base-content/50 truncate"
                                >
                                    {guest.role}
                                </div>
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
            <div
                class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3"
            >
                {#each data.cast.slice(0, 15) as person}
                    <a
                        href="/people/{person.id}"
                        class="flex items-center gap-3 bg-base-200 rounded-lg p-2 hover:bg-base-300 transition-colors"
                    >
                        {#if person.photo_url}
                            <img
                                src={imgUrl(person.photo_url)}
                                alt={person.name}
                                class="w-10 h-10 rounded-full object-cover shrink-0"
                            />
                        {:else}
                            <div
                                class="w-10 h-10 rounded-full bg-base-300 flex items-center justify-center text-sm shrink-0"
                            >
                                👤
                            </div>
                        {/if}
                        <div class="min-w-0">
                            <div class="font-medium text-sm truncate">
                                {person.name}
                            </div>
                            {#if person.character_name}
                                <div
                                    class="text-xs text-base-content/50 truncate"
                                >
                                    {person.character_name}
                                </div>
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
                    <a
                        href="/people/{person.id}"
                        class="flex items-center gap-3 bg-base-200 rounded-lg p-2 hover:bg-base-300 transition-colors"
                    >
                        {#if person.photo_url}
                            <img
                                src={imgUrl(person.photo_url)}
                                alt={person.name}
                                class="w-10 h-10 rounded-full object-cover shrink-0"
                            />
                        {:else}
                            <div
                                class="w-10 h-10 rounded-full bg-base-300 flex items-center justify-center text-sm shrink-0"
                            >
                                👤
                            </div>
                        {/if}
                        <div class="min-w-0">
                            <div class="font-medium text-sm truncate">
                                {person.name}
                            </div>
                            <div
                                class="text-xs text-base-content/50 truncate capitalize"
                            >
                                {person.role_type}
                            </div>
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
                                    <span
                                        class="badge badge-ghost badge-xs capitalize"
                                        >{entry.source || "unknown"}</span
                                    >
                                </td>
                                <td>
                                    {#if entry.duration_consumed_seconds}
                                        {Math.round(
                                            entry.duration_consumed_seconds /
                                                60,
                                        )}m
                                    {:else}
                                        —
                                    {/if}
                                </td>
                                <td>
                                    {#if entry.completion_pct != null}
                                        <div class="flex items-center gap-2">
                                            <progress
                                                class="progress progress-primary w-16"
                                                value={entry.completion_pct}
                                                max="100"
                                            ></progress>
                                            <span class="text-xs"
                                                >{Math.round(
                                                    entry.completion_pct,
                                                )}%</span
                                            >
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
