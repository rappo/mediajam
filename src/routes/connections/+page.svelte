<script>
    import { imgUrl } from "$lib/utils.js";

    /** @type {{ id: number, name: string, photo_url: string|null, slug: string|null, credit_count: number }|null} */
    let personA = $state(null);
    /** @type {{ id: number, name: string, photo_url: string|null, slug: string|null, credit_count: number }|null} */
    let personB = $state(null);

    let searchA = $state('');
    let searchB = $state('');
    /** @type {any[]} */
    let resultsA = $state([]);
    /** @type {any[]} */
    let resultsB = $state([]);
    let showDropdownA = $state(false);
    let showDropdownB = $state(false);

    let searching = $state(false);
    /** @type {any} */
    let result = $state(null);
    /** @type {any[]|null} */
    let multiResults = $state(null);
    let error = $state('');

    // Exclusions — media IDs blocked by clicking X
    /** @type {Set<number>} */
    let excludedMedia = $state(new Set());
    let pathCount = $state(1);
    let watchedOnly = $state(false);

    // Debounced search
    let timerA = /** @type {any} */ (null);
    let timerB = /** @type {any} */ (null);

    function onSearchA() {
        clearTimeout(timerA);
        if (searchA.trim().length < 2) { resultsA = []; return; }
        timerA = setTimeout(async () => {
            const res = await fetch(`/api/connections?search=${encodeURIComponent(searchA.trim())}`);
            const data = await res.json();
            resultsA = data.results || [];
            showDropdownA = true;
        }, 250);
    }

    function onSearchB() {
        clearTimeout(timerB);
        if (searchB.trim().length < 2) { resultsB = []; return; }
        timerB = setTimeout(async () => {
            const res = await fetch(`/api/connections?search=${encodeURIComponent(searchB.trim())}`);
            const data = await res.json();
            resultsB = data.results || [];
            showDropdownB = true;
        }, 250);
    }

    /** @param {any} person */
    function selectA(person) {
        personA = person;
        searchA = person.name;
        showDropdownA = false;
        resultsA = [];
    }

    /** @param {any} person */
    function selectB(person) {
        personB = person;
        searchB = person.name;
        showDropdownB = false;
        resultsB = [];
    }

    function clearA() {
        personA = null;
        searchA = '';
        resultsA = [];
        result = null;
        multiResults = null;
        excludedMedia = new Set();
    }

    function clearB() {
        personB = null;
        searchB = '';
        resultsB = [];
        result = null;
        multiResults = null;
        excludedMedia = new Set();
    }

    async function findConnection() {
        if (!personA || !personB) return;
        searching = true;
        error = '';
        result = null;
        multiResults = null;
        try {
            let url = `/api/connections?from=${personA.id}&to=${personB.id}`;
            if (excludedMedia.size > 0) {
                url += `&exclude=${[...excludedMedia].join(',')}`;
            }
            if (pathCount > 1) {
                url += `&count=${pathCount}`;
            }
            if (watchedOnly) {
                url += `&watchedOnly=1`;
            }
            const res = await fetch(url);
            if (!res.ok) {
                const data = await res.json();
                throw new Error(data.error || 'Search failed');
            }
            const data = await res.json();
            if (data.paths) {
                multiResults = data.paths;
                result = data.paths.length > 0 ? data.paths[0] : { degrees: -1, path: [] };
            } else {
                result = data;
            }
        } catch (/** @type {any} */ e) {
            error = e instanceof Error ? e.message : 'Search failed';
        }
        searching = false;
    }

    function swap() {
        const tmpPerson = personA;
        const tmpSearch = searchA;
        personA = personB;
        searchA = searchB;
        personB = tmpPerson;
        searchB = tmpSearch;
        result = null;
        multiResults = null;
        excludedMedia = new Set();
    }

    /** Block a media node and re-search for an alternative route */
    function blockMedia(/** @type {number} */ mediaId) {
        excludedMedia = new Set([...excludedMedia, mediaId]);
        findConnection();
    }

    /** Clear all exclusions and re-search */
    function clearExclusions() {
        excludedMedia = new Set();
        findConnection();
    }

    /** Get display URL for person page */
    function personUrl(/** @type {any} */ person) {
        return `/people/${person.slug || person.id}`;
    }

    /** Get display URL for media page */
    function mediaUrl(/** @type {any} */ media) {
        const typeMap = /** @type {Record<string, string>} */ ({ movie: 'movies', show: 'tv' });
        return `/${typeMap[media.media_type] || 'music'}/${media.slug || media.id}`;
    }

    /** @param {string} type */
    function mediaIcon(type) {
        if (type === 'movie') return '🎬';
        if (type === 'show') return '📺';
        return '🎵';
    }

    // Close dropdowns on outside click
    /** @param {MouseEvent} e */
    function handleClickOutside(e) {
        const target = /** @type {HTMLElement} */ (e.target);
        if (!target.closest('.search-box-a')) showDropdownA = false;
        if (!target.closest('.search-box-b')) showDropdownB = false;
    }
</script>

<svelte:head>
    <title>Six Degrees — Mediajam</title>
</svelte:head>

<svelte:window onclick={handleClickOutside} />

<div class="max-w-5xl mx-auto space-y-8 p-4">
    <!-- Header -->
    <div class="text-center space-y-2">
        <h1 class="text-3xl font-bold bg-gradient-to-r from-primary to-secondary bg-clip-text text-transparent">
            Six Degrees of Separation
        </h1>
        <p class="text-base-content/50 text-sm max-w-lg mx-auto">
            Find the shortest connection between any two people in your library through shared movies, TV shows, and music.
        </p>
    </div>

    <!-- Search Inputs -->
    <div class="flex flex-col sm:flex-row items-center gap-3">
        <!-- Person A -->
        <div class="flex-1 w-full search-box-a relative">
            <div class="relative">
                {#if personA}
                    <div class="flex items-center gap-2 px-4 py-3 rounded-xl bg-primary/10 border border-primary/30">
                        {#if personA.photo_url}
                            <img src={imgUrl(personA.photo_url, 40)} alt="" class="w-8 h-8 rounded-full object-cover" />
                        {:else}
                            <div class="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center text-sm">👤</div>
                        {/if}
                        <span class="font-medium text-sm flex-1 truncate">{personA.name}</span>
                        <button class="btn btn-ghost btn-xs btn-circle" onclick={clearA}>✕</button>
                    </div>
                {:else}
                    <input
                        type="text"
                        placeholder="Search for a person..."
                        class="input input-bordered w-full"
                        bind:value={searchA}
                        oninput={onSearchA}
                        onfocus={() => { if (resultsA.length) showDropdownA = true; }}
                    />
                    <span class="absolute right-3 top-1/2 -translate-y-1/2 text-base-content/30 text-sm">👤</span>
                {/if}
            </div>
            {#if showDropdownA && resultsA.length > 0}
                <div class="absolute z-50 top-full mt-1 w-full bg-base-200 rounded-xl shadow-xl border border-base-300 max-h-64 overflow-y-auto">
                    {#each resultsA as person}
                        <button
                            class="flex items-center gap-2 px-3 py-2 w-full hover:bg-base-300 transition-colors text-left"
                            onclick={() => selectA(person)}
                        >
                            {#if person.photo_url}
                                <img src={imgUrl(person.photo_url, 32)} alt="" class="w-6 h-6 rounded-full object-cover" />
                            {:else}
                                <div class="w-6 h-6 rounded-full bg-base-300 flex items-center justify-center text-xs">👤</div>
                            {/if}
                            <span class="text-sm flex-1 truncate">{person.name}</span>
                            <span class="text-xs text-base-content/40">{person.credit_count} credits</span>
                        </button>
                    {/each}
                </div>
            {/if}
        </div>

        <!-- Swap -->
        <div class="flex items-center gap-2">
            <button class="btn btn-ghost btn-sm btn-circle" onclick={swap} title="Swap">
                ⇄
            </button>
        </div>

        <!-- Person B -->
        <div class="flex-1 w-full search-box-b relative">
            <div class="relative">
                {#if personB}
                    <div class="flex items-center gap-2 px-4 py-3 rounded-xl bg-secondary/10 border border-secondary/30">
                        {#if personB.photo_url}
                            <img src={imgUrl(personB.photo_url, 40)} alt="" class="w-8 h-8 rounded-full object-cover" />
                        {:else}
                            <div class="w-8 h-8 rounded-full bg-secondary/20 flex items-center justify-center text-sm">👤</div>
                        {/if}
                        <span class="font-medium text-sm flex-1 truncate">{personB.name}</span>
                        <button class="btn btn-ghost btn-xs btn-circle" onclick={clearB}>✕</button>
                    </div>
                {:else}
                    <input
                        type="text"
                        placeholder="Search for another person..."
                        class="input input-bordered w-full"
                        bind:value={searchB}
                        oninput={onSearchB}
                        onfocus={() => { if (resultsB.length) showDropdownB = true; }}
                    />
                    <span class="absolute right-3 top-1/2 -translate-y-1/2 text-base-content/30 text-sm">👤</span>
                {/if}
            </div>
            {#if showDropdownB && resultsB.length > 0}
                <div class="absolute z-50 top-full mt-1 w-full bg-base-200 rounded-xl shadow-xl border border-base-300 max-h-64 overflow-y-auto">
                    {#each resultsB as person}
                        <button
                            class="flex items-center gap-2 px-3 py-2 w-full hover:bg-base-300 transition-colors text-left"
                            onclick={() => selectB(person)}
                        >
                            {#if person.photo_url}
                                <img src={imgUrl(person.photo_url, 32)} alt="" class="w-6 h-6 rounded-full object-cover" />
                            {:else}
                                <div class="w-6 h-6 rounded-full bg-base-300 flex items-center justify-center text-xs">👤</div>
                            {/if}
                            <span class="text-sm flex-1 truncate">{person.name}</span>
                            <span class="text-xs text-base-content/40">{person.credit_count} credits</span>
                        </button>
                    {/each}
                </div>
            {/if}
        </div>
    </div>

    <!-- Controls Row: Find button + Path Count -->
    <div class="flex items-center justify-center gap-4 flex-wrap">
        <button
            class="btn btn-primary gap-2 px-8"
            disabled={!personA || !personB || searching}
            onclick={findConnection}
        >
            {#if searching}
                <span class="loading loading-spinner loading-sm"></span>
                Searching...
            {:else}
                🔗 Find Connection
            {/if}
        </button>

        <div class="flex items-center gap-2">
            <label class="text-sm text-base-content/60" for="path-count">Paths:</label>
            <select id="path-count" class="select select-bordered select-sm w-20" bind:value={pathCount}>
                <option value={1}>1</option>
                <option value={3}>3</option>
                <option value={5}>5</option>
                <option value={10}>10</option>
            </select>
        </div>

        <label class="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" class="checkbox checkbox-sm checkbox-primary" bind:checked={watchedOnly} />
            <span class="text-sm text-base-content/60">Watched only</span>
        </label>

        {#if excludedMedia.size > 0}
            <button class="btn btn-outline btn-warning btn-sm gap-1" onclick={clearExclusions}>
                🚫 Clear {excludedMedia.size} block{excludedMedia.size > 1 ? 's' : ''}
            </button>
        {/if}
    </div>

    <!-- Error -->
    {#if error}
        <div class="alert alert-error text-sm">{error}</div>
    {/if}

    <!-- Results -->
    {#if multiResults && multiResults.length > 0}
        <!-- Multiple Paths -->
        {#each multiResults as pathResult, pi}
            <div class="path-section">
                <div class="flex items-center justify-center gap-2 mb-2">
                    <div class="badge badge-primary gap-1 px-4 py-3">
                        Path {pi + 1} — {pathResult.degrees} {pathResult.degrees === 1 ? 'degree' : 'degrees'}
                    </div>
                </div>
                {@render pathVisualization(pathResult)}
            </div>
        {/each}
    {:else if result}
        {#if result.degrees === 0}
            <div class="text-center py-8">
                <div class="text-5xl mb-3">🪞</div>
                <p class="text-lg font-medium">That's the same person!</p>
            </div>
        {:else if result.degrees === -1}
            <div class="text-center py-8">
                <div class="text-5xl mb-3">🌌</div>
                <p class="text-lg font-medium">No connection found</p>
                <p class="text-sm text-base-content/50 mt-1">
                    {#if excludedMedia.size > 0}
                        No alternate route available with {excludedMedia.size} blocked connection{excludedMedia.size > 1 ? 's' : ''}.
                        <button class="link link-primary" onclick={clearExclusions}>Clear blocks and retry</button>
                    {:else}
                        These two people are more than 6 degrees apart — or have no shared media in your library.
                    {/if}
                </p>
            </div>
        {:else}
            <!-- Single result (no multi) -->
            <div class="text-center">
                <div class="badge badge-lg badge-primary gap-1 text-lg px-6 py-4">
                    {result.degrees} {result.degrees === 1 ? 'degree' : 'degrees'} of separation
                </div>
            </div>
            {@render pathVisualization(result)}
        {/if}
    {/if}
</div>

{#snippet pathVisualization(pathResult)}
    <div class="connection-path">
        {#each pathResult.path as node, i}
            {#if node.person}
                <!-- Person node with role arrows -->
                <div class="person-node-wrap">
                    <a href={personUrl(node.person)} class="person-node group">
                        <div class="person-avatar {i === 0 ? 'avatar-start' : i === pathResult.path.length - 1 ? 'avatar-end' : ''}">
                            {#if node.person.photo_url}
                                <img src={imgUrl(node.person.photo_url, 120)} alt={node.person.name} class="w-full h-full object-cover" />
                            {:else}
                                <div class="w-full h-full flex items-center justify-center text-2xl bg-base-300">👤</div>
                            {/if}
                        </div>
                        <span class="person-name group-hover:text-primary transition-colors">{node.person.name}</span>
                    </a>
                    <div class="role-arrows">
                        {#if i > 0 && pathResult.path[i - 1]?.role?.to}
                            {@const r = pathResult.path[i - 1].role.to}
                            <span class="role-arrow role-left">
                                <span class="arrow">←</span>
                                <span class="role-text">{r.role_type}{#if r.character_name} <em>as {r.character_name}</em>{/if}</span>
                            </span>
                        {/if}
                        {#if i < pathResult.path.length - 1 && pathResult.path[i + 1]?.role?.from}
                            {@const r = pathResult.path[i + 1].role.from}
                            <span class="role-arrow role-right">
                                <span class="role-text">{r.role_type}{#if r.character_name} <em>as {r.character_name}</em>{/if}</span>
                                <span class="arrow">→</span>
                            </span>
                        {/if}
                    </div>
                </div>
            {:else if node.media}
                <!-- Media connector -->
                <div class="media-connector">
                    <div class="connector-line"></div>
                    <div class="media-node-wrapper">
                        <button
                            class="block-btn"
                            title="Block this connection and find alternate route"
                            onclick={() => blockMedia(node.media.id)}
                        >✕</button>
                        <a href={mediaUrl(node.media)} class="media-node group">
                            {#if node.media.poster_url}
                                <img src={imgUrl(node.media.poster_url, 100)} alt={node.media.title} class="media-poster" />
                            {:else}
                                <div class="media-poster bg-base-300 flex items-center justify-center text-xl">
                                    {mediaIcon(node.media.media_type)}
                                </div>
                            {/if}
                            <div class="media-info">
                                <span class="media-title group-hover:text-primary transition-colors">{node.media.title}</span>
                                <div class="media-meta">
                                    <span>{mediaIcon(node.media.media_type)}</span>
                                    {#if node.media.release_year}
                                        <span>{node.media.release_year}</span>
                                    {/if}
                                </div>
                            </div>
                        </a>
                    </div>
                    <div class="connector-line"></div>
                </div>
            {/if}
        {/each}
    </div>
{/snippet}

<style>
    .connection-path {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 0;
        padding: 1rem 0;
    }

    .person-node-wrap {
        display: flex;
        flex-direction: column;
        align-items: center;
        z-index: 1;
    }

    .person-node {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 0.5rem;
        text-decoration: none;
        color: inherit;
    }

    .person-avatar {
        width: 80px;
        height: 80px;
        border-radius: 50%;
        overflow: hidden;
        box-shadow: 0 0 0 3px oklch(var(--b3));
    }

    .person-avatar.avatar-start {
        box-shadow: 0 0 0 3px oklch(var(--p));
    }

    .person-avatar.avatar-end {
        box-shadow: 0 0 0 3px oklch(var(--s));
    }

    .person-name {
        font-size: 0.875rem;
        font-weight: 600;
        text-align: center;
        max-width: 130px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .role-arrows {
        display: flex;
        flex-direction: column;
        gap: 0.125rem;
        margin-top: 0.25rem;
        align-items: center;
    }

    .role-arrow {
        display: flex;
        align-items: center;
        gap: 0.25rem;
        font-size: 0.625rem;
        padding: 0.125rem 0.5rem;
        border-radius: 999px;
        text-transform: capitalize;
        white-space: nowrap;
        max-width: 160px;
    }

    .role-arrow .role-text {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .role-left {
        background: oklch(var(--p) / 0.12);
        color: oklch(var(--p));
    }

    .role-right {
        background: oklch(var(--s) / 0.12);
        color: oklch(var(--s));
    }

    .arrow {
        font-weight: 700;
        flex-shrink: 0;
    }

    .role-arrow em {
        font-style: italic;
        opacity: 0.7;
    }

    .media-connector {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 0;
    }

    .connector-line {
        width: 2px;
        height: 24px;
        background: linear-gradient(to bottom, oklch(var(--p) / 0.3), oklch(var(--s) / 0.3));
    }

    .media-node-wrapper {
        position: relative;
    }

    .block-btn {
        position: absolute;
        top: -6px;
        right: -6px;
        z-index: 10;
        width: 22px;
        height: 22px;
        border-radius: 50%;
        background: oklch(var(--er));
        color: oklch(var(--erc));
        border: 2px solid oklch(var(--b1));
        font-size: 0.625rem;
        font-weight: 700;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        opacity: 0;
        transition: opacity 0.15s, transform 0.15s;
        transform: scale(0.8);
        line-height: 1;
    }

    .media-node-wrapper:hover .block-btn {
        opacity: 1;
        transform: scale(1);
    }

    .media-node {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        padding: 0.75rem;
        border-radius: 0.75rem;
        background: oklch(var(--b2));
        border: 1px solid oklch(var(--b3));
        text-decoration: none;
        color: inherit;
        max-width: 350px;
        transition: border-color 0.2s;
    }

    .media-node:hover {
        border-color: oklch(var(--p) / 0.4);
    }

    .media-poster {
        width: 48px;
        height: 72px;
        border-radius: 0.375rem;
        object-fit: cover;
        flex-shrink: 0;
    }

    .media-info {
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 0.125rem;
    }

    .media-title {
        font-size: 0.8125rem;
        font-weight: 600;
        line-height: 1.3;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
    }

    .media-meta {
        display: flex;
        align-items: center;
        gap: 0.375rem;
        font-size: 0.6875rem;
        color: oklch(var(--bc) / 0.4);
    }

    .path-section {
        padding-top: 0.5rem;
        border-top: 1px solid oklch(var(--b3));
    }

    .path-section:first-of-type {
        border-top: none;
    }

    /* Responsive: horizontal on larger screens */
    @media (min-width: 768px) {
        .connection-path {
            flex-direction: row;
            flex-wrap: wrap;
            justify-content: center;
            gap: 0;
            padding: 2rem 1rem;
        }

        .media-connector {
            flex-direction: row;
        }

        .connector-line {
            width: 32px;
            height: 2px;
        }

        .media-node {
            flex-direction: column;
            text-align: center;
            max-width: 160px;
            padding: 0.5rem;
        }

        .media-poster {
            width: 80px;
            height: 120px;
        }

        .media-info {
            align-items: center;
        }




        .person-avatar {
            width: 96px;
            height: 96px;
        }
    }
</style>
