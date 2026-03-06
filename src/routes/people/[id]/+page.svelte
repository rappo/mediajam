<script>
    import ExternalLinks from "$lib/components/ExternalLinks.svelte";
    import FavoriteButton from "$lib/components/FavoriteButton.svelte";
    import HeartBorder from "$lib/components/HeartBorder.svelte";
    let { data } = $props();

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
     * Border class for a movie poster card based on its status.
     * Mirrors the TV episode border style conventions.
     */
    function movieBorderClass(credit) {
        const ws = credit.watch_status;
        const cs = credit.collection_status;
        // Watched — green solid
        if (ws === "watched" || credit.play_count > 0) return "poster-watched";
        // In progress
        if (ws === "in_progress") return "poster-progress";
        // Wanted but no file (upcoming / not downloaded)
        if (cs === "wanted" || (cs === "collected" && !credit.arr_has_file))
            return "poster-upcoming";
        // Not in collection at all (external / watched_not_owned)
        if (!credit.jellyfin_id && cs !== "collected")
            return "poster-unavailable";
        // Owned but unwatched
        return "poster-unwatched";
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
    let addingToArr = $state(/** @type {string|null} */ (null));
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
    let addedToArr = $state(/** @type {Set<string>} */ (new Set()));
    let addArrError = $state("");

    // Quality profile dialog state
    let showProfileDialog = $state(false);
    /** @type {any} */
    let pendingItem = $state(null);
    /** @type {any[]} */
    let availableProfiles = $state([]);
    /** @type {any[]} */
    let availableRootFolders = $state([]);
    let selectedProfileId = $state(/** @type {number|null} */ (null));
    let selectedRootFolder = $state(/** @type {string|null} */ (null));
    let profilesLoading = $state(false);

    let filteredDiscovery = $derived(
        (discoveryFilter === "all"
            ? discoveryItems
            : discoveryItems.filter((i) => i.media_type === discoveryFilter)
        ).toSorted((a, b) => (b.vote_average || 0) - (a.vote_average || 0)),
    );

    async function loadDiscovery() {
        discoveryLoading = true;
        discoveryError = "";
        try {
            const res = await fetch(`/api/discover/person/${data.person.id}`);
            if (!res.ok) {
                const r = await res.json();
                throw new Error(r.error || "Failed");
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

    /** @param {any} item */
    async function addToArr(item) {
        const service = item.media_type === "movie" ? "radarr" : "sonarr";

        // Fetch profiles first
        profilesLoading = true;
        pendingItem = item;
        try {
            const res = await fetch("/api/arr/profiles");
            if (!res.ok) throw new Error("Failed to fetch profiles");
            const options = await res.json();
            const serviceOptions = options[service];
            if (!serviceOptions) throw new Error(`${service} not configured`);
            availableProfiles = serviceOptions.profiles || [];
            availableRootFolders = serviceOptions.rootFolders || [];
            selectedProfileId = availableProfiles[0]?.id || null;
            selectedRootFolder = availableRootFolders[0]?.path || null;
            showProfileDialog = true;
        } catch (e) {
            addArrError = e instanceof Error ? e.message : "Failed";
            setTimeout(() => (addArrError = ""), 5000);
            pendingItem = null;
        }
        profilesLoading = false;
    }

    async function confirmAddToArr() {
        if (!pendingItem || !selectedProfileId) return;
        const item = pendingItem;
        showProfileDialog = false;
        addingToArr = item.tmdb_id;
        addArrError = "";
        try {
            // Step 1: Create a media_parents stub
            const createRes = await fetch("/api/discover/add", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    tmdb_id: item.tmdb_id,
                    media_type: item.media_type,
                    title: item.title,
                    release_year: item.release_year
                        ? parseInt(item.release_year)
                        : null,
                    poster_url: item.poster_url,
                    overview: item.overview,
                }),
            });
            if (!createRes.ok) {
                const r = await createRes.json();
                throw new Error(r.error || "Failed to create media entry");
            }
            const { mediaParentId } = await createRes.json();

            // Step 2: Add to arr with selected profile
            const service = item.media_type === "movie" ? "radarr" : "sonarr";
            const arrRes = await fetch(`/api/arr/${service}/add`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    mediaParentId,
                    qualityProfileId: selectedProfileId,
                    rootFolderPath: selectedRootFolder,
                }),
            });
            if (!arrRes.ok) {
                const r = await arrRes.json();
                throw new Error(r.error || "Failed to add to " + service);
            }

            const next = new Set(addedToArr);
            next.add(item.tmdb_id);
            addedToArr = next;
            invalidateAll();
        } catch (e) {
            addArrError = e instanceof Error ? e.message : "Failed";
            setTimeout(() => (addArrError = ""), 5000);
        }
        addingToArr = null;
        pendingItem = null;
    }
</script>

<svelte:head>
    <title>{data.person.name} — Mediajam</title>
</svelte:head>

<div class="space-y-6 max-w-5xl mx-auto">
    <!-- Back -->
    <a href="/movies" class="btn btn-ghost btn-sm gap-1">
        <svg
            xmlns="http://www.w3.org/2000/svg"
            class="h-4 w-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"><polyline points="15 18 9 12 15 6" /></svg
        >
        Back
    </a>

    <!-- Person Header -->
    <div class="flex gap-6 items-start">
        {#if data.person.photoUrl}
            <HeartBorder
                show={!!data.person.is_favorite &&
                    data.settings?.heartBorderPeople}
                class="rounded-2xl"
            >
                <img
                    src={data.person.photoUrl + "?maxHeight=300"}
                    alt={data.person.name}
                    class="w-32 h-32 md:w-40 md:h-40 rounded-2xl object-cover shadow-lg shrink-0"
                />
            </HeartBorder>
        {:else}
            <div
                class="w-32 h-32 md:w-40 md:h-40 rounded-2xl bg-base-300 flex items-center justify-center text-5xl shrink-0"
            >
                👤
            </div>
        {/if}
        <div class="space-y-3 min-w-0">
            <div>
                <h1
                    class="text-3xl md:text-4xl font-bold flex items-center gap-2"
                >
                    {data.person.name}
                    <FavoriteButton
                        type="person"
                        id={data.person.id}
                        isFavorite={!!data.person.is_favorite}
                    />
                </h1>
                <div
                    class="flex flex-wrap items-center gap-2 text-sm text-base-content/60 mt-1"
                >
                    {#if data.person.birth_date}
                        <span>Born: {data.person.birth_date}</span>
                    {/if}
                    {#if data.person.death_date}
                        <span>· Died: {data.person.death_date}</span>
                    {/if}
                </div>
            </div>

            {#if data.person.bio}
                <p class="text-sm text-base-content/70 line-clamp-4">
                    {data.person.bio}
                </p>
            {/if}

            <!-- External links -->
            <div class="flex flex-wrap items-center gap-1.5">
                <ExternalLinks
                    tmdb_person_id={data.person.tmdb_person_id}
                    imdb_person_id={data.person.imdb_person_id}
                    musicbrainz_artist_id={data.person.musicbrainz_artist_id}
                    jellyfin_id={data.person.jellyfin_id}
                    jellyfin_url={data.jellyfinUrl}
                    mediaType="person"
                />
                {#each data.externalIds.filter((e) => !(e.source === "imdb" && data.person.imdb_person_id)) as ext}
                    {@const cfg = sourceConfig[ext.source]}
                    {#if cfg}
                        <a
                            href={cfg.urlFn(ext.external_id)}
                            target="_blank"
                            rel="noopener noreferrer"
                            class="badge badge-sm badge-outline gap-1 hover:badge-primary transition-colors"
                        >
                            <span class="text-xs">{cfg.icon}</span>
                            {cfg.label} ↗
                        </a>
                    {/if}
                {/each}
            </div>
        </div>
    </div>

    <!-- Stats -->
    <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div class="card bg-base-200/50 border border-base-300">
            <div class="card-body py-3 px-4">
                <p
                    class="text-xs text-base-content/50 uppercase tracking-wider"
                >
                    Titles
                </p>
                <p class="text-2xl font-bold">{data.stats.totalCredits}</p>
            </div>
        </div>
        {#if data.stats.movieCount > 0}
            <div class="card bg-base-200/50 border border-base-300">
                <div class="card-body py-3 px-4">
                    <p
                        class="text-xs text-base-content/50 uppercase tracking-wider"
                    >
                        Movies
                    </p>
                    <p class="text-2xl font-bold">
                        {data.stats.watchedMovies}<span
                            class="text-sm text-base-content/40"
                            >/{data.stats.movieCount}</span
                        >
                    </p>
                    <p class="text-xs text-base-content/40">watched</p>
                </div>
            </div>
        {/if}
        {#if data.stats.showCount > 0}
            <div class="card bg-base-200/50 border border-base-300">
                <div class="card-body py-3 px-4">
                    <p
                        class="text-xs text-base-content/50 uppercase tracking-wider"
                    >
                        TV Shows
                    </p>
                    <p class="text-2xl font-bold">{data.stats.showCount}</p>
                </div>
            </div>
        {/if}
        {#if data.stats.artistCount > 0}
            <div class="card bg-base-200/50 border border-base-300">
                <div class="card-body py-3 px-4">
                    <p
                        class="text-xs text-base-content/50 uppercase tracking-wider"
                    >
                        Music
                    </p>
                    <p class="text-2xl font-bold">{data.stats.artistCount}</p>
                </div>
            </div>
        {/if}
    </div>

    <!-- Movies -->
    {#if data.movies.length > 0}
        <div class="space-y-3">
            <div class="flex items-center justify-between">
                <h2 class="text-xl font-bold flex items-center gap-2">
                    🎬 Movies
                    <span class="badge badge-ghost badge-sm"
                        >{data.movies.length}</span
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
            <!-- Legend -->
            <p class="text-xs text-base-content/50 -mt-1 mb-1">
                <span
                    class="inline-block w-3 h-3 rounded-sm bg-success mr-1 align-middle"
                ></span>Watched
                <span
                    class="inline-block w-3 h-3 rounded-sm poster-unwatched-legend mr-1 ml-3 align-middle"
                ></span>Unwatched
                <span
                    class="inline-block w-3 h-3 rounded-sm poster-upcoming-legend mr-1 ml-3 align-middle"
                ></span>Upcoming / No File
                <span
                    class="inline-block w-3 h-3 rounded-sm poster-unavailable-legend mr-1 ml-3 align-middle"
                ></span>Not In Collection
            </p>
            {#if creditsView === "poster"}
                <div
                    class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3"
                >
                    {#each data.movies as credit}
                        <a
                            href="/movies/{credit.media_id}"
                            class="card bg-base-200 card-compact overflow-hidden group transition-colors {movieBorderClass(
                                credit,
                            )}"
                        >
                            {#if credit.poster_url}
                                <figure class="aspect-[2/3] relative">
                                    <img
                                        src={credit.poster_url +
                                            "?maxHeight=300"}
                                        alt={credit.title}
                                        class="w-full h-full object-cover"
                                    />
                                    <div class="absolute top-1 left-1 text-sm">
                                        {watchIcon(credit.watch_status)}
                                    </div>
                                </figure>
                            {:else}
                                <div
                                    class="aspect-[2/3] bg-base-300 flex items-center justify-center text-3xl relative"
                                >
                                    🎬
                                    <div class="absolute top-1 left-1 text-sm">
                                        {watchIcon(credit.watch_status)}
                                    </div>
                                </div>
                            {/if}
                            <div class="card-body !p-2 !gap-1">
                                <h3
                                    class="font-medium text-xs leading-tight line-clamp-2 group-hover:text-primary transition-colors"
                                    title={credit.title}
                                >
                                    {credit.title}
                                </h3>
                                <div class="flex items-center gap-1 flex-wrap">
                                    {#if credit.release_year}
                                        <span
                                            class="text-[10px] text-base-content/40"
                                            >{credit.release_year}</span
                                        >
                                    {/if}
                                    {#each credit.roles as role}
                                        <span
                                            class="badge {roleBadge(
                                                role.role_type,
                                            )} badge-xs capitalize"
                                            >{role.role_type}</span
                                        >
                                    {/each}
                                </div>
                                {#if credit.roles.some((r) => r.character_name)}
                                    <div
                                        class="text-[10px] text-base-content/40 line-clamp-1"
                                    >
                                        {credit.roles
                                            .filter((r) => r.character_name)
                                            .map((r) => r.character_name)
                                            .join(", ")}
                                    </div>
                                {/if}
                            </div>
                        </a>
                    {/each}
                </div>
            {:else}
                <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {#each data.movies as credit}
                        <a
                            href="/movies/{credit.media_id}"
                            class="flex gap-3 p-3 rounded-xl bg-base-200/50 border border-base-300 hover:border-primary/30 transition-colors group"
                        >
                            {#if credit.poster_url}
                                <img
                                    src={credit.poster_url + "?maxHeight=100"}
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
                                <div
                                    class="flex flex-wrap items-center gap-1 mt-1"
                                >
                                    {#if credit.release_year}
                                        <span
                                            class="text-xs text-base-content/40"
                                            >{credit.release_year}</span
                                        >
                                    {/if}
                                    {#each credit.roles as role}
                                        <span
                                            class="badge {roleBadge(
                                                role.role_type,
                                            )} badge-xs capitalize"
                                            >{role.role_type}</span
                                        >
                                        {#if role.character_name}
                                            <span
                                                class="text-xs text-base-content/50"
                                                >as {role.character_name}</span
                                            >
                                        {/if}
                                    {/each}
                                </div>
                            </div>
                        </a>
                    {/each}
                </div>
            {/if}
        </div>
    {/if}

    <!-- TV Shows -->
    {#if data.shows.length > 0}
        <div class="space-y-3">
            <h2 class="text-xl font-bold flex items-center gap-2">
                📺 TV Shows
                <span class="badge badge-ghost badge-sm"
                    >{data.shows.length}</span
                >
            </h2>
            {#if creditsView === "poster"}
                <div
                    class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3"
                >
                    {#each data.shows as credit}
                        <a
                            href="/tv/{credit.media_id}"
                            class="card bg-base-200 card-compact border border-base-300/50 overflow-hidden group hover:border-primary/40 transition-colors"
                        >
                            {#if credit.poster_url}
                                <figure class="aspect-[2/3] relative">
                                    <img
                                        src={credit.poster_url +
                                            "?maxHeight=300"}
                                        alt={credit.title}
                                        class="w-full h-full object-cover"
                                    />
                                </figure>
                            {:else}
                                <div
                                    class="aspect-[2/3] bg-base-300 flex items-center justify-center text-3xl"
                                >
                                    📺
                                </div>
                            {/if}
                            <div class="card-body !p-2 !gap-1">
                                <h3
                                    class="font-medium text-xs leading-tight line-clamp-2 group-hover:text-primary transition-colors"
                                    title={credit.title}
                                >
                                    {credit.title}
                                </h3>
                                <div class="flex items-center gap-1 flex-wrap">
                                    {#if credit.release_year}
                                        <span
                                            class="text-[10px] text-base-content/40"
                                            >{credit.release_year}</span
                                        >
                                    {/if}
                                    {#each credit.roles as role}
                                        <span
                                            class="badge {roleBadge(
                                                role.role_type,
                                            )} badge-xs capitalize"
                                            >{role.role_type}</span
                                        >
                                    {/each}
                                    {#if credit.total_episodes}
                                        <span
                                            class="text-[10px] text-base-content/40"
                                            >({credit.total_episodes} ep)</span
                                        >
                                    {/if}
                                </div>
                                {#if credit.roles.some((r) => r.character_name)}
                                    <div
                                        class="text-[10px] text-base-content/40 line-clamp-1"
                                    >
                                        {credit.roles
                                            .filter((r) => r.character_name)
                                            .map((r) => r.character_name)
                                            .join(", ")}
                                    </div>
                                {/if}
                            </div>
                        </a>
                    {/each}
                </div>
            {:else}
                <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {#each data.shows as credit}
                        <a
                            href="/tv/{credit.media_id}"
                            class="flex gap-3 p-3 rounded-xl bg-base-200/50 border border-base-300 hover:border-primary/30 transition-colors group"
                        >
                            {#if credit.poster_url}
                                <img
                                    src={credit.poster_url + "?maxHeight=100"}
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
                                <div
                                    class="flex flex-wrap items-center gap-1 mt-1"
                                >
                                    {#if credit.release_year}
                                        <span
                                            class="text-xs text-base-content/40"
                                            >{credit.release_year}</span
                                        >
                                    {/if}
                                    {#each credit.roles as role}
                                        <span
                                            class="badge {roleBadge(
                                                role.role_type,
                                            )} badge-xs capitalize"
                                            >{role.role_type}</span
                                        >
                                        {#if role.character_name}
                                            <span
                                                class="text-xs text-base-content/50"
                                                >as {role.character_name}</span
                                            >
                                        {/if}
                                    {/each}
                                    {#if credit.total_episodes}
                                        <span
                                            class="text-xs text-base-content/40"
                                            >({credit.total_episodes} episodes)</span
                                        >
                                    {/if}
                                </div>
                            </div>
                        </a>
                    {/each}
                </div>
            {/if}
        </div>
    {/if}

    <!-- Music -->
    {#if data.artists.length > 0}
        <div class="space-y-3">
            <h2 class="text-xl font-bold flex items-center gap-2">
                🎵 Music
                <span class="badge badge-ghost badge-sm"
                    >{data.artists.length}</span
                >
            </h2>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                {#each data.artists as credit}
                    <a
                        href="/music/{credit.media_id}"
                        class="flex gap-3 p-3 rounded-xl bg-base-200/50 border border-base-300 hover:border-primary/30 transition-colors group"
                    >
                        {#if credit.poster_url}
                            <img
                                src={credit.poster_url + "?maxHeight=100"}
                                alt={credit.title}
                                class="w-12 h-12 rounded-lg object-cover shrink-0"
                            />
                        {:else}
                            <div
                                class="w-12 h-12 rounded-lg bg-base-300 flex items-center justify-center text-lg shrink-0"
                            >
                                🎵
                            </div>
                        {/if}
                        <div class="min-w-0 flex-1">
                            <span
                                class="font-medium group-hover:text-primary transition-colors truncate"
                                >{credit.title}</span
                            >
                            <div class="flex flex-wrap items-center gap-1 mt-1">
                                {#each credit.roles as role}
                                    <span
                                        class="badge {roleBadge(
                                            role.role_type,
                                        )} badge-xs capitalize"
                                        >{role.role_type}</span
                                    >
                                {/each}
                            </div>
                        </div>
                    </a>
                {/each}
            </div>
        </div>
    {/if}
</div>

<!-- Discovery: Filmography from TMDb -->
<div class="container mx-auto px-6 py-8">
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
                <div class="join">
                    <button
                        class="join-item btn btn-xs"
                        class:btn-active={discoveryFilter === "all"}
                        onclick={() => (discoveryFilter = "all")}>All</button
                    >
                    <button
                        class="join-item btn btn-xs"
                        class:btn-active={discoveryFilter === "movie"}
                        onclick={() => (discoveryFilter = "movie")}
                        >Movies</button
                    >
                    <button
                        class="join-item btn btn-xs"
                        class:btn-active={discoveryFilter === "show"}
                        onclick={() => (discoveryFilter = "show")}>TV</button
                    >
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
                                                src={item.poster_url}
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
                                                src={item.poster_url}
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
                                    <button
                                        class="btn btn-xs btn-primary gap-1 mt-1"
                                        disabled={addingToArr === item.tmdb_id}
                                        onclick={() => addToArr(item)}
                                    >
                                        {#if addingToArr === item.tmdb_id}
                                            <span
                                                class="loading loading-spinner loading-xs"
                                            ></span>
                                        {:else if addedToArr.has(item.tmdb_id)}
                                            ✅ Added
                                        {:else}
                                            ➕ {item.media_type === "movie"
                                                ? "Radarr"
                                                : "Sonarr"}
                                        {/if}
                                    </button>
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

<!-- Quality Profile Dialog -->
{#if showProfileDialog && pendingItem}
    <div class="modal modal-open">
        <div class="modal-box">
            <h3 class="font-bold text-lg">
                Add to {pendingItem.media_type === "movie"
                    ? "Radarr"
                    : "Sonarr"}
            </h3>
            <p class="text-sm text-base-content/60 mt-1">{pendingItem.title}</p>

            <div class="form-control mt-4">
                <label class="label" for="quality-profile">
                    <span class="label-text">Quality Profile</span>
                </label>
                <select
                    id="quality-profile"
                    class="select select-bordered"
                    bind:value={selectedProfileId}
                >
                    {#each availableProfiles as profile}
                        <option value={profile.id}>{profile.name}</option>
                    {/each}
                </select>
            </div>

            {#if availableRootFolders.length > 1}
                <div class="form-control mt-3">
                    <label class="label" for="root-folder">
                        <span class="label-text">Root Folder</span>
                    </label>
                    <select
                        id="root-folder"
                        class="select select-bordered"
                        bind:value={selectedRootFolder}
                    >
                        {#each availableRootFolders as folder}
                            <option value={folder.path}>{folder.path}</option>
                        {/each}
                    </select>
                </div>
            {/if}

            <div class="modal-action">
                <button
                    class="btn btn-ghost"
                    onclick={() => {
                        showProfileDialog = false;
                        pendingItem = null;
                    }}>Cancel</button
                >
                <button
                    class="btn btn-primary"
                    disabled={!selectedProfileId}
                    onclick={confirmAddToArr}
                >
                    ➕ Add
                </button>
            </div>
        </div>
        <div
            class="modal-backdrop"
            onclick={() => {
                showProfileDialog = false;
                pendingItem = null;
            }}
        ></div>
    </div>
{/if}

<style>
    /* ── Poster border status styles (mirroring TV episode conventions) ── */
    :global(.poster-watched) {
        border: 2px solid oklch(var(--su, 0.75 0.18 140));
    }
    :global(.poster-progress) {
        border: 2px solid oklch(var(--wa, 0.8 0.15 75));
    }
    :global(.poster-unwatched) {
        border: 1px solid rgba(100, 116, 139, 0.3);
    }
    :global(.poster-unwatched:hover) {
        border-color: oklch(var(--p, 0.65 0.24 270) / 0.4);
    }
    :global(.poster-upcoming) {
        border: 2px dashed oklch(var(--wa, 0.8 0.15 75));
    }
    :global(.poster-unavailable) {
        border: 2px dashed rgba(239, 68, 68, 0.6);
    }

    /* Legend swatches */
    :global(.poster-unwatched-legend) {
        background: rgba(100, 116, 139, 0.5);
    }
    :global(.poster-upcoming-legend) {
        background: rgba(245, 158, 11, 0.15);
        border: 2px dashed oklch(var(--wa, 0.8 0.15 75));
    }
    :global(.poster-unavailable-legend) {
        background: rgba(239, 68, 68, 0.15);
        border: 2px dashed rgba(239, 68, 68, 0.8);
    }
</style>
