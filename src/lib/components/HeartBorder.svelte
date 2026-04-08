<script>
    /**
     * HeartBorder: Wraps a poster/photo image with a decorative heart border when favorited.
     * @type {{ show?: boolean, class?: string, children: import('svelte').Snippet }}
     */
    let { show = false, class: className = "", children } = $props();
</script>

{#if show}
    <div class="heart-border-wrap {className}">
        {@render children()}
        <div class="heart-icons">
            <span class="ht1">💗</span><span class="ht2">❤️</span><span
                class="ht3">💕</span
            ><span class="ht4">❤️</span><span class="ht5">💗</span>
            <span class="hb1">💕</span><span class="hb2">❤️</span><span
                class="hb3">💗</span
            ><span class="hb4">❤️</span><span class="hb5">💕</span>
            <span class="hl1">💗</span><span class="hl2">❤️</span><span
                class="hl3">💕</span
            ><span class="hl4">❤️</span>
            <span class="hr1">💕</span><span class="hr2">❤️</span><span
                class="hr3">💗</span
            ><span class="hr4">❤️</span>
        </div>
    </div>
{:else}
    <div class={className}>
        {@render children()}
    </div>
{/if}
