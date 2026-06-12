<script>
    /**
     * MediaDetailHeader – unified "top half" for movie, tv, music, and person pages.
     *
     * @type {{
     *   mediaType: 'movie' | 'show' | 'artist' | 'person',
     *   title: string,
     *   backHref?: string | null,
     *   backLabel?: string | null,
     *   posterUrl?: string | null,
     *   backdropUrl?: string | null,
     *   year?: number | string | null,
     *   runtime?: string | null,
     *   overview?: string | null,
     *   overviewSource?: string | null,
     *   subtitle?: string | null,
     *   watchStatusBadge?: { label: string, cls: string } | null,
     *   heroBadges?: { label: string, cls?: string }[],
     *   isFavorite?: boolean,
     *   favoriteType?: 'media' | 'person',
     *   favoriteId?: number,
     *   heartBorderEnabled?: boolean,
     *   stats?: { label: string, value: string | number }[],
     *   fileInfo?: { label: string, value: string }[],
     *   onFileInfoClick?: () => void,
     *   externalLinks?: Record<string, any>,
     *   extraBadges?: { label: string, cls?: string }[],
     *   actions?: any,
     *   watchlistAction?: any,
     *   children?: any
     * }}
     */
    let {
        mediaType,
        title,
        backHref = null,
        backLabel = null,
        posterUrl = null,
        backdropUrl = null,
        year = null,
        runtime = null,
        overview = null,
        overviewSource = null,
        subtitle = null,
        watchStatusBadge = null,
        heroBadges = [],
        isFavorite = false,
        favoriteType = 'media',
        favoriteId = 0,
        heartBorderEnabled = false,
        stats = [],
        fileInfo = [],
        externalLinks = {},
        extraBadges = [],
        onFileInfoClick,
        actions,
        watchlistAction,
        ratingsBar,
        children,
    } = $props();

    import FavoriteButton from '$lib/components/FavoriteButton.svelte';
    import HeartBorder from '$lib/components/HeartBorder.svelte';
    import ServiceIcon from '$lib/components/ServiceIcon.svelte';
    import { imgUrl } from '$lib/utils.js';

    const isPerson = mediaType === 'person';
    // Use poster as backdrop fallback for pages without explicit backdrops (e.g. music)
    const effectiveBackdrop = $derived((backdropUrl || posterUrl) ? imgUrl(backdropUrl || posterUrl) : null);
    let backdropBroken = $state(false);
    // Reset broken state when backdrop URL changes (e.g. navigating between items)
    $effect(() => { void effectiveBackdrop; backdropBroken = false; });
    const hasBackdrop = $derived(!!effectiveBackdrop && !backdropBroken);

    let gearOpen = $state(false);
    let posterBroken = $state(false);

    // Internal services (self-hosted)
    const INTERNAL_SERVICES = new Set(['jellyfin', 'radarr', 'sonarr', 'lidarr']);

    // Build links array from externalLinks prop
    const linkDefs = $derived.by(() => {
        /** @type {{ label: string, url: string, service: string }[]} */
        const result = [];
        const el = externalLinks;
        const mt = el.mediaType || mediaType;

        if (el.jellyfin_id && el.jellyfin_url) {
            result.push({ label: 'Jellyfin', url: `${el.jellyfin_url}/web/index.html#!/details?id=${el.jellyfin_id}`, service: 'jellyfin' });
        }
        if (el.arr_slug && el.arr_url && el.arr_service) {
            const cfg = /** @type {Record<string, {label:string, path:string}>} */ ({ radarr: { label: 'Radarr', path: 'movie' }, sonarr: { label: 'Sonarr', path: 'series' }, lidarr: { label: 'Lidarr', path: 'artist' } });
            const c = cfg[el.arr_service];
            if (c) result.push({ label: c.label, url: `${String(el.arr_url).replace(/\/+$/, '')}/${c.path}/${el.arr_slug}`, service: el.arr_service });
        }
        const tmdb = el.tmdb_id || el.tmdb_person_id;
        if (tmdb) {
            const t = el.tmdb_person_id ? 'person' : mt === 'show' ? 'tv' : 'movie';
            result.push({ label: 'TMDB', url: `https://www.themoviedb.org/${t}/${tmdb}`, service: 'tmdb' });
        }
        const imdb = el.imdb_id || el.imdb_person_id;
        if (imdb) {
            const p = el.imdb_person_id || mt === 'person' ? 'name' : 'title';
            result.push({ label: 'IMDb', url: `https://www.imdb.com/${p}/${imdb}`, service: 'imdb' });
        }
        if (el.tvdb_id) {
            const t = mt === 'movie' ? 'movies' : 'series';
            result.push({ label: 'TVDB', url: `https://thetvdb.com/dereferrer/${t}/${el.tvdb_id}`, service: 'tvdb' });
        }
        const mb = el.musicbrainz_id || el.musicbrainz_artist_id;
        if (mb) {
            result.push({ label: 'MusicBrainz', url: `https://musicbrainz.org/artist/${mb}`, service: 'musicbrainz' });
        }
        if (el.wikipedia_url) {
            result.push({ label: 'Wikipedia', url: el.wikipedia_url, service: 'wikipedia' });
        }
        return result;
    });

    const internalLinks = $derived(linkDefs.filter(l => INTERNAL_SERVICES.has(l.service)));
    const externalLinksList = $derived(linkDefs.filter(l => !INTERNAL_SERVICES.has(l.service)));
    const hasAnyLinks = $derived(internalLinks.length > 0 || externalLinksList.length > 0);
    const hasStats = $derived(stats.length > 0);
    const hasFileInfo = $derived(fileInfo.length > 0);

    /** Count how many sections are rendered, for divider placement */
    const sectionFlags = $derived([internalLinks.length > 0, externalLinksList.length > 0, hasStats, hasFileInfo].filter(Boolean));

    /** Filter stats: hide if only stat is "0 plays" */
    const visibleStats = $derived(
        stats.filter(s => !(s.value === 0 && (s.label === 'plays' || s.label === 'play')))
    );
    const hasVisibleStats = $derived(visibleStats.length > 0);
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->

<!-- Ambient glow container -->
<div class="ambient-glow-wrap">
    {#if hasBackdrop}
        <div class="ambient-glow" style="background-image: url({effectiveBackdrop});"></div>
    {/if}

<!-- Backdrop / Gradient Header -->
<div class="detail-header" class:has-backdrop={hasBackdrop} class:no-backdrop={!hasBackdrop}>
    {#if hasBackdrop}
        <div class="backdrop-container">
            <img src={effectiveBackdrop} alt="" class="backdrop-img" onerror={() => backdropBroken = true} />
            <div class="backdrop-gradient"></div>
        </div>
    {/if}

    <!-- Back button (top-left of hero) -->
    {#if backHref}
        <a href={backHref} class="back-btn">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
            {backLabel || 'Back'}
        </a>
    {/if}

    <!-- Gear menu (top-right of hero) -->
    {#if actions}
        <div class="gear-menu-wrap">
            <button class="gear-btn" onclick={() => gearOpen = !gearOpen} title="Actions">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
                </svg>
            </button>
            {#if gearOpen}
                <div class="gear-backdrop" onclick={() => gearOpen = false}></div>
                <div class="gear-dropdown">
                    <div class="gear-dropdown-label">Actions</div>
                    <div class="gear-dropdown-items">
                        {@render actions()}
                    </div>
                </div>
            {/if}
        </div>
    {/if}

    <div class="header-content" class:with-backdrop={hasBackdrop}>
        <!-- Poster / Portrait -->
        <div class="poster-wrap">
            <HeartBorder show={isFavorite && heartBorderEnabled} class="rounded-xl">
                {#if posterUrl && !posterBroken}
                    <img src={imgUrl(posterUrl)} alt={title} class="poster-img" onerror={() => posterBroken = true} />
                {:else}
                    <div class="poster-placeholder">
                        {#if mediaType === 'movie'}🎬{:else if mediaType === 'show'}📺{:else if mediaType === 'artist'}🎵{:else}👤{/if}
                    </div>
                {/if}
            </HeartBorder>
        </div>

        <!-- Title & Meta (always bottom-aligned) -->
        <div class="title-area">
            <h1 class="detail-title">
                {title}
                <FavoriteButton type={favoriteType} id={favoriteId} {isFavorite} />
            </h1>
            <div class="meta-row">
                {#if year}<span class="meta-year">{year}</span>{/if}
                {#if subtitle}<span>{subtitle}</span>{/if}
                {#if runtime}<span>· {runtime}</span>{/if}
                {#each heroBadges as hb}
                    <span class="badge badge-sm {hb.cls || 'badge-outline'}">{hb.label}</span>
                {/each}
                {#if watchStatusBadge}<span class="badge {watchStatusBadge.cls} badge-sm watch-badge">{watchStatusBadge.label}</span>{/if}
                {#if watchlistAction}{@render watchlistAction()}{/if}
            </div>
            {#if ratingsBar}{@render ratingsBar()}{/if}
            {#if overview}
                <div class="hero-overview-wrap">
                    <p class="hero-overview">{overview}
                        {#if overviewSource}
                            <span class="overview-source">
                                — via {overviewSource === 'tmdb' ? 'TMDB' : overviewSource === 'wikipedia' ? 'Wikipedia' : overviewSource === 'jellyfin' ? 'Jellyfin' : overviewSource}
                            </span>
                        {/if}
                    </p>
                </div>
            {/if}
            {#if hasAnyLinks}
                <div class="hero-links-bar">
                    {#each internalLinks as link}
                        <a href={link.url} target="_blank" rel="noopener noreferrer" class="hero-link" title={link.label}>
                            <ServiceIcon service={link.service} size="w-4 h-4" />
                            <span class="hero-link-text">{link.label}</span>
                        </a>
                    {/each}
                    {#each externalLinksList as link}
                        <a href={link.url} target="_blank" rel="noopener noreferrer" class="hero-link" title={link.label}>
                            <ServiceIcon service={link.service} size="w-4 h-4" />
                            <span class="hero-link-text">{link.label}</span>
                        </a>
                    {/each}
                </div>
            {/if}
        </div>
    </div>
</div>

<!-- ═══ TOOLBAR RIBBON ═══ -->
{#if hasVisibleStats || hasFileInfo || extraBadges.length > 0}
<div class="toolbar-ribbon">
    <!-- Stats -->
    {#if hasVisibleStats}
        <div class="ribbon-section">
            <span class="ribbon-section-label">Stats</span>
            <div class="ribbon-stats-row">
                {#each visibleStats as stat}
                    <div class="ribbon-stat-cell">
                        <span class="ribbon-stat-value">{stat.value}</span>
                        <span class="ribbon-stat-label">{stat.label}</span>
                    </div>
                {/each}
            </div>
        </div>
    {/if}

    <!-- File Info -->
    {#if hasFileInfo}
        {#if hasVisibleStats}<span class="ribbon-divider"></span>{/if}
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div class="ribbon-section" class:clickable-section={!!onFileInfoClick} onclick={onFileInfoClick}>
            <span class="ribbon-section-label">File Info</span>
            <div class="ribbon-stats-row">
                {#each fileInfo as info}
                    <div class="ribbon-stat-cell">
                        <span class="ribbon-stat-value">{info.value}</span>
                        <span class="ribbon-stat-label">{info.label}</span>
                    </div>
                {/each}
            </div>
        </div>
    {/if}

    <!-- Extra badges -->
    {#if extraBadges.length > 0}
        <div class="ribbon-badges">
            {#each extraBadges as badge}
                <span class="badge badge-sm {badge.cls || 'badge-ghost'}">{badge.label}</span>
            {/each}
        </div>
    {/if}
</div>
{/if}

{#if children}{@render children()}{/if}
</div> <!-- end ambient-glow-wrap -->

<style>
    /* ══════════════ AMBIENT GLOW (react-image-glow style) ══════════════ */
    .ambient-glow-wrap {
        position: relative;
        isolation: isolate;
    }
    .ambient-glow {
        position: absolute;
        inset: 0;
        z-index: -1;
        pointer-events: none;
        background-size: cover;
        background-position: center;
        filter: blur(50px) saturate(2);
        opacity: 0.8;
    }

    /* ══════════════ HEADER ══════════════ */
    .detail-header { position: relative; border-radius: 1rem; overflow: hidden; margin-top: 1rem; }
    .detail-header.has-backdrop { border: 1px solid oklch(var(--bc) / 0.1); }
    .detail-header.no-backdrop {
        padding: 1.5rem 2rem;
        background: linear-gradient(135deg, oklch(var(--b2) / 0.6) 0%, oklch(var(--b2) / 0.3) 100%);
        border: 1px solid oklch(var(--bc) / 0.08);
    }

    .backdrop-container { position: relative; width: 100%; height: 20rem; }
    @media (min-width: 768px) { .backdrop-container { height: 24rem; } }
    .backdrop-img { width: 100%; height: 100%; object-fit: cover; opacity: 0.55; }
    .backdrop-gradient {
        position: absolute; inset: 0;
        background: linear-gradient(to top, oklch(var(--b1)) 0%, oklch(var(--b1) / 0.9) 25%, oklch(var(--b1) / 0.4) 60%, oklch(var(--b1) / 0.15) 100%);
    }

    /* ══════════════ BACK BUTTON ══════════════ */
    .back-btn {
        position: absolute;
        top: 0.75rem;
        left: 0.75rem;
        z-index: 10;
        display: flex;
        align-items: center;
        gap: 0.25rem;
        padding: 0.35rem 0.65rem 0.35rem 0.45rem;
        border-radius: 0.5rem;
        background: rgba(0,0,0,0.45);
        color: rgba(255,255,255,0.8);
        font-size: 0.75rem;
        font-weight: 500;
        text-decoration: none;
        backdrop-filter: blur(8px);
        transition: background 0.15s, color 0.15s;
    }
    .back-btn:hover { background: rgba(0,0,0,0.65); color: #fff; }

    /* ══════════════ GEAR MENU ══════════════ */
    .gear-menu-wrap {
        position: absolute;
        top: 0.75rem;
        right: 0.75rem;
        z-index: 10;
    }
    .gear-btn {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 2.25rem;
        height: 2.25rem;
        border-radius: 0.5rem;
        background: oklch(var(--b1) / 0.7);
        backdrop-filter: blur(8px);
        -webkit-backdrop-filter: blur(8px);
        border: 1px solid oklch(var(--bc) / 0.15);
        color: oklch(var(--bc) / 0.7);
        cursor: pointer;
        transition: all 0.15s ease;
    }
    .gear-btn:hover {
        background: oklch(var(--b1) / 0.9);
        color: oklch(var(--bc));
    }
    .gear-backdrop {
        position: fixed;
        inset: 0;
        z-index: 9;
    }
    .gear-dropdown {
        position: absolute;
        top: calc(100% + 0.5rem);
        right: 0;
        z-index: 10;
        min-width: 10rem;
        padding: 0.5rem;
        background: oklch(var(--b2));
        backdrop-filter: blur(24px) saturate(1.5);
        -webkit-backdrop-filter: blur(24px) saturate(1.5);
        border: 1px solid oklch(var(--bc) / 0.15);
        border-radius: 0.5rem;
        box-shadow: 0 8px 24px -4px rgba(0,0,0,0.25);
    }
    .gear-dropdown-label {
        font-size: 0.6rem;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: oklch(var(--bc) / 0.5);
        font-weight: 600;
        padding: 0.25rem 0.5rem;
    }
    .gear-dropdown-items {
        display: flex;
        flex-direction: column;
        gap: 0.125rem;
    }

    /* Gear dropdown button styling */
    :global(.gear-dropdown-items .btn) {
        background: transparent !important;
        border: none !important;
        color: oklch(var(--bc) / 0.85) !important;
        font-size: 0.8rem !important;
        font-weight: 500 !important;
        padding: 0.375rem 0.5rem !important;
        height: auto !important;
        min-height: 0 !important;
        border-radius: 0.375rem !important;
        justify-content: flex-start !important;
        width: 100% !important;
        transition: background 0.1s !important;
    }
    :global(.gear-dropdown-items .btn:hover) {
        background: oklch(var(--bc) / 0.1) !important;
        color: oklch(var(--bc)) !important;
    }
    :global(.gear-dropdown-items .btn-success) {
        color: oklch(0.8 0.15 145) !important;
    }
    :global(.gear-dropdown-items .btn-error) {
        color: oklch(0.8 0.15 25) !important;
    }

    /* UNIFIED: always bottom-align title with poster */
    .header-content { display: flex; gap: 1.5rem; align-items: flex-end; padding: 0; }
    .header-content.with-backdrop { position: absolute; bottom: 0; left: 0; right: 0; padding: 2rem; }

    .poster-wrap { flex-shrink: 0; z-index: 2; }
    .poster-img { width: 145px; aspect-ratio: 2/3; object-fit: cover; display: block; border-radius: 0.75rem; box-shadow: 0 12px 30px -5px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.05); }
    .poster-placeholder { width: 145px; aspect-ratio: 2/3; border-radius: 0.75rem; background: oklch(var(--b3)); display: flex; align-items: center; justify-content: center; font-size: 3rem; }
    @media (min-width: 768px) {
        .poster-img { width: 160px; }
        .poster-placeholder { width: 160px; }
    }

    .title-area { min-width: 0; display: flex; flex-direction: column; gap: 0.25rem; z-index: 2; padding-bottom: 0.25rem; flex: 1; }

    /* Title with glow for readability over backdrop */
    .detail-title {
        font-size: 2rem; font-weight: 800; line-height: 1.15;
        display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;
        text-shadow: 0 0 20px rgba(0,0,0,0.8), 0 0 40px rgba(0,0,0,0.5), 0 2px 4px rgba(0,0,0,0.9);
    }
    @media (min-width: 768px) { .detail-title { font-size: 2.5rem; } }

    .meta-row {
        display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem;
        font-size: 0.875rem; color: oklch(var(--bc) / 0.6);
        text-shadow: 0 0 10px rgba(0,0,0,0.6), 0 1px 3px rgba(0,0,0,0.8);
    }
    .meta-year { font-weight: 600; color: oklch(var(--bc) / 0.7); }

    /* Watched badge — solid opaque background for visibility over any backdrop */
    :global(.watch-badge) {
        backdrop-filter: none !important;
        -webkit-backdrop-filter: none !important;
        background-color: #16a34a !important;
        color: #fff !important;
        border-color: #16a34a !important;
        text-shadow: none !important;
        opacity: 1 !important;
    }

    /* Overview inside hero with faded background */
    .hero-overview-wrap {
        margin-top: 0.375rem;
        padding: 0.5rem 0.75rem;
        background: oklch(var(--b1) / 0.75);
        backdrop-filter: blur(12px) brightness(0.8);
        -webkit-backdrop-filter: blur(12px) brightness(0.8);
        border-radius: 0.5rem;
        max-width: 42rem;
        border: 1px solid oklch(var(--bc) / 0.08);
    }
    .hero-overview {
        font-size: 0.875rem;
        color: oklch(var(--bc) / 0.8);
        line-height: 1.5;
        display: -webkit-box;
        -webkit-line-clamp: 3;
        line-clamp: 3;
        -webkit-box-orient: vertical;
        overflow: hidden;
        margin: 0;
        text-shadow: 0 1px 3px oklch(var(--b1) / 0.8);
    }
    .overview-source {
        font-size: 0.7rem;
        color: oklch(var(--bc) / 0.35);
        font-style: italic;
    }

    /* ══════════════ HERO LINKS BAR ══════════════ */
    .hero-links-bar {
        display: flex;
        align-items: center;
        gap: 0.65rem;
        flex-wrap: wrap;
        margin-top: 0.375rem;
        padding: 0.35rem 0.6rem;
        background: oklch(var(--b1) / 0.6);
        backdrop-filter: blur(12px) brightness(0.85);
        -webkit-backdrop-filter: blur(12px) brightness(0.85);
        border-radius: 0.4rem;
        border: 1px solid oklch(var(--bc) / 0.08);
        max-width: fit-content;
    }
    .hero-link {
        display: inline-flex;
        align-items: center;
        gap: 0.3rem;
        font-size: 0.75rem;
        color: oklch(var(--bc) / 0.65);
        text-decoration: none;
        transition: color 0.15s;
        white-space: nowrap;
    }
    .hero-link :global(img),
    .hero-link :global(svg) {
        width: 16px !important;
        height: 16px !important;
        flex-shrink: 0;
    }
    .hero-link:hover { color: oklch(var(--bc) / 0.95); }
    .hero-link-text { font-weight: 500; }
    .hero-link-sub { font-size: 0.65rem; color: oklch(var(--bc) / 0.4); }
    :global(.hero-ratings-bar) {
        display: flex;
        align-items: center;
        gap: 0.65rem;
        flex-wrap: wrap;
        margin-top: 0.3rem;
        padding: 0.3rem 0.55rem;
        background: oklch(var(--b1) / 0.25);
        backdrop-filter: blur(10px);
        -webkit-backdrop-filter: blur(10px);
        border-radius: 0.4rem;
        max-width: fit-content;
    }
    :global(.hero-ratings-bar .hero-link) {
        display: inline-flex;
        align-items: center;
        gap: 0.3rem;
        font-size: 0.75rem;
        color: oklch(var(--bc) / 0.65);
        text-decoration: none;
        transition: color 0.15s;
        white-space: nowrap;
    }
    :global(.hero-ratings-bar .hero-link:hover) { color: oklch(var(--bc) / 0.95); }
    :global(.hero-ratings-bar .hero-link img),
    :global(.hero-ratings-bar .hero-link svg) {
        width: 16px !important;
        height: 16px !important;
        flex-shrink: 0;
    }
    :global(.hero-ratings-bar .hero-link-text) { font-weight: 500; }

    /* ══════════════ TOOLBAR RIBBON ══════════════ */
    .toolbar-ribbon {
        display: flex;
        align-items: stretch;
        gap: 0;
        padding: 1rem 1.25rem;
        border-radius: 0.75rem;
        background: oklch(var(--b2) / 0.6);
        border: 1px solid oklch(var(--bc) / 0.15);
        margin-top: 0.75rem;
        flex-wrap: wrap;
        min-height: 3.5rem;
    }

    .ribbon-section {
        display: flex;
        flex-direction: column;
        gap: 0.375rem;
        padding: 0 1.25rem;
        min-width: 0;
    }
    .ribbon-section.clickable-section { cursor: pointer; border-radius: 0.5rem; transition: background 0.15s; }
    .ribbon-section.clickable-section:hover { background: oklch(var(--bc) / 0.05); }

    .ribbon-section:first-child { padding-left: 0.25rem; }

    .ribbon-section-label {
        font-size: 0.65rem;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: oklch(var(--bc) / 0.35);
        font-weight: 600;
    }

    /* Visible vertical dividers */
    .ribbon-divider {
        display: block;
        width: 1px;
        align-self: stretch;
        background: oklch(var(--bc) / 0.2);
        margin: 0.25rem 0.5rem;
        flex-shrink: 0;
        min-height: 2rem;
    }

    .ribbon-links {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        flex-wrap: wrap;
    }

    .ribbon-link {
        display: flex;
        align-items: center;
        gap: 0.3rem;
        font-size: 0.8rem;
        color: oklch(var(--bc) / 0.6);
        text-decoration: none;
        transition: color 0.15s;
        white-space: nowrap;
    }
    .ribbon-link:hover { color: oklch(var(--bc) / 0.9); }
    .ribbon-link-text { font-weight: 500; }

    /* Stats row */
    .ribbon-stats-row {
        display: flex;
        align-items: baseline;
        gap: 1.25rem;
        flex-wrap: wrap;
    }

    .ribbon-stat-cell {
        display: flex;
        align-items: baseline;
        gap: 0.3rem;
        white-space: nowrap;
    }

    .ribbon-stat-value {
        font-size: 1.1rem;
        font-weight: 700;
        color: oklch(var(--bc));
    }

    .ribbon-stat-label {
        font-size: 0.75rem;
        color: oklch(var(--bc) / 0.45);
    }

    .ribbon-badges { display: flex; flex-wrap: wrap; gap: 0.375rem; margin-left: auto; align-self: center; }
</style>
