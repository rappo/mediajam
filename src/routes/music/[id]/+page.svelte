<script>
    let { data } = $props();
    let expandedAlbum = $state(null);
    let albumTracks = $state({});
    let loadingTracks = $state(null);

    async function toggleAlbum(album) {
        if (expandedAlbum === album.id) {
            expandedAlbum = null;
            return;
        }
        expandedAlbum = album.id;
        if (albumTracks[album.id]) return; // Already loaded
        loadingTracks = album.id;
        try {
            const res = await fetch(`/api/tracks/${album.jellyfin_id}`);
            if (res.ok) {
                const tracks = await res.json();
                albumTracks = { ...albumTracks, [album.id]: tracks };
            }
        } catch (e) {
            console.error("Failed to load tracks:", e);
        }
        loadingTracks = null;
    }

    function formatRuntime(mins) {
        if (!mins) return "—";
        if (mins < 60) return `${mins}m`;
        const h = Math.floor(mins / 60);
        const m = mins % 60;
        return m > 0 ? `${h}h ${m}m` : `${h}h`;
    }
</script>

<svelte:head>
    <title>{data.artist.title} — Mediajam</title>
</svelte:head>

<div class="space-y-6 max-w-6xl mx-auto">
    <!-- Back link -->
    <a href="/music" class="btn btn-ghost btn-sm gap-1">
        <svg
            xmlns="http://www.w3.org/2000/svg"
            class="h-4 w-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"><polyline points="15 18 9 12 15 6" /></svg
        >
        All Artists
    </a>

    <!-- Header -->
    <div class="flex gap-6 items-start">
        {#if data.artist.imageUrl}
            <img
                src={data.artist.imageUrl}
                alt={data.artist.title}
                class="w-40 h-40 rounded-xl shadow-lg shrink-0 object-cover"
            />
        {/if}
        <div class="space-y-3 min-w-0">
            <div>
                <h1 class="text-3xl font-bold">{data.artist.title}</h1>
                <p class="text-base-content/50 text-sm mt-1">
                    {#if data.artist.musicbrainz_id}
                        <a
                            href="https://musicbrainz.org/artist/{data.artist
                                .musicbrainz_id}"
                            target="_blank"
                            class="link link-primary">MusicBrainz ↗</a
                        >
                    {/if}
                </p>
            </div>
            <div class="flex flex-wrap gap-3">
                <div class="badge badge-lg badge-info gap-1">
                    💿 {data.albums.length} albums
                </div>
                <div class="badge badge-lg badge-secondary gap-1">
                    ▶️ {data.artist.total_plays} plays
                </div>
                <div class="badge badge-lg badge-accent gap-1">
                    ⏱️ {formatRuntime(data.totalRuntimeMinutes)}
                </div>
                {#if data.artist.collection_pct !== null}
                    <div class="badge badge-lg badge-primary gap-1">
                        📦 {data.artist.collection_pct}% collected
                    </div>
                {/if}
            </div>
        </div>
    </div>

    <!-- Albums -->
    <div class="space-y-3">
        <h2 class="text-xl font-bold">Discography</h2>

        {#if data.albums.length === 0}
            <p class="text-base-content/40 text-sm py-8 text-center">
                No albums found for this artist.
            </p>
        {:else}
            <div class="space-y-3">
                {#each data.albums as album}
                    <!-- Album Card -->
                    <a href="/music/{data.artist.id}/{album.id}" class="block">
                        <div
                            class="flex items-center gap-4 p-3 rounded-xl border border-base-content/5 bg-base-200/30 hover:bg-base-200/60 transition-all"
                        >
                            {#if album.artUrl}
                                <img
                                    src={album.artUrl}
                                    alt={album.title}
                                    class="w-16 h-16 rounded-lg shadow-md shrink-0 object-cover"
                                />
                            {:else}
                                <div
                                    class="w-16 h-16 rounded-lg bg-base-300 flex items-center justify-center shrink-0"
                                >
                                    <span class="text-2xl opacity-30">💿</span>
                                </div>
                            {/if}
                            <div class="flex-1 min-w-0">
                                <p class="font-semibold truncate">
                                    {album.title}
                                </p>
                                <p class="text-xs text-base-content/50">
                                    {album.release_year || "Unknown year"}
                                    · {formatRuntime(album.runtimeMinutes)}
                                </p>
                            </div>
                            <div class="flex items-center gap-3 shrink-0">
                                {#if album.play_count > 0}
                                    <span class="badge badge-sm badge-accent"
                                        >{album.play_count} plays</span
                                    >
                                {/if}
                                <svg
                                    xmlns="http://www.w3.org/2000/svg"
                                    class="h-4 w-4 text-base-content/30"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    stroke-width="2"
                                    ><polyline points="9 18 15 12 9 6" /></svg
                                >
                            </div>
                        </div>
                    </a>

                    <!-- Expanded Track List -->
                    {#if expandedAlbum === album.id}
                        <div
                            class="ml-20 border-l-2 border-primary/20 pl-4 pb-2 animate-fade-in"
                        >
                            {#if loadingTracks === album.id}
                                <p class="text-sm text-base-content/40 py-3">
                                    <span
                                        class="loading loading-spinner loading-xs"
                                    ></span>
                                    Loading tracks...
                                </p>
                            {:else if albumTracks[album.id] && albumTracks[album.id].length > 0}
                                <table class="table table-xs">
                                    <thead>
                                        <tr
                                            class="text-xs text-base-content/40"
                                        >
                                            <th class="w-8">#</th>
                                            <th>Track</th>
                                            <th class="w-16 text-right"
                                                >Duration</th
                                            >
                                            <th class="w-16 text-center"
                                                >Plays</th
                                            >
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {#each albumTracks[album.id] as track}
                                            <tr class="hover:bg-base-300/10">
                                                <td class="text-base-content/40"
                                                    >{track.IndexNumber ||
                                                        "—"}</td
                                                >
                                                <td class="text-sm"
                                                    >{track.Name}</td
                                                >
                                                <td
                                                    class="text-right text-xs text-base-content/40"
                                                >
                                                    {track.RunTimeTicks
                                                        ? `${Math.floor(track.RunTimeTicks / 600000000)}:${String(Math.floor((track.RunTimeTicks % 600000000) / 10000000)).padStart(2, "0")}`
                                                        : "—"}
                                                </td>
                                                <td class="text-center">
                                                    {#if track.UserData?.PlayCount > 0}
                                                        <span
                                                            class="badge badge-xs badge-accent"
                                                            >{track.UserData
                                                                .PlayCount}</span
                                                        >
                                                    {:else}
                                                        <span
                                                            class="text-base-content/20"
                                                            >—</span
                                                        >
                                                    {/if}
                                                </td>
                                            </tr>
                                        {/each}
                                    </tbody>
                                </table>
                            {:else if albumTracks[album.id]}
                                <p class="text-sm text-base-content/40 py-2">
                                    No tracks found.
                                </p>
                            {/if}
                        </div>
                    {/if}
                {/each}
            </div>
        {/if}
    </div>
</div>

<style>
    .animate-fade-in {
        animation: fadeIn 0.2s ease-out;
    }
    @keyframes fadeIn {
        from {
            opacity: 0;
            transform: translateY(-4px);
        }
        to {
            opacity: 1;
            transform: translateY(0);
        }
    }
</style>
