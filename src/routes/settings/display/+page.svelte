<script>
    /** @type {{ data: import('./$types').PageData }} */
    let { data } = $props();

    const DAISY_THEMES = [
        "light",
        "dark",
        "cupcake",
        "bumblebee",
        "emerald",
        "corporate",
        "synthwave",
        "retro",
        "cyberpunk",
        "valentine",
        "halloween",
        "garden",
        "forest",
        "aqua",
        "lofi",
        "pastel",
        "fantasy",
        "wireframe",
        "black",
        "luxury",
        "dracula",
        "cmyk",
        "autumn",
        "business",
        "acid",
        "lemonade",
        "night",
        "coffee",
        "winter",
        "dim",
        "nord",
        "sunset",
    ];

    let currentTheme = $state(data.settings.theme || "dark");
    let includeSpecials = $state(data.settings.includeSpecials || false);
    let savingSpecials = $state(false);

    async function setTheme(theme) {
        currentTheme = theme;
        document.documentElement.setAttribute("data-theme", theme);
        await fetch("/api/settings", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ theme }),
        });
    }

    async function toggleSpecials() {
        savingSpecials = true;
        await fetch("/api/settings", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ include_specials: includeSpecials ? 1 : 0 }),
        });
        savingSpecials = false;
    }
</script>

<div class="space-y-6">
    <!-- Theme -->
    <div class="card bg-base-200/50 border border-base-300">
        <div class="card-body">
            <h2 class="card-title text-lg">
                <svg
                    xmlns="http://www.w3.org/2000/svg"
                    class="h-5 w-5 text-accent"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                >
                    <circle cx="12" cy="12" r="5" /><line
                        x1="12"
                        y1="1"
                        x2="12"
                        y2="3"
                    /><line x1="12" y1="21" x2="12" y2="23" /><line
                        x1="4.22"
                        y1="4.22"
                        x2="5.64"
                        y2="5.64"
                    /><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" /><line
                        x1="1"
                        y1="12"
                        x2="3"
                        y2="12"
                    /><line x1="21" y1="12" x2="23" y2="12" /><line
                        x1="4.22"
                        y1="19.78"
                        x2="5.64"
                        y2="18.36"
                    /><line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
                </svg>
                Appearance
            </h2>
            <p class="text-sm text-base-content/60 mb-3">
                Choose your preferred theme. Changes are saved automatically.
            </p>
            <div class="grid grid-cols-4 sm:grid-cols-6 gap-2">
                {#each DAISY_THEMES as theme}
                    <button
                        class="btn btn-sm capitalize rounded-lg"
                        class:btn-primary={currentTheme === theme}
                        class:btn-ghost={currentTheme !== theme}
                        onclick={() => setTheme(theme)}
                        data-theme={theme}
                    >
                        <div
                            class="flex gap-0.5 rounded overflow-hidden h-3 mr-1"
                        >
                            <span class="w-1.5 bg-primary"></span>
                            <span class="w-1.5 bg-secondary"></span>
                            <span class="w-1.5 bg-accent"></span>
                        </div>
                        <span class="text-[10px] truncate">{theme}</span>
                    </button>
                {/each}
            </div>
        </div>
    </div>

    <!-- Data Display Options -->
    <div class="card bg-base-200/50 border border-base-300">
        <div class="card-body">
            <h2 class="card-title text-lg">
                <svg
                    xmlns="http://www.w3.org/2000/svg"
                    class="h-5 w-5 text-info"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                >
                    <line x1="8" y1="6" x2="21" y2="6" /><line
                        x1="8"
                        y1="12"
                        x2="21"
                        y2="12"
                    /><line x1="8" y1="18" x2="21" y2="18" /><line
                        x1="3"
                        y1="6"
                        x2="3.01"
                        y2="6"
                    /><line x1="3" y1="12" x2="3.01" y2="12" /><line
                        x1="3"
                        y1="18"
                        x2="3.01"
                        y2="18"
                    />
                </svg>
                Data Display
            </h2>
            <div class="form-control">
                <label class="label cursor-pointer justify-start gap-3">
                    <input
                        type="checkbox"
                        class="toggle toggle-primary toggle-sm"
                        bind:checked={includeSpecials}
                        onchange={toggleSpecials}
                        disabled={savingSpecials}
                    />
                    <div>
                        <span class="label-text"
                            >Include Specials (Season 0) in statistics</span
                        >
                        <p class="text-xs text-base-content/50 mt-0.5">
                            When enabled, special episodes are counted in show
                            statistics and charts.
                        </p>
                    </div>
                </label>
            </div>
        </div>
    </div>
</div>
