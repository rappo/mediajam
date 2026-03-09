<script>
    /** @type {{ service: string, size?: string, class?: string }} */
    let { service, size = "w-5 h-5", class: className = "" } = $props();

    const CDN = 'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons@latest';

    /** Map internal service keys → dashboardicons icon slugs */
    const SLUGS = /** @type {Record<string, string>} */ ({
        jellyfin: 'jellyfin',
        radarr: 'radarr',
        sonarr: 'sonarr',
        lidarr: 'lidarr',
        trakt: 'trakt',
        lastfm: 'last-fm',
        tmdb: 'tmdb',
        imdb: 'imdb',
        tvdb: 'thetvdb',
        musicbrainz: 'musicbrainz',
        wikipedia: 'wikipedia',
        omdb: 'omdb',
        discogs: 'discogs',
    });

    const slug = $derived(SLUGS[service] || service);
    const svgUrl = $derived(`${CDN}/svg/${slug}.svg`);
    const pngUrl = $derived(`${CDN}/png/${slug}.png`);

    let usePng = $state(false);
    let failed = $state(false);

    function onSvgError() { usePng = true; }
    function onPngError() { failed = true; }
</script>

{#if failed}
    <!-- Fallback: generic globe -->
    <svg class="{size} {className}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" xmlns="http://www.w3.org/2000/svg">
        <circle cx="12" cy="12" r="10" /><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
{:else}
    <img
        src={usePng ? pngUrl : svgUrl}
        alt={service}
        class="{size} {className} inline-block"
        onerror={usePng ? onPngError : onSvgError}
        loading="lazy"
    />
{/if}
