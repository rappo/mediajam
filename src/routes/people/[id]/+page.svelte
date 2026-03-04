<script>
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
            <img
                src={data.person.photoUrl + "?maxHeight=300"}
                alt={data.person.name}
                class="w-32 h-32 md:w-40 md:h-40 rounded-2xl object-cover shadow-lg shrink-0"
            />
        {:else}
            <div
                class="w-32 h-32 md:w-40 md:h-40 rounded-2xl bg-base-300 flex items-center justify-center text-5xl shrink-0"
            >
                👤
            </div>
        {/if}
        <div class="space-y-3 min-w-0">
            <div>
                <h1 class="text-3xl md:text-4xl font-bold">
                    {data.person.name}
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
            <div class="flex flex-wrap gap-2">
                {#if data.person.tmdb_person_id}
                    <a
                        href="https://www.themoviedb.org/person/{data.person
                            .tmdb_person_id}"
                        target="_blank"
                        rel="noopener"
                        class="btn btn-xs btn-outline gap-1"
                    >
                        <span class="text-[#01b4e4] font-bold">TMDB</span>
                    </a>
                {/if}
                {#if data.person.imdb_person_id}
                    <a
                        href="https://www.imdb.com/name/{data.person
                            .imdb_person_id}"
                        target="_blank"
                        rel="noopener"
                        class="btn btn-xs btn-outline gap-1"
                    >
                        <span class="text-[#F5C518] font-bold">IMDb</span>
                    </a>
                {/if}
                {#if data.person.musicbrainz_artist_id}
                    <a
                        href="https://musicbrainz.org/artist/{data.person
                            .musicbrainz_artist_id}"
                        target="_blank"
                        rel="noopener"
                        class="btn btn-xs btn-outline gap-1"
                    >
                        <span class="text-[#BA478F] font-bold">MusicBrainz</span
                        >
                    </a>
                {/if}
                {#if data.person.jellyfin_id && data.jellyfinUrl}
                    <a
                        href="{data.jellyfinUrl}/web/index.html#!/item?id={data
                            .person.jellyfin_id}"
                        target="_blank"
                        rel="noopener"
                        class="btn btn-xs btn-outline gap-1"
                    >
                        <span class="text-[#00A4DC] font-bold">Jellyfin</span>
                    </a>
                {/if}
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
            <h2 class="text-xl font-bold flex items-center gap-2">
                🎬 Movies
                <span class="badge badge-ghost badge-sm"
                    >{data.movies.length}</span
                >
            </h2>
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
                            <div class="flex flex-wrap items-center gap-1 mt-1">
                                {#if credit.release_year}
                                    <span class="text-xs text-base-content/40"
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
                            <div class="flex flex-wrap items-center gap-1 mt-1">
                                {#if credit.release_year}
                                    <span class="text-xs text-base-content/40"
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
                                    <span class="text-xs text-base-content/40"
                                        >({credit.total_episodes} episodes)</span
                                    >
                                {/if}
                            </div>
                        </div>
                    </a>
                {/each}
            </div>
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
