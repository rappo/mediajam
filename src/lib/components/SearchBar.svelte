<script>
    import { goto } from "$app/navigation";
    import { addToast } from "$lib/stores/toast.js";

    let open = $state(false);
    let query = $state("");
    /** @type {any} */
    let results = $state(null);
    let loading = $state(false);
    let selectedIndex = $state(-1);
    /** @type {ReturnType<typeof setTimeout> | null} */
    let debounceTimer = null;
    /** @type {HTMLInputElement | null} */
    let inputEl = $state(null);

    function close() {
        open = false;
        query = "";
        results = null;
        selectedIndex = -1;
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

    /** @param {KeyboardEvent} e */
    function handleKeydown(e) {
        const items = flatResults(results);
        if (e.key === "ArrowDown" && items.length > 0) {
            e.preventDefault();
            selectedIndex = Math.min(selectedIndex + 1, items.length - 1);
            scrollSelectedIntoView();
        } else if (e.key === "ArrowUp" && items.length > 0) {
            e.preventDefault();
            selectedIndex = Math.max(selectedIndex - 1, -1);
            scrollSelectedIntoView();
        } else if (e.key === "Enter" && items.length > 0) {
            e.preventDefault();
            if (selectedIndex >= 0 && selectedIndex < items.length) {
                navigateToResult(items[selectedIndex]);
            } else {
                navigateToResult(items[0]);
            }
        } else if (e.key === "Escape") {
            close();
        }
    }

    /** @param {KeyboardEvent} e */
    function handleGlobalKeydown(e) {
        if (e.ctrlKey && e.key === "k") {
            e.preventDefault();
            open = !open;
            if (open) setTimeout(() => inputEl?.focus(), 50);
        }
        if (e.key === "Escape" && open) {
            close();
        }
    }

    function scrollSelectedIntoView() {
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
</script>

<svelte:window onkeydown={handleGlobalKeydown} />

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

<!-- Modal overlay - NO portal, just position:fixed with high z-index -->
{#if open}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
        class="search-overlay"
        onkeydown={handleKeydown}
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
                                            src={item.poster_url}
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
                            No results
                        </p>
                        <p style="font-size:0.85rem">
                            Nothing found for "<strong>{query}</strong>"
                        </p>
                    </div>
                {:else if !results && query.length < 2}
                    <div class="search-empty">
                        <p style="font-size:0.85rem">
                            Type to search across your library...
                        </p>
                    </div>
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
        background: rgba(0, 0, 0, 0.6);
        backdrop-filter: blur(8px);
    }
    .search-dialog {
        width: 100%;
        max-width: 32rem;
        border-radius: 1rem;
        border: 1px solid oklch(var(--p) / 0.3);
        overflow: hidden;
        animation: search-in 0.15s ease-out;
        background: oklch(var(--b1));
        box-shadow: 0 0 30px 4px oklch(var(--p) / 0.15), 0 25px 50px -12px rgba(0,0,0,0.5);
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
</style>
