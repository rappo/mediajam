<script>
    /** @type {{ service: string, size?: string, class?: string }} */
    let { service, size = "w-5 h-5", class: className = "" } = $props();
    import MdiIcon from '$lib/components/MdiIcon.svelte';
    import { mdiWeb } from '@mdi/js';

    // Use local API route (icons cached on server boot)
    const src = $derived(`/api/icons/${service}`);

    let failed = $state(false);

    function onError() { failed = true; }
</script>

{#if failed}
    <!-- Fallback: generic globe -->
    <span class="{size} {className} inline-flex items-center justify-center"><MdiIcon icon={mdiWeb} size={16} /></span>
{:else}
    <img
        src={src}
        alt={service}
        class="{size} {className} inline-block"
        onerror={onError}
        loading="lazy"
    />
{/if}
