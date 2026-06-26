<script>
    import { imgUrl } from "$lib/utils.js";
    import MdiIcon from "$lib/components/MdiIcon.svelte";
    import { mdiAccountCircle, mdiClose, mdiMovie, mdiTelevision, mdiMusic, mdiLink, mdiBlockHelper, mdiSwapHorizontal, mdiAccount, mdiLinkOff } from "@mdi/js";

    /** @type {{ id: number, name: string, photo_url: string|null, slug: string|null, credit_count: number }|null} */
    let personA = $state(null);

    /**
     * Build "degree" rows from a flat path array.
     * Path alternates: person, media, person, media, person...
     * Each degree precomputes left/right assignments based on zigzag direction.
     * @param {any[]} path
     */
    function buildDegrees(path) {
        const degrees = [];
        for (let i = 0; i < path.length - 2; i += 2) {
            const pA = path[i]?.person;
            const med = path[i + 1];
            const pB = path[i + 2]?.person;
            if (!pA || !med?.media || !pB) continue;
            const di = degrees.length;
            const isReversed = di % 2 === 1;
            const isStartA = i === 0;
            const isEndB = i + 2 === path.length - 1;
            const roleFrom = med.role?.from || null;
            const roleTo = med.role?.to || null;
            degrees.push({
                personA: pA,
                media: med.media,
                personB: pB,
                isReversed,
                isLast: false, // will fix after loop
                // Precomputed for template
                leftPerson: isReversed ? pB : pA,
                rightPerson: isReversed ? pA : pB,
                leftRole: isReversed ? roleTo : roleFrom,
                rightRole: isReversed ? roleFrom : roleTo,
                leftIsStart: isReversed ? isEndB : isStartA,
                leftIsEnd: isReversed ? isStartA : isEndB,
                rightIsStart: isReversed ? isStartA : isEndB,
                rightIsEnd: isReversed ? isEndB : isStartA,
            });
        }
        if (degrees.length > 0) degrees[degrees.length - 1].isLast = true;
        return degrees;
    }
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
        if (personB) findConnection();
    }

    /** @param {any} person */
    function selectB(person) {
        personB = person;
        searchB = person.name;
        showDropdownB = false;
        resultsB = [];
        if (personA) findConnection();
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
        if (personA && personB) findConnection();
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
                            <div class="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center"><MdiIcon icon={mdiAccount} size={16} /></div>
                        {/if}
                        <span class="font-medium text-sm flex-1 truncate">{personA.name}</span>
                        <button class="btn btn-ghost btn-xs btn-circle" onclick={clearA}><MdiIcon icon={mdiClose} size={14} /></button>
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
                    <span class="absolute right-3 top-1/2 -translate-y-1/2 text-base-content/30"><MdiIcon icon={mdiAccount} size={16} /></span>
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
                                <div class="w-6 h-6 rounded-full bg-base-300 flex items-center justify-center"><MdiIcon icon={mdiAccount} size={12} /></div>
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
                <MdiIcon icon={mdiSwapHorizontal} size={18} />
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
                            <div class="w-8 h-8 rounded-full bg-secondary/20 flex items-center justify-center"><MdiIcon icon={mdiAccount} size={16} /></div>
                        {/if}
                        <span class="font-medium text-sm flex-1 truncate">{personB.name}</span>
                        <button class="btn btn-ghost btn-xs btn-circle" onclick={clearB}><MdiIcon icon={mdiClose} size={14} /></button>
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
                    <span class="absolute right-3 top-1/2 -translate-y-1/2 text-base-content/30"><MdiIcon icon={mdiAccount} size={16} /></span>
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
                                <div class="w-6 h-6 rounded-full bg-base-300 flex items-center justify-center"><MdiIcon icon={mdiAccount} size={12} /></div>
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
                <MdiIcon icon={mdiLink} size={18} /> Find Connection
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
                <MdiIcon icon={mdiBlockHelper} size={14} /> Clear {excludedMedia.size} block{excludedMedia.size > 1 ? 's' : ''}
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
                <div class="mb-3 text-base-content/30"><MdiIcon icon={mdiAccountCircle} size={48} /></div>
                <p class="text-lg font-medium">That's the same person!</p>
            </div>
        {:else if result.degrees === -1}
            <div class="text-center py-8">
                <div class="mb-3 text-base-content/30"><MdiIcon icon={mdiLinkOff} size={48} /></div>
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
    {@const degrees = buildDegrees(pathResult.path)}
    <div class="zigzag-wrap">
        {#each degrees as degree, di}
            <div class="zigzag-row" class:zigzag-reversed={degree.isReversed}>
                <!-- Left person -->
                <a href={personUrl(degree.leftPerson)} class="zz-person group">
                    <div class="zz-avatar" class:zz-avatar-start={degree.leftIsStart} class:zz-avatar-end={degree.leftIsEnd}>
                        {#if degree.leftPerson.photo_url}
                            <img src={imgUrl(degree.leftPerson.photo_url, 120)} alt={degree.leftPerson.name} />
                        {:else}
                            <div class="zz-avatar-placeholder"><MdiIcon icon={mdiAccountCircle} size={40} /></div>
                        {/if}
                    </div>
                    <span class="zz-person-name group-hover:text-primary transition-colors">{degree.leftPerson.name}</span>
                </a>

                <!-- Left role label + line -->
                <div class="zz-connector">
                    {#if degree.leftRole}
                        <span class="zz-role-tag zz-role-from">
                            {degree.leftRole.role_type}{#if degree.leftRole.character_name}<em>as {degree.leftRole.character_name}</em>{/if}
                        </span>
                    {/if}
                    <div class="zz-line"></div>
                </div>

                <!-- Media node -->
                <div class="zz-media-wrap">
                    <button
                        class="zz-block-btn"
                        title="Block this connection and find alternate route"
                        onclick={() => blockMedia(degree.media.id)}
                    ><MdiIcon icon={mdiClose} size={12} /></button>
                    <a href={mediaUrl(degree.media)} class="zz-media group">
                        {#if degree.media.poster_url}
                            <img src={imgUrl(degree.media.poster_url, 200)} alt={degree.media.title} class="zz-poster" />
                        {:else}
                            <div class="zz-poster zz-poster-placeholder">
                                <MdiIcon icon={degree.media.media_type === 'movie' ? mdiMovie : degree.media.media_type === 'show' ? mdiTelevision : mdiMusic} size={28} />
                            </div>
                        {/if}
                        <span class="zz-media-title group-hover:text-primary transition-colors">{degree.media.title}</span>
                        {#if degree.media.release_year}
                            <span class="zz-media-year">{degree.media.release_year}</span>
                        {/if}
                    </a>
                </div>

                <!-- Right role label + line -->
                <div class="zz-connector">
                    {#if degree.rightRole}
                        <span class="zz-role-tag zz-role-to">
                            {degree.rightRole.role_type}{#if degree.rightRole.character_name}<em>as {degree.rightRole.character_name}</em>{/if}
                        </span>
                    {/if}
                    <div class="zz-line"></div>
                </div>

                <!-- Right person -->
                <a href={personUrl(degree.rightPerson)} class="zz-person group">
                    <div class="zz-avatar" class:zz-avatar-start={degree.rightIsStart} class:zz-avatar-end={degree.rightIsEnd}>
                        {#if degree.rightPerson.photo_url}
                            <img src={imgUrl(degree.rightPerson.photo_url, 120)} alt={degree.rightPerson.name} />
                        {:else}
                            <div class="zz-avatar-placeholder"><MdiIcon icon={mdiAccountCircle} size={40} /></div>
                        {/if}
                    </div>
                    <span class="zz-person-name group-hover:text-primary transition-colors">{degree.rightPerson.name}</span>
                </a>
            </div>

            <!-- Vertical connector between rows -->
            {#if !degree.isLast}
                <div class="zz-vertical-connector" class:zz-vert-right={di % 2 === 0} class:zz-vert-left={di % 2 === 1}>
                    <svg class="zz-curve-svg" viewBox="0 0 60 48" preserveAspectRatio="none">
                        <path d="M30 0 Q30 24 30 48" stroke="url(#zzGrad)" stroke-width="2" fill="none" />
                        <defs>
                            <linearGradient id="zzGrad" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stop-color="oklch(var(--p))" stop-opacity="0.5" />
                                <stop offset="100%" stop-color="oklch(var(--s))" stop-opacity="0.5" />
                            </linearGradient>
                        </defs>
                    </svg>
                </div>
            {/if}
        {/each}
    </div>
{/snippet}

<style>
    /* ══════════════ ZIGZAG PATH ══════════════ */
    .zigzag-wrap {
        display: flex;
        flex-direction: column;
        align-items: center;
        padding: 1.5rem 0;
        gap: 0;
    }

    .zigzag-row {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 0;
        width: 100%;
        max-width: 750px;
        padding: 0.5rem 0;
    }

    .zigzag-reversed {
        flex-direction: row-reverse;
    }

    /* Person node */
    .zz-person {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 0.4rem;
        text-decoration: none;
        color: inherit;
        flex-shrink: 0;
        width: 100px;
    }

    .zz-avatar {
        width: 72px;
        height: 72px;
        border-radius: 50%;
        overflow: hidden;
        box-shadow: 0 0 0 3px oklch(var(--b3));
        transition: box-shadow 0.2s, transform 0.2s;
    }

    .zz-person:hover .zz-avatar {
        transform: scale(1.05);
    }

    .zz-avatar img {
        width: 100%;
        height: 100%;
        object-fit: cover;
    }

    .zz-avatar-placeholder {
        width: 100%;
        height: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        background: oklch(var(--b3));
        color: oklch(var(--bc) / 0.3);
    }

    .zz-avatar-start {
        box-shadow: 0 0 0 3px oklch(var(--p)), 0 0 12px oklch(var(--p) / 0.3);
    }

    .zz-avatar-end {
        box-shadow: 0 0 0 3px oklch(var(--s)), 0 0 12px oklch(var(--s) / 0.3);
    }

    .zz-person-name {
        font-size: 0.75rem;
        font-weight: 600;
        text-align: center;
        max-width: 100px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        color: oklch(var(--bc) / 0.8);
    }

    /* Connector line + role tag */
    .zz-connector {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 0.2rem;
        flex: 1;
        min-width: 40px;
        max-width: 120px;
    }

    .zz-line {
        height: 2px;
        width: 100%;
        background: linear-gradient(to right, oklch(var(--p) / 0.35), oklch(var(--s) / 0.35));
        border-radius: 1px;
    }

    .zigzag-reversed .zz-line {
        background: linear-gradient(to left, oklch(var(--p) / 0.35), oklch(var(--s) / 0.35));
    }

    .zz-role-tag {
        font-size: 0.6rem;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.03em;
        padding: 0.15rem 0.5rem;
        border-radius: 999px;
        white-space: nowrap;
        max-width: 110px;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .zz-role-tag em {
        font-style: italic;
        font-weight: 400;
        text-transform: none;
        opacity: 0.7;
        margin-left: 0.15rem;
    }

    .zz-role-from {
        background: oklch(var(--p) / 0.15);
        color: oklch(var(--p));
    }

    .zz-role-to {
        background: oklch(var(--s) / 0.15);
        color: oklch(var(--s));
    }

    /* Media node */
    .zz-media-wrap {
        position: relative;
        flex-shrink: 0;
    }

    .zz-media {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 0.35rem;
        text-decoration: none;
        color: inherit;
        width: 110px;
    }

    .zz-poster {
        width: 90px;
        height: 135px;
        border-radius: 0.5rem;
        object-fit: cover;
        box-shadow: 0 4px 12px oklch(0 0 0 / 0.4);
        transition: transform 0.2s, box-shadow 0.2s;
    }

    .zz-media:hover .zz-poster {
        transform: scale(1.05);
        box-shadow: 0 6px 20px oklch(0 0 0 / 0.5);
    }

    .zz-poster-placeholder {
        display: flex;
        align-items: center;
        justify-content: center;
        background: oklch(var(--b3));
        color: oklch(var(--bc) / 0.3);
    }

    .zz-media-title {
        font-size: 0.7rem;
        font-weight: 600;
        text-align: center;
        line-height: 1.3;
        max-width: 110px;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
        color: oklch(var(--bc) / 0.8);
    }

    .zz-media-year {
        font-size: 0.6rem;
        color: oklch(var(--bc) / 0.4);
    }

    /* Block button */
    .zz-block-btn {
        position: absolute;
        top: -6px;
        right: -2px;
        z-index: 10;
        width: 20px;
        height: 20px;
        border-radius: 50%;
        background: oklch(var(--er));
        color: oklch(var(--erc));
        border: 2px solid oklch(var(--b1));
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        opacity: 0;
        transition: opacity 0.15s, transform 0.15s;
        transform: scale(0.8);
    }

    .zz-media-wrap:hover .zz-block-btn {
        opacity: 1;
        transform: scale(1);
    }

    /* Vertical connector between zigzag rows */
    .zz-vertical-connector {
        display: flex;
        justify-content: flex-end;
        width: 100%;
        max-width: 750px;
        padding: 0;
    }

    .zz-vert-right {
        justify-content: flex-end;
        padding-right: 50px;
    }

    .zz-vert-left {
        justify-content: flex-start;
        padding-left: 50px;
    }

    .zz-curve-svg {
        width: 60px;
        height: 48px;
    }

    /* Path section (multi-path) */
    .path-section {
        padding-top: 0.5rem;
        border-top: 1px solid oklch(var(--b3));
    }
    .path-section:first-of-type {
        border-top: none;
    }

    /* ── Mobile: stack vertically ── */
    @media (max-width: 639px) {
        .zigzag-row {
            flex-direction: column !important;
            gap: 0.25rem;
        }
        .zz-connector {
            flex-direction: row;
            max-width: none;
            width: 60px;
        }
        .zz-line {
            width: 2px;
            height: 24px;
            background: linear-gradient(to bottom, oklch(var(--p) / 0.35), oklch(var(--s) / 0.35)) !important;
        }
        .zz-vertical-connector {
            display: none;
        }
    }

    /* ── Large screens: wider ── */
    @media (min-width: 1024px) {
        .zigzag-row {
            max-width: 850px;
        }
        .zz-vertical-connector {
            max-width: 850px;
        }
        .zz-avatar {
            width: 84px;
            height: 84px;
        }
        .zz-poster {
            width: 100px;
            height: 150px;
        }
        .zz-person {
            width: 120px;
        }
        .zz-media {
            width: 130px;
        }
        .zz-person-name, .zz-media-title {
            max-width: 120px;
        }
    }
</style>

