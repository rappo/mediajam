<script>
    import { onMount } from 'svelte';
    import DeleteToast from "$lib/components/DeleteToast.svelte";
    import Skeleton from "$lib/components/Skeleton.svelte";
    import { imgUrl } from "$lib/utils.js";

    let { data } = $props();

    // Smart sections — loaded on mount
    let sectionsLoaded = $state(false);
    let sections = $state(/** @type {any} */ ({ hero: null, recommended: [], personRecs: [], recentlyWatched: [], unwatched: [] }));

    onMount(async () => {
        try {
            const res = await fetch('/api/pages/movies');
            const d = await res.json();
            sections = d.sections;
        } catch (e) {
            console.error('[movies] Failed to load sections:', e);
        }
        sectionsLoaded = true;
    });

    /** @param {string} ts */
    function timeAgo(ts) {
        if (!ts) return '';
        const d = new Date(ts);
        const diff = Math.floor((Date.now() - d.getTime()) / 86400000);
        if (diff === 0) return 'Today';
        if (diff === 1) return 'Yesterday';
        if (diff < 7) return `${diff}d ago`;
        if (diff < 30) return `${Math.floor(diff / 7)}w ago`;
        if (diff < 365) return `${Math.floor(diff / 30)}mo ago`;
        return `${Math.floor(diff / 365)}y ago`;
    }
</script>

<svelte:head>
    <title>Mediajam — Movies</title>
</svelte:head>

<div class="page-wrap max-w-6xl mx-auto">
    <DeleteToast />

    <!-- Header -->
    <div class="page-header">
        <div>
            <h1 class="page-title">Movies</h1>
            <p class="page-sub">
                {data.totalMovies.toLocaleString()} films · {data.movieStats.watched.toLocaleString()} watched · {data.runtimeHours.toLocaleString()}h total runtime
            </p>
        </div>
        <a href="/movies/library" class="btn btn-ghost btn-sm">
            Library & Stats →
        </a>
    </div>

    <!-- ═══ SMART HOME VIEW ═══ -->

        {#if !sectionsLoaded}
            <!-- Skeleton placeholders while sections load -->
            <Skeleton type="poster-row" />
            <Skeleton type="poster-row" />
            <Skeleton type="poster-row" />
        {:else}

        <!-- ▌HERO: Pattern Detection ──────────────────────────────── -->
        {#if sections.hero && sections.hero.items.length > 0}
            <section class="hero-banner">
                <!-- Background faded poster -->
                {#if sections.hero.items[0]?.poster_url}
                    <div class="hero-bg" style="background-image: url('{imgUrl(sections.hero.items[0].poster_url)}')"></div>
                {/if}
                <div class="hero-overlay"></div>
                <div class="hero-body">
                    <h2 class="hero-title">{sections.hero.title}</h2>
                    <p class="hero-subtitle">{sections.hero.subtitle}</p>
                    <div class="hero-posters">
                        {#each sections.hero.items.slice(0, 6) as item}
                            <a href="/movies/{item.id}" class="poster-card" title={item.title}>
                                <div class="poster-img poster-placeholder">🎬</div>
                                {#if item.poster_url}
                                    <img src={imgUrl(item.poster_url)} alt={item.title} class="poster-img poster-img-abs" loading="lazy" onerror={(e) => { /** @type {HTMLImageElement} */ (e.currentTarget).style.display='none'; }} />
                                {/if}
                                <div class="poster-meta">
                                    <span class="poster-name">{item.title}</span>
                                    <span class="poster-year">{item.release_year || ''}</span>
                                </div>
                            </a>
                        {/each}
                    </div>
                </div>
            </section>
        {/if}

        <!-- ▌RECOMMENDED FOR YOU ──────────────────────────────────── -->
        {#if sections.recommended.length > 0}
            <section class="smart-section">
                <div class="section-header">
                    <h2 class="section-title">🎯 Recommended For You</h2>
                    <span class="section-count">based on what you watch</span>
                </div>
                <div class="poster-scroll">
                    {#each sections.recommended as item}
                        <a href="/movies/{item.id}" class="poster-card" title={item.title}>
                            <span class="uwb">unwatched</span>
                            <div class="poster-img poster-placeholder">🎬</div>
                            {#if item.poster_url}
                                <img src={imgUrl(item.poster_url)} alt={item.title} class="poster-img poster-img-abs" loading="lazy" onerror={(e) => { /** @type {HTMLImageElement} */ (e.currentTarget).style.display='none'; }} />
                            {/if}
                            <div class="poster-meta">
                                <span class="poster-name">{item.title}</span>
                                {#if item.reason}
                                    <span class="poster-reason">{item.reason}</span>
                                {/if}
                            </div>
                        </a>
                    {/each}
                </div>
            </section>
        {/if}

        <!-- ▌PERSON RECOMMENDATIONS ────────────────────────────── -->
        {#each sections.personRecs as section}
            <section class="smart-section">
                <div class="section-header">
                    <h2 class="section-title">
                        {#if section.sectionTitle && section.personId}
                            {@const parts = section.sectionTitle.split(section.person)}
                            {parts[0]}<a href="/people/{section.personId}" class="person-link">{section.person}</a>{parts.slice(1).join(section.person)}
                        {:else}
                            {section.sectionTitle || `More from ${section.person}`}
                        {/if}
                    </h2>
                    <span class="section-count">{section.totalInLibrary} films in library · {section.items.length} unwatched</span>
                </div>
                <div class="poster-scroll">
                    {#each section.items as item}
                        <a href="/movies/{item.id}" class="poster-card" title={item.title}>
                            <span class="uwb">unwatched</span>
                            <div class="poster-img poster-placeholder">🎬</div>
                            {#if item.poster_url}
                                <img src={imgUrl(item.poster_url)} alt={item.title} class="poster-img poster-img-abs" loading="lazy" onerror={(e) => { /** @type {HTMLImageElement} */ (e.currentTarget).style.display='none'; }} />
                            {/if}
                            <div class="poster-meta">
                                <span class="poster-name">{item.title}</span>
                                <span class="poster-reason">
                                    {#if item.reasonPersonId && item.reasonPersonName && item.reason}
                                        {@const rParts = item.reason.split(item.reasonPersonName)}
                                        {rParts[0]}<span class="person-link" role="link" tabindex="0"
                                            onclick={(e) => { e.preventDefault(); e.stopPropagation(); window.location.href = `/people/${item.reasonPersonId}`; }}
                                            onkeydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); window.location.href = `/people/${item.reasonPersonId}`; }}}
                                        >{item.reasonPersonName}</span>{rParts.slice(1).join(item.reasonPersonName)}
                                    {:else}
                                        {item.reason}
                                    {/if}
                                </span>
                            </div>
                        </a>
                    {/each}
                </div>
            </section>
        {/each}

        <!-- ▌RECENTLY WATCHED ─────────────────────────────────────── -->
        {#if sections.recentlyWatched.length > 0}
            <section class="smart-section recently-watched-section">
                <div class="section-header">
                    <h2 class="section-title">Recently Watched</h2>
                </div>
                <div class="poster-scroll">
                    {#each sections.recentlyWatched as item}
                        <a href="/movies/{item.id}" class="poster-card" title={item.title}>
                            <span class="wb">watched</span>
                            <div class="poster-img poster-placeholder">🎬</div>
                            {#if item.poster_url}
                                <img src={imgUrl(item.poster_url)} alt={item.title} class="poster-img poster-img-abs" loading="lazy" onerror={(e) => { /** @type {HTMLImageElement} */ (e.currentTarget).style.display='none'; }} />
                            {/if}
                            <div class="poster-meta">
                                <span class="poster-name">{item.title}</span>
                                <span class="poster-year">{timeAgo(item.last_watched)}</span>
                            </div>
                        </a>
                    {/each}
                </div>
            </section>
        {/if}

        <!-- ▌UNWATCHED IN LIBRARY ─────────────────────────────────── -->
        {#if sections.unwatched.length > 0}
            <section class="smart-section">
                <div class="section-header">
                    <h2 class="section-title">Unwatched in Your Library</h2>
                    <span class="section-count">{data.movieStats.unwatched} total</span>
                </div>
                <div class="poster-scroll">
                    {#each sections.unwatched as item}
                        <a href="/movies/{item.id}" class="poster-card" title={item.title}>
                            <div class="poster-img poster-placeholder">🎬</div>
                            {#if item.poster_url}
                                <img src={imgUrl(item.poster_url)} alt={item.title} class="poster-img poster-img-abs" loading="lazy" onerror={(e) => { /** @type {HTMLImageElement} */ (e.currentTarget).style.display='none'; }} />
                            {/if}
                            <div class="poster-meta">
                                <span class="poster-name">{item.title}</span>
                                <span class="poster-year">{item.release_year || ''}</span>
                            </div>
                        </a>
                    {/each}
                </div>
            </section>
        {/if}
        {/if} <!-- end loaded -->
</div>

<style>
    /* ── Page Layout ── */
    .page-wrap {
        display: flex;
        flex-direction: column;
        gap: 2rem;
        padding: 0 1.5rem;
    }
    .page-header {
        display: flex;
        align-items: flex-end;
        justify-content: space-between;
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

    /* ── Hero Banner ── */
    .hero-banner {
        position: relative;
        border-radius: 1rem;
        overflow: hidden;
        min-height: 280px;
        display: flex;
        flex-direction: column;
        justify-content: flex-end;
    }
    .hero-bg {
        position: absolute;
        inset: 0;
        background-size: cover;
        background-position: center top;
        filter: blur(16px) brightness(0.45) saturate(1.1);
        transform: scale(1.15);
    }
    .hero-overlay {
        position: absolute;
        inset: 0;
        background: linear-gradient(
            180deg,
            oklch(var(--b1) / 0.2) 0%,
            oklch(var(--b1) / 0.65) 40%,
            oklch(var(--b1) / 0.92) 100%
        );
    }
    .hero-body {
        position: relative;
        z-index: 1;
        padding: 2rem 1.75rem 1.5rem;
        text-align: center;
    }
    .hero-title {
        font-size: 1.75rem;
        font-weight: 800;
        letter-spacing: -0.02em;
        margin-bottom: 0.25rem;
    }
    .hero-subtitle {
        font-size: 0.85rem;
        color: oklch(var(--bc) / 0.5);
        margin-bottom: 1.25rem;
    }
    .hero-posters {
        display: flex;
        gap: 14px;
        justify-content: center;
        flex-wrap: wrap;
    }

    /* ── Smart Sections ── */
    .smart-section {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
    }
    .section-header {
        display: flex;
        align-items: baseline;
        gap: 10px;
    }
    .section-title {
        font-size: 1.1rem;
        font-weight: 700;
    }
    .section-count {
        font-size: 0.7rem;
        color: oklch(var(--bc) / 0.35);
    }

    /* ── Poster Scroll & Cards ── */
    .poster-scroll {
        display: flex;
        gap: 14px;
        overflow-x: auto;
        scrollbar-width: none;
        -ms-overflow-style: none;
        padding-bottom: 4px;
    }
    .poster-scroll::-webkit-scrollbar { display: none; }

    .poster-card {
        flex-shrink: 0;
        width: 130px;
        text-decoration: none;
        color: inherit;
        transition: transform 0.2s ease, box-shadow 0.2s ease;
        position: relative;
    }
    .poster-card:hover {
        transform: translateY(-4px) scale(1.03);
    }
    .poster-img {
        width: 100%;
        aspect-ratio: 2/3;
        border-radius: 10px;
        object-fit: cover;
        box-shadow: 0 4px 14px oklch(0 0 0 / 0.35);
    }
    .poster-img-abs {
        position: absolute;
        inset: 0;
        z-index: 1;
    }
    .poster-placeholder {
        display: flex;
        align-items: center;
        justify-content: center;
        background: oklch(var(--b3));
        font-size: 2rem;
    }

    /* Poster meta text */
    .poster-meta {
        margin-top: 6px;
        display: flex;
        flex-direction: column;
        gap: 1px;
    }
    .poster-name {
        font-size: 0.72rem;
        font-weight: 600;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        line-height: 1.3;
    }
    .poster-year {
        font-size: 0.62rem;
        color: oklch(var(--bc) / 0.4);
    }
    .poster-reason {
        font-size: 0.58rem;
        color: oklch(var(--p) / 0.8);
        font-weight: 500;
    }

    /* Person name links in section titles and reasons */
    .person-link {
        color: oklch(var(--p));
        text-decoration: none;
        cursor: pointer;
        transition: color 0.15s, text-decoration 0.15s;
        font-weight: 600;
    }
    .person-link:hover {
        text-decoration: underline;
        color: oklch(var(--s));
    }

    /* Unwatched badge */
    .uwb {
        position: absolute;
        top: 6px;
        right: 6px;
        z-index: 2;
        font-size: 0.5rem;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        padding: 2px 7px;
        border-radius: 6px;
        background: #dc2626;
        color: #fff;
        text-shadow: 0 1px 2px rgba(0,0,0,0.4);
        border: 1px solid rgba(0,0,0,0.15);
    }

    /* Watched badge */
    .wb {
        position: absolute;
        top: 6px;
        right: 6px;
        z-index: 2;
        font-size: 0.5rem;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        padding: 2px 7px;
        border-radius: 6px;
        background: #16a34a;
        color: #fff;
        text-shadow: 0 1px 2px rgba(0,0,0,0.4);
        border: 1px solid rgba(0,0,0,0.15);
    }

    /* Recently watched section has darker bg */
    .recently-watched-section {
        background: oklch(var(--b2) / 0.4);
        margin: 0 -1.5rem;
        padding: 1.25rem 1.5rem;
        border-radius: 1rem;
    }

    :global(.arr-missing) {
        border-left: 3px dashed rgba(239, 68, 68, 0.8);
    }
    :global(.arr-upcoming) {
        border-left: 3px dashed oklch(0.8 0.15 75);
    }
</style>
