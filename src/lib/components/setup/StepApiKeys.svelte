<script>
    /** @type {{ wizardData: any, onStepComplete: (data: any) => void, onBack: () => void }} */
    let { wizardData, onStepComplete, onBack } = $props();

    let tvdbApiKey = $state(wizardData.tvdbApiKey || "");
    let tmdbApiKey = $state(wizardData.tmdbApiKey || "");
    let musicbrainzApiKey = $state(wizardData.musicbrainzApiKey || "");
    let saving = $state(false);
    let error = $state("");

    const API_INFO = [
        {
            key: "tvdb",
            label: "TheTVDB API Key",
            description:
                "Required for TV show episode data and collection status.",
            registerUrl: "https://thetvdb.com/dashboard/account/apikey",
            registerLabel: "Get your API key at thetvdb.com",
            placeholder: "Enter your TVDB API key",
            icon: "📺",
        },
        {
            key: "tmdb",
            label: "TMDB API Key",
            description: "Required for movie metadata and collection tracking.",
            registerUrl: "https://www.themoviedb.org/settings/api",
            registerLabel: "Get your API key at themoviedb.org",
            placeholder: "Enter your TMDB API key",
            icon: "🎬",
        },
        {
            key: "musicbrainz",
            label: "MusicBrainz API",
            description:
                "Used for music album and track data. No key required for basic use.",
            registerUrl: "https://musicbrainz.org/doc/MusicBrainz_API",
            registerLabel: "Learn about the MusicBrainz API",
            placeholder: "Optional — user agent string",
            icon: "🎵",
        },
    ];

    function getBindValue(key) {
        if (key === "tvdb") return tvdbApiKey;
        if (key === "tmdb") return tmdbApiKey;
        return musicbrainzApiKey;
    }

    function setBindValue(key, value) {
        if (key === "tvdb") tvdbApiKey = value;
        else if (key === "tmdb") tmdbApiKey = value;
        else musicbrainzApiKey = value;
    }

    async function saveAndContinue() {
        saving = true;
        error = "";

        try {
            const res = await fetch("/api/settings", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    tvdb_api_key: tvdbApiKey || null,
                    tmdb_api_key: tmdbApiKey || null,
                    musicbrainz_api_key: musicbrainzApiKey || null,
                }),
            });

            const data = await res.json();

            if (data.success) {
                onStepComplete({
                    tvdbApiKey,
                    tmdbApiKey,
                    musicbrainzApiKey,
                });
            } else {
                error = data.error || "Failed to save API keys.";
            }
        } catch (e) {
            error = "An error occurred while saving.";
        }

        saving = false;
    }
</script>

<div>
    <h2 class="text-2xl font-bold mb-2">API Keys</h2>
    <p class="text-base-content/60 text-sm mb-6">
        Add your API keys to unlock full metadata enrichment. You can skip this
        and add them later in Settings.
    </p>

    <div class="space-y-5">
        {#each API_INFO as api}
            <div class="p-4 rounded-xl border border-base-300 bg-base-300/20">
                <div class="flex items-center gap-3 mb-3">
                    <span class="text-xl">{api.icon}</span>
                    <div>
                        <h3 class="font-semibold text-sm">{api.label}</h3>
                        <p class="text-xs text-base-content/50">
                            {api.description}
                        </p>
                    </div>
                </div>

                <input
                    type="text"
                    placeholder={api.placeholder}
                    class="input input-bordered input-sm w-full mb-2"
                    value={getBindValue(api.key)}
                    oninput={(e) => setBindValue(api.key, e.target.value)}
                />

                <a
                    href={api.registerUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    class="link link-primary text-xs inline-flex items-center gap-1"
                >
                    {api.registerLabel}
                    <svg
                        xmlns="http://www.w3.org/2000/svg"
                        class="h-3 w-3"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                    >
                        <path
                            d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"
                        /><polyline points="15 3 21 3 21 9" /><line
                            x1="10"
                            y1="14"
                            x2="21"
                            y2="3"
                        />
                    </svg>
                </a>
            </div>
        {/each}
    </div>

    {#if error}
        <div class="alert alert-error alert-sm mt-4">
            <span class="text-sm">{error}</span>
        </div>
    {/if}

    <div class="flex gap-3 mt-6">
        <button class="btn btn-ghost" onclick={onBack}>Back</button>
        <button
            class="btn btn-outline flex-1"
            onclick={() => onStepComplete({})}
        >
            Skip for Now
        </button>
        <button
            class="btn btn-primary flex-1"
            disabled={saving}
            onclick={saveAndContinue}
        >
            {#if saving}
                <span class="loading loading-spinner loading-sm"></span>
            {/if}
            Save & Continue
        </button>
    </div>
</div>
