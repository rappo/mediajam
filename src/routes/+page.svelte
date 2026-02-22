<script>
    import StatCard from "$lib/components/StatCard.svelte";

    let { data } = $props();
</script>

<svelte:head>
    <title>Mediajam — Dashboard</title>
</svelte:head>

<div class="space-y-8">
    <!-- Hero -->
    <div class="text-center py-6">
        <h1
            class="text-4xl font-extrabold bg-gradient-to-r from-primary via-secondary to-accent bg-clip-text text-transparent"
        >
            Your Library at a Glance
        </h1>
        <p class="text-base-content/50 text-sm mt-2">
            {#if data.lastSync}
                Last synced {new Date(data.lastSync).toLocaleDateString(
                    "en-US",
                    {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                    },
                )}
            {:else}
                Welcome to Mediajam
            {/if}
        </p>
    </div>

    <!-- Overview Stats -->
    <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
            icon="📺"
            label="TV Shows"
            value={data.showCount || 0}
            sub="{(data.episodeCount || 0).toLocaleString()} episodes"
            color="primary"
        />
        <StatCard
            icon="🎬"
            label="Movies"
            value={data.movieCount || 0}
            sub="{data.watchedMovies || 0} watched"
            color="secondary"
        />
        <StatCard
            icon="🎤"
            label="Artists"
            value={data.artistCount || 0}
            sub="{(data.albumCount || 0).toLocaleString()} albums"
            color="accent"
        />
        <StatCard
            icon="⏱️"
            label="Total Runtime"
            value="{(data.runtimeHours || 0).toLocaleString()}h"
            sub="of content"
            color="primary"
        />
    </div>

    <!-- Quick Navigation -->
    <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
        <a
            href="/tv"
            class="group card bg-base-300/30 hover:bg-primary/10 border border-base-content/5 hover:border-primary/30 transition-all duration-300 p-6 no-underline"
        >
            <div class="flex items-center gap-4 mb-3">
                <div
                    class="w-12 h-12 rounded-2xl bg-primary/15 flex items-center justify-center text-2xl group-hover:scale-110 transition-transform"
                >
                    📺
                </div>
                <div>
                    <h3 class="font-bold text-lg">TV Shows</h3>
                    <p class="text-xs text-base-content/50">
                        {data.showCount || 0} shows · {(
                            data.episodeCount || 0
                        ).toLocaleString()} episodes
                    </p>
                </div>
            </div>
            <div class="w-full bg-base-300 rounded-full h-2">
                <div
                    class="h-2 rounded-full bg-primary transition-all"
                    style="width: {data.episodeCount
                        ? Math.round(
                              (data.watchedEps / data.episodeCount) * 100,
                          )
                        : 0}%"
                ></div>
            </div>
            <p class="text-xs text-base-content/50 mt-1">
                {data.watchedEps || 0} of {(
                    data.episodeCount || 0
                ).toLocaleString()} episodes watched
            </p>
        </a>

        <a
            href="/movies"
            class="group card bg-base-300/30 hover:bg-secondary/10 border border-base-content/5 hover:border-secondary/30 transition-all duration-300 p-6 no-underline"
        >
            <div class="flex items-center gap-4 mb-3">
                <div
                    class="w-12 h-12 rounded-2xl bg-secondary/15 flex items-center justify-center text-2xl group-hover:scale-110 transition-transform"
                >
                    🎬
                </div>
                <div>
                    <h3 class="font-bold text-lg">Movies</h3>
                    <p class="text-xs text-base-content/50">
                        {data.movieCount || 0} movies
                    </p>
                </div>
            </div>
            <div class="w-full bg-base-300 rounded-full h-2">
                <div
                    class="h-2 rounded-full bg-secondary transition-all"
                    style="width: {data.movieCount
                        ? Math.round(
                              (data.watchedMovies / data.movieCount) * 100,
                          )
                        : 0}%"
                ></div>
            </div>
            <p class="text-xs text-base-content/50 mt-1">
                {data.watchedMovies || 0} of {data.movieCount || 0} movies watched
            </p>
        </a>

        <a
            href="/music"
            class="group card bg-base-300/30 hover:bg-accent/10 border border-base-content/5 hover:border-accent/30 transition-all duration-300 p-6 no-underline"
        >
            <div class="flex items-center gap-4 mb-3">
                <div
                    class="w-12 h-12 rounded-2xl bg-accent/15 flex items-center justify-center text-2xl group-hover:scale-110 transition-transform"
                >
                    🎤
                </div>
                <div>
                    <h3 class="font-bold text-lg">Music</h3>
                    <p class="text-xs text-base-content/50">
                        {data.artistCount || 0} artists · {(
                            data.albumCount || 0
                        ).toLocaleString()} albums
                    </p>
                </div>
            </div>
            <div class="w-full bg-base-300 rounded-full h-2 overflow-hidden">
                <div class="h-2 rounded-full bg-accent w-full"></div>
            </div>
            <p class="text-xs text-base-content/50 mt-1">
                Full collection synced
            </p>
        </a>
    </div>
</div>
