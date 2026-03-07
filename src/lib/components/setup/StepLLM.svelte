<script>
    /** @type {{ wizardData: any, onStepComplete: (data: any) => void, onBack: () => void }} */
    let { wizardData, onStepComplete, onBack } = $props();

    let ollamaUrl = $state(wizardData.ollamaUrl || "");
    let ollamaEmbedModel = $state(
        wizardData.ollamaEmbedModel || "nomic-embed-text",
    );
    let ollamaChatModel = $state(wizardData.ollamaChatModel || "llama3.2:3b");
    let saving = $state(false);
    let error = $state("");

    // Health check
    let healthStatus = $state("idle"); // idle | checking | ok | error
    let healthModels = $state(/** @type {string[]} */ ([]));
    let healthError = $state("");

    // Scan
    let scanStatus = $state("idle"); // idle | scanning | found | notfound

    // Derived model lists
    const embedModels = $derived(
        healthModels.filter((/** @type {string} */ m) =>
            /embed|minilm|bert/i.test(m),
        ),
    );
    const chatModels = $derived(
        healthModels.filter(
            (/** @type {string} */ m) => !/embed|minilm|bert/i.test(m),
        ),
    );

    const RECOMMENDED_EMBED = "nomic-embed-text";
    const RECOMMENDED_CHAT = "llama3.2:3b";

    async function testConnection() {
        if (!ollamaUrl) return;
        healthStatus = "checking";
        healthError = "";
        try {
            const res = await fetch(
                `/api/ollama/health?url=${encodeURIComponent(ollamaUrl)}`,
            );
            const data = await res.json();
            if (data.ok) {
                healthStatus = "ok";
                healthModels = data.models || [];

                // Auto-select recommended models if current selection isn't available
                if (
                    embedModels.length &&
                    !embedModels.includes(ollamaEmbedModel)
                ) {
                    ollamaEmbedModel =
                        embedModels.find((/** @type {string} */ m) =>
                            m.includes("nomic-embed"),
                        ) || embedModels[0];
                }
                if (
                    chatModels.length &&
                    !chatModels.includes(ollamaChatModel)
                ) {
                    ollamaChatModel =
                        chatModels.find((/** @type {string} */ m) =>
                            m.includes("llama3.2"),
                        ) || chatModels[0];
                }
            } else {
                healthStatus = "error";
                healthError = data.error || "Connection failed";
            }
        } catch {
            healthStatus = "error";
            healthError = "Network error — could not reach the server";
        }
    }

    async function scanForOllama() {
        scanStatus = "scanning";
        try {
            const res = await fetch("/api/ollama/scan");
            const data = await res.json();
            if (data.found && data.instances?.length) {
                ollamaUrl = data.instances[0].url;
                scanStatus = "found";
                await testConnection();
            } else {
                scanStatus = "notfound";
            }
        } catch {
            scanStatus = "notfound";
        }
    }

    /** @param {string} model */
    function isRecommended(model) {
        return (
            model.includes(RECOMMENDED_EMBED) ||
            model.includes(RECOMMENDED_CHAT)
        );
    }

    /** @param {string} model */
    function modelLabel(model) {
        return isRecommended(model) ? `⭐ ${model} (recommended)` : model;
    }

    async function saveAndContinue() {
        saving = true;
        error = "";

        try {
            const payload = {};
            if (ollamaUrl) payload.ollama_url = ollamaUrl;
            if (ollamaEmbedModel) payload.ollama_embed_model = ollamaEmbedModel;
            if (ollamaChatModel) payload.ollama_chat_model = ollamaChatModel;

            if (Object.keys(payload).length > 0) {
                const res = await fetch("/api/settings", {
                    method: "PUT",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(payload),
                });
                const data = await res.json();
                if (!data.success) {
                    error = data.error || "Failed to save LLM settings.";
                    saving = false;
                    return;
                }
            }

            onStepComplete({ ollamaUrl, ollamaEmbedModel, ollamaChatModel });
        } catch (e) {
            error = "An error occurred while saving.";
        }

        saving = false;
    }
</script>

<div>
    <h2 class="text-2xl font-bold mb-2">AI Features</h2>
    <p class="text-base-content/60 text-sm mb-2">
        Connect an Ollama instance for smart matching, recommendations, and chat
        features.
    </p>
    <p class="text-xs text-base-content/40 mb-6">
        This is optional — Mediajam works great without it.
    </p>

    <div class="p-4 rounded-xl border border-base-300 bg-base-300/20 space-y-4">
        <div class="flex items-center justify-between mb-1">
            <div class="flex items-center gap-3">
                <span class="text-xl">🤖</span>
                <div>
                    <h3 class="font-semibold text-sm">Ollama</h3>
                    <p class="text-xs text-base-content/50">
                        Requires a running Ollama instance with models
                        downloaded.
                    </p>
                </div>
            </div>
            <!-- Scan button -->
            <button
                class="btn btn-ghost btn-xs gap-1"
                disabled={scanStatus === "scanning"}
                onclick={scanForOllama}
            >
                {#if scanStatus === "scanning"}
                    <span class="loading loading-spinner loading-xs"></span>
                    Scanning...
                {:else if scanStatus === "found"}
                    ✓ Found
                {:else if scanStatus === "notfound"}
                    Not found — enter manually
                {:else}
                    <svg
                        xmlns="http://www.w3.org/2000/svg"
                        class="h-3.5 w-3.5"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                    >
                        <circle cx="11" cy="11" r="8" /><line
                            x1="21"
                            y1="21"
                            x2="16.65"
                            y2="16.65"
                        />
                    </svg>
                    Scan network
                {/if}
            </button>
        </div>

        <!-- URL + Test -->
        <div class="form-control">
            <label class="label" for="ollama-url">
                <span class="label-text text-xs font-medium">Server URL</span>
            </label>
            <div class="join w-full">
                <input
                    id="ollama-url"
                    type="url"
                    placeholder="http://192.168.1.50:11434"
                    class="input input-bordered input-sm join-item flex-1"
                    bind:value={ollamaUrl}
                />
                <button
                    class="btn btn-sm btn-outline join-item"
                    disabled={!ollamaUrl || healthStatus === "checking"}
                    onclick={testConnection}
                >
                    {#if healthStatus === "checking"}
                        <span class="loading loading-spinner loading-xs"></span>
                    {:else if healthStatus === "ok"}
                        ✓ Connected
                    {:else if healthStatus === "error"}
                        ✗ Retry
                    {:else}
                        Test
                    {/if}
                </button>
            </div>
            {#if healthStatus === "ok"}
                <span class="text-xs text-success mt-1"
                    >Connected — {healthModels.length} models available</span
                >
            {:else if healthStatus === "error"}
                <span class="text-xs text-error mt-1">{healthError}</span>
            {/if}
        </div>

        <!-- Model dropdowns (only shown after successful connection) -->
        {#if healthStatus === "ok" && healthModels.length > 0}
            <div class="grid grid-cols-2 gap-3">
                <div class="form-control">
                    <label class="label" for="embed-model">
                        <span class="label-text text-xs font-medium"
                            >Embedding Model</span
                        >
                    </label>
                    {#if embedModels.length > 0}
                        <select
                            id="embed-model"
                            class="select select-bordered select-sm w-full"
                            bind:value={ollamaEmbedModel}
                        >
                            {#each embedModels as model}
                                <option value={model}
                                    >{modelLabel(model)}</option
                                >
                            {/each}
                        </select>
                    {:else}
                        <input
                            id="embed-model"
                            type="text"
                            placeholder="nomic-embed-text"
                            class="input input-bordered input-sm w-full"
                            bind:value={ollamaEmbedModel}
                        />
                        <span class="text-xs text-warning mt-1"
                            >No embedding models found — enter manually or pull
                            one</span
                        >
                    {/if}
                </div>
                <div class="form-control">
                    <label class="label" for="chat-model">
                        <span class="label-text text-xs font-medium"
                            >Chat Model</span
                        >
                    </label>
                    {#if chatModels.length > 0}
                        <select
                            id="chat-model"
                            class="select select-bordered select-sm w-full"
                            bind:value={ollamaChatModel}
                        >
                            {#each chatModels as model}
                                <option value={model}
                                    >{modelLabel(model)}</option
                                >
                            {/each}
                        </select>
                    {:else}
                        <input
                            id="chat-model"
                            type="text"
                            placeholder="llama3.2:3b"
                            class="input input-bordered input-sm w-full"
                            bind:value={ollamaChatModel}
                        />
                        <span class="text-xs text-warning mt-1"
                            >No chat models found — enter manually or pull one</span
                        >
                    {/if}
                </div>
            </div>
        {:else if healthStatus !== "ok"}
            <!-- Show text inputs when not connected -->
            <div class="grid grid-cols-2 gap-3">
                <div class="form-control">
                    <label class="label" for="embed-model-text">
                        <span class="label-text text-xs font-medium"
                            >Embedding Model</span
                        >
                    </label>
                    <input
                        id="embed-model-text"
                        type="text"
                        placeholder="nomic-embed-text"
                        class="input input-bordered input-sm w-full"
                        bind:value={ollamaEmbedModel}
                    />
                </div>
                <div class="form-control">
                    <label class="label" for="chat-model-text">
                        <span class="label-text text-xs font-medium"
                            >Chat Model</span
                        >
                    </label>
                    <input
                        id="chat-model-text"
                        type="text"
                        placeholder="llama3.2:3b"
                        class="input input-bordered input-sm w-full"
                        bind:value={ollamaChatModel}
                    />
                </div>
            </div>
        {/if}

        <a
            href="https://ollama.ai"
            target="_blank"
            rel="noopener noreferrer"
            class="link link-primary text-xs inline-flex items-center gap-1"
        >
            Learn more about Ollama
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
            Skip
        </button>
        <button
            class="btn btn-primary flex-1"
            disabled={saving || !ollamaUrl}
            onclick={saveAndContinue}
        >
            {#if saving}
                <span class="loading loading-spinner loading-sm"></span>
            {/if}
            Save & Continue
        </button>
    </div>
</div>
