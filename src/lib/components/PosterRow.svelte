<script>
    import MdiIcon from '$lib/components/MdiIcon.svelte';
    import { mdiMovieOpen, mdiChevronLeft, mdiChevronRight, mdiDownload, mdiCheck } from '@mdi/js';
    import { imgUrl } from "$lib/utils.js";
    import { goto } from "$app/navigation";
    /** @type {{ title: string, items: any[], emptyText?: string, square?: boolean, showLabels?: boolean, timeFilter?: { paramName: string, value: string, options: {label: string, value: string}[] }, onAutoSearch?: (item: any) => void }} */
    let { title, items, emptyText = '', square = false, showLabels = false, timeFilter = undefined, onAutoSearch = undefined } = $props();
    /** @type {HTMLDivElement|null} */
    let scrollContainer = $state(null);
    let canScrollLeft = $state(false);
    let canScrollRight = $state(false);
    let needsScroll = $state(false);

    /** @type {Set<string>} */
    let searching = $state(new Set());
    /** @type {Set<string>} */
    let searched = $state(new Set());

    function updateScrollState() {
        if (!scrollContainer) return;
        canScrollLeft = scrollContainer.scrollLeft > 0;
        canScrollRight = scrollContainer.scrollLeft < scrollContainer.scrollWidth - scrollContainer.clientWidth - 2;
        needsScroll = scrollContainer.scrollWidth > scrollContainer.clientWidth + 2;
    }

    // Check scroll state on mount and when items change
    $effect(() => {
        items; // track
        if (scrollContainer) {
            // Wait for layout
            requestAnimationFrame(updateScrollState);
        }
    });

    function scrollBy(dir) {
        scrollContainer?.scrollBy({ left: dir * 400, behavior: 'smooth' });
    }

    function onTimeChange(e) {
        const url = new URL(window.location.href);
        url.searchParams.set(timeFilter.paramName, e.target.value);
        goto(url.toString(), { invalidateAll: true });
    }
</script>

{#if items.length > 0}
    <div class="poster-section">
        {#if title}
        <div class="poster-title-row">
            <h3 class="poster-section-title">{title}</h3>
            {#if timeFilter}
                <select class="time-select" value={timeFilter.value} onchange={onTimeChange}>
                    {#each timeFilter.options as opt}
                        <option value={opt.value} selected={opt.value === timeFilter.value}>{opt.label}</option>
                    {/each}
                </select>
            {/if}
        </div>
        {/if}
        <div class="poster-row-wrapper" class:fade-right={canScrollRight}>
            {#if canScrollLeft}
                <button class="poster-scroll-btn left" onclick={() => scrollBy(-1)}><MdiIcon icon={mdiChevronLeft} size={20} /></button>
            {/if}
            <div
                class="poster-row"
                class:poster-row-square={square}
                bind:this={scrollContainer}
                onscroll={updateScrollState}
            >
                {#each items as item}
                    <div class="poster-item" class:poster-item-labeled={showLabels}>
                    <a href={item.href} class="poster-card" title={item.title} target={item.external ? '_blank' : undefined} rel={item.external ? 'noopener noreferrer' : undefined}>
                        {#if item.poster_url}
                            <img src={imgUrl(item.poster_url)} alt={item.title} class="poster-img" loading="lazy" />
                        {:else}
                            <div class="poster-placeholder">
                                <span><MdiIcon icon={mdiMovieOpen} size={32} /></span>
                            </div>
                        {/if}
                        {#if !showLabels}
                        <div class="poster-overlay">
                            <div class="poster-title">{item.title}</div>
                            {#if item.subtitle}
                                <div class="poster-subtitle">{item.subtitle}</div>
                            {/if}
                            {#if onAutoSearch && item.service}
                                <button
                                    class="poster-search-btn"
                                    title="Auto-search downloads"
                                    onclick={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        const key = item.arrId || item.title;
                                        if (searching.has(key) || searched.has(key)) return;
                                        const next = new Set(searching);
                                        next.add(key);
                                        searching = next;
                                        Promise.resolve(onAutoSearch(item)).then(() => {
                                            const done = new Set(searched);
                                            done.add(key);
                                            searched = done;
                                        }).finally(() => {
                                            const rm = new Set(searching);
                                            rm.delete(key);
                                            searching = rm;
                                        });
                                    }}
                                >
                                    {#if searching.has(item.arrId || item.title)}
                                        <span class="loading loading-spinner" style="width:14px;height:14px"></span>
                                    {:else if searched.has(item.arrId || item.title)}
                                        <MdiIcon icon={mdiCheck} size={16} />
                                    {:else}
                                        <MdiIcon icon={mdiDownload} size={16} />
                                    {/if}
                                </button>
                            {/if}
                        </div>
                        {/if}
                        {#if item.badge}
                            <span class="poster-badge {item.badgeClass || ''}">{item.badge}</span>
                        {/if}
                    </a>
                    {#if showLabels}
                        <div class="poster-card-label">
                            <span class="poster-card-label-title">{item.title}</span>
                            {#if item.subtitle}
                                <span class="poster-card-label-sub">{item.subtitle}</span>
                            {/if}
                        </div>
                    {/if}
                    </div>
                {/each}
            </div>
            {#if canScrollRight}
                <button class="poster-scroll-btn right" onclick={() => scrollBy(1)}><MdiIcon icon={mdiChevronRight} size={20} /></button>
            {/if}
        </div>
    </div>
{:else if emptyText}
    <!-- skip empty sections silently -->
{/if}

<style>
    .poster-section {
        margin-bottom: 0;
    }
    .poster-title-row {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        margin-bottom: 0.5rem;
    }
    .poster-title-row::after {
        content: '';
        flex: 1;
        height: 1px;
        background: currentColor;
        opacity: 0.12;
        min-width: 2rem;
        margin-left: 0.5rem;
    }
    .poster-section-title {
        font-size: 1.1rem;
        font-weight: 700;
        opacity: 0.9;
        white-space: nowrap;
    }
    .time-select {
        font-size: 0.7rem;
        padding: 0.15rem 0.4rem;
        border-radius: 0.3rem;
        border: 1px solid oklch(var(--bc) / 0.15);
        background: oklch(var(--b2));
        color: oklch(var(--bc) / 0.7);
        cursor: pointer;
        outline: none;
    }
    .time-select:hover {
        border-color: oklch(var(--bc) / 0.3);
    }
    .poster-row-wrapper {
        position: relative;
    }
    /* Right-edge fade via CSS mask — works over any background */
    .poster-row-wrapper.fade-right .poster-row {
        -webkit-mask-image: linear-gradient(to right, black 85%, transparent 100%);
        mask-image: linear-gradient(to right, black 85%, transparent 100%);
    }
    .poster-row {
        display: flex;
        gap: 0.6rem;
        overflow-x: auto;
        scroll-snap-type: x mandatory;
        scrollbar-width: none;
        -ms-overflow-style: none;
        padding-bottom: 0.25rem;
    }
    .poster-row::-webkit-scrollbar { display: none; }
    .poster-card {
        flex-shrink: 0;
        width: 140px;
        aspect-ratio: 2/3;
        border-radius: 0.5rem;
        overflow: hidden;
        position: relative;
        scroll-snap-align: start;
        transition: transform 0.15s, box-shadow 0.15s;
        cursor: pointer;
        text-decoration: none;
        color: inherit;
    }
    .poster-row-square .poster-card {
        width: 150px;
        aspect-ratio: 1/1;
    }
    .poster-card:hover {
        transform: scale(1.05);
        box-shadow: 0 8px 24px rgba(0,0,0,0.4);
        z-index: 2;
    }
    .poster-img {
        width: 100%;
        height: 100%;
        object-fit: cover;
    }
    .poster-placeholder {
        width: 100%;
        height: 100%;
        background: oklch(var(--b3));
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 2rem;
    }
    .poster-overlay {
        position: absolute;
        bottom: 0;
        left: 0;
        right: 0;
        padding: 0.5rem;
        background: linear-gradient(transparent, rgba(0,0,0,0.85));
        opacity: 0;
        transition: opacity 0.15s;
    }
    .poster-card:hover .poster-overlay {
        opacity: 1;
    }
    .poster-search-btn {
        position: absolute;
        top: 0.35rem;
        left: 0.35rem;
        width: 1.75rem;
        height: 1.75rem;
        border-radius: 50%;
        border: none;
        background: oklch(var(--p) / 0.9);
        color: oklch(var(--pc));
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        backdrop-filter: blur(4px);
        transition: transform 0.1s, background 0.15s;
        z-index: 2;
    }
    .poster-search-btn:hover {
        transform: scale(1.15);
        background: oklch(var(--p));
    }
    .poster-title {
        font-size: 0.75rem;
        font-weight: 600;
        line-height: 1.2;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        color: #fff;
    }
    .poster-subtitle {
        font-size: 0.65rem;
        opacity: 0.7;
        color: #fff;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }
    .poster-badge {
        position: absolute;
        top: 0.35rem;
        right: 0.35rem;
        font-size: 0.6rem;
        font-weight: 700;
        padding: 0.1rem 0.35rem;
        border-radius: 0.25rem;
        background: oklch(var(--p));
        color: oklch(var(--pc));
    }
    /* Incoming status badge variants */
    .poster-badge.badge-queue {
        background: oklch(0.55 0.18 250);
        color: #fff;
    }
    .poster-badge.badge-failed {
        background: oklch(0.55 0.22 25);
        color: #fff;
    }
    .poster-badge.badge-missing {
        background: oklch(0.6 0.18 55);
        color: #fff;
    }
    .poster-badge.badge-unreleased {
        background: oklch(0.45 0.02 260);
        color: oklch(0.85 0 0);
    }
    .poster-badge.badge-upgrade {
        background: oklch(0.7 0.17 85);
        color: oklch(0.25 0 0);
    }
    .poster-scroll-btn {
        position: absolute;
        top: 50%;
        transform: translateY(-50%);
        z-index: 3;
        width: 2rem;
        height: 2rem;
        border-radius: 50%;
        border: none;
        background: oklch(var(--b1) / 0.9);
        color: oklch(var(--bc));
        font-size: 1.2rem;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        box-shadow: 0 2px 8px rgba(0,0,0,0.3);
        backdrop-filter: blur(4px);
    }
    .poster-scroll-btn:hover {
        background: oklch(var(--b2));
    }
    .poster-scroll-btn.left { left: -0.5rem; }
    .poster-scroll-btn.right { right: -0.5rem; }

    /* ══════════════ LABELED CARDS ══════════════ */
    .poster-item {
        flex-shrink: 0;
    }
    .poster-item-labeled {
        width: 140px;
    }
    .poster-item-labeled .poster-card {
        width: 100%;
    }
    .poster-row-square .poster-item-labeled {
        width: 150px;
    }
    .poster-card-label {
        margin-top: 0.3rem;
        display: flex;
        flex-direction: column;
        gap: 0;
    }
    .poster-card-label-title {
        font-size: 0.7rem;
        font-weight: 600;
        line-height: 1.2;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        color: oklch(var(--bc) / 0.9);
    }
    .poster-card-label-sub {
        font-size: 0.6rem;
        line-height: 1.2;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        color: oklch(var(--bc) / 0.4);
    }
</style>
