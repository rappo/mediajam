<script>
    /**
     * MediaDetailHeader – unified "top half" for movie, tv, music, and person pages.
     *
     * @type {{
     *   mediaType: 'movie' | 'show' | 'artist' | 'person',
     *   title: string,
     *   posterUrl?: string | null,
     *   backdropUrl?: string | null,
     *   year?: number | string | null,
     *   runtime?: string | null,
     *   overview?: string | null,
     *   overviewSource?: string | null,
     *   subtitle?: string | null,
     *   watchStatusBadge?: { label: string, cls: string } | null,
     *   isFavorite?: boolean,
     *   favoriteType?: 'media' | 'person',
     *   favoriteId?: number,
     *   heartBorderEnabled?: boolean,
     *   stats?: { label: string, value: string | number, icon?: string }[],
     *   externalLinks?: Record<string, any>,
     *   extraBadges?: { label: string, cls?: string }[],
     *   actions?: any,
     *   children?: any
     * }}
     */
    let {
        mediaType,
        title,
        posterUrl = null,
        backdropUrl = null,
        year = null,
        runtime = null,
        overview = null,
        overviewSource = null,
        subtitle = null,
        watchStatusBadge = null,
        isFavorite = false,
        favoriteType = 'media',
        favoriteId = 0,
        heartBorderEnabled = false,
        stats = [],
        externalLinks = {},
        extraBadges = [],
        actions,
        children,
    } = $props();

    import FavoriteButton from '$lib/components/FavoriteButton.svelte';
    import HeartBorder from '$lib/components/HeartBorder.svelte';
    import { imgUrl } from '$lib/utils.js';

    const isPerson = mediaType === 'person';
    const hasBackdrop = !!backdropUrl;

    // Build links array from externalLinks prop
    const linkDefs = $derived.by(() => {
        /** @type {{ label: string, url: string, icon: string }[]} */
        const result = [];
        const el = externalLinks;
        const mt = el.mediaType || mediaType;

        if (el.jellyfin_id && el.jellyfin_url) {
            result.push({ label: 'Jellyfin', url: `${el.jellyfin_url}/web/index.html#!/details?id=${el.jellyfin_id}`, icon: '🟦' });
        }
        const tmdb = el.tmdb_id || el.tmdb_person_id;
        if (tmdb) {
            const t = el.tmdb_person_id ? 'person' : mt === 'show' ? 'tv' : 'movie';
            result.push({ label: 'TMDB', url: `https://www.themoviedb.org/${t}/${tmdb}`, icon: '🎬' });
        }
        const imdb = el.imdb_id || el.imdb_person_id;
        if (imdb) {
            const p = el.imdb_person_id || mt === 'person' ? 'name' : 'title';
            result.push({ label: 'IMDb', url: `https://www.imdb.com/${p}/${imdb}`, icon: '⭐' });
        }
        if (el.tvdb_id) {
            const t = mt === 'movie' ? 'movies' : 'series';
            result.push({ label: 'TVDB', url: `https://thetvdb.com/dereferrer/${t}/${el.tvdb_id}`, icon: '📺' });
        }
        const mb = el.musicbrainz_id || el.musicbrainz_artist_id;
        if (mb) {
            result.push({ label: 'MusicBrainz', url: `https://musicbrainz.org/artist/${mb}`, icon: '🎵' });
        }
        if (el.arr_slug && el.arr_url && el.arr_service) {
            const cfg = { radarr: { label: 'Radarr', path: 'movie' }, sonarr: { label: 'Sonarr', path: 'series' }, lidarr: { label: 'Lidarr', path: 'artist' } };
            const c = cfg[el.arr_service];
            if (c) result.push({ label: c.label, url: `${String(el.arr_url).replace(/\/+$/, '')}/${c.path}/${el.arr_slug}`, icon: '📡' });
        }
        if (el.wikipedia_url) {
            result.push({ label: 'Wikipedia', url: el.wikipedia_url, icon: '📖' });
        }
        return result;
    });
</script>

<!-- Backdrop / Gradient Header -->
<div class="detail-header" class:has-backdrop={hasBackdrop} class:no-backdrop={!hasBackdrop}>
    {#if hasBackdrop}
        <div class="backdrop-container">
            <img src={backdropUrl} alt="" class="backdrop-img" />
            <div class="backdrop-gradient"></div>
        </div>
    {/if}

    <div class="header-content" class:with-backdrop={hasBackdrop}>
        <!-- Poster / Portrait -->
        <div class="poster-wrap" class:poster-portrait={isPerson}>
            <HeartBorder show={isFavorite && heartBorderEnabled} class={isPerson ? 'rounded-full' : 'rounded-xl'}>
                {#if posterUrl}
                    <img src={imgUrl(posterUrl, isPerson ? 400 : undefined)} alt={title} class="poster-img" class:poster-round={isPerson} />
                {:else}
                    <div class="poster-placeholder" class:poster-round={isPerson}>
                        {#if mediaType === 'movie'}🎬{:else if mediaType === 'show'}📺{:else if mediaType === 'artist'}🎵{:else}👤{/if}
                    </div>
                {/if}
            </HeartBorder>
        </div>

        <!-- Title & Meta -->
        <div class="title-area">
            <h1 class="detail-title">
                {title}
                <FavoriteButton type={favoriteType} id={favoriteId} {isFavorite} />
            </h1>
            <div class="meta-row">
                {#if year}<span class="meta-year">{year}</span>{/if}
                {#if subtitle}<span>{subtitle}</span>{/if}
                {#if runtime}<span>· {runtime}</span>{/if}
                {#if watchStatusBadge}<span class="badge {watchStatusBadge.cls} badge-sm">{watchStatusBadge.label}</span>{/if}
            </div>
        </div>
    </div>
</div>

<!-- ═══ TOOLBAR RIBBON (3-section) ═══ -->
<div class="toolbar-ribbon">
    <!-- Section 1: External Links -->
    {#if linkDefs.length > 0}
        <div class="ribbon-section">
            <span class="ribbon-section-label">External Links</span>
            <div class="ribbon-links">
                {#each linkDefs as link}
                    <a href={link.url} target="_blank" rel="noopener noreferrer" class="ribbon-link" title={link.label}>
                        <span class="ribbon-link-icon">{link.icon}</span>
                        <span class="ribbon-link-text">{link.label}</span>
                    </a>
                {/each}
            </div>
        </div>
    {/if}

    <!-- Section 2: Stats -->
    {#if stats.length > 0}
        {#if linkDefs.length > 0}<span class="ribbon-section-divider"></span>{/if}
        <div class="ribbon-section">
            <span class="ribbon-section-label">Stats</span>
            <div class="ribbon-stats-row">
                {#each stats as stat}
                    <div class="ribbon-stat-cell">
                        <span class="ribbon-stat-value">{stat.value}</span>
                        <span class="ribbon-stat-label">{stat.label}</span>
                    </div>
                {/each}
            </div>
        </div>
    {/if}

    <!-- Section 3: Actions (slot from parent page) -->
    {#if actions}
        <span class="ribbon-section-divider"></span>
        <div class="ribbon-section">
            <span class="ribbon-section-label">Actions</span>
            <div class="ribbon-actions">
                {@render actions()}
            </div>
        </div>
    {/if}

    <!-- Extra badges (e.g. "External" indicator) -->
    {#if extraBadges.length > 0}
        <div class="ribbon-badges">
            {#each extraBadges as badge}
                <span class="badge badge-sm {badge.cls || 'badge-ghost'}">{badge.label}</span>
            {/each}
        </div>
    {/if}
</div>

<!-- Overview / Bio -->
{#if overview}
    <div class="overview-card">
        <p class="overview-text">{overview}</p>
        {#if overviewSource}
            <span class="overview-source">
                via {overviewSource === 'tmdb' ? 'TMDB' : overviewSource === 'wikipedia' ? 'Wikipedia' : overviewSource === 'jellyfin' ? 'Jellyfin' : overviewSource}
            </span>
        {/if}
    </div>
{/if}

{#if children}{@render children()}{/if}

<style>
    /* ══════════════ HEADER ══════════════ */
    .detail-header { position: relative; border-radius: 1rem; overflow: hidden; }
    .detail-header.has-backdrop { border: 1px solid oklch(var(--bc) / 0.1); }
    .detail-header.no-backdrop { padding: 1.5rem 0; }

    .backdrop-container { position: relative; width: 100%; height: 18rem; }
    @media (min-width: 768px) { .backdrop-container { height: 22rem; } }
    .backdrop-img { width: 100%; height: 100%; object-fit: cover; opacity: 0.55; }
    .backdrop-gradient {
        position: absolute; inset: 0;
        background: linear-gradient(to top, oklch(var(--b1)) 0%, oklch(var(--b1) / 0.9) 25%, oklch(var(--b1) / 0.4) 60%, oklch(var(--b1) / 0.15) 100%);
    }

    .header-content { display: flex; gap: 1.5rem; align-items: flex-start; padding: 0; }
    .header-content.with-backdrop { position: absolute; bottom: 0; left: 0; right: 0; padding: 1.5rem 2rem; align-items: flex-end; }

    .poster-wrap { flex-shrink: 0; z-index: 2; }
    .poster-img { width: 160px; height: 240px; object-fit: cover; display: block; border-radius: 0.75rem; box-shadow: 0 12px 30px -5px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.05); }
    .poster-img.poster-round { width: 150px; height: 150px; border-radius: 50%; }
    .poster-placeholder { width: 160px; height: 240px; border-radius: 0.75rem; background: oklch(var(--b3)); display: flex; align-items: center; justify-content: center; font-size: 3rem; }
    .poster-placeholder.poster-round { width: 150px; height: 150px; border-radius: 50%; }

    .title-area { min-width: 0; display: flex; flex-direction: column; gap: 0.25rem; z-index: 2; }
    .header-content.with-backdrop .title-area { align-self: flex-end; padding-bottom: 0.25rem; }
    .detail-title { font-size: 2rem; font-weight: 800; line-height: 1.15; display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; text-shadow: 0 2px 8px rgba(0,0,0,0.3); }
    @media (min-width: 768px) { .detail-title { font-size: 2.5rem; } }

    .meta-row { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; font-size: 0.875rem; color: oklch(var(--bc) / 0.6); }
    .meta-year { font-weight: 600; color: oklch(var(--bc) / 0.7); }

    /* ══════════════ TOOLBAR RIBBON ══════════════ */
    .toolbar-ribbon {
        display: flex;
        align-items: stretch;
        gap: 0;
        padding: 0.75rem 1rem;
        border-radius: 0.75rem;
        background: oklch(var(--b2) / 0.6);
        border: 1px solid oklch(var(--bc) / 0.1);
        margin-top: 0.75rem;
        flex-wrap: wrap;
    }

    .ribbon-section {
        display: flex;
        flex-direction: column;
        gap: 0.375rem;
        padding: 0 1rem;
        min-width: 0;
    }

    .ribbon-section:first-child { padding-left: 0.25rem; }

    .ribbon-section-label {
        font-size: 0.65rem;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: oklch(var(--bc) / 0.35);
        font-weight: 600;
    }

    .ribbon-section-divider {
        width: 1px;
        align-self: stretch;
        background: oklch(var(--bc) / 0.12);
        margin: 0 0.25rem;
    }

    /* Links row */
    .ribbon-links {
        display: flex;
        align-items: center;
        gap: 0.625rem;
        flex-wrap: wrap;
    }

    .ribbon-link {
        display: flex;
        align-items: center;
        gap: 0.25rem;
        font-size: 0.75rem;
        color: oklch(var(--bc) / 0.6);
        text-decoration: none;
        transition: color 0.15s;
        white-space: nowrap;
    }
    .ribbon-link:hover { color: oklch(var(--bc) / 0.9); }
    .ribbon-link-icon { font-size: 0.8rem; }
    .ribbon-link-text { font-weight: 500; }

    /* Stats row */
    .ribbon-stats-row {
        display: flex;
        align-items: baseline;
        gap: 1rem;
        flex-wrap: wrap;
    }

    .ribbon-stat-cell {
        display: flex;
        align-items: baseline;
        gap: 0.25rem;
        white-space: nowrap;
    }

    .ribbon-stat-value {
        font-size: 1rem;
        font-weight: 700;
        color: oklch(var(--bc));
    }

    .ribbon-stat-label {
        font-size: 0.7rem;
        color: oklch(var(--bc) / 0.45);
    }

    /* Actions row */
    .ribbon-actions {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        flex-wrap: wrap;
    }

    .ribbon-badges { display: flex; flex-wrap: wrap; gap: 0.375rem; margin-left: auto; align-self: center; }

    /* ══════════════ OVERVIEW ══════════════ */
    .overview-card {
        padding: 1.25rem 1.5rem;
        border-radius: 0.75rem;
        background: oklch(var(--b2) / 0.45);
        border: 1px solid oklch(var(--bc) / 0.08);
        margin-top: 0.75rem;
    }
    .overview-text { font-size: 0.875rem; color: oklch(var(--bc) / 0.75); line-height: 1.7; display: -webkit-box; -webkit-line-clamp: 5; line-clamp: 5; -webkit-box-orient: vertical; overflow: hidden; }
    .overview-source { display: inline-block; margin-top: 0.5rem; font-size: 0.75rem; color: oklch(var(--bc) / 0.4); font-style: italic; }
</style>
