<script>
    /** @type {{ service: string, size?: string, class?: string }} */
    let { service, size = "w-5 h-5", class: className = "" } = $props();

    // Use local API route (icons cached on server boot)
    const src = $derived(`/api/icons/${service}`);

    let failed = $state(false);

    function onError() { failed = true; }
</script>

{#if failed}
    <!-- Fallback: generic globe -->
    <svg class="{size} {className}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" xmlns="http://www.w3.org/2000/svg">
        <circle cx="12" cy="12" r="10" /><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
{:else}
    <img
        src={src}
        alt={service}
        class="{size} {className} inline-block"
        onerror={onError}
        loading="lazy"
    />
{/if}
