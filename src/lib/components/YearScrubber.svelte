<script>
    import { goto } from "$app/navigation";
    import { page } from "$app/stores";

    /** @type {{ yearMap: Array<{year: string, count: number}> }} */
    let { yearMap } = $props();

    let isDragging = $state(false);
    let scrubberEl = $state(/** @type {HTMLElement|null} */ (null));

    // Find max count for density scaling
    const maxCount = $derived(Math.max(...yearMap.map((y) => y.count), 1));

    // Current active year from URL
    const activeYear = $derived.by(() => {
        const from = $page.url.searchParams.get("from");
        if (from) return from.substring(0, 4);
        return null;
    });

    /**
     * Navigate to a specific year
     * @param {string} year
     */
    function goToYear(year) {
        const params = new URLSearchParams($page.url.searchParams);
        params.set("from", `${year}-01-01`);
        params.set("to", `${year}-12-31`);
        goto(`/history?${params.toString()}`, { keepFocus: true });
    }

    /** Clear year filter */
    function clearYear() {
        const params = new URLSearchParams($page.url.searchParams);
        params.delete("from");
        params.delete("to");
        goto(`/history?${params.toString()}`, { keepFocus: true });
    }

    /**
     * Handle drag/scrub on the bar
     * @param {MouseEvent | TouchEvent} e
     */
    function handleScrub(e) {
        if (!scrubberEl || yearMap.length === 0) return;
        const rect = scrubberEl.getBoundingClientRect();
        const clientY =
            "touches" in e ? e.touches[0].clientY : e.clientY;
        const ratio = Math.max(
            0,
            Math.min(1, (clientY - rect.top) / rect.height),
        );
        const idx = Math.round(ratio * (yearMap.length - 1));
        if (yearMap[idx]) {
            goToYear(yearMap[idx].year);
        }
    }

    /**
     * @param {MouseEvent} e
     */
    function onMouseDown(e) {
        isDragging = true;
        handleScrub(e);
    }
    /**
     * @param {MouseEvent} e
     */
    function onMouseMove(e) {
        if (isDragging) handleScrub(e);
    }
    function onMouseUp() {
        isDragging = false;
    }
</script>

<svelte:window onmousemove={onMouseMove} onmouseup={onMouseUp} />

{#if yearMap.length > 1}
    <div
        class="year-scrubber"
        bind:this={scrubberEl}
        role="slider"
        tabindex="0"
        aria-label="Timeline year scrubber"
        aria-valuemin={parseInt(yearMap[yearMap.length - 1]?.year || "0")}
        aria-valuemax={parseInt(yearMap[0]?.year || "0")}
        aria-valuenow={parseInt(activeYear || yearMap[0]?.year || "0")}
        onmousedown={onMouseDown}
        ontouchstart={(e) => {
            isDragging = true;
            handleScrub(e);
        }}
        ontouchmove={handleScrub}
        ontouchend={() => (isDragging = false)}
    >
        {#each yearMap as item (item.year)}
            {@const density = Math.max(0.3, item.count / maxCount)}
            {@const isActive = activeYear === item.year}
            <button
                class="year-item"
                class:active={isActive}
                style="--density: {density}"
                onclick={() =>
                    isActive ? clearYear() : goToYear(item.year)}
                title="{item.year}: {item.count} plays"
            >
                <span class="year-label">{item.year}</span>
                <span class="year-dot"></span>
            </button>
        {/each}
    </div>
{/if}

<style>
    .year-scrubber {
        position: fixed;
        right: 0.5rem;
        top: 50%;
        transform: translateY(-50%);
        display: flex;
        flex-direction: column;
        align-items: flex-end;
        gap: 2px;
        z-index: 40;
        padding: 0.75rem 0.25rem;
        border-radius: 1rem;
        background: oklch(from var(--b2) l c h / 0.7);
        backdrop-filter: blur(8px);
        user-select: none;
        cursor: pointer;
        max-height: 70vh;
        overflow-y: auto;
        scrollbar-width: none;
    }

    .year-scrubber::-webkit-scrollbar {
        display: none;
    }

    .year-item {
        display: flex;
        align-items: center;
        gap: 4px;
        padding: 2px 8px;
        border: none;
        background: transparent;
        cursor: pointer;
        transition: all 0.15s ease;
        border-radius: 0.5rem;
        white-space: nowrap;
    }

    .year-item:hover {
        background: oklch(from var(--p) l c h / 0.15);
    }

    .year-item.active {
        background: oklch(from var(--p) l c h / 0.2);
    }

    .year-label {
        font-size: 0.65rem;
        font-weight: 600;
        color: oklch(from var(--bc) l c h / 0.5);
        transition: all 0.15s ease;
    }

    .year-item:hover .year-label,
    .year-item.active .year-label {
        color: oklch(from var(--p) l c h);
        font-size: 0.75rem;
    }

    .year-dot {
        width: calc(4px + 8px * var(--density));
        height: 4px;
        border-radius: 2px;
        background: oklch(from var(--p) l c h / calc(0.3 + 0.5 * var(--density)));
        transition: all 0.15s ease;
    }

    .year-item:hover .year-dot,
    .year-item.active .year-dot {
        background: oklch(from var(--p) l c h / 0.9);
        height: 5px;
    }

    /* Mobile: smaller labels */
    @media (max-width: 768px) {
        .year-scrubber {
            right: 0.25rem;
            padding: 0.5rem 0.125rem;
        }
        .year-label {
            font-size: 0.55rem;
        }
        .year-item {
            padding: 1px 4px;
            gap: 2px;
        }
    }
</style>
