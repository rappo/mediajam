<script>
    import { imgUrl } from "$lib/utils.js";
    import MediaTypeFilter from "$lib/components/MediaTypeFilter.svelte";
    import DashSection from '$lib/components/DashSection.svelte';
    import MdiIcon from '$lib/components/MdiIcon.svelte';
    import { mdiCalendar, mdiMovieOpen, mdiTelevision, mdiMusic } from '@mdi/js';

    let { upcoming = [], onSettingsChange = () => {}, maxPerDay = 2 } = $props();

    let calendarDays = $state(7);
    let activeTypes = $state(['movie', 'show', 'artist']);
    /** @type {Set<string>} */
    let expandedDays = $state(new Set());
    const MAX_VISIBLE = maxPerDay;

    let filteredDays = $derived(
        upcoming.map(day => ({
            ...day,
            items: day.items.filter(it => activeTypes.includes(it.media_type)),
        }))
    );

    let weekRows = $derived.by(() => {
        const rows = [];
        for (let i = 0; i < filteredDays.length; i += 7) {
            rows.push(filteredDays.slice(i, i + 7));
        }
        return rows;
    });

    let rangeLabel = $derived.by(() => {
        const weeks = Math.floor(calendarDays / 7);
        if (weeks <= 1) return '1 week';
        return `${weeks} weeks`;
    });

    /** Pick the best poster from a day's items — returns raw URL */
    function dayHeroPosterRaw(day) {
        const withPoster = day.items.filter(i => i.display_poster || i.poster_url);
        if (withPoster.length === 0) return '';
        return withPoster[0].display_poster || withPoster[0].poster_url;
    }

    /** Same but proxied for inline CSS background-image */
    function dayHeroImage(day) {
        const raw = dayHeroPosterRaw(day);
        return raw ? imgUrl(raw) : '';
    }

    /** First poster URL for DashSection glow */
    let firstGlowSrc = $derived.by(() => {
        for (const day of filteredDays) {
            const src = dayHeroPosterRaw(day);
            if (src) return src;
        }
        return '';
    });

    function onTypesChanged(types) {
        activeTypes = types;
        onSettingsChange({ calendarDays, calendarTypes: activeTypes });
    }

    function resetTypes() {
        activeTypes = ['movie', 'show', 'artist'];
        onSettingsChange({ calendarDays, calendarTypes: activeTypes });
    }

    function showMore() {
        calendarDays += 7;
        onSettingsChange({ calendarDays, calendarTypes: activeTypes });
    }

    function typeBadge(type) {
        if (type === 'movie') return 'MOVIE';
        if (type === 'show') return 'TV';
        return 'MUSIC';
    }

    function typeColor(type) {
        if (type === 'movie') return 'var(--color-movies)';
        if (type === 'show') return 'var(--color-tv)';
        return 'var(--color-music)';
    }
</script>

<DashSection title="Upcoming · {rangeLabel}" icon={mdiCalendar} glowSrc={firstGlowSrc}>
    {#snippet headerLeft()}
        <a href="/calendar" class="hcal-inline-link">Calendar →</a>
        <button class="hcal-inline-btn" onclick={showMore}>Show more +</button>
    {/snippet}
    {#snippet headerRight()}
        <MediaTypeFilter {activeTypes} onchange={onTypesChanged} />
    {/snippet}

        <!-- Week rows -->
        {#each weekRows as week, wi}
            <div class="hcal-strip" class:hcal-strip-extra={wi > 0}>
                {#each week as day}
                    {@const heroSrc = dayHeroImage(day)}
                    <div class="hcal-day" class:is-today={day.isToday} class:is-weekend={day.dayName === 'Sat' || day.dayName === 'Sun'}>
                        <!-- Day backdrop glow -->
                        {#if heroSrc}
                            <div class="hcal-day-bg" style="background-image: url('{heroSrc}')"></div>
                        {/if}

                        <!-- Day header -->
                        <div class="hcal-day-head" class:today={day.isToday}>
                            <span class="hcal-day-name">{day.dayName.toUpperCase()}</span>
                            <span class="hcal-day-num">{day.dayNum}</span>
                        </div>

                        <!-- Items -->
                        <div class="hcal-day-body">
                            {#if day.items.length === 0}
                                <div class="hcal-empty">—</div>
                            {:else}
                                {#each (expandedDays.has(day.date) ? day.items : day.items.slice(0, MAX_VISIBLE)) as item}
                                    <a
                                        href={item.href || '/calendar'}
                                        class="hcal-item"
                                    >
                                        <!-- Poster -->
                                        <div class="hcal-item-poster" class:tall={item.media_type === 'show' || item.media_type === 'movie'}>
                                            {#if item.display_poster || item.poster_url}
                                                <img
                                                    src={imgUrl(item.display_poster || item.poster_url)}
                                                    alt={item.title}
                                                    loading="lazy"
                                                />
                                            {:else}
                                                <div class="hcal-no-poster">
                                                    {#if item.media_type === 'movie'}<MdiIcon icon={mdiMovieOpen} size={16} />{:else if item.media_type === 'show'}<MdiIcon icon={mdiTelevision} size={16} />{:else}<MdiIcon icon={mdiMusic} size={16} />{/if}
                                                </div>
                                            {/if}
                                        </div>
                                        <!-- Info -->
                                        <div class="hcal-item-info">
                                            <span class="hcal-badge" style="background: oklch({typeColor(item.media_type)} / 0.15); color: oklch({typeColor(item.media_type)})">{typeBadge(item.media_type)}</span>
                                            <span class="hcal-item-title">{item.title}</span>
                                            {#if item.subtitle}
                                                <span class="hcal-item-sub">{item.subtitle}{item.episode_title && item.episode_title !== 'TBA' ? ` — ${item.episode_title}` : ''}</span>
                                            {:else if item.episode_title && item.episode_title !== 'TBA'}
                                                <span class="hcal-item-sub">{item.episode_title}</span>
                                            {/if}
                                        </div>
                                    </a>
                                {/each}
                                {#if day.items.length > MAX_VISIBLE && !expandedDays.has(day.date)}
                                    <button
                                        class="hcal-day-expand"
                                        onclick={() => { expandedDays = new Set([...expandedDays, day.date]); }}
                                    >
                                        +{day.items.length - MAX_VISIBLE} more
                                    </button>
                                {/if}
                            {/if}
                        </div>
                    </div>
                {/each}
            </div>
        {/each}

</DashSection>

<style>
    /* ══════════════ DAY STRIP ══════════════ */
    .hcal-strip {
        display: flex;
        gap: 0.5rem;
        overflow-x: auto;
        scrollbar-width: none;
        padding: 0;
    }
    .hcal-strip::-webkit-scrollbar { display: none; }
    .hcal-strip-extra { margin-top: 0.5rem; }

    /* ══════════════ DAY CARD (HERO) ══════════════ */
    .hcal-day {
        flex: 1 0 0;
        min-width: 130px;
        border-radius: 0.75rem;
        overflow: hidden;
        position: relative;
        isolation: isolate;
        border: 1px solid rgba(255, 255, 255, 0.12);
        background: oklch(var(--b1) / 0.5);
        transition: border-color 0.25s, box-shadow 0.25s;
    }
    .hcal-day.is-weekend {
        border-color: rgba(251, 191, 36, 0.3);
    }
    .hcal-day-bg {
        position: absolute;
        inset: 0;
        background-size: cover;
        background-position: center;
        filter: blur(30px) saturate(1.3);
        opacity: 0.12;
        z-index: 0;
        pointer-events: none;
    }
    .hcal-day.is-today {
        border-color: oklch(var(--p) / 0.5);
        box-shadow: 0 0 16px oklch(var(--p) / 0.12);
    }

    /* Day header */
    .hcal-day-head {
        position: relative;
        z-index: 1;
        display: flex;
        flex-direction: column;
        align-items: center;
        padding: 0.5rem 0.5rem 0.35rem;
        border-bottom: 1px solid oklch(var(--bc) / 0.05);
    }
    .hcal-day-head.today {
        background: oklch(var(--p) / 0.08);
    }
    .hcal-day-name {
        font-size: 0.6rem;
        font-weight: 700;
        letter-spacing: 0.06em;
        color: oklch(var(--bc) / 0.35);
    }
    .hcal-day-head.today .hcal-day-name { color: oklch(var(--p) / 0.8); }
    .hcal-day-num {
        font-size: 1.4rem;
        font-weight: 800;
        color: oklch(var(--bc) / 0.7);
        line-height: 1.1;
    }
    .hcal-day-head.today .hcal-day-num { color: oklch(var(--p)); }

    /* Day body */
    .hcal-day-body {
        position: relative;
        z-index: 1;
        padding: 0.4rem;
        display: flex;
        flex-direction: column;
        gap: 0.35rem;
        min-height: 90px;
    }

    .hcal-empty {
        font-size: 0.7rem;
        color: oklch(var(--bc) / 0.1);
        text-align: center;
        padding: 2rem 0;
    }

    .hcal-day-expand {
        display: block;
        width: 100%;
        padding: 0.25rem;
        font-size: 0.6rem;
        font-weight: 700;
        color: oklch(var(--p) / 0.7);
        background: oklch(var(--p) / 0.04);
        border: 1px dashed oklch(var(--p) / 0.15);
        border-radius: 0.3rem;
        cursor: pointer;
        transition: all 0.15s;
        text-align: center;
    }
    .hcal-day-expand:hover {
        color: oklch(var(--p));
        background: oklch(var(--p) / 0.1);
        border-color: oklch(var(--p) / 0.3);
    }

    /* ══════════════ ITEMS ══════════════ */
    .hcal-item {
        display: flex;
        gap: 0.4rem;
        padding: 0.3rem;
        border-radius: 0.45rem;
        text-decoration: none;
        color: inherit;
        transition: background 0.15s, transform 0.15s;
        cursor: pointer;
        overflow: hidden;
    }
    .hcal-item:hover {
        background: oklch(var(--bc) / 0.06);
        transform: translateY(-1px);
    }

    .hcal-item-poster {
        flex-shrink: 0;
        width: 44px;
        height: 44px;
        border-radius: 0.3rem;
        overflow: hidden;
        background: oklch(var(--bc) / 0.06);
    }
    .hcal-item-poster.tall { height: 66px; }
    .hcal-item-poster img {
        width: 100%;
        height: 100%;
        object-fit: cover;
        display: block;
    }
    .hcal-no-poster {
        width: 100%;
        height: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 1rem;
    }

    .hcal-item-info {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 0.1rem;
        padding-top: 0.05rem;
    }

    .hcal-badge {
        font-size: 0.45rem;
        font-weight: 800;
        letter-spacing: 0.05em;
        text-transform: uppercase;
        padding: 0.06rem 0.3rem;
        border-radius: 0.2rem;
        width: fit-content;
        line-height: 1.4;
    }

    .hcal-item-title {
        font-size: 0.68rem;
        font-weight: 700;
        color: oklch(var(--bc) / 0.9);
        line-height: 1.25;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
    }
    .hcal-item-sub {
        font-size: 0.55rem;
        color: oklch(var(--bc) / 0.4);
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
    }

    /* ══════════════ SHOW MORE ══════════════ */
    /* ══════════════ INLINE HEADER CONTROLS ══════════════ */
    .hcal-inline-link,
    .hcal-inline-btn {
        font-size: 0.65rem;
        font-weight: 600;
        color: oklch(var(--bc) / 0.4);
        text-decoration: none;
        background: transparent;
        border: 1px dashed oklch(var(--bc) / 0.12);
        border-radius: 999px;
        padding: 0.15rem 0.55rem;
        cursor: pointer;
        transition: all 0.15s;
        white-space: nowrap;
    }
    .hcal-inline-btn {
        margin-left: auto;
    }
    .hcal-inline-link:hover,
    .hcal-inline-btn:hover {
        color: oklch(var(--p));
        border-color: oklch(var(--p) / 0.3);
        background: oklch(var(--p) / 0.05);
    }

    @media (max-width: 767px) {
        .hcal-day { min-width: 110px; }
        .hcal-item-poster { width: 36px; height: 36px; }
        .hcal-item-poster.tall { height: 54px; }
    }
</style>
