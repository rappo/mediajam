<script>
    import MdiIcon from '$lib/components/MdiIcon.svelte';
    import { mdiAccount, mdiChevronLeft, mdiChevronRight } from '@mdi/js';
    import { imgUrl } from '$lib/utils.js';

    /**
     * CreditRow — Horizontal scrolling row of person cards (cast or crew).
     * Matches the square portrait + label style used in dashboard poster rows.
     *
     * @prop {string} title — Section title (e.g. "Cast", "Crew")
     * @prop {any[]} items — Array of person objects with id, name, photo_url, character_name, role_type
     * @prop {number} [limit=20] — Max items to show before "Show all" button
     */
    let { title = '', items = [], limit = 20 } = $props();

    let showAll = $state(false);
    /** @type {HTMLDivElement|null} */
    let scrollContainer = $state(null);
    let canScrollLeft = $state(false);
    let canScrollRight = $state(false);

    const displayed = $derived(showAll ? items : items.slice(0, limit));

    function updateScrollState() {
        if (!scrollContainer) return;
        canScrollLeft = scrollContainer.scrollLeft > 0;
        canScrollRight = scrollContainer.scrollLeft < scrollContainer.scrollWidth - scrollContainer.clientWidth - 2;
    }

    $effect(() => {
        displayed; // track
        if (scrollContainer) {
            requestAnimationFrame(updateScrollState);
        }
    });

    function scrollBy(dir) {
        scrollContainer?.scrollBy({ left: dir * 400, behavior: 'smooth' });
    }
</script>

{#if items.length > 0}
    <div class="credit-section">
        {#if title}
            <div class="credit-title-row">
                <h3 class="credit-section-title">{title}</h3>
            </div>
        {/if}
        <div class="credit-row-wrapper" class:fade-right={canScrollRight}>
            {#if canScrollLeft}
                <button class="credit-scroll-btn left" onclick={() => scrollBy(-1)}><MdiIcon icon={mdiChevronLeft} size={20} /></button>
            {/if}
            <div
                class="credit-row"
                bind:this={scrollContainer}
                onscroll={updateScrollState}
            >
                {#each displayed as person}
                    <a href="/people/{person.id}" class="credit-card group">
                        <div class="credit-portrait">
                            {#if person.photo_url}
                                <img src={imgUrl(person.photo_url, 200)} alt={person.name} class="credit-img" loading="lazy" />
                            {:else}
                                <div class="credit-placeholder">
                                    <MdiIcon icon={mdiAccount} size={28} />
                                </div>
                            {/if}
                        </div>
                        <div class="credit-label">
                            <span class="credit-name">{person.name}</span>
                            {#if person.character_name}
                                <span class="credit-role">{person.character_name}</span>
                            {:else if person.role_type}
                                <span class="credit-role capitalize">{person.role_type}</span>
                            {/if}
                        </div>
                    </a>
                {/each}
            </div>
            {#if canScrollRight}
                <button class="credit-scroll-btn right" onclick={() => scrollBy(1)}><MdiIcon icon={mdiChevronRight} size={20} /></button>
            {/if}
        </div>
        {#if items.length > limit}
            <button
                class="credit-toggle"
                onclick={() => showAll = !showAll}
            >
                {showAll ? '← Show less' : `Show all ${items.length} →`}
            </button>
        {/if}
    </div>
{/if}

<style>
    .credit-section {
        margin-bottom: 0;
    }
    .credit-title-row {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        margin-bottom: 0.5rem;
    }
    .credit-section-title {
        font-size: 0.85rem;
        font-weight: 600;
        opacity: 0.6;
        white-space: nowrap;
        text-transform: uppercase;
        letter-spacing: 0.04em;
    }
    .credit-row-wrapper {
        position: relative;
    }
    .credit-row-wrapper.fade-right .credit-row {
        -webkit-mask-image: linear-gradient(to right, black 85%, transparent 100%);
        mask-image: linear-gradient(to right, black 85%, transparent 100%);
    }
    .credit-row {
        display: flex;
        gap: 0.6rem;
        overflow-x: auto;
        scroll-snap-type: x mandatory;
        scrollbar-width: none;
        -ms-overflow-style: none;
        padding-bottom: 0.25rem;
    }
    .credit-row::-webkit-scrollbar { display: none; }

    .credit-card {
        flex-shrink: 0;
        width: 110px;
        text-decoration: none;
        color: inherit;
        scroll-snap-align: start;
        transition: transform 0.15s;
    }
    .credit-card:hover {
        transform: translateY(-2px);
    }

    .credit-portrait {
        width: 110px;
        height: 110px;
        border-radius: 0.5rem;
        overflow: hidden;
        position: relative;
        transition: box-shadow 0.15s;
    }
    .credit-card:hover .credit-portrait {
        box-shadow: 0 6px 20px rgba(0,0,0,0.35);
    }
    .credit-img {
        width: 100%;
        height: 100%;
        object-fit: cover;
    }
    .credit-placeholder {
        width: 100%;
        height: 100%;
        background: oklch(var(--b3));
        display: flex;
        align-items: center;
        justify-content: center;
        color: oklch(var(--bc) / 0.3);
    }

    .credit-label {
        margin-top: 0.3rem;
        display: flex;
        flex-direction: column;
        gap: 0;
    }
    .credit-name {
        font-size: 0.7rem;
        font-weight: 600;
        line-height: 1.2;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        color: oklch(var(--bc) / 0.9);
        transition: color 0.15s;
    }
    .credit-card:hover .credit-name {
        color: oklch(var(--p));
    }
    .credit-role {
        font-size: 0.6rem;
        line-height: 1.2;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        color: oklch(var(--bc) / 0.4);
    }

    .credit-toggle {
        font-size: 0.7rem;
        color: oklch(var(--p) / 0.7);
        background: none;
        border: none;
        cursor: pointer;
        margin-top: 0.35rem;
        padding: 0;
    }
    .credit-toggle:hover {
        color: oklch(var(--p));
    }

    .credit-scroll-btn {
        position: absolute;
        top: 45%;
        transform: translateY(-50%);
        z-index: 3;
        width: 2rem;
        height: 2rem;
        border-radius: 50%;
        border: none;
        background: oklch(var(--b1) / 0.9);
        color: oklch(var(--bc));
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        box-shadow: 0 2px 8px rgba(0,0,0,0.3);
        backdrop-filter: blur(4px);
    }
    .credit-scroll-btn:hover {
        background: oklch(var(--b2));
    }
    .credit-scroll-btn.left { left: -0.5rem; }
    .credit-scroll-btn.right { right: -0.5rem; }
</style>
