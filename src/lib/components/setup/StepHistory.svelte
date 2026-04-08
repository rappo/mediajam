<script>
    /** @type {{ wizardData: any, onStepComplete: (data: any) => void, onBack: () => void }} */
    let { wizardData, onStepComplete, onBack } = $props();

    const hasTraktCreds = $derived(!!wizardData.traktClientId);
    const hasLastfmCreds = $derived(!!wizardData.lastfmApiKey);

    function connectTrakt() {
        // Store return URL in sessionStorage so the callback knows to redirect back
        sessionStorage.setItem("mediajam_setup_return", "true");
        sessionStorage.setItem("mediajam_setup_step", "6");
        window.location.href = "/api/spokes/trakt";
    }

    function connectLastfm() {
        sessionStorage.setItem("mediajam_setup_return", "true");
        sessionStorage.setItem("mediajam_setup_step", "6");
        window.location.href = "/api/spokes/lastfm";
    }
</script>

<div>
    <h2 class="text-2xl font-bold mb-2">Import Watch & Listen History</h2>
    <p class="text-base-content/60 text-sm mb-6">
        Connect your personal Trakt and Last.fm accounts to pull in your viewing
        and listening history. This is <strong>your</strong> account — different
        from the app credentials in the previous step.
    </p>

    <div class="space-y-4">
        <!-- Trakt -->
        <div class="p-4 rounded-xl border border-base-300 bg-base-300/20">
            <div class="flex items-center justify-between">
                <div class="flex items-center gap-3">
                    <span class="text-xl">🎬</span>
                    <div>
                        <h3 class="font-semibold text-sm">Trakt</h3>
                        <p class="text-xs text-base-content/50">
                            Import your movie & TV watch history
                        </p>
                    </div>
                </div>
                {#if hasTraktCreds}
                    <button
                        class="btn btn-primary btn-sm gap-1"
                        onclick={connectTrakt}
                    >
                        <svg
                            xmlns="http://www.w3.org/2000/svg"
                            class="h-4 w-4"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="2"
                        >
                            <path d="M15 3h4a2 2 0 012 2v14a2 2 0 01-2 2h-4" />
                            <polyline points="10 17 15 12 10 7" />
                            <line x1="15" y1="12" x2="3" y2="12" />
                        </svg>
                        Connect
                    </button>
                {:else}
                    <span class="badge badge-ghost badge-sm"
                        >Set up app credentials first</span
                    >
                {/if}
            </div>
        </div>

        <!-- Last.fm -->
        <div class="p-4 rounded-xl border border-base-300 bg-base-300/20">
            <div class="flex items-center justify-between">
                <div class="flex items-center gap-3">
                    <span class="text-xl">🎵</span>
                    <div>
                        <h3 class="font-semibold text-sm">Last.fm</h3>
                        <p class="text-xs text-base-content/50">
                            Import your scrobble / listening history
                        </p>
                    </div>
                </div>
                {#if hasLastfmCreds}
                    <button
                        class="btn btn-primary btn-sm gap-1"
                        onclick={connectLastfm}
                    >
                        <svg
                            xmlns="http://www.w3.org/2000/svg"
                            class="h-4 w-4"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="2"
                        >
                            <path d="M15 3h4a2 2 0 012 2v14a2 2 0 01-2 2h-4" />
                            <polyline points="10 17 15 12 10 7" />
                            <line x1="15" y1="12" x2="3" y2="12" />
                        </svg>
                        Connect
                    </button>
                {:else}
                    <span class="badge badge-ghost badge-sm"
                        >Set up app credentials first</span
                    >
                {/if}
            </div>
        </div>

        <!-- Jellyfin Playback Reporting -->
        <div class="p-4 rounded-xl border border-base-300 bg-base-300/20">
            <div class="flex items-center gap-3">
                <span class="text-xl">📊</span>
                <div>
                    <h3 class="font-semibold text-sm">
                        Jellyfin Playback Reporting
                    </h3>
                    <p class="text-xs text-base-content/50">
                        Mount the <code class="text-xs"
                            >playback_reporting.db</code
                        > file in Docker to import Jellyfin watch history. Configure
                        the path in Settings after setup.
                    </p>
                </div>
            </div>
        </div>
    </div>

    <div class="alert alert-info alert-sm mt-5">
        <svg
            xmlns="http://www.w3.org/2000/svg"
            class="h-4 w-4 shrink-0"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
        >
            <circle cx="12" cy="12" r="10" /><line
                x1="12"
                y1="16"
                x2="12"
                y2="12"
            /><line x1="12" y1="8" x2="12.01" y2="8" />
        </svg>
        <span class="text-xs">
            You can also connect these services later in Settings → Account.
        </span>
    </div>

    <div class="flex gap-3 mt-6">
        <button class="btn btn-ghost" onclick={onBack}>Back</button>
        <button
            class="btn btn-primary flex-1"
            onclick={() => onStepComplete({})}
        >
            Continue
        </button>
    </div>
</div>
