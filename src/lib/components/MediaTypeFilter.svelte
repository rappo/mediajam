<script>
    import MdiIcon from '$lib/components/MdiIcon.svelte';
    import { mdiTelevision, mdiMovieOpen, mdiMusic } from '@mdi/js';
    /**
     * Shared media-type toggle buttons (TV / Movies / Music).
     * Uses DaisyUI btn-xs checkbox toggles with oklch color vars.
     *
     * @type {{ activeTypes: string[], onchange: (types: string[]) => void }}
     */
    let { activeTypes = ['movie', 'show', 'artist'], onchange = () => {} } = $props();

    const typeLabels = [
        { key: 'show', label: 'TV', icon: mdiTelevision, colorVar: '--color-tv' },
        { key: 'movie', label: 'Movies', icon: mdiMovieOpen, colorVar: '--color-movies' },
        { key: 'artist', label: 'Music', icon: mdiMusic, colorVar: '--color-music' },
    ];

    function onToggle(key, checked) {
        let next;
        if (checked) {
            next = [...activeTypes, key];
        } else {
            // Don't allow turning off the last one
            if (activeTypes.length > 1) {
                next = activeTypes.filter(t => t !== key);
            } else {
                return;
            }
        }
        onchange(next);
    }
</script>

<form class="media-type-filter" onsubmit={(e) => e.preventDefault()}>
    {#each typeLabels as { key, label, icon, colorVar }}
        <input
            class="btn btn-xs media-type-filter-btn"
            type="checkbox"
            name="media-types"
            aria-label="{label}"
            checked={activeTypes.includes(key)}
            onchange={(e) => onToggle(key, e.target.checked)}
            style="--filter-color: oklch(var({colorVar})); {activeTypes.includes(key) ? `background: oklch(var(${colorVar}) / 0.18); color: oklch(var(${colorVar})); border-color: oklch(var(${colorVar}) / 0.5);` : `opacity: 0.35; border-color: oklch(var(${colorVar}) / 0.15);`}"
        />
    {/each}
</form>

<style>
    .media-type-filter {
        display: flex;
        gap: 0.25rem;
        align-items: center;
    }
    .media-type-filter-btn {
        transition: all 0.2s ease !important;
    }
</style>
