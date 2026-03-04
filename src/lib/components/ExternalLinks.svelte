<script>
    /**
     * @type {{
     *   tmdb_id?: string | null,
     *   imdb_id?: string | null,
     *   tvdb_id?: string | null,
     *   musicbrainz_id?: string | null,
     *   tmdb_person_id?: string | null,
     *   imdb_person_id?: string | null,
     *   musicbrainz_artist_id?: string | null,
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
        mediaType = "movie",
        class: className = "",
    } = $props();

    // Build links array
    const links = $derived.by(() => {
        /** @type {{ label: string, url: string, icon: string }[]} */
        const result = [];

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
                icon: "🎬",
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
                icon: "⭐",
            });
        }

        // TVDB
        if (tvdb_id) {
            const tvdbType = mediaType === "movie" ? "movies" : "series";
            result.push({
                label: "TVDB",
                url: `https://thetvdb.com/${tvdbType}/${tvdb_id}`,
                icon: "📺",
            });
        }

        // MusicBrainz
        const mb = musicbrainz_id || musicbrainz_artist_id;
        if (mb) {
            const mbType = mediaType === "album" ? "release-group" : "artist";
            result.push({
                label: "MusicBrainz",
                url: `https://musicbrainz.org/${mbType}/${mb}`,
                icon: "🎵",
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
                <span class="text-xs">{link.icon}</span>
                {link.label} ↗
            </a>
        {/each}
    </div>
{/if}
