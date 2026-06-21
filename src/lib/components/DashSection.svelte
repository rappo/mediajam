<script>
    import MdiIcon from '$lib/components/MdiIcon.svelte';
    import { imgUrl } from '$lib/utils.js';

    /**
     * DashSection — Unified glassmorphism card wrapper for all dashboard widgets.
     * Design based on the DashboardCalendarHero "Upcoming" widget.
     *
     * To revert to the old unwrapped style, simply remove the <DashSection> wrapper
     * and render children directly. See git history pre-DashSection for reference.
     *
     * @prop {string} [title] — Section title text
     * @prop {string} [icon] — MDI icon path for the title
     * @prop {string|string[]} [glowSrc] — URL(s) for ambient poster glow; if array, tries each until one loads
     * @prop {string} [href] — "View all" link destination
     * @prop {string} [hrefLabel] — Link label text (default: "View all →")
     * @prop {boolean} [compact] — Reduce padding for inline widgets
     * @prop {boolean} [noGlow] — Disable ambient glow even if glowSrc is provided
     */
    let {
        title = '',
        icon = undefined,
        iconSrc = '',
        subtitle = '',
        glowSrc = '',
        href = '',
        hrefLabel = 'View all →',
        compact = false,
        noGlow = false,
        headerLeft,
        headerRight,
        footer,
        children,
    } = $props();

    /** Validated glow URL — empty until a candidate loads successfully */
    let validatedGlow = $state('');

    // Flatten glowSrc into candidate array and probe each
    let candidates = $derived.by(() => {
        if (noGlow) return [];
        const raw = Array.isArray(glowSrc) ? glowSrc : [glowSrc];
        return raw.filter(Boolean).map(u => imgUrl(u));
    });

    $effect(() => {
        validatedGlow = '';
        if (candidates.length === 0) return;

        let cancelled = false;
        function tryIndex(i) {
            if (cancelled || i >= candidates.length) return;
            const img = new Image();
            img.onload = () => {
                if (!cancelled && img.naturalWidth > 0) validatedGlow = candidates[i];
            };
            img.onerror = () => {
                if (!cancelled) tryIndex(i + 1);
            };
            img.src = candidates[i];
        }
        tryIndex(0);

        return () => { cancelled = true; };
    });
</script>

<div class="ds-outer">
    <!-- Ambient glow from poster -->
    {#if validatedGlow}
        <div class="ds-glow" style="background-image: url('{validatedGlow}')"></div>
    {/if}

    <div class="ds-inner" class:ds-compact={compact}>
        <!-- Header -->
        {#if title || headerRight || headerLeft}
            <div class="ds-header">
                <div class="ds-header-left">
                    {#if iconSrc}
                        <img src={imgUrl(iconSrc)} alt="" class="ds-portrait" />
                    {:else if icon}
                        <MdiIcon {icon} size={24} class="ds-icon" />
                    {/if}
                    {#if title}
                        <h3 class="ds-title">{title}</h3>
                    {/if}
                    {#if subtitle}
                        <span class="ds-subtitle">{subtitle}</span>
                    {/if}
                    {#if href}
                        <a href={href} class="ds-link">{hrefLabel}</a>
                    {/if}
                    {#if headerLeft}
                        {@render headerLeft()}
                    {/if}
                </div>
                {#if headerRight}
                    <div class="ds-header-right">
                        {@render headerRight()}
                    </div>
                {/if}
            </div>
        {/if}

        <!-- Content -->
        <div class="ds-content">
            {@render children()}
        </div>

        <!-- Footer -->
        {#if footer}
            <div class="ds-footer">
                {@render footer()}
            </div>
        {/if}
    </div>
</div>

<style>
    /* ══════════════ OUTER WRAPPER ══════════════ */
    .ds-outer {
        position: relative;
        border-radius: 1rem;
        isolation: isolate;
        margin-bottom: 1rem;
    }

    /* ══════════════ AMBIENT GLOW ══════════════ */
    .ds-glow {
        position: absolute;
        inset: 0;
        overflow: hidden;
        border-radius: 1rem;
        background-size: cover;
        background-position: center;
        filter: blur(60px) saturate(1.5);
        opacity: 0.15;
        z-index: 0;
        pointer-events: none;
    }

    /* ══════════════ INNER CARD ══════════════ */
    .ds-inner {
        position: relative;
        z-index: 1;
        background: oklch(var(--b1) / 0.7);
        backdrop-filter: blur(20px);
        -webkit-backdrop-filter: blur(20px);
        border: 1px solid oklch(var(--bc) / 0.08);
        border-radius: 1rem;
        padding: 1rem 1.25rem 1rem;
    }
    .ds-inner.ds-compact {
        padding: 0.6rem 0.8rem 0.5rem;
    }

    /* ══════════════ HEADER ══════════════ */
    .ds-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 0.75rem;
        flex-wrap: wrap;
        gap: 0.5rem;
    }
    .ds-header-left {
        display: flex;
        align-items: center;
        gap: 0.4rem;
        flex: 1;
        min-width: 0;
    }
    .ds-header-right {
        display: flex;
        align-items: center;
        gap: 0.5rem;
    }
    :global(.ds-icon) {
        opacity: 0.7;
    }
    .ds-portrait {
        width: 32px;
        height: 32px;
        border-radius: 50%;
        object-fit: cover;
        border: 2px solid oklch(var(--p) / 0.3);
        flex-shrink: 0;
    }
    .ds-title {
        font-size: 0.9rem;
        font-weight: 700;
        color: oklch(var(--bc) / 0.9);
        margin: 0;
    }
    .ds-subtitle {
        font-size: 0.75rem;
        font-weight: 500;
        color: oklch(var(--bc) / 0.4);
        white-space: nowrap;
    }
    .ds-link {
        font-size: 0.65rem;
        font-weight: 600;
        color: oklch(var(--p));
        text-decoration: none;
        padding: 0.2rem 0.6rem;
        border-radius: 0.4rem;
        border: 1px solid oklch(var(--p) / 0.2);
        transition: all 0.15s;
        white-space: nowrap;
    }
    .ds-link:hover {
        background: oklch(var(--p) / 0.1);
        border-color: oklch(var(--p) / 0.4);
    }

    /* ══════════════ CONTENT ══════════════ */
    .ds-content {
        /* Allow children to control their own layout */
    }

    /* ══════════════ FOOTER ══════════════ */
    .ds-footer {
        margin-top: 0.5rem;
    }

    @media (max-width: 767px) {
        .ds-header {
            flex-direction: column;
            align-items: flex-start;
        }
    }
</style>
