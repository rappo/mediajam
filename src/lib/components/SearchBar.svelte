<script>
    import { goto } from "$app/navigation";
    import { onMount } from "svelte";
    import { addToast } from "$lib/stores/toast.js";
    import { imgUrl } from "$lib/utils.js";

    let open = $state(false);
    let query = $state("");
    /** @type {any} */
    let results = $state(null);
    let loading = $state(false);
    let selectedIndex = $state(-1);
    /** @type {any} */
    let externalResults = $state(null);
    let externalLoading = $state(false);
    /** @type {ReturnType<typeof setTimeout> | null} */
    let debounceTimer = null;
    /** @type {HTMLInputElement | null} */
    let inputEl = $state(null);

    // Use a plain object ref so native event listeners always see current state
    const stateRef = { open: false, results: null, selectedIndex: -1 };
    $effect(() => { stateRef.open = open; });
    $effect(() => { stateRef.results = results; });
    $effect(() => { stateRef.selectedIndex = selectedIndex; });

    onMount(() => {
        /** @param {KeyboardEvent} e */
        function handleKeys(e) {
            if (e.ctrlKey && e.key === "k") {
                e.preventDefault();
                open = !open;
                if (open) setTimeout(() => inputEl?.focus(), 50);
                return;
            }
            if (e.key === "Escape" && stateRef.open) {
                close();
                return;
            }
            if (stateRef.open && stateRef.results) {
                const items = flatResults(stateRef.results);
                if (e.key === "ArrowDown" && items.length > 0) {
                    e.preventDefault();
                    selectedIndex = Math.min(stateRef.selectedIndex + 1, items.length - 1);
                    scrollSelectedIntoView();
                } else if (e.key === "ArrowUp" && items.length > 0) {
                    e.preventDefault();
                    selectedIndex = Math.max(stateRef.selectedIndex - 1, -1);
                    scrollSelectedIntoView();
                } else if (e.key === "Enter" && items.length > 0) {
                    e.preventDefault();
                    if (stateRef.selectedIndex >= 0 && stateRef.selectedIndex < items.length) {
                        navigateToResult(items[stateRef.selectedIndex]);
                    } else {
                        navigateToResult(items[0]);
                    }
                }
            }
        }
        document.addEventListener('keydown', handleKeys);
        return () => document.removeEventListener('keydown', handleKeys);
    });



    function close() {
        open = false;
        query = "";
        results = null;
        externalResults = null;
        externalLoading = false;
        selectedIndex = -1;
    }

    async function searchExternal() {
        if (query.length < 2) return;
        externalLoading = true;
        try {
            const res = await fetch(`/api/search/external?q=${encodeURIComponent(query)}`);
            if (res.ok) {
                externalResults = await res.json();
            }
        } catch (/** @type {any} */ err) {
            addToast({ type: 'error', message: 'External search failed', detail: err?.message || String(err) });
        }
        externalLoading = false;
    }

    /** @param {any} item */
    function navigateToExternalResult(item) {
        close();
        if (item.type === 'movie' && item.tmdb_id) {
            window.open(`https://www.themoviedb.org/movie/${item.tmdb_id}`, '_blank');
        } else if (item.type === 'show' && item.tmdb_id) {
            window.open(`https://www.themoviedb.org/tv/${item.tmdb_id}`, '_blank');
        } else if (item.type === 'artist' && item.musicbrainz_id) {
            window.open(`https://musicbrainz.org/artist/${item.musicbrainz_id}`, '_blank');
        }
    }

    function handleInput() {
        if (debounceTimer) clearTimeout(debounceTimer);
        if (query.length < 2) {
            results = null;
            return;
        }
        loading = true;
        debounceTimer = setTimeout(async () => {
            try {
                const res = await fetch(
                    `/api/search?q=${encodeURIComponent(query)}`,
                );
                if (!res.ok) {
                    const errText = await res.text();
                    addToast({
                        type: "error",
                        message: `Search failed (${res.status})`,
                        detail: errText,
                    });
                    results = null;
                } else {
                    const data = await res.json();
                    results = data;
                }
                selectedIndex = -1;
            } catch (/** @type {any} */ err) {
                addToast({
                    type: "error",
                    message: "Search failed",
                    detail: err?.message || String(err),
                });
                results = null;
            }
            loading = false;
        }, 250);
    }

    /** @param {any} item */
    function navigateToResult(item) {
        close();
        if (item.type === "show") goto(`/tv/${item.id}`);
        else if (item.type === "movie") goto(`/movies/${item.id}`);
        else if (item.type === "artist") goto(`/music/${item.id}`);
        else if (item.type === "person") goto(`/people/${item.id}`);
        else if (item.type === "album") goto(`/music/${item.parent_id}`);
        else if (item.type === "child") {
            if (item.media_type === "artist") goto(`/music/${item.parent_id}`);
            else if (item.media_type === "show") goto(`/tv/${item.parent_id}`);
            else goto(`/movies/${item.parent_id}`);
        } else if (item.type === "history") {
            if (item.media_type === "show")
                goto(`/tv/${item.parent_id || item.id}`);
            else if (item.media_type === "movie")
                goto(`/movies/${item.parent_id || item.id}`);
            else if (item.media_type === "artist")
                goto(`/music/${item.parent_id || item.id}`);
            else goto(`/history`);
        }
    }

    /** @param {any} r */
    function flatResults(r) {
        if (!r?.results) return [];
        return [
            ...(r.results.shows || []),
            ...(r.results.movies || []),
            ...(r.results.music || []),
            ...(r.results.albums || []),
            ...(r.results.people || []),
            ...(r.results.children || []),
            ...(r.results.history || []),
        ];
    }


    function scrollSelectedIntoView() {
        // Wait a tick for the DOM to update with the new selected class
        setTimeout(() => {
            const el = document.querySelector(".search-result-item.selected");
            el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
        }, 0);
    }

    /** @type {Record<string, string>} */
    const TYPE_ICONS = {
        show: "📺",
        movie: "🎬",
        artist: "🎵",
        album: "💿",
        person: "👤",
        child: "📄",
        history: "⏱️",
    };
    /** @type {Record<string, string>} */
    const TYPE_LABELS = {
        show: "TV Show",
        movie: "Movie",
        artist: "Artist",
        album: "Album",
        person: "Person",
        child: "Episode/Track",
        history: "History",
    };

    /** @param {any} item */
    function itemLabel(item) {
        if (item.type === "album") {
            return `${item.parent_title} — ${item.item_title}`;
        }
        if (item.type === "child") {
            if (item.season_number)
                return `${item.parent_title} S${item.season_number}E${item.item_number} — ${item.item_title}`;
            return `${item.parent_title} — ${item.item_title}`;
        }
        if (item.type === "history") {
            if (item.season_number)
                return `${item.parent_title} S${item.season_number}E${item.item_number}`;
            return `${item.parent_title} — ${item.item_title}`;
        }
        return item.title;
    }

    /** @param {any} item */
    function itemSubLabel(item) {
        if (item.type === "show")
            return item.release_year
                ? `${item.release_year} · ${item.episode_count || 0} episodes`
                : `${item.episode_count || 0} episodes`;
        if (item.type === "movie") return item.release_year || "";
        if (item.type === "artist") return `${item.album_count || 0} albums`;
        if (item.type === "album") return item.parent_title || "";
        if (item.type === "person") return `${item.credit_count || 0} credits`;
        if (item.type === "history")
            return item.timestamp
                ? new Date(item.timestamp).toLocaleDateString()
                : "";
        return "";
    }
    /** @param {HTMLElement} node */
    function portal(node) {
        const theme = document.documentElement.getAttribute("data-theme");
        if (theme) node.setAttribute("data-theme", theme);
        document.body.appendChild(node);

        // Read actual computed colors from a real themed element (the navbar)
        const themedEl =
            document.querySelector(".navbar") ||
            document.querySelector("[data-theme]") ||
            document.documentElement;
        const cs = getComputedStyle(themedEl);
        const bgColor = cs.backgroundColor; // resolved RGB

        // Get primary color from a themed element
        const tempEl = document.createElement("div");
        tempEl.className = "text-primary";
        tempEl.style.display = "none";
        document.body.appendChild(tempEl);
        const primaryColor = getComputedStyle(tempEl).color;
        tempEl.remove();

        const dialog = /** @type {HTMLElement|null} */ (
            node.querySelector(".search-dialog")
        );
        if (dialog) {
            dialog.style.backgroundColor = bgColor;
            dialog.style.borderColor = primaryColor
                .replace(")", " / 0.3)")
                .replace("rgb(", "rgba(");
            dialog.style.boxShadow = `0 0 30px 4px ${primaryColor.replace(")", " / 0.15)").replace("rgb(", "rgba(")}, 0 25px 50px -12px rgba(0,0,0,0.5)`;
        }

        const inputRow = /** @type {HTMLElement|null} */ (
            node.querySelector(".search-input-row")
        );
        if (inputRow) {
            inputRow.style.borderBottomColor = bgColor
                .replace(")", " / 0.5)")
                .replace("rgb(", "rgba(");
        }

        // Attach keyboard handler directly to the input element in the portal
        const inp = /** @type {HTMLInputElement|null} */ (node.querySelector('.search-input'));
        let portalSelectedIdx = -1;

        function updatePortalSelection() {
            const allItems = node.querySelectorAll('.search-result-item');
            allItems.forEach((el, i) => {
                if (i === portalSelectedIdx) {
                    el.classList.add('selected');
                    el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
                } else {
                    el.classList.remove('selected');
                }
            });
        }

        /** @param {KeyboardEvent} e */
        function handlePortalKeydown(e) {
            const allItems = node.querySelectorAll('.search-result-item');
            const count = allItems.length;
            if (e.key === 'ArrowDown' && count > 0) {
                e.preventDefault();
                portalSelectedIdx = Math.min(portalSelectedIdx + 1, count - 1);
                updatePortalSelection();
            } else if (e.key === 'ArrowUp' && count > 0) {
                e.preventDefault();
                portalSelectedIdx = Math.max(portalSelectedIdx - 1, -1);
                updatePortalSelection();
            } else if (e.key === 'Enter' && count > 0) {
                e.preventDefault();
                const target = portalSelectedIdx >= 0 ? allItems[portalSelectedIdx] : allItems[0];
                if (target) /** @type {HTMLElement} */ (target).click();
            } else if (e.key === 'Escape') {
                close();
            }
        }
        if (inp) {
            // Reset selection index when input changes (new results)
            inp.addEventListener('input', () => { portalSelectedIdx = -1; });
            inp.addEventListener('keydown', handlePortalKeydown);
        }

        return {
            destroy() {
                if (inp) inp.removeEventListener('keydown', handlePortalKeydown);
                node.remove();
            },
        };
    }
</script>



<!-- Search trigger button -->
<button
    class="btn btn-ghost btn-sm gap-2 font-normal text-base-content/60 hover:text-base-content"
    onclick={() => {
        open = true;
        setTimeout(() => inputEl?.focus(), 50);
    }}
>
    <svg
        xmlns="http://www.w3.org/2000/svg"
        class="h-4 w-4"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
    >
        <circle cx="11" cy="11" r="8" /><line
            x1="21"
            y1="21"
            x2="16.65"
            y2="16.65"
        />
    </svg>
    <span class="hidden md:inline text-sm">Search</span>
    <kbd class="kbd kbd-xs hidden lg:inline-flex">Ctrl+K</kbd>
</button>

<!-- Modal overlay - portaled to body to escape navbar stacking context -->
{#if open}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
        class="search-overlay"
        use:portal
        onclick={(e) => {
            if (e.target === e.currentTarget) close();
        }}
    >
        <div class="search-dialog">
            <!-- Search input -->
            <div class="search-input-row">
                <svg
                    xmlns="http://www.w3.org/2000/svg"
                    class="search-icon"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                >
                    <circle cx="11" cy="11" r="8" /><line
                        x1="21"
                        y1="21"
                        x2="16.65"
                        y2="16.65"
                    />
                </svg>
                <input
                    bind:this={inputEl}
                    bind:value={query}
                    oninput={handleInput}
                    type="text"
                    placeholder="Search shows, movies, music, people..."
                    class="search-input"
                />
                {#if loading}
                    <span class="loading loading-spinner loading-xs"></span>
                {/if}
                <kbd class="kbd kbd-xs" style="opacity:0.3">ESC</kbd>
            </div>

            <!-- Results -->
            <div class="search-results">
                {#if results && results.totalCount > 0}
                    {@const flat = flatResults(results)}
                    {#each ["shows", "movies", "music", "albums", "people", "children", "history"] as category}
                        {#if results.results[category]?.length > 0}
                            <div class="search-category-label">
                                {category === "children"
                                    ? "Episodes & Tracks"
                                    : category === "music"
                                      ? "Artists"
                                      : category === "albums"
                                        ? "Albums"
                                        : category === "people"
                                          ? "People"
                                          : category}
                            </div>
                            {#each results.results[category] as item}
                                {@const globalIdx = flat.indexOf(item)}
                                <button
                                    class="search-result-item"
                                    class:selected={globalIdx === selectedIndex}
                                    onclick={() => navigateToResult(item)}
                                >
                                    {#if item.poster_url}
                                        <img
                                            src={imgUrl(item.poster_url)}
                                            alt=""
                                            class="search-thumb"
                                            class:search-thumb-round={item.type ===
                                                "person"}
                                        />
                                    {:else}
                                        <span class="search-thumb-placeholder">
                                            {TYPE_ICONS[item.type] || "🔍"}
                                        </span>
                                    {/if}
                                    <div class="search-result-text">
                                        <div class="search-result-title">
                                            {itemLabel(item)}
                                        </div>
                                        {#if itemSubLabel(item)}
                                            <div class="search-result-sub">
                                                {itemSubLabel(item)}
                                            </div>
                                        {/if}
                                    </div>
                                    <span class="search-result-type"
                                        >{TYPE_LABELS[item.type] ||
                                            item.type}</span
                                    >
                                </button>
                            {/each}
                        {/if}
                    {/each}
                {:else if results && results.totalCount === 0 && query.length >= 2}
                    <div class="search-empty">
                        <p style="font-size:1.1rem;margin-bottom:0.25rem">
                            No results in library
                        </p>
                        <p style="font-size:0.85rem">
                            Nothing found for "<strong>{query}</strong>" in your library
                        </p>
                    </div>
                {:else if !results && query.length < 2}
                    <div class="search-empty">
                        <p style="font-size:0.85rem">
                            Type to search across your library...
                        </p>
                    </div>
                {/if}

                <!-- External search section -->
                {#if query.length >= 2}
                    <div class="search-external-divider">
                        <span class="search-external-line"></span>
                        <span class="search-external-label">External Search</span>
                        <span class="search-external-line"></span>
                    </div>

                    {#if !externalResults && !externalLoading}
                        <div style="padding: 0.5rem 1rem 0.75rem;">
                            <button class="btn btn-sm btn-ghost gap-2 w-full" onclick={searchExternal}>
                                🌐 Search TMDb & MusicBrainz
                            </button>
                        </div>
                    {:else if externalLoading}
                        <div style="padding: 1rem; text-align: center;">
                            <span class="loading loading-spinner loading-sm"></span>
                            <span style="font-size: 0.8rem; opacity: 0.5; margin-left: 0.5rem;">Searching externally...</span>
                        </div>
                    {:else if externalResults}
                        {#if externalResults.movies?.length > 0}
                            <div class="search-category-label">🎬 Movies (TMDb)</div>
                            {#each externalResults.movies as item}
                                <button class="search-result-item" onclick={() => navigateToExternalResult(item)}>
                                    {#if item.poster_url}
                                        <img src={item.poster_url} alt="" class="search-thumb" />
                                    {:else}
                                        <span class="search-thumb-placeholder">🎬</span>
                                    {/if}
                                    <div class="search-result-text">
                                        <div class="search-result-title">{item.title}</div>
                                        <div class="search-result-sub">{item.release_year || ''}{item.overview ? ` · ${item.overview}` : ''}</div>
                                    </div>
                                    <span class="search-ext-badge">TMDb</span>
                                </button>
                            {/each}
                        {/if}
                        {#if externalResults.shows?.length > 0}
                            <div class="search-category-label">📺 TV Shows (TMDb)</div>
                            {#each externalResults.shows as item}
                                <button class="search-result-item" onclick={() => navigateToExternalResult(item)}>
                                    {#if item.poster_url}
                                        <img src={item.poster_url} alt="" class="search-thumb" />
                                    {:else}
                                        <span class="search-thumb-placeholder">📺</span>
                                    {/if}
                                    <div class="search-result-text">
                                        <div class="search-result-title">{item.title}</div>
                                        <div class="search-result-sub">{item.release_year || ''}{item.overview ? ` · ${item.overview}` : ''}</div>
                                    </div>
                                    <span class="search-ext-badge">TMDb</span>
                                </button>
                            {/each}
                        {/if}
                        {#if externalResults.artists?.length > 0}
                            <div class="search-category-label">🎵 Artists (MusicBrainz)</div>
                            {#each externalResults.artists as item}
                                <button class="search-result-item" onclick={() => navigateToExternalResult(item)}>
                                    <span class="search-thumb-placeholder">🎵</span>
                                    <div class="search-result-text">
                                        <div class="search-result-title">{item.title}</div>
                                        <div class="search-result-sub">
                                            {item.disambiguation || ''}
                                            {item.country ? ` · ${item.country}` : ''}
                                        </div>
                                    </div>
                                    <span class="search-ext-badge ext-mb">MB</span>
                                </button>
                            {/each}
                        {/if}
                        {#if externalResults.totalCount === 0}
                            <div class="search-empty" style="padding: 1rem;">
                                <p style="font-size: 0.85rem;">No external results found</p>
                            </div>
                        {/if}
                    {/if}
                {/if}
            </div>

            <!-- Footer -->
            {#if results && results.totalCount > 0}
                <div class="search-footer">
                    <span>↑↓ Navigate</span>
                    <span>↵ Open</span>
                    <span>ESC Close</span>
                </div>
            {/if}
        </div>
    </div>
{/if}

<style>
    .search-overlay {
        position: fixed;
        inset: 0;
        z-index: 9999;
        display: flex;
        align-items: flex-start;
        justify-content: center;
        padding-top: 15vh;
        background: rgba(0, 0, 0, 0.4);
        backdrop-filter: blur(8px);
    }
    .search-dialog {
        width: 100%;
        max-width: 32rem;
        border-radius: 1rem;
        border: 1px solid transparent;
        overflow: hidden;
        animation: search-in 0.15s ease-out;
    }
    .search-input-row {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        padding: 0.75rem 1rem;
        border-bottom: 1px solid transparent;
    }
    .search-icon {
        width: 1.25rem;
        height: 1.25rem;
        opacity: 0.4;
        flex-shrink: 0;
    }
    .search-input {
        flex: 1;
        background: transparent;
        border: none;
        outline: none;
        color: oklch(var(--bc));
        font-size: 0.95rem;
    }
    .search-input::placeholder {
        opacity: 0.3;
    }
    .search-results {
        max-height: 50vh;
        overflow-y: auto;
    }
    .search-category-label {
        padding: 0.75rem 0.75rem 0.25rem;
        font-size: 0.7rem;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        opacity: 0.4;
    }
    .search-result-item {
        width: 100%;
        display: flex;
        align-items: center;
        gap: 0.75rem;
        padding: 0.6rem 1rem;
        text-align: left;
        border: none;
        background: none;
        color: oklch(var(--bc));
        cursor: pointer;
        transition: background 0.1s;
    }
    .search-result-item:hover,
    .search-result-item.selected {
        background: oklch(var(--p) / 0.12);
    }
    .search-thumb {
        width: 2rem;
        height: 2rem;
        border-radius: 0.25rem;
        object-fit: cover;
        flex-shrink: 0;
    }
    .search-thumb-round {
        border-radius: 50%;
    }
    .search-thumb-placeholder {
        width: 2rem;
        height: 2rem;
        border-radius: 0.25rem;
        background: oklch(var(--b3));
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 0.85rem;
        flex-shrink: 0;
    }
    .search-result-text {
        flex: 1;
        min-width: 0;
    }
    .search-result-title {
        font-size: 0.875rem;
        font-weight: 500;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }
    .search-result-sub {
        font-size: 0.75rem;
        opacity: 0.5;
    }
    .search-result-type {
        font-size: 0.7rem;
        opacity: 0.3;
        flex-shrink: 0;
    }
    .search-empty {
        padding: 2rem 1rem;
        text-align: center;
        opacity: 0.4;
    }
    .search-footer {
        display: flex;
        align-items: center;
        gap: 1rem;
        padding: 0.5rem 1rem;
        border-top: 1px solid oklch(var(--b3));
        font-size: 0.7rem;
        opacity: 0.3;
    }
    @keyframes search-in {
        from {
            opacity: 0;
            transform: scale(0.96) translateY(-8px);
        }
        to {
            opacity: 1;
            transform: scale(1) translateY(0);
        }
    }
    .search-external-divider {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.5rem 1rem 0;
    }
    .search-external-line {
        flex: 1;
        height: 1px;
        background: oklch(var(--bc) / 0.1);
    }
    .search-external-label {
        font-size: 0.65rem;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        opacity: 0.3;
    }
    .search-ext-badge {
        font-size: 0.6rem;
        font-weight: 700;
        padding: 0.15rem 0.4rem;
        border-radius: 0.25rem;
        background: oklch(var(--p) / 0.15);
        color: oklch(var(--p));
        flex-shrink: 0;
        letter-spacing: 0.03em;
    }
    .search-ext-badge.ext-mb {
        background: oklch(var(--su) / 0.15);
        color: oklch(var(--su));
    }
</style>
