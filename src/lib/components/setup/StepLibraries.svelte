<script>
    /** @type {{ wizardData: any, onStepComplete: (data: any) => void, onBack: () => void }} */
    let { wizardData, onStepComplete, onBack } = $props();

    let libraries = $state([]);
    let selected = $state(new Set());
    let loading = $state(true);
    let saving = $state(false);
    let error = $state("");

    const TYPE_ICONS = {
        movies: "🎬",
        tvshows: "📺",
        music: "🎵",
        books: "📚",
        photos: "📷",
        homevideos: "🎥",
        mixed: "📂",
    };

    const TYPE_LABELS = {
        movies: "Movies",
        tvshows: "TV Shows",
        music: "Music",
        books: "Books",
        photos: "Photos",
        homevideos: "Home Videos",
        mixed: "Mixed",
    };

    async function fetchLibraries() {
        loading = true;
        error = "";

        try {
            const res = await fetch(
                `/api/setup/libraries?jellyfinUrl=${encodeURIComponent(wizardData.jellyfinUrl)}&accessToken=${encodeURIComponent(wizardData.accessToken || "")}`,
            );
            const data = await res.json();

            if (data.libraries) {
                libraries = data.libraries;
                // Auto-select movies, TV, and music
                for (const lib of libraries) {
                    if (["movies", "tvshows", "music"].includes(lib.type)) {
                        selected.add(lib.id);
                    }
                }
                selected = new Set(selected); // trigger reactivity
            } else {
                error = data.error || "Failed to fetch libraries.";
            }
        } catch (e) {
            error = "Could not fetch libraries from Jellyfin.";
        }

        loading = false;
    }

    function toggleLibrary(id) {
        if (selected.has(id)) {
            selected.delete(id);
        } else {
            selected.add(id);
        }
        selected = new Set(selected);
    }

    async function saveAndContinue() {
        if (selected.size === 0) {
            error = "Please select at least one library.";
            return;
        }

        saving = true;
        error = "";

        const selectedLibs = libraries
            .filter((lib) => selected.has(lib.id))
            .map((lib) => ({
                jellyfin_id: lib.id,
                name: lib.name,
                media_type: lib.type,
            }));

        try {
            const res = await fetch("/api/setup/libraries", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ libraries: selectedLibs }),
            });
            const data = await res.json();

            if (data.success) {
                onStepComplete({ selectedLibraries: selectedLibs });
            } else {
                error = data.error || "Failed to save library selection.";
            }
        } catch (e) {
            error = "An error occurred while saving.";
        }

        saving = false;
    }

    $effect(() => {
        fetchLibraries();
    });
</script>

<div>
    <h2 class="text-2xl font-bold mb-2">Select Libraries</h2>
    <p class="text-base-content/60 text-sm mb-6">
        Choose which Jellyfin libraries to include in your statistics.
    </p>

    {#if loading}
        <div class="flex flex-col items-center py-10">
            <span class="loading loading-spinner loading-lg text-primary"
            ></span>
            <p class="text-sm text-base-content/60 mt-4">
                Fetching libraries from Jellyfin...
            </p>
        </div>
    {:else if libraries.length === 0}
        <div class="alert alert-warning mb-4">
            <span class="text-sm"
                >No libraries found on your Jellyfin server.</span
            >
        </div>
    {:else}
        <div class="grid gap-3 mb-6">
            {#each libraries as lib}
                <label
                    class="flex items-center gap-4 p-4 rounded-xl border transition-all cursor-pointer hover:bg-base-300/50
					{selected.has(lib.id) ? 'border-primary/50 bg-primary/5' : 'border-base-300'}"
                >
                    <input
                        type="checkbox"
                        class="checkbox checkbox-primary checkbox-sm"
                        checked={selected.has(lib.id)}
                        onchange={() => toggleLibrary(lib.id)}
                    />
                    <span class="text-2xl">{TYPE_ICONS[lib.type] || "📂"}</span>
                    <div class="flex-1">
                        <span class="font-medium">{lib.name}</span>
                        <span class="badge badge-ghost badge-sm ml-2"
                            >{TYPE_LABELS[lib.type] || lib.type}</span
                        >
                    </div>
                    {#if selected.has(lib.id)}
                        <svg
                            xmlns="http://www.w3.org/2000/svg"
                            class="h-5 w-5 text-primary"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="2"
                        >
                            <polyline points="20 6 9 17 4 12" />
                        </svg>
                    {/if}
                </label>
            {/each}
        </div>

        <div class="text-xs text-base-content/40 mb-4">
            {selected.size} of {libraries.length} libraries selected
        </div>
    {/if}

    {#if error}
        <div class="alert alert-error alert-sm mb-4">
            <span class="text-sm">{error}</span>
        </div>
    {/if}

    <div class="flex gap-3">
        <button class="btn btn-ghost" onclick={onBack}>Back</button>
        <button
            class="btn btn-primary flex-1"
            disabled={selected.size === 0 || saving}
            onclick={saveAndContinue}
        >
            {#if saving}
                <span class="loading loading-spinner loading-sm"></span>
            {/if}
            Continue
        </button>
    </div>
</div>
