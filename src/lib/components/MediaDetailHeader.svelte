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
     *   backUrl?: string,
     *   backLabel?: string,
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
        backUrl = '/',
        backLabel = 'Back',
        children,
    } = $props();

    import ExternalLinks from '$lib/components/ExternalLinks.svelte';
    import FavoriteButton from '$lib/components/FavoriteButton.svelte';
    import HeartBorder from '$lib/components/HeartBorder.svelte';
    import { imgUrl } from '$lib/utils.js';

    const isPerson = mediaType === 'person';
    const hasBackdrop = !!backdropUrl;
</script>

<!-- Backdrop / Gradient Header -->
<div class="detail-header" class:has-backdrop={hasBackdrop}>
    {#if hasBackdrop}
        <div class="backdrop-container">
            <img
                src={backdropUrl}
                alt=""
                class="backdrop-img"
            />
            <div class="backdrop-gradient"></div>
        </div>
    {/if}

    <div class="header-content" class:with-backdrop={hasBackdrop}>
        <!-- Poster / Portrait -->
        <div class="poster-container" class:poster-portrait={isPerson}>
            <HeartBorder
                show={isFavorite && heartBorderEnabled}
                class={isPerson ? 'rounded-full' : 'rounded-xl'}
            >
                {#if posterUrl}
                    <img
                        src={imgUrl(posterUrl, isPerson ? 400 : undefined)}
                        alt={title}
                        class="poster-img"
                        class:poster-round={isPerson}
                    />
                {:else}
                    <div class="poster-placeholder" class:poster-round={isPerson}>
                        {#if mediaType === 'movie'}🎬
                        {:else if mediaType === 'show'}📺
                        {:else if mediaType === 'artist'}🎵
                        {:else}👤{/if}
                    </div>
                {/if}
            </HeartBorder>
        </div>

        <!-- Title & Meta -->
        <div class="title-area">
            <h1 class="detail-title">
                {title}
                <FavoriteButton
                    type={favoriteType}
                    id={favoriteId}
                    {isFavorite}
                />
            </h1>

            <div class="meta-row">
                {#if year}
                    <span>{year}</span>
                {/if}
                {#if subtitle}
                    <span>{subtitle}</span>
                {/if}
                {#if runtime}
                    <span>· {runtime}</span>
                {/if}
                {#if watchStatusBadge}
                    <span class="badge {watchStatusBadge.cls} badge-sm">{watchStatusBadge.label}</span>
                {/if}
            </div>

            <!-- External Links -->
            <ExternalLinks {...externalLinks} class="mt-1" />
        </div>
    </div>
</div>

<!-- Toolbar Ribbon: Stats + Extra Badges -->
{#if stats.length > 0 || extraBadges.length > 0}
    <div class="toolbar-ribbon">
        <div class="ribbon-stats">
            {#each stats as stat, i}
                {#if i > 0}
                    <span class="ribbon-sep">·</span>
                {/if}
                <span class="ribbon-stat">
                    {#if stat.icon}<span class="ribbon-icon">{stat.icon}</span>{/if}
                    <strong>{stat.value}</strong> {stat.label}
                </span>
            {/each}
        </div>
        {#if extraBadges.length > 0}
            <div class="ribbon-badges">
                {#each extraBadges as badge}
                    <span class="badge badge-sm {badge.cls || 'badge-ghost'}">{badge.label}</span>
                {/each}
            </div>
        {/if}
    </div>
{/if}

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

<!-- Slot for page-specific content (arr status, actions, etc.) -->
{#if children}
    {@render children()}
{/if}

<style>
    .detail-header {
        position: relative;
        border-radius: 1rem;
        overflow: hidden;
        margin-bottom: 0;
    }

    .detail-header.has-backdrop {
        border: 1px solid oklch(var(--bc) / 0.1);
    }

    .backdrop-container {
        position: relative;
        width: 100%;
        height: 16rem;
    }

    @media (min-width: 768px) {
        .backdrop-container {
            height: 20rem;
        }
    }

    .backdrop-img {
        width: 100%;
        height: 100%;
        object-fit: cover;
        opacity: 0.35;
    }

    .backdrop-gradient {
        position: absolute;
        inset: 0;
        background: linear-gradient(
            to top,
            oklch(var(--b1)) 0%,
            oklch(var(--b1) / 0.85) 40%,
            transparent 100%
        );
    }

    .header-content {
        display: flex;
        gap: 1.5rem;
        align-items: flex-start;
        padding: 0;
    }

    .header-content.with-backdrop {
        position: absolute;
        bottom: 0;
        left: 0;
        right: 0;
        padding: 1.5rem;
        align-items: flex-end;
    }

    .poster-container {
        flex-shrink: 0;
        width: 140px;
        min-width: 140px;
    }

    .header-content.with-backdrop .poster-container {
        margin-top: -5rem;
    }

    .poster-portrait {
        width: 150px;
        min-width: 150px;
    }

    .poster-img {
        width: 140px;
        height: 210px;
        object-fit: cover;
        display: block;
        border-radius: 0.75rem;
        box-shadow: 0 10px 25px -5px rgba(0,0,0,0.4);
    }

    .poster-img.poster-round {
        width: 150px;
        height: 150px;
        border-radius: 50%;
    }

    .poster-placeholder {
        width: 140px;
        height: 210px;
        border-radius: 0.75rem;
        background: oklch(var(--b3));
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 3rem;
    }

    .poster-placeholder.poster-round {
        width: 150px;
        height: 150px;
        border-radius: 50%;
    }

    .title-area {
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
    }

    .header-content.with-backdrop .title-area {
        align-self: flex-end;
    }

    .detail-title {
        font-size: 1.875rem;
        font-weight: 800;
        line-height: 1.2;
        display: flex;
        align-items: center;
        gap: 0.5rem;
        flex-wrap: wrap;
    }

    @media (min-width: 768px) {
        .detail-title {
            font-size: 2.25rem;
        }
    }

    .meta-row {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 0.5rem;
        font-size: 0.875rem;
        color: oklch(var(--bc) / 0.6);
    }

    /* Toolbar Ribbon */
    .toolbar-ribbon {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 1rem;
        flex-wrap: wrap;
        padding: 0.75rem 1rem;
        border-radius: 0.75rem;
        background: oklch(var(--b2) / 0.5);
        border: 1px solid oklch(var(--bc) / 0.08);
        margin-top: 0.75rem;
    }

    .ribbon-stats {
        display: flex;
        align-items: center;
        gap: 0.375rem;
        flex-wrap: wrap;
        font-size: 0.875rem;
        color: oklch(var(--bc) / 0.7);
    }

    .ribbon-sep {
        color: oklch(var(--bc) / 0.25);
    }

    .ribbon-icon {
        font-size: 0.8em;
    }

    .ribbon-stat strong {
        color: oklch(var(--bc));
        font-weight: 700;
    }

    .ribbon-badges {
        display: flex;
        flex-wrap: wrap;
        gap: 0.375rem;
    }

    /* Overview Card */
    .overview-card {
        padding: 1rem 1.25rem;
        border-radius: 0.75rem;
        background: oklch(var(--b2) / 0.3);
        border: 1px solid oklch(var(--bc) / 0.06);
        margin-top: 0.75rem;
    }

    .overview-text {
        font-size: 0.875rem;
        color: oklch(var(--bc) / 0.7);
        line-height: 1.6;
        display: -webkit-box;
        -webkit-line-clamp: 5;
        line-clamp: 5;
        -webkit-box-orient: vertical;
        overflow: hidden;
    }

    .overview-source {
        display: inline-block;
        margin-top: 0.375rem;
        font-size: 0.75rem;
        color: oklch(var(--bc) / 0.4);
        font-style: italic;
    }
</style>
