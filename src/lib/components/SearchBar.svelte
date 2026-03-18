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
    /** @type {any} */
    let externalResults = $state(null);
    let externalLoading = $state(false);
    /** @type {ReturnType<typeof setTimeout> | null} */
    let debounceTimer = null;
    /** @type {HTMLInputElement | null} */
    let inputEl = $state(null);
    /** Currently highlighted result index, -1 = nothing selected */
    let selectedIdx = $state(-1);

    // Ctrl+K global shortcut — the only thing that needs addEventListener
    onMount(() => {
        /** @param {KeyboardEvent} e */
        function handleGlobalKey(e) {
            if (e.ctrlKey && e.key === "k") {
                e.preventDefault();
                open = !open;
                if (open) setTimeout(() => inputEl?.focus(), 50);
            }
        }
        document.addEventListener("keydown", handleGlobalKey);
        return () => document.removeEventListener("keydown", handleGlobalKey);
    });

    /**
     * Handle keyboard events on the overlay (Svelte-managed, no portal issues)
     * @param {KeyboardEvent} e
     */
    function handleDialogKeydown(e) {
        if (e.key === "ArrowDown") {
            e.preventDefault();
            const count = flatResults().length;
            if (count > 0) {
                selectedIdx = Math.min(selectedIdx + 1, count - 1);
            }
        } else if (e.key === "ArrowUp") {
            e.preventDefault();
            if (selectedIdx > 0) {
                selectedIdx = selectedIdx - 1;
            } else {
                selectedIdx = -1;
                inputEl?.focus();
            }
        } else if (e.key === "Enter") {
            e.preventDefault();
            const flat = flatResults();
            if (flat.length > 0) {
                const target =
                    selectedIdx >= 0 && selectedIdx < flat.length
                        ? flat[selectedIdx]
                        : flat[0];
                navigateToResult(target.item);
            }
        } else if (e.key === "Escape") {
            e.preventDefault();
            close();
        }
    }

    /**
     * Svelte action: scroll element into view when it becomes the active selection.
     * @param {HTMLElement} node
     * @param {boolean} isActive
     */
    function scrollWhenActive(node, isActive) {
        if (isActive) {
            node.scrollIntoView({ block: "nearest", behavior: "smooth" });
        }
        return {
            /** @param {boolean} newActive */
            update(newActive) {
                if (newActive) {
                    node.scrollIntoView({ block: "nearest", behavior: "smooth" });
                }
            },
        };
    }

    /**
     * Flatten all result items into a single ordered list for keyboard nav.
     * @returns {Array<{item: any, category: string}>}
     */
    function flatResults() {
        if (!results?.results) return [];
        const items = /** @type {Array<{item: any, category: string}>} */ ([]);
        for (const category of [
            "shows",
            "movies",
            "music",
            "albums",
            "people",
            "children",
            "history",
        ]) {
            for (const item of results.results[category] || []) {
                items.push({ item, category });
            }
        }
        return items;
    }

    function close() {
        open = false;
        query = "";
        results = null;
        externalResults = null;
        externalLoading = false;
        selectedIdx = -1;
    }

    async function searchExternal() {
        if (query.length < 2) return;
        externalLoading = true;
        try {
            const res = await fetch(
                `/api/search/external?q=${encodeURIComponent(query)}`,
            );
            if (res.ok) {
                externalResults = await res.json();
            }
        } catch (/** @type {any} */ err) {
            addToast({
                type: "error",
                message: "External search failed",
                detail: err?.message || String(err),
            });
        }
        externalLoading = false;
    }

    /** @param {any} item */
    async function navigateToExternalResult(item) {
        close();
        try {
            const res = await fetch("/api/search/external/stub", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    type: item.type,
                    tmdb_id: item.tmdb_id || null,
                    musicbrainz_id: item.musicbrainz_id || null,
                    title: item.title,
                    release_year: item.release_year || null,
                    poster_url: item.poster_url || null,
                    overview: item.overview || null,
                }),
            });
            if (res.ok) {
                const data = await res.json();
                goto(data.href);
            } else {
                addToast({ type: "error", message: "Failed to create entry" });
            }
        } catch (/** @type {any} */ err) {
            addToast({
                type: "error",
                message: "Failed to load result",
                detail: err?.message || String(err),
            });
        }
    }

    function handleInput() {
        selectedIdx = -1;
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
                selectedIdx = -1;
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
            if (item.media_type === "artist")
                goto(`/music/${item.parent_id}`);
            else if (item.media_type === "show")
                goto(`/tv/${item.parent_id}`);
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
        if (item.type === "artist")
            return `${item.album_count || 0} albums`;
        if (item.type === "album") return item.parent_title || "";
        if (item.type === "person")
            return `${item.credit_count || 0} credits`;
        if (item.type === "history")
            return item.timestamp
                ? new Date(item.timestamp).toLocaleDateString()
                : "";
        return "";
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

<!-- Modal overlay — NO portal, just position:fixed -->
{#if open}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
        class="search-overlay"
        onclick={(e) => {
            if (e.target === e.currentTarget) close();
        }}
        onkeydown={handleDialogKeydown}
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
                    {@const flat = flatResults()}
                    {#each flat as entry, idx}
                        {#if idx === 0 || entry.category !== flat[idx - 1].category}
                            <div class="search-category-label">
                                {entry.category === "children"
                                    ? "Episodes & Tracks"
                                    : entry.category === "music"
                                      ? "Artists"
                                      : entry.category === "albums"
                                        ? "Albums"
                                        : entry.category === "people"
                                          ? "People"
                                          : entry.category}
                            </div>
                        {/if}
                        <button
                            class="search-result-item"
                            class:search-result-active={selectedIdx === idx}
                            use:scrollWhenActive={selectedIdx === idx}
                            onclick={() => navigateToResult(entry.item)}
                            onmouseenter={() => {
                                selectedIdx = idx;
                            }}
                        >
                            {#if entry.item.poster_url}
                                <img
                                    src={imgUrl(entry.item.poster_url)}
                                    alt=""
                                    class="search-thumb"
                                    class:search-thumb-round={entry.item.type ===
                                        "person"}
                                />
                            {:else}
                                <span class="search-thumb-placeholder">
                                    {TYPE_ICONS[entry.item.type] || "🔍"}
                                </span>
                            {/if}
                            <div class="search-result-text">
                                <div class="search-result-title">
                                    {itemLabel(entry.item)}
                                </div>
                                {#if itemSubLabel(entry.item)}
                                    <div class="search-result-sub">
                                        {itemSubLabel(entry.item)}
                                    </div>
                                {/if}
                            </div>
                            <span class="search-result-type"
                                >{TYPE_LABELS[entry.item.type] ||
                                    entry.item.type}</span
                            >
                        </button>
                    {/each}
                {:else if results && results.totalCount === 0 && query.length >= 2}
                    <div class="search-empty">
                        <p style="font-size:1.1rem;margin-bottom:0.25rem">
                            No results in library
                        </p>
                        <p style="font-size:0.85rem">
                            Nothing found for "<strong>{query}</strong>" in your
                            library
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
                        <span class="search-external-label"
                            >External Search</span
                        >
                        <span class="search-external-line"></span>
                    </div>

                    {#if !externalResults && !externalLoading}
                        <div style="padding: 0.5rem 1rem 0.75rem;">
                            <button
                                class="btn btn-sm btn-ghost gap-2 w-full"
                                onclick={searchExternal}
                            >
                                🌐 Search TMDb & MusicBrainz
                            </button>
                        </div>
                    {:else if externalLoading}
                        <div style="padding: 1rem; text-align: center;">
                            <span
                                class="loading loading-spinner loading-sm"
                            ></span>
                            <span
                                style="font-size: 0.8rem; opacity: 0.5; margin-left: 0.5rem;"
                                >Searching externally...</span
                            >
                        </div>
                    {:else if externalResults}
                        {#if externalResults.movies?.length > 0}
                            <div class="search-category-label">
                                🎬 Movies (TMDb)
                            </div>
                            {#each externalResults.movies as item}
                                <button
                                    class="search-result-item"
                                    onclick={() =>
                                        navigateToExternalResult(item)}
                                >
                                    {#if item.poster_url}
                                        <img
                                            src={item.poster_url}
                                            alt=""
                                            class="search-thumb"
                                        />
                                    {:else}
                                        <span class="search-thumb-placeholder"
                                            >🎬</span
                                        >
                                    {/if}
                                    <div class="search-result-text">
                                        <div class="search-result-title">
                                            {item.title}
                                        </div>
                                        <div class="search-result-sub">
                                            {item.release_year || ""}{item.overview
                                                ? ` · ${item.overview}`
                                                : ""}
                                        </div>
                                    </div>
                                    <span class="search-ext-badge">TMDb</span>
                                </button>
                            {/each}
                        {/if}
                        {#if externalResults.shows?.length > 0}
                            <div class="search-category-label">
                                📺 TV Shows (TMDb)
                            </div>
                            {#each externalResults.shows as item}
                                <button
                                    class="search-result-item"
                                    onclick={() =>
                                        navigateToExternalResult(item)}
                                >
                                    {#if item.poster_url}
                                        <img
                                            src={item.poster_url}
                                            alt=""
                                            class="search-thumb"
                                        />
                                    {:else}
                                        <span class="search-thumb-placeholder"
                                            >📺</span
                                        >
                                    {/if}
                                    <div class="search-result-text">
                                        <div class="search-result-title">
                                            {item.title}
                                        </div>
                                        <div class="search-result-sub">
                                            {item.release_year || ""}{item.overview
                                                ? ` · ${item.overview}`
                                                : ""}
                                        </div>
                                    </div>
                                    <span class="search-ext-badge">TMDb</span>
                                </button>
                            {/each}
                        {/if}
                        {#if externalResults.artists?.length > 0}
                            <div class="search-category-label">
                                🎵 Artists (MusicBrainz)
                            </div>
                            {#each externalResults.artists as item}
                                <button
                                    class="search-result-item"
                                    onclick={() =>
                                        navigateToExternalResult(item)}
                                >
                                    <span class="search-thumb-placeholder"
                                        >🎵</span
                                    >
                                    <div class="search-result-text">
                                        <div class="search-result-title">
                                            {item.title}
                                        </div>
                                        <div class="search-result-sub">
                                            {item.disambiguation || ""}
                                            {item.country
                                                ? ` · ${item.country}`
                                                : ""}
                                        </div>
                                    </div>
                                    <span class="search-ext-badge ext-mb"
                                        >MB</span
                                    >
                                </button>
                            {/each}
                        {/if}
                        {#if externalResults.totalCount === 0}
                            <div class="search-empty" style="padding: 1rem;">
                                <p style="font-size: 0.85rem;">
                                    No external results found
                                </p>
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
        background: rgba(0, 0, 0, 0.5);
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
    }
    .search-dialog {
        width: 100%;
        max-width: 32rem;
        border-radius: 1rem;
        border: 1px solid oklch(var(--p) / 0.25);
        overflow: hidden;
        animation: search-in 0.15s ease-out;
        background: oklch(var(--b1));
        box-shadow:
            0 0 30px 4px oklch(var(--p) / 0.1),
            0 25px 50px -12px rgba(0, 0, 0, 0.5);
    }
    .search-input-row {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        padding: 0.75rem 1rem;
        border-bottom: 1px solid oklch(var(--b3));
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
    .search-result-active {
        background: oklch(var(--p) / 0.15);
    }
    .search-result-active {
        outline: 2px solid oklch(var(--p) / 0.4);
        outline-offset: -2px;
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
