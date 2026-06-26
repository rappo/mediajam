<script>
    import ArrAddDialog from "$lib/components/ArrAddDialog.svelte";
    import ExternalLinks from "$lib/components/ExternalLinks.svelte";
    import FavoriteButton from "$lib/components/FavoriteButton.svelte";
    import HeartBorder from "$lib/components/HeartBorder.svelte";
    import MediaDetailHeader from "$lib/components/MediaDetailHeader.svelte";
    import { imgUrl } from "$lib/utils.js";
    let { data } = $props();

    /** Format all roles for a credit as a plain text string */
    function rolesText(credit) {
        return credit.roles.map(r => {
            let s = r.role_type;
            if (r.character_name) s += ` (${r.character_name})`;
            return s;
        }).join(', ');
    }

    function roleBadge(roleType) {
        const colors = {
            actor: "badge-primary",
            director: "badge-secondary",
            writer: "badge-accent",
            producer: "badge-info",
            composer: "badge-warning",
            guest: "badge-ghost",
            creator: "badge-success",
            band_member: "badge-primary",
        };
        return colors[roleType] || "badge-ghost";
    }

    function watchIcon(status) {
        if (status === "watched") return "✅";
        if (status === "in_progress") return "⏳";
        return "🙈";
    }

    /**
     * Unified border class for any media card (movie, show, artist).
     * Returns compound classes: base status + optional modifiers.
     *   Base: poster-watched | poster-progress | poster-unwatched | poster-stub
     *   Modifiers: poster-airing (dashed) | poster-missing (red dot)
     */
    function mediaBorderClass(credit) {
        let base = 'poster-stub';
        let modifiers = '';

        if (credit.media_type === 'show') {
            // TV shows: use computed episode stats
            if (credit.total_episodes > 0 && credit.watched_count === credit.total_episodes)
                base = 'poster-watched';
            else if (credit.watched_count > 0 || credit.progress_count > 0)
                base = 'poster-progress';
            else if (credit.jellyfin_id)
                base = 'poster-unwatched';
            // Modifiers
            if (credit.upcoming_count > 0) modifiers += ' poster-airing';
            if (credit.missing_count > 0) modifiers += ' poster-missing';
        } else {
            // Movies (& music): use child record watch_status/play_count
            const ws = credit.watch_status;
            if (ws === 'watched' || credit.play_count > 0) base = 'poster-watched';
            else if (ws === 'in_progress') base = 'poster-progress';
            else if (credit.jellyfin_id) base = 'poster-unwatched';
            else if (credit.collection_status === 'wanted' || credit.arr_has_file === 0) {
                base = 'poster-unwatched';
            }
            // No jellyfin_id = no files = dotted border
            if (!credit.jellyfin_id) modifiers += ' poster-missing';
        }
        return base + modifiers;
    }

    function mediaWatchIcon(credit) {
        if (credit.media_type === 'show') {
            if (credit.total_episodes > 0 && credit.watched_count === credit.total_episodes)
                return '✅';
            if (credit.watched_count > 0 || credit.progress_count > 0)
                return '⏳';
            if (credit.jellyfin_id) return '🙈';
            return '';
        }
        const ws = credit.watch_status;
        if (ws === 'watched' || credit.play_count > 0) return '✅';
        if (ws === 'in_progress') return '⏳';
        if (credit.jellyfin_id) return '🙈';
        return '';
    }

    /**
     * Is this credit "in library"? True if it has a jellyfin_id (downloaded)
     * or collection_status is 'wanted' (tracked in *arr).
     * Stubs/metadata-only items return false.
     */
    function isInLibrary(credit) {
        return !!credit.jellyfin_id || credit.collection_status === 'wanted' || credit.arr_has_file === 1;
    }

    /** @type {Record<string, { label: string, icon: string, urlFn: (id: string) => string }>} */
    const sourceConfig = {
        discogs: {
            label: "Discogs",
            icon: "💿",
            urlFn: (id) => `https://www.discogs.com/artist/${id}`,
        },
        wikidata: {
            label: "Wikidata",
            icon: "🌐",
            urlFn: (id) => `https://www.wikidata.org/wiki/${id}`,
        },
        allmusic: {
            label: "AllMusic",
            icon: "🎶",
            urlFn: (id) => `https://www.allmusic.com/artist/${id}`,
        },
        imdb: {
            label: "IMDb",
            icon: "⭐",
            urlFn: (id) => `https://www.imdb.com/name/${id}`,
        },
        songkick: {
            label: "Songkick",
            icon: "🎤",
            urlFn: (id) => `https://www.songkick.com/artists/${id}`,
        },
        secondhandsongs: {
            label: "2ndHandSongs",
            icon: "🎹",
            urlFn: (id) => `https://secondhandsongs.com/artist/${id}`,
        },
        lastfm: {
            label: "Last.fm",
            icon: "📻",
            urlFn: (id) =>
                `https://www.last.fm/music/${encodeURIComponent(id)}`,
        },
        bbc_music: {
            label: "BBC Music",
            icon: "📡",
            urlFn: (id) => `https://www.bbc.co.uk/music/artists/${id}`,
        },
        soundcloud: {
            label: "SoundCloud",
            icon: "☁️",
            urlFn: (id) => `https://soundcloud.com/${id}`,
        },
        bandcamp: {
            label: "Bandcamp",
            icon: "🏕",
            urlFn: (id) =>
                id.startsWith("http") ? id : `https://${id}.bandcamp.com`,
        },
        setlistfm: {
            label: "Setlist.fm",
            icon: "📝",
            urlFn: (id) => `https://www.setlist.fm/setlists/${id}.html`,
        },
        vgmdb: {
            label: "VGMdb",
            icon: "🎮",
            urlFn: (id) => `https://vgmdb.net/artist/${id}`,
        },
    };

    // ── Discovery state ──
    import { invalidateAll } from "$app/navigation";

    let creditsView = $state("poster");
    let showBorderInfo = $state(false);
    /** @type {Set<string>} */
    let hiddenStates = $state(new Set());

    /** Toggle a legend state filter */
    function toggleFilter(state) {
        if (hiddenStates.has(state)) {
            hiddenStates.delete(state);
        } else {
            hiddenStates.add(state);
        }
        hiddenStates = new Set(hiddenStates); // trigger reactivity
    }

    /** Should this credit be visible given current filters? */
    function shouldShow(credit) {
        if (hiddenStates.size === 0) return true;
        const cls = mediaBorderClass(credit);
        for (const h of hiddenStates) {
            // 'collected' is a virtual filter — items WITHOUT poster-missing
            if (h === 'collected') {
                if (!cls.includes('poster-missing')) return false;
            } else {
                if (cls.includes(`poster-${h}`)) return false;
            }
        }
        return true;
    }
    // Compute which border states are present on this page (reactive)
    let activeStates = $derived((() => {
        const states = new Set();
        for (const c of [...data.movies, ...data.shows, ...data.artists]) {
            const cls = mediaBorderClass(c);
            if (cls.includes('poster-watched')) states.add('watched');
            if (cls.includes('poster-progress')) states.add('progress');
            if (cls.includes('poster-unwatched')) states.add('unwatched');
            if (cls.includes('poster-stub')) states.add('stub');
            if (cls.includes('poster-airing')) states.add('airing');
            if (cls.includes('poster-missing')) states.add('missing');
            if (!cls.includes('poster-missing')) states.add('collected');
        }
        return states;
    })());
    let discoveryLoading = $state(false);
    let discoveryLoaded = $state(false);
    let discoveryError = $state("");
    /** @type {any[]} */
    let discoveryItems = $state([]);
    // Default discovery filter: whichever type the person has more local credits for
    let discoveryFilter = $state(
        data.movies.length > data.shows.length
            ? "movie"
            : data.shows.length > data.movies.length
              ? "show"
              : "all",
    );
    let discoveryLimit = $state(24);
    let discoverySearch = $state('');
    let discoveryRoleFilter = $state('all');
    let discoverySort = $state('rating');
    let navigatingItem = $state(/** @type {string|null} */ (null));

    /** Create a stub and open the item page in a new tab */
    async function openDiscoveryItem(item) {
        if (navigatingItem === item.tmdb_id) return;
        navigatingItem = item.tmdb_id;
        try {
            const res = await fetch("/api/discover/add", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    tmdb_id: item.tmdb_id,
                    media_type: item.media_type,
                    title: item.title,
                    release_year: item.release_year,
                    poster_url: item.poster_url,
                    overview: item.overview,
                }),
            });
            const data = await res.json();
            if (data.mediaParentId) {
                const path = item.media_type === "movie" ? "movies" : "tv";
                window.open(`/${path}/${data.mediaParentId}`, "_blank");
            }
        } catch (e) {
            console.error("Failed to create stub:", e);
        } finally {
            navigatingItem = null;
        }
    }
    let addArrError = $state("");

    // Compute available departments from discovery items
    let availableDepartments = $derived(
        (() => {
            /** @type {Set<string>} */
            const depts = new Set();
            for (const item of discoveryItems) {
                for (const d of (item.departments || [])) depts.add(d);
            }
            // Sort with common ones first
            const order = ['Directing', 'Acting', 'Writing', 'Production', 'Sound', 'Art', 'Camera', 'Editing', 'Visual Effects', 'Costume & Make-Up', 'Crew', 'Lighting'];
            return [...depts].sort((a, b) => {
                const ai = order.indexOf(a), bi = order.indexOf(b);
                if (ai >= 0 && bi >= 0) return ai - bi;
                if (ai >= 0) return -1;
                if (bi >= 0) return 1;
                return a.localeCompare(b);
            });
        })()
    );

    let filteredDiscovery = $derived(
        (() => {
            let items = discoveryFilter === 'all'
                ? discoveryItems
                : discoveryItems.filter((i) => i.media_type === discoveryFilter);
            if (discoveryRoleFilter !== 'all') {
                items = items.filter((i) => (i.departments || []).includes(discoveryRoleFilter));
            }
            if (discoverySearch.trim()) {
                const q = discoverySearch.trim().toLowerCase();
                items = items.filter((i) => i.title?.toLowerCase().includes(q));
            }
            // Sort based on selected sort option
            switch (discoverySort) {
                case 'rating':
                    return items.toSorted((a, b) => (b.vote_average || 0) - (a.vote_average || 0));
                case 'newest':
                    return items.toSorted((a, b) => (parseInt(b.release_year) || 0) - (parseInt(a.release_year) || 0));
                case 'oldest':
                    return items.toSorted((a, b) => (parseInt(a.release_year) || 9999) - (parseInt(b.release_year) || 9999));
                case 'episodes':
                    return items.toSorted((a, b) => (b.episode_count || 0) - (a.episode_count || 0));
                case 'popularity':
                default:
                    return items.toSorted((a, b) => (b.popularity || 0) - (a.popularity || 0));
            }
        })()
    );

    async function loadDiscovery() {
        discoveryLoading = true;
        discoveryError = "";
        try {
            const res = await fetch(`/api/discover/person/${data.person.id}`);
            if (!res.ok) {
                const r = await res.json();
                const parts = [r.error || "Failed"];
                if (r.tmdb_response) parts.push(`TMDb: ${r.tmdb_response}`);
                if (r.debug) parts.push(`(${r.debug.step}, key:${r.debug.apiKeyLen}ch)`);
                throw new Error(parts.join(" | "));
            }
            const result = await res.json();
            discoveryItems = result.filmography || [];
            discoveryLoaded = true;
        } catch (e) {
            discoveryError =
                e instanceof Error ? e.message : "Discovery failed";
        }
        discoveryLoading = false;
    }



    // ── Person Sync ──
    let personSyncing = $state(false);
    let personSyncResult = $state(/** @type {any} */ (null));

    // Bio lazy-fetch
    let lazyBio = $state(/** @type {string|null} */ (null));
    let lazyBioSource = $state(/** @type {string|null} */ (null));
    let bioLoading = $state(false);

    $effect(() => {
        if (data.person.needsBioFetch && !lazyBio && !bioLoading) {
            bioLoading = true;
            fetch(`/api/people/${data.person.id}/bio`)
                .then(r => r.json())
                .then(d => {
                    if (d.bio) {
                        lazyBio = d.bio;
                        lazyBioSource = d.source;
                    }
                })
                .catch(() => {})
                .finally(() => { bioLoading = false; });
        }
    });

    // Auto-enrich: silently fetch missing data (bio, dates, IDs) on page load
    let enriching = $state(false);
    let enrichFailed = $state(false);
    $effect(() => {
        if (data.person.needsEnrichment && !enriching && !enrichFailed) {
            enriching = true;
            fetch(`/api/people/${data.person.id}/sync`, { method: 'POST' })
                .then(r => r.json())
                .then(d => {
                    if (d.success) invalidateAll();
                    else enrichFailed = true;
                })
                .catch(() => { enrichFailed = true; })
                .finally(() => { enriching = false; });
        }
    });

    async function syncPerson() {
        if (personSyncing) return;
        personSyncing = true;
        personSyncResult = null;
        try {
            const res = await fetch(`/api/people/${data.person.id}/sync`, { method: 'POST' });
            const result = await res.json();
            personSyncResult = result;
            if (result.success) {
                // Refresh the page data to show updated info
                setTimeout(() => invalidateAll(), 500);
            }
        } catch (e) {
            personSyncResult = { success: false, error: e instanceof Error ? e.message : 'Sync failed' };
        }
        personSyncing = false;
    }

    // Year/age subtitle for person header
    const personYearStr = $derived((() => {
        const bd = data.person.birth_date ? new Date(data.person.birth_date) : null;
        if (!bd) return null;
        const endDate = data.person.death_date ? new Date(data.person.death_date) : new Date();
        const age = Math.floor((endDate.getTime() - bd.getTime()) / (365.25 * 24 * 60 * 60 * 1000));
        return data.person.death_date
            ? `Born: ${data.person.birth_date} · Died: ${data.person.death_date} (aged ${age})`
            : `Born: ${data.person.birth_date} (age ${age})`;
    })());
</script>

<svelte:head>
    <title>{data.person.name} — Mediajam</title>
</svelte:head>

<div class="space-y-6 max-w-5xl mx-auto">
        <!-- ═══ PERSON HEADER ═══ -->
        <MediaDetailHeader
            mediaType="person"
            backHref="/people"
            backLabel="People"
            title={data.person.name}
            posterUrl={data.person.photoUrl}
            backdropUrl={data.backdropUrl}
            subtitle={personYearStr}
            overview={data.person.displayBio || lazyBio}
            overviewSource={data.person.bioSource || lazyBioSource}
            isFavorite={!!data.person.is_favorite}
            favoriteType="person"
            favoriteId={data.person.id}
            heartBorderEnabled={!!data.settings?.heartBorderPeople}
            stats={[
                ...(data.stats.movieCount > 0 ? [{ label: data.stats.movieCount === 1 ? 'movie' : 'movies', value: data.stats.movieCount }] : []),
                ...(data.stats.movieCount > 0 && data.stats.watchedMovies > 0 ? [{ label: 'watched', value: `${data.stats.watchedMovies}/${data.stats.movieCount}` }] : []),
                ...(data.stats.showCount > 0 ? [{ label: data.stats.showCount === 1 ? 'TV show' : 'TV shows', value: data.stats.showCount }] : []),
                ...(data.stats.artistCount > 0 ? [{ label: data.stats.artistCount === 1 ? 'band' : 'bands', value: data.stats.artistCount }] : []),
            ]}
            externalLinks={{
                tmdb_person_id: data.person.tmdb_person_id,
                imdb_person_id: data.person.imdb_person_id,
                musicbrainz_artist_id: data.person.musicbrainz_artist_id,
                jellyfin_id: data.person.jellyfin_id,
                jellyfin_url: data.jellyfinUrl,
                wikipedia_url: data.person.wikipedia_url,
                mediaType: 'person'
            }}
        >
            {#snippet actions()}
                <button
                    class="btn btn-xs btn-ghost gap-1"
                    disabled={personSyncing}
                    onclick={syncPerson}
                >
                    {#if personSyncing}
                        <span class="loading loading-spinner loading-xs"></span> Syncing…
                    {:else if personSyncResult?.success}
                        ✅ Synced
                    {:else if personSyncResult && !personSyncResult.success}
                        ❌ Failed
                    {:else}
                        🔄 Sync Person
                    {/if}
                </button>
            {/snippet}
        </MediaDetailHeader>

    <!-- Legend (applies to all sections – click to filter) -->
    <div class="flex items-center gap-2 flex-wrap text-xs text-base-content/50">
        {#if activeStates.has('watched')}
            <button
                class="flex items-center gap-1 cursor-pointer hover:text-base-content/80 transition-opacity"
                class:opacity-30={hiddenStates.has('watched')}
                class:line-through={hiddenStates.has('watched')}
                onclick={() => toggleFilter('watched')}
                title="Click to toggle watched">
                <span class="inline-block w-3 h-3 rounded-full border-2 border-solid" style="border-color: oklch(0.75 0.18 140);"></span>Watched
            </button>
        {/if}
        {#if activeStates.has('progress')}
            <button
                class="flex items-center gap-1 cursor-pointer hover:text-base-content/80 transition-opacity"
                class:opacity-30={hiddenStates.has('progress')}
                class:line-through={hiddenStates.has('progress')}
                onclick={() => toggleFilter('progress')}
                title="Click to toggle in progress">
                <span class="inline-block w-3 h-3 rounded-full border-2 border-solid" style="border-color: oklch(0.8 0.15 75);"></span>In Progress
            </button>
        {/if}
        {#if activeStates.has('unwatched')}
            <button
                class="flex items-center gap-1 cursor-pointer hover:text-base-content/80 transition-opacity"
                class:opacity-30={hiddenStates.has('unwatched')}
                class:line-through={hiddenStates.has('unwatched')}
                onclick={() => toggleFilter('unwatched')}
                title="Click to toggle unwatched">
                <span class="inline-block w-3 h-3 rounded-full border-2 border-solid" style="border-color: oklch(0.65 0.2 25);"></span>Unwatched
            </button>
        {/if}
        {#if activeStates.has('stub')}
            <button
                class="flex items-center gap-1 cursor-pointer hover:text-base-content/80 transition-opacity"
                class:opacity-30={hiddenStates.has('stub')}
                class:line-through={hiddenStates.has('stub')}
                onclick={() => toggleFilter('stub')}
                title="Click to toggle stubs">
                <span class="inline-block w-3 h-3 rounded-full border-2 border-solid" style="border-color: oklch(0.72 0.11 220 / 0.5);"></span>Stub
            </button>
        {/if}
        {#if activeStates.has('missing') || activeStates.has('airing') || activeStates.has('collected')}
            <span class="text-base-content/30 mx-1">|</span>
            {#if activeStates.has('collected')}
                <button
                    class="flex items-center gap-1 cursor-pointer hover:text-base-content/80 transition-opacity"
                    class:opacity-30={hiddenStates.has('collected')}
                    class:line-through={hiddenStates.has('collected')}
                    onclick={() => toggleFilter('collected')}
                    title="Click to hide collected and show only missing">
                    <span class="inline-block w-3 h-3 rounded-full border-2 border-solid" style="border-color: oklch(0.75 0.18 140);"></span>Collected
                </button>
            {/if}
            {#if activeStates.has('missing')}
                <button
                    class="flex items-center gap-1 cursor-pointer hover:text-base-content/80 transition-opacity"
                    class:opacity-30={hiddenStates.has('missing')}
                    class:line-through={hiddenStates.has('missing')}
                    onclick={() => toggleFilter('missing')}
                    title="Click to toggle missing">
                    <span class="inline-block w-3 h-3 rounded-full border-2 border-dashed" style="border-color: oklch(0.65 0.2 25 / 0.6);"></span>
                    {activeStates.has('missing') ? 'Missing Files' : 'Still Airing'}
                </button>
            {/if}
        {/if}
        <button
            class="btn btn-ghost btn-xs text-base-content/30 hover:text-base-content/60 min-h-0 h-5 w-5 p-0"
            onclick={() => (showBorderInfo = true)}
            title="What do the borders mean?"
        >?</button>
    </div>

    <!-- Movies -->
    {#if data.movies.length > 0}
        {@const libraryMovies = data.movies.filter(c => isInLibrary(c))}
        {@const stubMovies = data.movies.filter(c => !isInLibrary(c))}
        <div class="space-y-3">
            <div class="flex items-center justify-between">
                <h2 class="text-xl font-bold flex items-center gap-2">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" style="color: oklch(var(--color-movies))" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"/><line x1="7" y1="2" x2="7" y2="22"/><line x1="17" y1="2" x2="17" y2="22"/><line x1="2" y1="12" x2="22" y2="12"/></svg> Movies
                    <span class="badge badge-ghost badge-sm"
                        >{libraryMovies.length}</span
                    >
                </h2>
                <button
                    class="btn btn-ghost btn-xs gap-1"
                    onclick={() =>
                        (creditsView =
                            creditsView === "poster" ? "list" : "poster")}
                >
                    {creditsView === "poster" ? "📋 List" : "🖼️ Poster"}
                </button>
            </div>
            {#if creditsView === "poster"}
                <div
                    class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3"
                >
                    {#each libraryMovies.filter(shouldShow) as credit}
                        <a
                            href="/movies/{credit.media_id}"
                            class="card bg-base-200 card-compact overflow-hidden group transition-colors {mediaBorderClass(
                                credit,
                            )}"
                        >
                            {#if credit.poster_url}
                                <figure class="aspect-[2/3] relative">
                                    <img
                                        src={imgUrl(credit.poster_url, 300)}
                                        alt={credit.title}
                                        class="w-full h-full object-cover"
                                    />
                                    {#if mediaWatchIcon(credit)}
                                        <div class="absolute top-1 left-1 text-sm">
                                            {mediaWatchIcon(credit)}
                                        </div>
                                    {/if}

                                </figure>
                            {:else}
                                <div
                                    class="aspect-[2/3] bg-base-300 flex items-center justify-center text-3xl relative"
                                >
                                    🎬
                                    {#if mediaWatchIcon(credit)}
                                        <div class="absolute top-1 left-1 text-sm">
                                            {mediaWatchIcon(credit)}
                                        </div>
                                    {/if}

                                </div>
                            {/if}
                            <div class="card-body !p-2 !gap-1">
                                <h3
                                    class="font-medium text-xs leading-tight line-clamp-2 group-hover:text-primary transition-colors"
                                    title={credit.title}
                                >
                                    {credit.title}
                                </h3>
                                <div class="text-[10px] text-base-content/40 leading-snug">
                                    {#if credit.release_year}
                                        <span>{credit.release_year}</span>
                                        <span class="mx-0.5">·</span>
                                    {/if}
                                    {rolesText(credit)}
                                </div>
                            </div>
                        </a>
                    {/each}
                </div>
            {:else}
                <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {#each libraryMovies.filter(shouldShow) as credit}
                        <a
                            href="/movies/{credit.media_id}"
                            class="flex gap-3 p-3 rounded-xl bg-base-200/50 border border-base-300 hover:border-primary/30 transition-colors group"
                        >
                            {#if credit.poster_url}
                                <img
                                    src={imgUrl(credit.poster_url, 100)}
                                    alt={credit.title}
                                    class="w-12 h-18 rounded-lg object-cover shrink-0"
                                />
                            {:else}
                                <div
                                    class="w-12 h-18 rounded-lg bg-base-300 flex items-center justify-center text-lg shrink-0"
                                >
                                    🎬
                                </div>
                            {/if}
                            <div class="min-w-0 flex-1">
                                <div class="flex items-center gap-2">
                                    <span class="text-sm"
                                        >{watchIcon(credit.watch_status)}</span
                                    >
                                    <span
                                        class="font-medium group-hover:text-primary transition-colors truncate"
                                        >{credit.title}</span
                                    >
                                </div>
                                <div class="text-xs text-base-content/40 mt-1">
                                    {#if credit.release_year}
                                        <span>{credit.release_year}</span>
                                        <span class="mx-0.5">·</span>
                                    {/if}
                                    {rolesText(credit)}
                                </div>
                            </div>
                        </a>
                    {/each}
                </div>
            {/if}
        </div>

        <!-- You Might Be Interested In (stub movies) -->
        {#if stubMovies.length > 0}
            <div class="space-y-3 mt-6">
                <h3 class="text-lg font-semibold flex items-center gap-2 text-base-content/70">
                    💡 You Might Be Interested In
                    <span class="badge badge-ghost badge-sm">{stubMovies.length}</span>
                </h3>
                {#if creditsView === "poster"}
                    <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
                        {#each stubMovies.filter(shouldShow) as credit}
                            <a
                                href="/movies/{credit.media_id}"
                                class="card bg-base-200/50 card-compact overflow-hidden group transition-colors {mediaBorderClass(credit)} opacity-80 hover:opacity-100"
                            >
                                {#if credit.poster_url}
                                    <figure class="aspect-[2/3] relative">
                                        <img
                                            src={imgUrl(credit.poster_url, 300)}
                                            alt={credit.title}
                                            class="w-full h-full object-cover"
                                        />
                                    </figure>
                                {:else}
                                    <div class="aspect-[2/3] bg-base-300 flex items-center justify-center text-3xl">🎬</div>
                                {/if}
                                <div class="card-body !p-2 !gap-1">
                                    <div class="flex items-center justify-between gap-1">
                                        <h3 class="font-medium text-xs leading-tight line-clamp-2 group-hover:text-primary transition-colors flex-1 min-w-0" title={credit.title}>{credit.title}</h3>
                                        {#if credit.tmdb_id}
                                            <div onclick={(e) => e.preventDefault()}>
                                                <ArrAddDialog
                                                    discoveryItem={{ tmdb_id: credit.tmdb_id, media_type: credit.media_type || 'movie', title: credit.title, release_year: credit.release_year, poster_url: credit.poster_url }}
                                                    onComplete={() => invalidateAll()}
                                                    buttonClass="btn btn-xs btn-ghost btn-circle"
                                                    buttonLabel="⬇"
                                                />
                                            </div>
                                        {/if}
                                    </div>
                                    <div class="text-[10px] text-base-content/40 leading-snug">
                                        {#if credit.release_year}
                                            <span>{credit.release_year}</span>
                                            <span class="mx-0.5">·</span>
                                        {/if}
                                        {rolesText(credit)}
                                    </div>
                                </div>
                            </a>
                        {/each}
                    </div>
                {:else}
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {#each stubMovies.filter(shouldShow) as credit}
                            <a
                                href="/movies/{credit.media_id}"
                                class="flex gap-3 p-3 rounded-xl bg-base-200/30 border border-base-300/50 hover:border-primary/30 transition-colors group opacity-80 hover:opacity-100"
                            >
                                {#if credit.poster_url}
                                    <img src={imgUrl(credit.poster_url, 100)} alt={credit.title} class="w-12 h-18 rounded-lg object-cover shrink-0" />
                                {:else}
                                    <div class="w-12 h-18 rounded-lg bg-base-300 flex items-center justify-center text-lg shrink-0">🎬</div>
                                {/if}
                                <div class="min-w-0 flex-1">
                                    <div class="flex items-center gap-2">
                                        <span class="font-medium group-hover:text-primary transition-colors truncate">{credit.title}</span>
                                        {#if credit.tmdb_id}
                                            <div onclick={(e) => e.preventDefault()}>
                                                <ArrAddDialog
                                                    discoveryItem={{ tmdb_id: credit.tmdb_id, media_type: credit.media_type || 'movie', title: credit.title, release_year: credit.release_year, poster_url: credit.poster_url }}
                                                    onComplete={() => invalidateAll()}
                                                    buttonClass="btn btn-xs btn-ghost btn-circle"
                                                    buttonLabel="⬇"
                                                />
                                            </div>
                                        {/if}
                                    </div>
                                    <div class="text-xs text-base-content/40 mt-1">
                                        {#if credit.release_year}
                                            <span>{credit.release_year}</span>
                                            <span class="mx-0.5">·</span>
                                        {/if}
                                        {rolesText(credit)}
                                    </div>
                                </div>
                            </a>
                        {/each}
                    </div>
                {/if}
            </div>
        {/if}
    {/if}

    <!-- TV Shows -->
    {#if data.shows.length > 0}
        {@const libraryShows = data.shows.filter(c => isInLibrary(c))}
        {@const stubShows = data.shows.filter(c => !isInLibrary(c))}
        <div class="space-y-3">
            <h2 class="text-xl font-bold flex items-center gap-2">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" style="color: oklch(var(--color-tv))" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="7" width="20" height="15" rx="2" ry="2"/><polyline points="17 2 12 7 7 2"/></svg> TV Shows
                <span class="badge badge-ghost badge-sm"
                    >{libraryShows.length}</span
                >
            </h2>
            {#if creditsView === "poster"}
                <div
                    class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3"
                >
                    {#each libraryShows.filter(shouldShow) as credit}
                        <a
                            href="/tv/{credit.media_id}"
                            class="card bg-base-200 card-compact overflow-hidden group transition-colors {mediaBorderClass(
                                credit,
                            )}"
                        >
                            {#if credit.poster_url}
                                <figure class="aspect-[2/3] relative">
                                    <img
                                        src={imgUrl(credit.poster_url, 300)}
                                        alt={credit.title}
                                        class="w-full h-full object-cover"
                                    />
                                    {#if mediaWatchIcon(credit)}
                                        <div class="absolute top-1 left-1 text-sm">
                                            {mediaWatchIcon(credit)}
                                        </div>
                                    {/if}

                                </figure>
                            {:else}
                                <div
                                    class="aspect-[2/3] bg-base-300 flex items-center justify-center text-3xl relative"
                                >
                                    📺
                                    {#if mediaWatchIcon(credit)}
                                        <div class="absolute top-1 left-1 text-sm">
                                            {mediaWatchIcon(credit)}
                                        </div>
                                    {/if}

                                </div>
                            {/if}
                            <div class="card-body !p-2 !gap-1">
                                <h3
                                    class="font-medium text-xs leading-tight line-clamp-2 group-hover:text-primary transition-colors"
                                    title={credit.title}
                                >
                                    {credit.title}
                                </h3>
                                <div class="text-[10px] text-base-content/40 leading-snug">
                                    {#if credit.release_year}
                                        <span>{credit.release_year}</span>
                                        <span class="mx-0.5">·</span>
                                    {/if}
                                    {rolesText(credit)}
                                    {#if credit.total_episodes}
                                        <span class="mx-0.5">·</span>
                                        <span>{credit.total_episodes} ep</span>
                                    {/if}
                                </div>
                            </div>
                        </a>
                    {/each}
                </div>
            {:else}
                <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {#each libraryShows.filter(shouldShow) as credit}
                        <a
                            href="/tv/{credit.media_id}"
                            class="flex gap-3 p-3 rounded-xl bg-base-200/50 border border-base-300 hover:border-primary/30 transition-colors group"
                        >
                            {#if credit.poster_url}
                                <img
                                    src={imgUrl(credit.poster_url, 100)}
                                    alt={credit.title}
                                    class="w-12 h-18 rounded-lg object-cover shrink-0"
                                />
                            {:else}
                                <div
                                    class="w-12 h-18 rounded-lg bg-base-300 flex items-center justify-center text-lg shrink-0"
                                >
                                    📺
                                </div>
                            {/if}
                            <div class="min-w-0 flex-1">
                                <div class="flex items-center gap-2">
                                    <span
                                        class="font-medium group-hover:text-primary transition-colors truncate"
                                        >{credit.title}</span
                                    >
                                </div>
                                <div class="text-xs text-base-content/40 mt-1">
                                    {#if credit.release_year}
                                        <span>{credit.release_year}</span>
                                        <span class="mx-0.5">·</span>
                                    {/if}
                                    {rolesText(credit)}
                                    {#if credit.total_episodes}
                                        <span class="mx-0.5">·</span>
                                        <span>{credit.total_episodes} episodes</span>
                                    {/if}
                                </div>
                            </div>
                        </a>
                    {/each}
                </div>
            {/if}
        </div>

        <!-- You Might Be Interested In (stub shows) -->
        {#if stubShows.length > 0}
            <div class="space-y-3 mt-6">
                <h3 class="text-lg font-semibold flex items-center gap-2 text-base-content/70">
                    💡 You Might Be Interested In
                    <span class="badge badge-ghost badge-sm">{stubShows.length}</span>
                </h3>
                {#if creditsView === "poster"}
                    <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
                        {#each stubShows.filter(shouldShow) as credit}
                            <a
                                href="/tv/{credit.media_id}"
                                class="card bg-base-200/50 card-compact overflow-hidden group transition-colors {mediaBorderClass(credit)} opacity-80 hover:opacity-100"
                            >
                                {#if credit.poster_url}
                                    <figure class="aspect-[2/3] relative">
                                        <img src={imgUrl(credit.poster_url, 300)} alt={credit.title} class="w-full h-full object-cover" />
                                    </figure>
                                {:else}
                                    <div class="aspect-[2/3] bg-base-300 flex items-center justify-center text-3xl">📺</div>
                                {/if}
                                <div class="card-body !p-2 !gap-1">
                                    <div class="flex items-center justify-between gap-1">
                                        <h3 class="font-medium text-xs leading-tight line-clamp-2 group-hover:text-primary transition-colors flex-1 min-w-0" title={credit.title}>{credit.title}</h3>
                                        {#if credit.tmdb_id}
                                            <div onclick={(e) => e.preventDefault()}>
                                                <ArrAddDialog
                                                    discoveryItem={{ tmdb_id: credit.tmdb_id, media_type: credit.media_type || 'show', title: credit.title, release_year: credit.release_year, poster_url: credit.poster_url }}
                                                    onComplete={() => invalidateAll()}
                                                    buttonClass="btn btn-xs btn-ghost btn-circle"
                                                    buttonLabel="⬇"
                                                />
                                            </div>
                                        {/if}
                                    </div>
                                    <div class="text-[10px] text-base-content/40 leading-snug">
                                        {#if credit.release_year}
                                            <span>{credit.release_year}</span>
                                            <span class="mx-0.5">·</span>
                                        {/if}
                                        {rolesText(credit)}
                                    </div>
                                </div>
                            </a>
                        {/each}
                    </div>
                {:else}
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {#each stubShows.filter(shouldShow) as credit}
                            <a
                                href="/tv/{credit.media_id}"
                                class="flex gap-3 p-3 rounded-xl bg-base-200/30 border border-base-300/50 hover:border-primary/30 transition-colors group opacity-80 hover:opacity-100"
                            >
                                {#if credit.poster_url}
                                    <img src={imgUrl(credit.poster_url, 100)} alt={credit.title} class="w-12 h-18 rounded-lg object-cover shrink-0" />
                                {:else}
                                    <div class="w-12 h-18 rounded-lg bg-base-300 flex items-center justify-center text-lg shrink-0">📺</div>
                                {/if}
                                <div class="min-w-0 flex-1">
                                    <div class="flex items-center gap-2">
                                        <span class="font-medium group-hover:text-primary transition-colors truncate">{credit.title}</span>
                                        {#if credit.tmdb_id}
                                            <div onclick={(e) => e.preventDefault()}>
                                                <ArrAddDialog
                                                    discoveryItem={{ tmdb_id: credit.tmdb_id, media_type: credit.media_type || 'show', title: credit.title, release_year: credit.release_year, poster_url: credit.poster_url }}
                                                    onComplete={() => invalidateAll()}
                                                    buttonClass="btn btn-xs btn-ghost btn-circle"
                                                    buttonLabel="⬇"
                                                />
                                            </div>
                                        {/if}
                                    </div>
                                    <div class="text-xs text-base-content/40 mt-1">
                                        {#if credit.release_year}
                                            <span>{credit.release_year}</span>
                                            <span class="mx-0.5">·</span>
                                        {/if}
                                        {rolesText(credit)}
                                    </div>
                                </div>
                            </a>
                        {/each}
                    </div>
                {/if}
            </div>
        {/if}
    {/if}

    <!-- Music -->
    {#if data.artists.length > 0}
        <div class="space-y-3">
            <h2 class="text-xl font-bold flex items-center gap-2">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" style="color: oklch(var(--color-music))" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg> Music
                <span class="badge badge-ghost badge-sm"
                    >{data.artists.length}</span
                >
            </h2>
            {#if creditsView === "poster"}
                <div
                    class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3"
                >
                    {#each data.artists.filter(shouldShow) as credit}
                        <a
                            href="/music/{credit.media_id}"
                            class="card bg-base-200 card-compact overflow-hidden group transition-colors {mediaBorderClass(
                                credit,
                            )}"
                        >
                            {#if credit.poster_url}
                                <figure class="aspect-[2/3] relative">
                                    <img
                                        src={imgUrl(credit.poster_url, 300)}
                                        alt={credit.title}
                                        class="w-full h-full object-cover"
                                    />
                                    {#if mediaWatchIcon(credit)}
                                        <div class="absolute top-1 left-1 text-sm">
                                            {mediaWatchIcon(credit)}
                                        </div>
                                    {/if}

                                </figure>
                            {:else}
                                <div
                                    class="aspect-[2/3] bg-base-300 flex items-center justify-center text-3xl relative"
                                >
                                    🎵
                                    {#if mediaWatchIcon(credit)}
                                        <div class="absolute top-1 left-1 text-sm">
                                            {mediaWatchIcon(credit)}
                                        </div>
                                    {/if}

                                </div>
                            {/if}
                            <div class="card-body !p-2 !gap-1">
                                <h3
                                    class="font-medium text-xs leading-tight line-clamp-2 group-hover:text-primary transition-colors"
                                    title={credit.title}
                                >
                                    {credit.title}
                                </h3>
                                <div class="text-[10px] text-base-content/40 leading-snug">
                                    {rolesText(credit)}
                                </div>
                            </div>
                        </a>
                    {/each}
                </div>
            {:else}
                <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {#each data.artists.filter(shouldShow) as credit}
                        <a
                            href="/music/{credit.media_id}"
                            class="flex gap-3 p-3 rounded-xl bg-base-200/50 border border-base-300 hover:border-primary/30 transition-colors group"
                        >
                            {#if credit.poster_url}
                                <img
                                    src={imgUrl(credit.poster_url, 100)}
                                    alt={credit.title}
                                    class="w-12 h-18 rounded-lg object-cover shrink-0"
                                />
                            {:else}
                                <div
                                    class="w-12 h-18 rounded-lg bg-base-300 flex items-center justify-center text-lg shrink-0"
                                >
                                    🎵
                                </div>
                            {/if}
                            <div class="min-w-0 flex-1">
                                <span
                                    class="font-medium group-hover:text-primary transition-colors truncate"
                                    >{credit.title}</span
                                >
                                <div class="text-xs text-base-content/40 mt-1">
                                    {rolesText(credit)}
                                </div>
                            </div>
                        </a>
                    {/each}
                </div>
            {/if}
        </div>
    {/if}
</div>

<!-- Discovery: Filmography from TMDb -->
<div class="max-w-5xl mx-auto px-6 py-8">
    {#if !discoveryLoaded && !discoveryLoading}
        <button
            class="btn btn-outline btn-primary w-full gap-2"
            onclick={loadDiscovery}
        >
            🔍 Discover Full Filmography from TMDb
        </button>
    {:else if discoveryLoading}
        <div class="flex flex-col items-center gap-3 py-8">
            <span class="loading loading-spinner loading-lg text-primary"
            ></span>
            <span class="text-sm text-base-content/50"
                >Fetching filmography from TMDb...</span
            >
        </div>
    {:else if discoveryError}
        <div class="alert alert-error text-sm">{discoveryError}</div>
    {:else}
        <div class="space-y-4">
            <div class="flex items-center justify-between flex-wrap gap-2">
                <h2 class="text-xl font-bold">
                    🔍 Not in Your Library
                    <span class="badge badge-neutral badge-sm ml-1"
                        >{filteredDiscovery.length}</span
                    >
                </h2>
                <div class="flex items-center gap-2 flex-wrap">
                    <input
                        type="text"
                        placeholder="Search titles…"
                        class="input input-bordered input-xs w-40"
                        bind:value={discoverySearch}
                    />
                    {#if availableDepartments.length > 1}
                        <select
                            class="select select-bordered select-xs"
                            bind:value={discoveryRoleFilter}
                            onchange={() => { discoveryLimit = 24; }}
                        >
                            <option value="all">All Roles</option>
                            {#each availableDepartments as dept}
                                <option value={dept}>{dept}</option>
                            {/each}
                        </select>
                    {/if}
                    <select
                        class="select select-bordered select-xs"
                        bind:value={discoverySort}
                        onchange={() => { discoveryLimit = 24; }}
                    >
                        <option value="rating">★ Rating</option>
                        <option value="popularity">🔥 Popularity</option>
                        <option value="newest">📅 Newest</option>
                        <option value="oldest">📅 Oldest</option>
                        {#if discoveryFilter !== 'movie'}
                            <option value="episodes">📺 Most Episodes</option>
                        {/if}
                    </select>
                    <div class="join">
                        <button
                            class="join-item btn btn-xs"
                            class:btn-active={discoveryFilter === "all"}
                            onclick={() => { discoveryFilter = "all"; discoveryLimit = 24; }}>All</button
                        >
                        <button
                            class="join-item btn btn-xs"
                            class:btn-active={discoveryFilter === "movie"}
                            onclick={() => { discoveryFilter = "movie"; discoveryLimit = 24; if (discoverySort === 'episodes') discoverySort = 'rating'; }}
                            >Movies</button
                        >
                        <button
                            class="join-item btn btn-xs"
                            class:btn-active={discoveryFilter === "show"}
                            onclick={() => { discoveryFilter = "show"; discoveryLimit = 24; }}>TV</button
                        >
                    </div>
                </div>
            </div>

            {#if filteredDiscovery.length === 0}
                <div class="text-center py-6 text-base-content/40">
                    <div class="text-3xl mb-2">🎉</div>
                    <p>You already have everything! Nothing to discover.</p>
                </div>
            {:else}
                <div
                    class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3"
                >
                    {#each filteredDiscovery.slice(0, discoveryLimit) as item}
                        {@const localUrl = item.in_library
                            ? `/${item.media_type === "movie" ? "movies" : "tv"}/${item.library_id}`
                            : null}
                        <div
                            class="card bg-base-200 card-compact border border-base-300/50 overflow-hidden group"
                        >
                            {#if localUrl}
                                <a
                                    href={localUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    class="block"
                                >
                                    {#if item.poster_url}
                                        <figure class="aspect-[2/3]">
                                            <img
                                                src={imgUrl(item.poster_url)}
                                                alt={item.title}
                                                class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                                            />
                                        </figure>
                                    {:else}
                                        <div
                                            class="aspect-[2/3] bg-base-300 flex items-center justify-center text-3xl"
                                        >
                                            🎬
                                        </div>
                                    {/if}
                                </a>
                            {:else}
                                <!-- svelte-ignore a11y_click_events_have_key_events -->
                                <!-- svelte-ignore a11y_no_static_element_interactions -->
                                <div
                                    class="cursor-pointer"
                                    onclick={() => openDiscoveryItem(item)}
                                >
                                    {#if item.poster_url}
                                        <figure class="aspect-[2/3] relative">
                                            <img
                                                src={imgUrl(item.poster_url)}
                                                alt={item.title}
                                                class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                                            />
                                            {#if navigatingItem === item.tmdb_id}
                                                <div
                                                    class="absolute inset-0 bg-black/50 flex items-center justify-center"
                                                >
                                                    <span
                                                        class="loading loading-spinner loading-md text-white"
                                                    ></span>
                                                </div>
                                            {/if}
                                        </figure>
                                    {:else}
                                        <div
                                            class="aspect-[2/3] bg-base-300 flex items-center justify-center text-3xl"
                                        >
                                            🎬
                                        </div>
                                    {/if}
                                </div>
                            {/if}
                            <div class="card-body !p-2 !gap-1">
                                {#if localUrl}
                                    <a
                                        href={localUrl}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        class="font-medium text-xs leading-tight line-clamp-2 hover:text-primary transition-colors cursor-pointer"
                                        title={item.title}>{item.title}</a
                                    >
                                {:else}
                                    <!-- svelte-ignore a11y_click_events_have_key_events -->
                                    <!-- svelte-ignore a11y_no_static_element_interactions -->
                                    <span
                                        class="font-medium text-xs leading-tight line-clamp-2 hover:text-primary transition-colors cursor-pointer"
                                        title={item.title}
                                        onclick={() => openDiscoveryItem(item)}
                                        >{item.title}</span
                                    >
                                {/if}
                                <div class="flex items-center gap-1 flex-wrap">
                                    {#if item.release_year}
                                        <span
                                            class="text-[10px] text-base-content/50"
                                            >{item.release_year}</span
                                        >
                                    {/if}
                                    <span
                                        class="badge badge-xs"
                                        class:badge-info={item.media_type ===
                                            "movie"}
                                        class:badge-accent={item.media_type ===
                                            "show"}
                                    >
                                        {item.media_type === "movie"
                                            ? "🎬"
                                            : "📺"}
                                    </span>
                                    {#if item.vote_average > 0}
                                        <span class="text-[10px] text-warning"
                                            >★ {item.vote_average.toFixed(
                                                1,
                                            )}</span
                                        >
                                    {/if}
                                    {#if item.episode_count && item.media_type === 'show'}
                                        <span class="text-[10px] text-base-content/40"
                                            >{item.episode_count} ep</span
                                        >
                                    {/if}
                                </div>
                                {#if item.roles?.length}
                                    <div
                                        class="text-[10px] text-base-content/40 line-clamp-1"
                                        title={item.roles.join(", ")}
                                    >
                                        {item.roles.join(", ")}
                                    </div>
                                {/if}
                                {#if item.in_library}
                                    <a
                                        href="/{item.media_type === 'movie'
                                            ? 'movies'
                                            : 'tv'}/{item.library_id}"
                                        class="btn btn-xs btn-success gap-1 mt-1"
                                    >
                                        ✅ In Library
                                    </a>
                                {:else}
                                    <ArrAddDialog
                                        discoveryItem={{
                                            tmdb_id: item.tmdb_id,
                                            media_type: item.media_type,
                                            title: item.title,
                                            release_year: item.release_year,
                                            poster_url: item.poster_url,
                                            overview: item.overview,
                                        }}
                                        buttonClass="btn btn-xs btn-primary gap-1 mt-1"
                                        buttonLabel="Download"
                                        onComplete={() => invalidateAll()}
                                    />
                                {/if}
                            </div>
                        </div>
                    {/each}
                </div>
                {#if filteredDiscovery.length > discoveryLimit}
                    <button
                        class="btn btn-ghost btn-sm w-full"
                        onclick={() => (discoveryLimit += 24)}
                    >
                        Show more ({filteredDiscovery.length - discoveryLimit} remaining)
                    </button>
                {/if}
            {/if}

            {#if addArrError}
                <div class="alert alert-error text-sm mt-2">{addArrError}</div>
            {/if}
        </div>
    {/if}
</div>



<!-- Border Info Dialog -->
{#if showBorderInfo}
    <div class="modal modal-open">
        <div class="modal-box max-w-lg">
            <h3 class="font-bold text-lg mb-3">🎨 Border Guide</h3>
            <div class="space-y-4">
                <div>
                    <h4 class="font-semibold text-sm text-base-content/70 mb-2">Watch Status → Border Color</h4>
                    <table class="table table-sm">
                        <tbody>
                            <tr>
                                <td><span class="inline-block w-5 h-5 rounded border-2" style="border-color: oklch(0.75 0.18 140);"></span></td>
                                <td class="font-medium">Watched</td>
                                <td class="text-base-content/60 text-xs">All content watched</td>
                            </tr>
                            <tr>
                                <td><span class="inline-block w-5 h-5 rounded border-2" style="border-color: oklch(0.8 0.15 75);"></span></td>
                                <td class="font-medium">In Progress</td>
                                <td class="text-base-content/60 text-xs">Some watched, some remaining</td>
                            </tr>
                            <tr>
                                <td><span class="inline-block w-5 h-5 rounded border-2" style="border-color: oklch(0.65 0.2 25 / 0.5);"></span></td>
                                <td class="font-medium">Unwatched</td>
                                <td class="text-base-content/60 text-xs">In collection, nothing watched</td>
                            </tr>
                            <tr>
                                <td><span class="inline-block w-5 h-5 rounded border-2" style="border-color: oklch(0.72 0.11 220 / 0.5);"></span></td>
                                <td class="font-medium">Stub</td>
                                <td class="text-base-content/60 text-xs">Not in Jellyfin or *arr — metadata only</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
                <div class="divider my-0"></div>
                <div>
                    <h4 class="font-semibold text-sm text-base-content/70 mb-2">Collection Health → Border Style</h4>
                    <table class="table table-sm">
                        <tbody>
                            <tr>
                                <td><span class="inline-block w-5 h-5 rounded border-2 border-solid" style="border-color: oklch(0.75 0.18 140);"></span></td>
                                <td class="font-medium">Solid</td>
                                <td class="text-base-content/60 text-xs">All released content collected</td>
                            </tr>
                            <tr>
                                <td><span class="inline-block w-5 h-5 rounded border-2 border-dashed" style="border-color: oklch(0.75 0.18 140);"></span></td>
                                <td class="font-medium">Dashed</td>
                                <td class="text-base-content/60 text-xs">Still airing — more episodes coming</td>
                            </tr>
                            <tr>
                                <td><span class="inline-block w-5 h-5 rounded border-2 border-dashed" style="border-color: oklch(0.8 0.15 75);"></span></td>
                                <td class="font-medium">Dashed</td>
                                <td class="text-base-content/60 text-xs">Missing files — released content not on disk</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
                <div class="divider my-0"></div>
                <div>
                    <h4 class="font-semibold text-sm text-base-content/70 mb-2">Examples</h4>
                    <table class="table table-sm">
                        <tbody>
                            <tr>
                                <td><span class="inline-block w-5 h-5 rounded border-2 border-solid" style="border-color: oklch(0.75 0.18 140);"></span></td>
                                <td class="text-base-content/60 text-xs">Watched everything, all files present</td>
                            </tr>
                            <tr>
                                <td class="flex items-center gap-1">
                                    <span class="inline-block w-5 h-5 rounded border-2 border-dashed" style="border-color: oklch(0.75 0.18 140);"></span>
                                </td>
                                <td class="text-base-content/60 text-xs">Watched everything, still airing</td>
                            </tr>
                            <tr>
                                <td><span class="inline-block w-5 h-5 rounded border-2 border-dashed" style="border-color: oklch(0.8 0.15 75);"></span></td>
                                <td class="text-base-content/60 text-xs">In progress, some files missing</td>
                            </tr>
                            <tr>
                                <td><span class="inline-block w-5 h-5 rounded border-2 border-dashed" style="border-color: oklch(0.65 0.2 25 / 0.5);"></span></td>
                                <td class="text-base-content/60 text-xs">Unwatched, some files missing</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>
            <div class="modal-action">
                <button class="btn btn-sm" onclick={() => (showBorderInfo = false)}>Close</button>
            </div>
        </div>
        <div class="modal-backdrop" onclick={() => (showBorderInfo = false)}></div>
    </div>
{/if}

<style>
    /* ── Poster border system ──
       Base classes: poster-watched, poster-progress, poster-unwatched, poster-stub
       Modifiers:    poster-airing (dashed), poster-missing (dashed + red dot)
    */

    /* Base: Watch Status Colors (solid border) */
    :global(.poster-watched) {
        border: 2px solid oklch(var(--su, 0.75 0.18 140));
    }
    :global(.poster-progress) {
        border: 2px solid oklch(var(--wa, 0.8 0.15 75));
    }
    :global(.poster-unwatched) {
        border: 2px solid oklch(0.65 0.2 25 / 0.5);
    }
    :global(.poster-unwatched:hover) {
        border-color: oklch(0.65 0.2 25 / 0.8);
    }
    :global(.poster-stub) {
        border: 2px solid oklch(var(--in, 0.72 0.11 220) / 0.5);
    }

    /* Modifier: Still Airing → dashed border */
    :global(.poster-airing) {
        border-style: dashed !important;
    }

    /* Modifier: Missing Files → dashed border */
    :global(.poster-missing) {
        border-style: dashed !important;
    }

    /* Red dot indicator for missing files */
    :global(.missing-dot) {
        position: absolute;
        top: 4px;
        right: 4px;
        font-size: 12px;
        line-height: 1;
        filter: drop-shadow(0 1px 2px rgba(0,0,0,0.5));
    }

    /* Legend swatches */
    :global(.poster-unwatched-legend) {
        background: oklch(0.65 0.2 25 / 0.5);
    }
    :global(.poster-stub-legend) {
        background: oklch(var(--in, 0.72 0.11 220) / 0.3);
        border: 1px solid oklch(var(--in, 0.72 0.11 220) / 0.6);
    }
    :global(.poster-airing-legend) {
        border: 2px dashed oklch(var(--su, 0.75 0.18 140));
    }
    :global(.poster-missing-legend) {
        background: rgba(239, 68, 68, 0.15);
        border: 2px dashed rgba(239, 68, 68, 0.8);
    }
</style>
