<script>
    /** @type {{ wizardData: any, onStepComplete: (data: any) => void, onBack: () => void }} */
    let { wizardData, onStepComplete, onBack } = $props();

    let traktClientId = $state(wizardData.traktClientId || "");
    let traktClientSecret = $state(wizardData.traktClientSecret || "");
    let lastfmApiKey = $state(wizardData.lastfmApiKey || "");
    let lastfmSharedSecret = $state(wizardData.lastfmSharedSecret || "");
    let saving = $state(false);
    let error = $state("");

    const hasTraktCreds = $derived(traktClientId && traktClientSecret);
    const hasLastfmCreds = $derived(lastfmApiKey && lastfmSharedSecret);

    async function saveAndContinue() {
        saving = true;
        error = "";

        try {
            const payload = {};
            if (traktClientId) payload.trakt_client_id = traktClientId;
            if (traktClientSecret)
                payload.trakt_client_secret = traktClientSecret;
            if (lastfmApiKey) payload.lastfm_api_key = lastfmApiKey;
            if (lastfmSharedSecret)
                payload.lastfm_shared_secret = lastfmSharedSecret;

            if (Object.keys(payload).length > 0) {
                const res = await fetch("/api/settings", {
                    method: "PUT",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(payload),
                });
                const data = await res.json();
                if (!data.success) {
                    error =
                        data.error || "Failed to save integration settings.";
                    saving = false;
                    return;
                }
            }

            onStepComplete({
                traktClientId,
                traktClientSecret,
                lastfmApiKey,
                lastfmSharedSecret,
            });
        } catch (e) {
            error = "An error occurred while saving.";
        }

        saving = false;
    }
</script>

<div>
    <h2 class="text-2xl font-bold mb-2">Integrations</h2>
    <p class="text-base-content/60 text-sm mb-2">
        Connect Trakt and Last.fm to import watch and listen history. These are
        <strong>app-level API credentials</strong> shared across all Mediajam users.
    </p>
    <p class="text-xs text-base-content/40 mb-6">
        Personal accounts are connected in the next step.
    </p>

    <div class="space-y-5">
        <!-- Trakt -->
        <div class="p-4 rounded-xl border border-base-300 bg-base-300/20">
            <div class="flex items-center gap-3 mb-3">
                <span class="text-xl">🎬</span>
                <div>
                    <h3 class="font-semibold text-sm">Trakt</h3>
                    <p class="text-xs text-base-content/50">
                        Track movies & TV shows you've watched. Create an app at
                        trakt.tv to get credentials.
                    </p>
                </div>
            </div>

            <div class="space-y-2">
                <input
                    type="text"
                    placeholder="Client ID"
                    class="input input-bordered input-sm w-full"
                    bind:value={traktClientId}
                />
                <input
                    type="text"
                    placeholder="Client Secret"
                    class="input input-bordered input-sm w-full"
                    bind:value={traktClientSecret}
                />
            </div>

            <a
                href="https://trakt.tv/oauth/applications/new"
                target="_blank"
                rel="noopener noreferrer"
                class="link link-primary text-xs inline-flex items-center gap-1 mt-2"
            >
                Create a Trakt API application
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
                    />
                    <polyline points="15 3 21 3 21 9" />
                    <line x1="10" y1="14" x2="21" y2="3" />
                </svg>
            </a>
        </div>

        <!-- Last.fm -->
        <div class="p-4 rounded-xl border border-base-300 bg-base-300/20">
            <div class="flex items-center gap-3 mb-3">
                <span class="text-xl">🎵</span>
                <div>
                    <h3 class="font-semibold text-sm">Last.fm</h3>
                    <p class="text-xs text-base-content/50">
                        Import your scrobble history to track music listening
                        habits.
                    </p>
                </div>
            </div>

            <div class="space-y-2">
                <input
                    type="text"
                    placeholder="API Key"
                    class="input input-bordered input-sm w-full"
                    bind:value={lastfmApiKey}
                />
                <input
                    type="text"
                    placeholder="Shared Secret"
                    class="input input-bordered input-sm w-full"
                    bind:value={lastfmSharedSecret}
                />
            </div>

            <a
                href="https://www.last.fm/api/account/create"
                target="_blank"
                rel="noopener noreferrer"
                class="link link-primary text-xs inline-flex items-center gap-1 mt-2"
            >
                Create a Last.fm API account
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
                    />
                    <polyline points="15 3 21 3 21 9" />
                    <line x1="10" y1="14" x2="21" y2="3" />
                </svg>
            </a>
        </div>
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
