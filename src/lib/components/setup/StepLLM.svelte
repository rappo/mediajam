<script>
    /** @type {{ wizardData: any, onStepComplete: (data: any) => void, onBack: () => void }} */
    let { wizardData, onStepComplete, onBack } = $props();

    const PROVIDERS = [
        { value: 'ollama', label: 'Ollama', sub: 'local / self-hosted', icon: '🦙' },
        { value: 'openai', label: 'OpenAI', sub: 'GPT-4o, GPT-4.1', icon: '🤖' },
        { value: 'gemini', label: 'Gemini', sub: 'Google AI', icon: '💎' },
        { value: 'claude', label: 'Claude', sub: 'Anthropic', icon: '🧠' },
        { value: 'kimi', label: 'Kimi', sub: 'Moonshot AI', icon: '🌙' },
        { value: 'litellm', label: 'LiteLLM', sub: 'proxy / gateway', icon: '🔀' },
    ];

    // svelte-ignore state_referenced_locally
    let provider = $state(wizardData.llmProvider || 'ollama');
    let saving = $state(false);
    let error = $state('');

    // Ollama-specific
    // svelte-ignore state_referenced_locally
    let ollamaUrl = $state(wizardData.ollamaUrl || '');
    // svelte-ignore state_referenced_locally
    let ollamaEmbedModel = $state(wizardData.ollamaEmbedModel || 'nomic-embed-text');
    // svelte-ignore state_referenced_locally
    let ollamaChatModel = $state(wizardData.ollamaChatModel || 'llama3.2:3b');
    let healthStatus = $state('idle');
    let healthModels = $state(/** @type {string[]} */ ([]));
    let healthError = $state('');
    let scanStatus = $state('idle');

    // Cloud / LiteLLM
    let apiKey = $state('');
    let apiUrl = $state('');
    let chatModel = $state('');

    const embedModels = $derived(healthModels.filter(m => /embed|minilm|bert/i.test(m)));
    const chatModels = $derived(healthModels.filter(m => !/embed|minilm|bert/i.test(m)));

    const RECOMMENDED_EMBED = 'nomic-embed-text';
    const RECOMMENDED_CHAT = 'llama3.2:3b';

    /** @param {string} model */
    function isRecommended(model) {
        return model.includes(RECOMMENDED_EMBED) || model.includes(RECOMMENDED_CHAT);
    }

    /** @param {string} model */
    function modelLabel(model) {
        return isRecommended(model) ? `⭐ ${model} (recommended)` : model;
    }

    async function testOllamaConnection() {
        if (!ollamaUrl) return;
        healthStatus = 'checking';
        healthError = '';
        try {
            const res = await fetch(`/api/ollama/health?url=${encodeURIComponent(ollamaUrl)}`);
            const data = await res.json();
            if (data.ok) {
                healthStatus = 'ok';
                healthModels = data.models || [];
                if (embedModels.length && !embedModels.includes(ollamaEmbedModel)) {
                    ollamaEmbedModel = embedModels.find(m => m.includes('nomic-embed')) || embedModels[0];
                }
                if (chatModels.length && !chatModels.includes(ollamaChatModel)) {
                    ollamaChatModel = chatModels.find(m => m.includes('llama3.2')) || chatModels[0];
                }
            } else {
                healthStatus = 'error';
                healthError = data.error || 'Connection failed';
            }
        } catch {
            healthStatus = 'error';
            healthError = 'Network error — could not reach the server';
        }
    }

    async function scanForOllama() {
        scanStatus = 'scanning';
        try {
            const res = await fetch('/api/ollama/scan');
            const data = await res.json();
            if (data.found && data.instances?.length) {
                ollamaUrl = data.instances[0].url;
                scanStatus = 'found';
                await testOllamaConnection();
            } else {
                scanStatus = 'notfound';
            }
        } catch {
            scanStatus = 'notfound';
        }
    }

    async function saveAndContinue() {
        saving = true;
        error = '';

        try {
            /** @type {Record<string, any>} */
            const payload = { llm_provider: provider };

            if (provider === 'ollama') {
                if (ollamaUrl) payload.ollama_url = ollamaUrl;
                if (ollamaEmbedModel) payload.ollama_embed_model = ollamaEmbedModel;
                if (ollamaChatModel) payload.ollama_chat_model = ollamaChatModel;
            } else if (provider === 'litellm') {
                if (apiUrl) payload.llm_api_url = apiUrl;
                if (apiKey) payload.litellm_api_key = apiKey;
                if (chatModel) payload.llm_chat_model = chatModel;
            } else {
                // Cloud providers: openai, gemini, claude, kimi
                const keyField = `${provider}_api_key`;
                if (apiKey) payload[keyField] = apiKey;
                if (chatModel) payload.llm_chat_model = chatModel;
            }

            if (Object.keys(payload).length > 1) {
                const res = await fetch('/api/settings', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                });
                const data = await res.json();
                if (!data.success) {
                    error = data.error || 'Failed to save LLM settings.';
                    saving = false;
                    return;
                }
            }

            onStepComplete({ llmProvider: provider });
        } catch {
            error = 'An error occurred while saving.';
        }

        saving = false;
    }

    // Auto-scan for Ollama on mount
    $effect(() => {
        if (provider === 'ollama' && !ollamaUrl) {
            scanForOllama();
        }
    });
</script>

<div>
    <h2 class="text-2xl font-bold mb-2">AI Features</h2>
    <p class="text-base-content/60 text-sm mb-2">
        Connect an AI provider for smart matching, recommendations, and chat features.
    </p>
    <p class="text-xs text-base-content/40 mb-6">
        This is optional — Mediajam works great without it.
    </p>

    <!-- Provider selector -->
    <div class="grid grid-cols-3 gap-2 mb-5">
        {#each PROVIDERS as p}
            <button
                class="flex flex-col items-center gap-1 p-3 rounded-xl border-2 transition-all text-center
                    {provider === p.value
                        ? 'border-primary bg-primary/10 shadow-sm'
                        : 'border-base-300 hover:border-base-content/20 bg-base-300/20'}"
                onclick={() => { provider = p.value; healthStatus = 'idle'; }}
            >
                <span class="text-xl">{p.icon}</span>
                <span class="font-semibold text-xs">{p.label}</span>
                <span class="text-[10px] text-base-content/40 leading-tight">{p.sub}</span>
            </button>
        {/each}
    </div>

    <!-- Provider-specific config -->
    <div class="p-4 rounded-xl border border-base-300 bg-base-300/20 space-y-4">
        {#if provider === 'ollama'}
            <!-- Ollama config -->
            <div class="flex items-center justify-between">
                <span class="text-xs text-base-content/50">Requires a running Ollama instance with models downloaded.</span>
                <button
                    class="btn btn-ghost btn-xs gap-1"
                    disabled={scanStatus === 'scanning'}
                    onclick={scanForOllama}
                >
                    {#if scanStatus === 'scanning'}
                        <span class="loading loading-spinner loading-xs"></span> Scanning...
                    {:else if scanStatus === 'found'}
                        ✓ Found
                    {:else if scanStatus === 'notfound'}
                        Not found
                    {:else}
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
                        </svg>
                        Scan
                    {/if}
                </button>
            </div>

            <div class="form-control">
                <label class="label" for="ollama-url">
                    <span class="label-text text-xs font-medium">Server URL</span>
                </label>
                <div class="join w-full">
                    <input
                        id="ollama-url"
                        type="url"
                        placeholder="http://localhost:11434"
                        class="input input-bordered input-sm join-item flex-1"
                        bind:value={ollamaUrl}
                    />
                    <button
                        class="btn btn-sm btn-outline join-item"
                        disabled={!ollamaUrl || healthStatus === 'checking'}
                        onclick={testOllamaConnection}
                    >
                        {#if healthStatus === 'checking'}
                            <span class="loading loading-spinner loading-xs"></span>
                        {:else if healthStatus === 'ok'}
                            ✓ Connected
                        {:else if healthStatus === 'error'}
                            ✗ Retry
                        {:else}
                            Test
                        {/if}
                    </button>
                </div>
                {#if healthStatus === 'ok'}
                    <span class="text-xs text-success mt-1">Connected — {healthModels.length} models available</span>
                {:else if healthStatus === 'error'}
                    <span class="text-xs text-error mt-1">{healthError}</span>
                {/if}
            </div>

            {#if healthStatus === 'ok' && healthModels.length > 0}
                <div class="grid grid-cols-2 gap-3">
                    <div class="form-control">
                        <label class="label" for="embed-model">
                            <span class="label-text text-xs font-medium">Embedding Model</span>
                        </label>
                        {#if embedModels.length > 0}
                            <select id="embed-model" class="select select-bordered select-sm w-full" bind:value={ollamaEmbedModel}>
                                {#each embedModels as model}
                                    <option value={model}>{modelLabel(model)}</option>
                                {/each}
                            </select>
                        {:else}
                            <input id="embed-model" type="text" placeholder="nomic-embed-text" class="input input-bordered input-sm w-full" bind:value={ollamaEmbedModel} />
                            <span class="text-xs text-warning mt-1">No embedding models found — enter manually or pull one</span>
                        {/if}
                    </div>
                    <div class="form-control">
                        <label class="label" for="chat-model">
                            <span class="label-text text-xs font-medium">Chat Model</span>
                        </label>
                        {#if chatModels.length > 0}
                            <select id="chat-model" class="select select-bordered select-sm w-full" bind:value={ollamaChatModel}>
                                {#each chatModels as model}
                                    <option value={model}>{modelLabel(model)}</option>
                                {/each}
                            </select>
                        {:else}
                            <input id="chat-model" type="text" placeholder="llama3.2:3b" class="input input-bordered input-sm w-full" bind:value={ollamaChatModel} />
                            <span class="text-xs text-warning mt-1">No chat models found — enter manually or pull one</span>
                        {/if}
                    </div>
                </div>
            {:else if healthStatus !== 'ok'}
                <div class="grid grid-cols-2 gap-3">
                    <div class="form-control">
                        <label class="label" for="embed-model-text">
                            <span class="label-text text-xs font-medium">Embedding Model</span>
                        </label>
                        <input id="embed-model-text" type="text" placeholder="nomic-embed-text" class="input input-bordered input-sm w-full" bind:value={ollamaEmbedModel} />
                    </div>
                    <div class="form-control">
                        <label class="label" for="chat-model-text">
                            <span class="label-text text-xs font-medium">Chat Model</span>
                        </label>
                        <input id="chat-model-text" type="text" placeholder="llama3.2:3b" class="input input-bordered input-sm w-full" bind:value={ollamaChatModel} />
                    </div>
                </div>
            {/if}

        {:else if provider === 'litellm'}
            <!-- LiteLLM config -->
            <p class="text-xs text-base-content/50">
                Connect to a self-hosted <a href="https://www.litellm.ai/" target="_blank" class="link link-primary">LiteLLM</a> proxy.
            </p>
            <div class="form-control">
                <label class="label" for="litellm-url">
                    <span class="label-text text-xs font-medium">Proxy URL</span>
                </label>
                <input id="litellm-url" type="url" placeholder="http://localhost:4000" class="input input-bordered input-sm w-full" bind:value={apiUrl} />
            </div>
            <div class="form-control">
                <label class="label" for="litellm-key">
                    <span class="label-text text-xs font-medium">API Key <span class="text-base-content/40">(optional)</span></span>
                </label>
                <input id="litellm-key" type="password" placeholder="sk-..." class="input input-bordered input-sm w-full" bind:value={apiKey} />
            </div>
            <div class="form-control">
                <label class="label" for="litellm-model">
                    <span class="label-text text-xs font-medium">Chat Model</span>
                </label>
                <input id="litellm-model" type="text" placeholder="gpt-4o-mini" class="input input-bordered input-sm w-full" bind:value={chatModel} />
            </div>

        {:else}
            <!-- Cloud providers: openai, gemini, claude, kimi -->
            <div class="form-control">
                <label class="label" for="cloud-key">
                    <span class="label-text text-xs font-medium">{PROVIDERS.find(p => p.value === provider)?.label} API Key</span>
                </label>
                <input id="cloud-key" type="password" placeholder="sk-..." class="input input-bordered input-sm w-full" bind:value={apiKey} />
            </div>
            <div class="form-control">
                <label class="label" for="cloud-model">
                    <span class="label-text text-xs font-medium">Chat Model <span class="text-base-content/40">(optional — uses provider default)</span></span>
                </label>
                <input id="cloud-model" type="text" placeholder={
                    provider === 'openai' ? 'gpt-4o-mini' :
                    provider === 'gemini' ? 'gemini-2.0-flash' :
                    provider === 'claude' ? 'claude-sonnet-4-20250514' :
                    'moonshot-v1-8k'
                } class="input input-bordered input-sm w-full" bind:value={chatModel} />
            </div>
        {/if}
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
            disabled={saving || (provider === 'ollama' && !ollamaUrl) || (provider === 'litellm' && !apiUrl) || (!['ollama', 'litellm'].includes(provider) && !apiKey)}
            onclick={saveAndContinue}
        >
            {#if saving}
                <span class="loading loading-spinner loading-sm"></span>
            {/if}
            Save & Continue
        </button>
    </div>
</div>
