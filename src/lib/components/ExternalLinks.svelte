<script>
    import ServiceIcon from '$lib/components/ServiceIcon.svelte';

    /**
     * @type {{
     *   tmdb_id?: string | null,
     *   imdb_id?: string | null,
     *   tvdb_id?: string | null,
     *   musicbrainz_id?: string | null,
     *   tmdb_person_id?: string | null,
     *   imdb_person_id?: string | null,
     *   musicbrainz_artist_id?: string | null,
     *   jellyfin_id?: string | null,
     *   jellyfin_url?: string | null,
     *   arr_slug?: string | null,
     *   arr_url?: string | null,
     *   arr_service?: 'radarr' | 'sonarr' | 'lidarr' | null,
     *   trakt_slug?: string | null,
     *   wikipedia_url?: string | null,
     *   mediaType?: 'movie' | 'show' | 'artist' | 'person' | 'album',
     *   class?: string
     * }}
     */
    let {
        tmdb_id = null,
        imdb_id = null,
        tvdb_id = null,
        musicbrainz_id = null,
        tmdb_person_id = null,
        imdb_person_id = null,
        musicbrainz_artist_id = null,
        jellyfin_id = null,
        jellyfin_url = null,
        arr_slug = null,
        arr_url = null,
        arr_service = null,
        trakt_slug = null,
        wikipedia_url = null,
        mediaType = "movie",
        class: className = "",
    } = $props();

    // Build links array
    const links = $derived.by(() => {
        /** @type {{ label: string, url: string, service: string }[]} */
        const result = [];

        // Jellyfin
        if (jellyfin_id && jellyfin_url) {
            result.push({
                label: "Jellyfin",
                url: `${jellyfin_url}/web/index.html#!/details?id=${jellyfin_id}`,
                service: "jellyfin",
            });
        }

        // TMDB
        const tmdb = tmdb_id || tmdb_person_id;
        if (tmdb) {
            const tmdbType = tmdb_person_id
                ? "person"
                : mediaType === "show"
                  ? "tv"
                  : "movie";
            result.push({
                label: "TMDB",
                url: `https://www.themoviedb.org/${tmdbType}/${tmdb}`,
                service: "tmdb",
            });
        }

        // IMDB
        const imdb = imdb_id || imdb_person_id;
        if (imdb) {
            const imdbPath =
                imdb_person_id || mediaType === "person" ? "name" : "title";
            result.push({
                label: "IMDb",
                url: `https://www.imdb.com/${imdbPath}/${imdb}`,
                service: "imdb",
            });
        }

        // TVDB
        if (tvdb_id) {
            const tvdbType = mediaType === "movie" ? "movies" : "series";
            result.push({
                label: "TVDB",
                url: `https://thetvdb.com/dereferrer/${tvdbType}/${tvdb_id}`,
                service: "tvdb",
            });
        }

        // MusicBrainz
        const mb = musicbrainz_id || musicbrainz_artist_id;
        if (mb) {
            const mbType = mediaType === "album" ? "release-group" : "artist";
            result.push({
                label: "MusicBrainz",
                url: `https://musicbrainz.org/${mbType}/${mb}`,
                service: "musicbrainz",
            });
        }

        // Trakt
        if (trakt_slug) {
            const traktType = mediaType === "show" ? "shows" : "movies";
            result.push({
                label: "Trakt",
                url: `https://trakt.tv/${traktType}/${trakt_slug}`,
                service: "trakt",
            });
        }

        // *arr service
        if (arr_slug && arr_url && arr_service) {
            const arrConfig = {
                radarr: { label: "Radarr", path: "movie" },
                sonarr: { label: "Sonarr", path: "series" },
                lidarr: { label: "Lidarr", path: "artist" },
            };
            const cfg = arrConfig[arr_service];
            if (cfg) {
                // For Lidarr, use musicbrainz_id (foreignArtistId) for the URL, not the title slug
                const arrPath = arr_service === 'lidarr' && musicbrainz_id
                    ? musicbrainz_id
                    : arr_slug;
                result.push({
                    label: cfg.label,
                    url: `${String(arr_url).replace(/\/+$/, '')}/${cfg.path}/${arrPath}`,
                    service: arr_service,
                });
            }
        } else if (!arr_slug && arr_url && arr_service === 'lidarr' && musicbrainz_id) {
            // Not yet in Lidarr — show search link using MB ID
            result.push({
                label: "Lidarr Search",
                url: `${String(arr_url).replace(/\/+$/, '')}/add/search?term=lidarr%3A${musicbrainz_id}`,
                service: "lidarr",
            });
        }

        // Wikipedia
        if (wikipedia_url) {
            result.push({
                label: "Wikipedia",
                url: wikipedia_url,
                service: "wikipedia",
            });
        }

        return result;
    });
</script>

{#if links.length > 0}
    <div class="flex flex-wrap items-center gap-1.5 {className}">
        {#each links as link}
            <a
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                class="badge badge-sm badge-outline gap-1 hover:badge-primary transition-colors"
            >
                <ServiceIcon service={link.service} size="w-3.5 h-3.5" />
                {link.label} ↗
            </a>
        {/each}
    </div>
{/if}
