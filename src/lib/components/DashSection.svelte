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
     * @prop {string} [glowSrc] — URL for ambient poster glow (optional)
     * @prop {string} [href] — "View all" link destination
     * @prop {string} [hrefLabel] — Link label text (default: "View all →")
     * @prop {boolean} [compact] — Reduce padding for inline widgets
     * @prop {boolean} [noGlow] — Disable ambient glow even if glowSrc is provided
     */
    let {
        title = '',
        icon = undefined,
        glowSrc = '',
        href = '',
        hrefLabel = 'View all →',
        compact = false,
        noGlow = false,
        headerRight,
        footer,
        children,
    } = $props();

    let resolvedGlow = $derived(glowSrc && !noGlow ? imgUrl(glowSrc) : '');
</script>

<div class="ds-outer">
    <!-- Ambient glow from poster -->
    {#if resolvedGlow}
        <div class="ds-glow" style="background-image: url('{resolvedGlow}')"></div>
    {/if}

    <div class="ds-inner" class:ds-compact={compact}>
        <!-- Header -->
        {#if title || headerRight}
            <div class="ds-header">
                <div class="ds-header-left">
                    {#if icon}
                        <MdiIcon {icon} size={16} class="ds-icon" />
                    {/if}
                    {#if title}
                        <h3 class="ds-title">{title}</h3>
                    {/if}
                </div>
                {#if headerRight || href}
                    <div class="ds-header-right">
                        {#if headerRight}
                            {@render headerRight()}
                        {/if}
                        {#if href}
                            <a href={href} class="ds-link">{hrefLabel}</a>
                        {/if}
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
        overflow: hidden;
        isolation: isolate;
        margin-bottom: 1rem;
    }

    /* ══════════════ AMBIENT GLOW ══════════════ */
    .ds-glow {
        position: absolute;
        inset: 0;
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
        padding: 1rem 1.25rem 0.75rem;
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
    }
    .ds-header-right {
        display: flex;
        align-items: center;
        gap: 0.5rem;
    }
    :global(.ds-icon) {
        opacity: 0.7;
    }
    .ds-title {
        font-size: 0.9rem;
        font-weight: 700;
        color: oklch(var(--bc) / 0.9);
        margin: 0;
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
