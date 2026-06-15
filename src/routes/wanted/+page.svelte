<script>
    import { onMount, onDestroy } from 'svelte';
    import { imgUrl } from '$lib/utils.js';
    import Skeleton from '$lib/components/Skeleton.svelte';
    import MdiIcon from '$lib/components/MdiIcon.svelte';
    import { mdiSync, mdiCloseCircle, mdiMagnify, mdiCalendar, mdiArrowUp, mdiMovieOpen, mdiTelevision, mdiMusic, mdiRefresh, mdiPartyPopper, mdiPackageVariant, mdiChevronDown, mdiCheck } from '@mdi/js';

    let loading = $state(true);
    let items = $state(/** @type {any[]} */ ([]));
    let summary = $state(/** @type {any} */ ({ total: 0, totalItems: 0, byReason: {}, byService: {} }));
    let error = $state('');

    // Filters
    let filterReason = $state('all');
    let filterService = $state('all');
    let includeCutoff = $state(false);

    // Expanded items
    let expandedIds = $state(/** @type {Set<string>} */ (new Set()));

    // Auto-refresh
    let refreshInterval = $state(/** @type {ReturnType<typeof setInterval>|null} */ (null));
    let lastRefresh = $state(/** @type {Date|null} */ (null));

    // Searching items
    let searchingIds = $state(/** @type {Set<string>} */ (new Set()));
    let searchedIds = $state(/** @type {Set<string>} */ (new Set()));

    let refreshing = $state(false);

    async function fetchWanted(force = false) {
        try {
            const params = new URLSearchParams();
            if (includeCutoff) params.set('includeCutoff', '1');
            if (force) params.set('refresh', '1');
            const qs = params.toString() ? `?${params}` : '';
            const res = await fetch(`/api/arr/wanted${qs}`);
            if (!res.ok) throw new Error('Failed to fetch');
            const data = await res.json();
            items = data.items;
            summary = data.summary;
            refreshing = !!data.refreshing;
            lastRefresh = new Date();
            error = '';

            // If server said it's refreshing in background, poll once more after a few seconds
            if (data.refreshing) {
                setTimeout(() => fetchWanted(false), 5000);
            }
        } catch (e) {
            error = e instanceof Error ? e.message : 'Failed to load wanted items';
        }
        loading = false;
    }

    function forceRefresh() {
        refreshing = true;
        fetchWanted(true);
    }

    let mounted = false;
    onMount(() => { mounted = true; fetchWanted(); });

    // Re-fetch when cutoff toggle changes (but not on mount)
    $effect(() => {
        void includeCutoff;
        if (!mounted) return;
        loading = true;
        fetchWanted(true);
    });

    // Auto-refresh when items are in queue
    $effect(() => {
        if (items.some(i => i.reason === 'in_queue')) {
            const id = setInterval(() => fetchWanted(false), 15000);
            return () => clearInterval(id);
        }
    });

    function toggleExpand(id) {
        const next = new Set(expandedIds);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        expandedIds = next;
    }

    /** @param {any} item */
    function itemKey(item) {
        return `${item.service}-${item.arrId}`;
    }

    let filteredItems = $derived(items.filter(item => {
        if (filterReason !== 'all' && item.reason !== filterReason) return false;
        if (filterService !== 'all' && item.service !== filterService) return false;
        return true;
    }));

    const REASON_META = {
        in_queue: { icon: mdiSync, color: 'info', label: 'Downloading' },
        failed: { icon: mdiCloseCircle, color: 'error', label: 'Failed' },
        not_available: { icon: mdiMagnify, color: 'warning', label: 'Missing' },
        not_out_yet: { icon: mdiCalendar, color: 'neutral', label: 'Unreleased' },
        cutoff_unmet: { icon: mdiArrowUp, color: 'secondary', label: 'Upgrade' },
    };

    const SERVICE_META = {
        radarr: { icon: mdiMovieOpen, label: 'Movies', color: '#ffa500' },
        sonarr: { icon: mdiTelevision, label: 'Shows', color: '#3fc1c9' },
        lidarr: { icon: mdiMusic, label: 'Music', color: '#a78bfa' },
    };

    /** @param {any} item */
    async function triggerSearch(item) {
        const key = itemKey(item);
        const next = new Set(searchingIds);
        next.add(key);
        searchingIds = next;

        try {
            const service = item.service;
            const commandName = service === 'radarr' ? 'MoviesSearch'
                : service === 'sonarr' ? 'SeriesSearch'
                : 'ArtistSearch';
            const idField = service === 'radarr' ? 'movieIds'
                : service === 'sonarr' ? 'seriesId'
                : 'artistId';
            const body = {
                name: commandName,
                [idField]: service === 'radarr' ? [item.arrId] : item.arrId,
            };

            const settings = await fetch('/api/settings').then(r => r.json());
            const baseUrl = settings[`${service}_url`] || settings[`${service}Url`];
            const apiKey = settings[`${service}_api_key`] || settings[`${service}ApiKey`];

            // Use the existing search endpoint
            if (item.mediaParentId) {
                await fetch(`/api/arr/${service}/search`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ mediaParentId: item.mediaParentId }),
                });
            }

            const done = new Set(searchedIds);
            done.add(key);
            searchedIds = done;
        } catch (e) {
            console.error('Search failed:', e);
        }

        const rm = new Set(searchingIds);
        rm.delete(key);
        searchingIds = rm;
    }

    /** @param {string} ts */
    function formatDate(ts) {
        if (!ts) return '';
        const d = new Date(ts);
        const now = new Date();
        const diffDays = Math.round((d.getTime() - now.getTime()) / 86400000);
        if (diffDays === 0) return 'Today';
        if (diffDays === 1) return 'Tomorrow';
        if (diffDays === -1) return 'Yesterday';
        if (diffDays > 0 && diffDays <= 7) return `in ${diffDays}d`;
        if (diffDays < 0 && diffDays >= -7) return `${Math.abs(diffDays)}d ago`;
        return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: d.getFullYear() !== now.getFullYear() ? 'numeric' : undefined });
    }

    /** @param {any} item */
    function getItemLink(item) {
        if (!item.slug && !item.mediaParentId) return null;
        if (item.type === 'movie') return `/movies/${item.slug || item.mediaParentId}`;
        if (item.type === 'show') return `/tv/${item.slug || item.mediaParentId}`;
        if (item.type === 'artist') return `/music/${item.mediaParentId}`;
        return null;
    }
</script>

<svelte:head>
    <title>Mediajam — Wanted</title>
</svelte:head>

<div class="wanted-page max-w-6xl mx-auto">
    <!-- Header -->
    <div class="page-header">
        <div>
            <h1 class="page-title">Wanted</h1>
            <p class="page-sub">
                {#if loading}
                    Loading…
                {:else}
                    {summary.totalItems} items · {summary.total} missing
                    {#if lastRefresh}
                        <span class="refresh-time">· updated {lastRefresh.toLocaleTimeString()}</span>
                    {/if}
                {/if}
            </p>
        </div>
        <div class="header-actions">
            <label class="label cursor-pointer gap-2">
                <span class="label-text text-xs">Cutoff Unmet</span>
                <input type="checkbox" class="toggle toggle-xs toggle-secondary" bind:checked={includeCutoff} />
            </label>
            <button class="btn btn-ghost btn-sm" onclick={forceRefresh} disabled={loading}>
                {#if loading || refreshing}
                    <span class="loading loading-spinner loading-xs"></span>
                    {refreshing && !loading ? 'Updating…' : ''}
                {:else}
                    <MdiIcon icon={mdiRefresh} size={14} /> Refresh
                {/if}
            </button>
        </div>
    </div>

    {#if error}
        <div class="alert alert-error">
            <span>{error}</span>
        </div>
    {/if}

    {#if loading}
        <Skeleton type="stat-cards" />
        <div class="space-y-3 mt-4">
            <Skeleton type="poster-row" />
            <Skeleton type="poster-row" />
        </div>
    {:else}
        <!-- Summary Cards -->
        <div class="summary-row">
            {#each Object.entries(SERVICE_META) as [key, meta]}
                {#if summary.byService[key]}
                    <button
                        class="summary-card"
                        class:active={filterService === key}
                        onclick={() => filterService = filterService === key ? 'all' : key}
                    >
                        <span class="summary-icon"><MdiIcon icon={meta.icon} size={20} /></span>
                        <span class="summary-count">{summary.byService[key]}</span>
                        <span class="summary-label">{meta.label}</span>
                    </button>
                {/if}
            {/each}
        </div>

        <!-- Reason Filter Pills -->
        <div class="filter-row">
            <button
                class="filter-pill"
                class:active={filterReason === 'all'}
                onclick={() => filterReason = 'all'}
            >All ({items.length})</button>
            {#each Object.entries(REASON_META) as [key, meta]}
                {#if summary.byReason[key]}
                    <button
                        class="filter-pill {key}"
                        class:active={filterReason === key}
                        onclick={() => filterReason = filterReason === key ? 'all' : key}
                    >
                        <span><MdiIcon icon={meta.icon} size={12} /></span>
                        {meta.label} ({summary.byReason[key]})
                    </button>
                {/if}
            {/each}
        </div>

        <!-- Items List -->
        {#if filteredItems.length === 0}
            <div class="empty-state">
                <span class="empty-icon"><MdiIcon icon={mdiPartyPopper} size={40} /></span>
                <p>Nothing wanted — everything is downloaded!</p>
            </div>
        {:else}
            <div class="items-list">
                {#each filteredItems as item (itemKey(item))}
                    {@const key = itemKey(item)}
                    {@const meta = REASON_META[item.reason] || REASON_META.not_available}
                    {@const svc = SERVICE_META[item.service]}
                    {@const isExpanded = expandedIds.has(key)}
                    {@const link = getItemLink(item)}

                    <div class="wanted-card {item.reason}">
                        <!-- svelte-ignore a11y_no_static_element_interactions -->
                        <div class="card-main" role="button" tabindex="0" onclick={() => item.episodes?.length > 1 && toggleExpand(key)} onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); item.episodes?.length > 1 && toggleExpand(key); } }}>
                            <!-- Poster -->
                            <div class="card-poster">
                                {#if item.poster_url}
                                    <img src={imgUrl(item.poster_url)} alt={item.title} loading="lazy" />
                                {:else}
                                    <div class="poster-placeholder"><MdiIcon icon={svc?.icon || mdiPackageVariant} size={20} /></div>
                                {/if}
                            </div>

                            <!-- Info -->
                            <div class="card-info">
                                <div class="card-title-row">
                                    {#if link}
                                        <a href={link} class="card-title" onclick={(e) => e.stopPropagation()}>{item.title}</a>
                                    {:else}
                                        <span class="card-title">{item.title}</span>
                                    {/if}
                                    {#if item.year}
                                        <span class="card-year">({item.year})</span>
                                    {/if}
                                </div>
                                <div class="card-badges">
                                    <span class="badge badge-sm service-badge" style="--badge-color: {svc?.color}">
                                        <MdiIcon icon={svc?.icon} size={12} /> {svc?.label}
                                    </span>
                                    <span class="badge badge-sm reason-badge {item.reason}">
                                        <MdiIcon icon={meta.icon} size={12} /> {item.reasonLabel}
                                    </span>
                                </div>
                                <div class="card-detail">
                                    {#if item.type === 'show'}
                                        {item.missingCount} episode{item.missingCount !== 1 ? 's' : ''} missing
                                        {#if item.unairedCount > 0}
                                            <span class="text-base-content/40">· {item.unairedCount} unaired</span>
                                        {/if}
                                    {:else if item.type === 'artist'}
                                        {item.missingCount} album{item.missingCount !== 1 ? 's' : ''} missing
                                    {:else}
                                        Missing
                                    {/if}
                                </div>

                                <!-- Queue progress -->
                                {#if item.reason === 'in_queue' && item.queueInfo}
                                    <div class="queue-progress">
                                        <div class="progress-track">
                                            <div class="progress-fill" style="width: {item.queueInfo.progress}%"></div>
                                        </div>
                                        <span class="progress-text">
                                            {item.queueInfo.progress}%
                                            {#if item.queueInfo.timeleft}· {item.queueInfo.timeleft}{/if}
                                        </span>
                                    </div>
                                {/if}

                                <!-- Failure info -->
                                {#if item.reason === 'failed' && item.failureInfo}
                                    <div class="failure-info">
                                        <MdiIcon icon={mdiCloseCircle} size={12} /> {item.failureInfo.message}
                                        {#if item.failureInfo.date}
                                            <span class="text-base-content/40">· {formatDate(item.failureInfo.date)}</span>
                                        {/if}
                                    </div>
                                {/if}
                            </div>

                            <!-- Actions -->
                            <div class="card-actions">
                                {#if item.mediaParentId && item.reason !== 'not_out_yet' && item.reason !== 'in_queue'}
                                    <button
                                        class="btn btn-xs btn-ghost action-btn"
                                        onclick={(e) => { e.stopPropagation(); triggerSearch(item); }}
                                        disabled={searchingIds.has(key) || searchedIds.has(key)}
                                        title="Search {item.service} for releases"
                                    >
                                        {#if searchingIds.has(key)}
                                            <span class="loading loading-spinner" style="width: 12px; height: 12px;"></span>
                                        {:else if searchedIds.has(key)}
                                            <MdiIcon icon={mdiCheck} size={14} />
                                        {:else}
                                            <MdiIcon icon={mdiMagnify} size={14} />
                                        {/if}
                                    </button>
                                {/if}
                                {#if item.episodes?.length > 1}
                                    <button class="btn btn-xs btn-ghost expand-btn" onclick={(e) => { e.stopPropagation(); toggleExpand(key); }}>
                                        <MdiIcon icon={mdiChevronDown} size={14} class="expand-chevron {isExpanded ? 'expanded' : ''}" />
                                    </button>
                                {/if}
                            </div>
                        </div>

                        <!-- Expanded episodes/albums -->
                        {#if isExpanded && item.episodes?.length}
                            <div class="episode-list">
                                {#each item.episodes as ep}
                                    <div class="episode-row">
                                        <span class="ep-code">{ep.label}</span>
                                        {#if ep.title && ep.title !== ep.label}
                                            <span class="ep-title">{ep.title}</span>
                                        {/if}
                                        {#if ep.airDate}
                                            <span class="ep-date" class:unaired={!ep.isAired}>
                                                {formatDate(ep.airDate)}
                                            </span>
                                        {/if}
                                        {#if ep.queue}
                                            <span class="badge badge-xs badge-info">{ep.queue.progress}%</span>
                                        {/if}
                                        {#if ep.failure}
                                            <span class="badge badge-xs badge-error">failed</span>
                                        {/if}
                                    </div>
                                {/each}
                            </div>
                        {/if}
                    </div>
                {/each}
            </div>
        {/if}
    {/if}
</div>

<style>
    .wanted-page {
        display: flex;
        flex-direction: column;
        gap: 1.25rem;
    }

    /* Header */
    .page-header {
        display: flex;
        align-items: flex-end;
        justify-content: space-between;
        gap: 1rem;
    }
    .page-title {
        font-size: 1.75rem;
        font-weight: 800;
        letter-spacing: -0.02em;
    }
    .page-sub {
        font-size: 0.8rem;
        color: oklch(var(--bc) / 0.45);
        margin-top: 2px;
    }
    .refresh-time { opacity: 0.6; }
    .header-actions {
        display: flex;
        align-items: center;
        gap: 0.75rem;
    }

    /* Summary Cards */
    .summary-row {
        display: flex;
        gap: 0.75rem;
    }
    .summary-card {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.6rem 1rem;
        border-radius: 0.75rem;
        background: oklch(var(--b2) / 0.6);
        border: 1px solid oklch(var(--bc) / 0.08);
        cursor: pointer;
        transition: all 0.15s ease;
        flex: 1;
    }
    .summary-card:hover {
        border-color: oklch(var(--bc) / 0.15);
        background: oklch(var(--b2) / 0.8);
    }
    .summary-card.active {
        border-color: oklch(var(--p) / 0.5);
        background: oklch(var(--p) / 0.08);
    }
    .summary-icon { font-size: 1.2rem; }
    .summary-count {
        font-size: 1.4rem;
        font-weight: 800;
        letter-spacing: -0.03em;
    }
    .summary-label {
        font-size: 0.7rem;
        color: oklch(var(--bc) / 0.5);
        font-weight: 500;
    }

    /* Filter Pills */
    .filter-row {
        display: flex;
        gap: 0.4rem;
        flex-wrap: wrap;
    }
    .filter-pill {
        padding: 0.3rem 0.75rem;
        border-radius: 999px;
        font-size: 0.72rem;
        font-weight: 600;
        background: oklch(var(--b2) / 0.5);
        border: 1px solid oklch(var(--bc) / 0.08);
        cursor: pointer;
        transition: all 0.15s ease;
        display: flex;
        align-items: center;
        gap: 0.3rem;
    }
    .filter-pill:hover { border-color: oklch(var(--bc) / 0.2); }
    .filter-pill.active {
        background: oklch(var(--p) / 0.15);
        border-color: oklch(var(--p) / 0.4);
        color: oklch(var(--p));
    }

    /* Items List */
    .items-list {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
    }

    /* Wanted Card */
    .wanted-card {
        border-radius: 0.75rem;
        background: oklch(var(--b2) / 0.4);
        border: 1px solid oklch(var(--bc) / 0.06);
        overflow: hidden;
        transition: border-color 0.15s;
    }
    .wanted-card:hover {
        border-color: oklch(var(--bc) / 0.12);
    }
    .wanted-card.in_queue {
        border-left: 3px solid oklch(var(--in));
    }
    .wanted-card.failed {
        border-left: 3px solid oklch(var(--er));
    }
    .wanted-card.not_available {
        border-left: 3px solid oklch(var(--wa));
    }
    .wanted-card.not_out_yet {
        border-left: 3px solid oklch(var(--bc) / 0.15);
    }
    .wanted-card.cutoff_unmet {
        border-left: 3px solid oklch(var(--s));
    }

    .card-main {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        padding: 0.6rem 0.75rem;
        cursor: pointer;
    }

    .card-poster {
        flex-shrink: 0;
        width: 42px;
        height: 63px;
        border-radius: 6px;
        overflow: hidden;
        background: oklch(var(--b3));
    }
    .card-poster img {
        width: 100%;
        height: 100%;
        object-fit: cover;
    }
    .poster-placeholder {
        width: 100%;
        height: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 1.2rem;
    }

    .card-info {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 3px;
    }
    .card-title-row {
        display: flex;
        align-items: baseline;
        gap: 0.4rem;
    }
    .card-title {
        font-size: 0.85rem;
        font-weight: 700;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        text-decoration: none;
        color: inherit;
    }
    a.card-title:hover {
        color: oklch(var(--p));
    }
    .card-year {
        font-size: 0.7rem;
        color: oklch(var(--bc) / 0.35);
        flex-shrink: 0;
    }

    .card-badges {
        display: flex;
        gap: 0.35rem;
    }
    .service-badge {
        background: color-mix(in oklch, var(--badge-color, gray) 15%, transparent);
        color: var(--badge-color, gray);
        border: none;
        font-size: 0.6rem;
    }
    .reason-badge {
        font-size: 0.6rem;
        border: none;
    }
    .reason-badge.in_queue { background: oklch(var(--in) / 0.12); color: oklch(var(--in)); }
    .reason-badge.failed { background: oklch(var(--er) / 0.12); color: oklch(var(--er)); }
    .reason-badge.not_available { background: oklch(var(--wa) / 0.12); color: oklch(var(--wa)); }
    .reason-badge.not_out_yet { background: oklch(var(--bc) / 0.08); color: oklch(var(--bc) / 0.5); }
    .reason-badge.cutoff_unmet { background: oklch(var(--s) / 0.12); color: oklch(var(--s)); }

    .card-detail {
        font-size: 0.7rem;
        color: oklch(var(--bc) / 0.5);
    }

    /* Queue progress */
    .queue-progress {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        margin-top: 2px;
    }
    .progress-track {
        flex: 1;
        max-width: 120px;
        height: 4px;
        border-radius: 2px;
        background: oklch(var(--bc) / 0.1);
        overflow: hidden;
    }
    .progress-fill {
        height: 100%;
        background: oklch(var(--in));
        border-radius: 2px;
        transition: width 0.5s ease;
    }
    .progress-text {
        font-size: 0.62rem;
        color: oklch(var(--in));
        font-weight: 600;
    }

    /* Failure info */
    .failure-info {
        font-size: 0.65rem;
        color: oklch(var(--er) / 0.8);
        margin-top: 2px;
    }

    /* Actions */
    .card-actions {
        display: flex;
        align-items: center;
        gap: 0.25rem;
        flex-shrink: 0;
    }
    .action-btn {
        font-size: 0.8rem;
    }
    .expand-chevron {
        transition: transform 0.2s ease;
    }
    .expand-chevron.expanded {
        transform: rotate(180deg);
    }

    /* Episode list */
    .episode-list {
        border-top: 1px solid oklch(var(--bc) / 0.06);
        padding: 0.4rem 0.75rem 0.5rem;
        display: flex;
        flex-direction: column;
        gap: 1px;
        max-height: 300px;
        overflow-y: auto;
        background: oklch(var(--b1) / 0.3);
    }
    .episode-row {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.25rem 0.4rem;
        border-radius: 4px;
        font-size: 0.7rem;
    }
    .episode-row:hover {
        background: oklch(var(--bc) / 0.04);
    }
    .ep-code {
        font-family: 'JetBrains Mono', 'Fira Code', monospace;
        font-size: 0.65rem;
        font-weight: 600;
        color: oklch(var(--bc) / 0.6);
        flex-shrink: 0;
        width: 55px;
    }
    .ep-title {
        flex: 1;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        color: oklch(var(--bc) / 0.7);
    }
    .ep-date {
        font-size: 0.62rem;
        color: oklch(var(--bc) / 0.4);
        flex-shrink: 0;
    }
    .ep-date.unaired {
        color: oklch(var(--in) / 0.7);
    }

    /* Empty state */
    .empty-state {
        text-align: center;
        padding: 3rem 1rem;
        color: oklch(var(--bc) / 0.4);
    }
    .empty-icon {
        font-size: 2.5rem;
        display: block;
        margin-bottom: 0.75rem;
    }
</style>
