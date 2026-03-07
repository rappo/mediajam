<script>
    import { page } from '$app/stores';
    import LogConsole from '$lib/components/LogConsole.svelte';

    /** @type {{ data: import('./$types').PageData }} */
    let { data } = $props();

    // Section completion state (persisted in localStorage)
    const STORAGE_KEY = 'mediajam_welcome_sections';

    function loadCompleted() {
        try {
            return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
        } catch { return {}; }
    }

    let completed = $state(loadCompleted());

    function markComplete(section) {
        completed = { ...completed, [section]: true };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(completed));
    }

    const SECTIONS = ['apiKeys', 'integrations', 'history', 'arr', 'llm', 'finalSync'];
    let allComplete = $derived(SECTIONS.every(s => completed[s]));

    // Track expanded section (only one at a time, auto-open first incomplete)
    let expandedSection = $state(SECTIONS.find(s => !completed[s]) || null);

    // ─── Form State ──────────────────────────────────────────────────────────────
    // API Keys
    let tvdbApiKey = $state(data.settings.tvdbApiKey || '');
    let tmdbApiKey = $state(data.settings.tmdbApiKey || '');
    let musicbrainzApiKey = $state(data.settings.musicbrainzApiKey || '');
    let omdbApiKey = $state(data.settings.omdbApiKey || '');
    let discogsToken = $state(data.settings.discogsToken || '');

    // Integrations
    let traktClientId = $state(data.settings.traktClientId || '');
    let traktClientSecret = $state(data.settings.traktClientSecret || '');
    let lastfmApiKey = $state(data.settings.lastfmApiKey || '');
    let lastfmSharedSecret = $state(data.settings.lastfmSharedSecret || '');

    // *arr
    let radarrUrl = $state(data.settings.radarrUrl || '');
    let radarrApiKey = $state(data.settings.radarrApiKey || '');
    let sonarrUrl = $state(data.settings.sonarrUrl || '');
    let sonarrApiKey = $state(data.settings.sonarrApiKey || '');
    let lidarrUrl = $state(data.settings.lidarrUrl || '');
    let lidarrApiKey = $state(data.settings.lidarrApiKey || '');

    // LLM
    let ollamaUrl = $state(data.settings.ollamaUrl || '');
    let ollamaEmbedModel = $state(data.settings.ollamaEmbedModel || 'nomic-embed-text');
    let ollamaChatModel = $state(data.settings.ollamaChatModel || 'llama3.2:3b');

    // ─── Save helpers ────────────────────────────────────────────────────────────
    let saving = $state(false);
    let saveError = $state('');

    async function saveSettings(fields) {
        saving = true;
        saveError = '';
        try {
            const res = await fetch('/api/settings', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(fields),
            });
            const result = await res.json();
            if (!result.success) {
                saveError = result.error || 'Failed to save settings.';
                saving = false;
                return false;
            }
            saving = false;
            return true;
        } catch (e) {
            saveError = e instanceof Error ? e.message : 'Save failed.';
            saving = false;
            return false;
        }
    }

    // ─── Section Actions ─────────────────────────────────────────────────────────

    async function saveApiKeys() {
        const ok = await saveSettings({
            tvdb_api_key: tvdbApiKey,
            tmdb_api_key: tmdbApiKey,
            musicbrainz_api_key: musicbrainzApiKey,
            omdb_api_key: omdbApiKey,
            discogs_token: discogsToken,
        });
        if (ok) {
            markComplete('apiKeys');
            expandedSection = SECTIONS.find(s => !completed[s] && s !== 'apiKeys') || null;
        }
    }

    async function saveIntegrations() {
        const ok = await saveSettings({
            trakt_client_id: traktClientId,
            trakt_client_secret: traktClientSecret,
            lastfm_api_key: lastfmApiKey,
            lastfm_shared_secret: lastfmSharedSecret,
        });
        if (ok) {
            markComplete('integrations');
            expandedSection = SECTIONS.find(s => !completed[s] && s !== 'integrations') || null;
        }
    }

    async function saveArr() {
        const ok = await saveSettings({
            radarr_url: radarrUrl,
            radarr_api_key: radarrApiKey,
            sonarr_url: sonarrUrl,
            sonarr_api_key: sonarrApiKey,
            lidarr_url: lidarrUrl,
            lidarr_api_key: lidarrApiKey,
        });
        if (ok) {
            markComplete('arr');
            expandedSection = SECTIONS.find(s => !completed[s] && s !== 'arr') || null;
        }
    }

    async function saveLLM() {
        const ok = await saveSettings({
            ollama_url: ollamaUrl,
            ollama_embed_model: ollamaEmbedModel,
            ollama_chat_model: ollamaChatModel,
        });
        if (ok) {
            markComplete('llm');
            expandedSection = SECTIONS.find(s => !completed[s] && s !== 'llm') || null;
        }
    }

    function skip(section) {
        markComplete(section);
        expandedSection = SECTIONS.find(s => !completed[s] && s !== section) || null;
    }

    // ─── Final Sync ──────────────────────────────────────────────────────────────
    let finalSyncStatus = $state('idle'); // idle | syncing | complete | error
    let finalSyncLogs = $state([]);
    let finalSyncStep = $state(''); // Current step description

    function addFinalLog(message, type = 'info') {
        const timestamp = new Date().toLocaleTimeString();
        finalSyncLogs = [...finalSyncLogs, { timestamp, message, type }];
    }

    async function runFinalSync() {
        finalSyncStatus = 'syncing';
        finalSyncLogs = [];

        try {
            // Step 1: Incremental Jellyfin sync
            finalSyncStep = 'Syncing Jellyfin libraries...';
            addFinalLog('Starting incremental Jellyfin sync...');
            const syncRes = await fetch('/api/sync', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'start' }),
            });
            if (syncRes.ok) {
                addFinalLog('Jellyfin sync started. Waiting for completion...');
                // Wait for sync to finish by polling
                await waitForSyncComplete();
                addFinalLog('Jellyfin sync complete.', 'success');
            } else {
                addFinalLog('Jellyfin sync may already be running — continuing.', 'warning');
            }

            // Step 2: People enrichment (if never run and TMDB key exists)
            if (!data.hasPeopleSync && tmdbApiKey) {
                finalSyncStep = 'Enriching people data from TMDB...';
                addFinalLog('Starting people enrichment (first time)...');
                const peopleRes = await fetch('/api/sync/people', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: 'start' }),
                });
                if (peopleRes.ok) {
                    addFinalLog('People enrichment started. This may take a while...');
                    await waitForPeopleSyncComplete();
                    addFinalLog('People enrichment complete.', 'success');
                } else {
                    addFinalLog('People enrichment skipped (may already be running).', 'warning');
                }
            } else if (data.hasPeopleSync) {
                addFinalLog('People enrichment already done — skipping.', 'info');
            } else {
                addFinalLog('People enrichment skipped — no TMDB API key configured.', 'info');
            }

            // Step 3: MusicBrainz enrichment (if never run)
            if (!data.hasMusicBrainzSync) {
                finalSyncStep = 'Enriching music data from MusicBrainz...';
                addFinalLog('Starting MusicBrainz enrichment (first time)...');
                const mbRes = await fetch('/api/sync/musicbrainz', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: 'start' }),
                });
                if (mbRes.ok) {
                    addFinalLog('MusicBrainz enrichment started...');
                    await waitForMBSyncComplete();
                    addFinalLog('MusicBrainz enrichment complete.', 'success');
                } else {
                    addFinalLog('MusicBrainz enrichment skipped (may already be running).', 'warning');
                }
            } else {
                addFinalLog('MusicBrainz enrichment already done — skipping.', 'info');
            }

            // Step 4: Reconciliation (always last)
            finalSyncStep = 'Running data reconciliation...';
            addFinalLog('Starting reconciliation...');
            const reconRes = await fetch('/api/reconcile', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'start' }),
            });
            if (reconRes.ok) {
                addFinalLog('Reconciliation started...');
                // Just wait a bit — reconciliation runs in background
                await new Promise(r => setTimeout(r, 2000));
                addFinalLog('Reconciliation is running in the background.', 'success');
            } else {
                addFinalLog('Reconciliation may already be running.', 'warning');
            }

            finalSyncStep = 'All done!';
            finalSyncStatus = 'complete';
            addFinalLog('🎉 All sync steps completed!', 'success');
            markComplete('finalSync');
        } catch (e) {
            finalSyncStatus = 'error';
            addFinalLog('Error: ' + (e instanceof Error ? e.message : String(e)), 'error');
        }
    }

    async function waitForSyncComplete() {
        // Poll sync state for up to 5 minutes
        for (let i = 0; i < 60; i++) {
            await new Promise(r => setTimeout(r, 5000));
            try {
                const res = await fetch('/api/sync/status');
                if (res.ok) {
                    const status = await res.json();
                    if (status.status === 'idle' || status.status === 'complete') return;
                }
            } catch { /* continue polling */ }
        }
    }

    async function waitForPeopleSyncComplete() {
        for (let i = 0; i < 120; i++) {
            await new Promise(r => setTimeout(r, 5000));
            try {
                const res = await fetch('/api/sync/people/status');
                if (res.ok) {
                    const status = await res.json();
                    if (status.status === 'idle' || status.status === 'complete' || status.status === 'error') return;
                }
            } catch { /* continue polling */ }
        }
    }

    async function waitForMBSyncComplete() {
        for (let i = 0; i < 120; i++) {
            await new Promise(r => setTimeout(r, 5000));
            try {
                const res = await fetch('/api/sync/musicbrainz/status');
                if (res.ok) {
                    const status = await res.json();
                    if (status.status === 'idle' || status.status === 'complete' || status.status === 'error') return;
                }
            } catch { /* continue polling */ }
        }
    }

    async function finishWelcome() {
        await saveSettings({ welcome_complete: 1 });
        localStorage.removeItem(STORAGE_KEY);
        window.location.href = '/history';
    }
</script>

<svelte:head>
    <title>Welcome — Mediajam</title>
</svelte:head>

<div class="max-w-3xl mx-auto p-6 py-10">
    {#if allComplete}
        <!-- All done! -->
        <div class="text-center py-16 space-y-6">
            <div class="text-7xl">🎉</div>
            <h1 class="text-4xl font-extrabold tracking-tight bg-gradient-to-r from-primary via-secondary to-accent bg-clip-text text-transparent">
                You're all set!
            </h1>
            <p class="text-base-content/60 text-lg max-w-md mx-auto">
                Mediajam is configured and your data is syncing. Everything configured here can be changed later in Settings.
            </p>
            <button class="btn btn-primary btn-lg gap-2" onclick={finishWelcome}>
                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="20 6 9 17 4 12" />
                </svg>
                Go to Mediajam
            </button>
        </div>
    {:else}
        <!-- Header -->
        <div class="mb-8">
            <h1 class="text-3xl font-bold flex items-center gap-3">
                <span class="text-3xl">👋</span>
                Welcome to Mediajam
            </h1>
            <p class="text-base-content/60 text-sm mt-2">
                Your Jellyfin data is syncing in the background. Let's set up the rest — everything here is optional and can be changed later in Settings.
            </p>
            <div class="flex items-center gap-2 mt-4">
                <progress class="progress progress-primary flex-1" value={SECTIONS.filter(s => completed[s]).length} max={SECTIONS.length}></progress>
                <span class="text-xs text-base-content/40">{SECTIONS.filter(s => completed[s]).length}/{SECTIONS.length}</span>
            </div>
        </div>

        <div class="space-y-4">

            <!-- ═══ Section 1: API Keys ═══ -->
            <div class="card bg-base-200/50 border border-base-300 overflow-hidden">
                <button
                    class="w-full flex items-center gap-3 px-5 py-4 hover:bg-base-300/30 transition-colors text-left"
                    onclick={() => expandedSection = expandedSection === 'apiKeys' ? null : 'apiKeys'}
                >
                    {#if completed.apiKeys}
                        <span class="text-lg">✅</span>
                    {:else}
                        <span class="text-lg">🔑</span>
                    {/if}
                    <span class="font-medium flex-1">Metadata API Keys</span>
                    <span class="text-xs text-base-content/40">TVDB, TMDB, MusicBrainz, OMDb, Discogs</span>
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-base-content/30 transition-transform" class:rotate-180={expandedSection === 'apiKeys'} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9" /></svg>
                </button>

                {#if expandedSection === 'apiKeys'}
                    <div class="px-5 pb-5 space-y-3 border-t border-base-content/5 pt-4">
                        <p class="text-xs text-base-content/50">These keys enrich your media with posters, ratings, and metadata. They're free to obtain from each service's website.</p>

                        <div class="grid gap-3 sm:grid-cols-2">
                            <label class="form-control">
                                <div class="label py-1"><span class="label-text text-xs">TMDB API Key</span></div>
                                <input type="text" class="input input-sm input-bordered font-mono" placeholder="Enter key..." bind:value={tmdbApiKey} />
                            </label>
                            <label class="form-control">
                                <div class="label py-1"><span class="label-text text-xs">TVDB API Key</span></div>
                                <input type="text" class="input input-sm input-bordered font-mono" placeholder="Enter key..." bind:value={tvdbApiKey} />
                            </label>
                            <label class="form-control">
                                <div class="label py-1"><span class="label-text text-xs">MusicBrainz App Name</span></div>
                                <input type="text" class="input input-sm input-bordered font-mono" placeholder="MyApp/1.0" bind:value={musicbrainzApiKey} />
                            </label>
                            <label class="form-control">
                                <div class="label py-1"><span class="label-text text-xs">OMDb API Key</span></div>
                                <input type="text" class="input input-sm input-bordered font-mono" placeholder="Enter key..." bind:value={omdbApiKey} />
                            </label>
                            <label class="form-control sm:col-span-2">
                                <div class="label py-1"><span class="label-text text-xs">Discogs Token</span></div>
                                <input type="text" class="input input-sm input-bordered font-mono" placeholder="Enter token..." bind:value={discogsToken} />
                            </label>
                        </div>

                        {#if saveError}<p class="text-xs text-error">{saveError}</p>{/if}

                        <div class="flex gap-2 pt-1">
                            <button class="btn btn-primary btn-sm gap-1" onclick={saveApiKeys} disabled={saving}>
                                {#if saving}<span class="loading loading-spinner loading-xs"></span>{/if}
                                Save & Continue
                            </button>
                            <button class="btn btn-ghost btn-sm" onclick={() => skip('apiKeys')}>Skip for Now</button>
                        </div>
                    </div>
                {/if}
            </div>

            <!-- ═══ Section 2: Integrations ═══ -->
            <div class="card bg-base-200/50 border border-base-300 overflow-hidden">
                <button
                    class="w-full flex items-center gap-3 px-5 py-4 hover:bg-base-300/30 transition-colors text-left"
                    onclick={() => expandedSection = expandedSection === 'integrations' ? null : 'integrations'}
                >
                    {#if completed.integrations}
                        <span class="text-lg">✅</span>
                    {:else}
                        <span class="text-lg">🔗</span>
                    {/if}
                    <span class="font-medium flex-1">Integrations</span>
                    <span class="text-xs text-base-content/40">Trakt, Last.fm</span>
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-base-content/30 transition-transform" class:rotate-180={expandedSection === 'integrations'} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9" /></svg>
                </button>

                {#if expandedSection === 'integrations'}
                    <div class="px-5 pb-5 space-y-3 border-t border-base-content/5 pt-4">
                        <p class="text-xs text-base-content/50">Connect Trakt and Last.fm to import your watch & listen history. You can connect the accounts themselves after saving these keys, from Settings → Account.</p>

                        <h4 class="text-xs font-semibold text-base-content/70 pt-1">Trakt</h4>
                        <div class="grid gap-3 sm:grid-cols-2">
                            <label class="form-control">
                                <div class="label py-1"><span class="label-text text-xs">Client ID</span></div>
                                <input type="text" class="input input-sm input-bordered font-mono" placeholder="Trakt Client ID" bind:value={traktClientId} />
                            </label>
                            <label class="form-control">
                                <div class="label py-1"><span class="label-text text-xs">Client Secret</span></div>
                                <input type="text" class="input input-sm input-bordered font-mono" placeholder="Trakt Client Secret" bind:value={traktClientSecret} />
                            </label>
                        </div>

                        <h4 class="text-xs font-semibold text-base-content/70 pt-1">Last.fm</h4>
                        <div class="grid gap-3 sm:grid-cols-2">
                            <label class="form-control">
                                <div class="label py-1"><span class="label-text text-xs">API Key</span></div>
                                <input type="text" class="input input-sm input-bordered font-mono" placeholder="Last.fm API Key" bind:value={lastfmApiKey} />
                            </label>
                            <label class="form-control">
                                <div class="label py-1"><span class="label-text text-xs">Shared Secret</span></div>
                                <input type="text" class="input input-sm input-bordered font-mono" placeholder="Last.fm Shared Secret" bind:value={lastfmSharedSecret} />
                            </label>
                        </div>

                        {#if saveError}<p class="text-xs text-error">{saveError}</p>{/if}

                        <div class="flex gap-2 pt-1">
                            <button class="btn btn-primary btn-sm gap-1" onclick={saveIntegrations} disabled={saving}>
                                {#if saving}<span class="loading loading-spinner loading-xs"></span>{/if}
                                Save & Continue
                            </button>
                            <button class="btn btn-ghost btn-sm" onclick={() => skip('integrations')}>Skip for Now</button>
                        </div>
                    </div>
                {/if}
            </div>

            <!-- ═══ Section 3: History Import ═══ -->
            <div class="card bg-base-200/50 border border-base-300 overflow-hidden">
                <button
                    class="w-full flex items-center gap-3 px-5 py-4 hover:bg-base-300/30 transition-colors text-left"
                    onclick={() => expandedSection = expandedSection === 'history' ? null : 'history'}
                >
                    {#if completed.history}
                        <span class="text-lg">✅</span>
                    {:else}
                        <span class="text-lg">📊</span>
                    {/if}
                    <span class="font-medium flex-1">History Import</span>
                    <span class="text-xs text-base-content/40">Trakt & Last.fm watch/listen history</span>
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-base-content/30 transition-transform" class:rotate-180={expandedSection === 'history'} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9" /></svg>
                </button>

                {#if expandedSection === 'history'}
                    <div class="px-5 pb-5 space-y-3 border-t border-base-content/5 pt-4">
                        <p class="text-xs text-base-content/50">
                            Import your watch and listen history from Trakt and Last.fm. You'll need to connect those services first from Settings → Account.
                        </p>
                        <p class="text-xs text-base-content/40">
                            You can trigger history imports anytime from Settings → Account. For now, skip this step and come back to it once Trakt/Last.fm are connected.
                        </p>

                        <div class="flex gap-2 pt-1">
                            <button class="btn btn-ghost btn-sm" onclick={() => skip('history')}>Skip for Now</button>
                        </div>
                    </div>
                {/if}
            </div>

            <!-- ═══ Section 4: *arr Collection Management ═══ -->
            <div class="card bg-base-200/50 border border-base-300 overflow-hidden">
                <button
                    class="w-full flex items-center gap-3 px-5 py-4 hover:bg-base-300/30 transition-colors text-left"
                    onclick={() => expandedSection = expandedSection === 'arr' ? null : 'arr'}
                >
                    {#if completed.arr}
                        <span class="text-lg">✅</span>
                    {:else}
                        <span class="text-lg">📦</span>
                    {/if}
                    <span class="font-medium flex-1">Collection Management</span>
                    <span class="text-xs text-base-content/40">Radarr, Sonarr, Lidarr</span>
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-base-content/30 transition-transform" class:rotate-180={expandedSection === 'arr'} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9" /></svg>
                </button>

                {#if expandedSection === 'arr'}
                    <div class="px-5 pb-5 space-y-3 border-t border-base-content/5 pt-4">
                        <p class="text-xs text-base-content/50">Connect your *arr instances to track collection status and manage requests.</p>

                        <h4 class="text-xs font-semibold text-base-content/70">Radarr</h4>
                        <div class="grid gap-3 sm:grid-cols-2">
                            <label class="form-control">
                                <div class="label py-1"><span class="label-text text-xs">URL</span></div>
                                <input type="text" class="input input-sm input-bordered font-mono" placeholder="http://localhost:7878" bind:value={radarrUrl} />
                            </label>
                            <label class="form-control">
                                <div class="label py-1"><span class="label-text text-xs">API Key</span></div>
                                <input type="text" class="input input-sm input-bordered font-mono" placeholder="API key" bind:value={radarrApiKey} />
                            </label>
                        </div>

                        <h4 class="text-xs font-semibold text-base-content/70">Sonarr</h4>
                        <div class="grid gap-3 sm:grid-cols-2">
                            <label class="form-control">
                                <div class="label py-1"><span class="label-text text-xs">URL</span></div>
                                <input type="text" class="input input-sm input-bordered font-mono" placeholder="http://localhost:8989" bind:value={sonarrUrl} />
                            </label>
                            <label class="form-control">
                                <div class="label py-1"><span class="label-text text-xs">API Key</span></div>
                                <input type="text" class="input input-sm input-bordered font-mono" placeholder="API key" bind:value={sonarrApiKey} />
                            </label>
                        </div>

                        <h4 class="text-xs font-semibold text-base-content/70">Lidarr</h4>
                        <div class="grid gap-3 sm:grid-cols-2">
                            <label class="form-control">
                                <div class="label py-1"><span class="label-text text-xs">URL</span></div>
                                <input type="text" class="input input-sm input-bordered font-mono" placeholder="http://localhost:8686" bind:value={lidarrUrl} />
                            </label>
                            <label class="form-control">
                                <div class="label py-1"><span class="label-text text-xs">API Key</span></div>
                                <input type="text" class="input input-sm input-bordered font-mono" placeholder="API key" bind:value={lidarrApiKey} />
                            </label>
                        </div>

                        {#if saveError}<p class="text-xs text-error">{saveError}</p>{/if}

                        <div class="flex gap-2 pt-1">
                            <button class="btn btn-primary btn-sm gap-1" onclick={saveArr} disabled={saving}>
                                {#if saving}<span class="loading loading-spinner loading-xs"></span>{/if}
                                Save & Continue
                            </button>
                            <button class="btn btn-ghost btn-sm" onclick={() => skip('arr')}>Skip for Now</button>
                        </div>
                    </div>
                {/if}
            </div>

            <!-- ═══ Section 5: AI / LLM ═══ -->
            <div class="card bg-base-200/50 border border-base-300 overflow-hidden">
                <button
                    class="w-full flex items-center gap-3 px-5 py-4 hover:bg-base-300/30 transition-colors text-left"
                    onclick={() => expandedSection = expandedSection === 'llm' ? null : 'llm'}
                >
                    {#if completed.llm}
                        <span class="text-lg">✅</span>
                    {:else}
                        <span class="text-lg">🤖</span>
                    {/if}
                    <span class="font-medium flex-1">AI / Local LLM</span>
                    <span class="text-xs text-base-content/40">Ollama for search & tagging</span>
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-base-content/30 transition-transform" class:rotate-180={expandedSection === 'llm'} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9" /></svg>
                </button>

                {#if expandedSection === 'llm'}
                    <div class="px-5 pb-5 space-y-3 border-t border-base-content/5 pt-4">
                        <p class="text-xs text-base-content/50">Connect a local Ollama instance for AI-powered search and auto-tagging. Requires Ollama running on your network.</p>

                        <div class="grid gap-3 sm:grid-cols-2">
                            <label class="form-control sm:col-span-2">
                                <div class="label py-1"><span class="label-text text-xs">Ollama URL</span></div>
                                <input type="text" class="input input-sm input-bordered font-mono" placeholder="http://localhost:11434" bind:value={ollamaUrl} />
                            </label>
                            <label class="form-control">
                                <div class="label py-1"><span class="label-text text-xs">Embedding Model</span></div>
                                <input type="text" class="input input-sm input-bordered font-mono" bind:value={ollamaEmbedModel} />
                            </label>
                            <label class="form-control">
                                <div class="label py-1"><span class="label-text text-xs">Chat Model</span></div>
                                <input type="text" class="input input-sm input-bordered font-mono" bind:value={ollamaChatModel} />
                            </label>
                        </div>

                        {#if saveError}<p class="text-xs text-error">{saveError}</p>{/if}

                        <div class="flex gap-2 pt-1">
                            <button class="btn btn-primary btn-sm gap-1" onclick={saveLLM} disabled={saving}>
                                {#if saving}<span class="loading loading-spinner loading-xs"></span>{/if}
                                Save & Continue
                            </button>
                            <button class="btn btn-ghost btn-sm" onclick={() => skip('llm')}>Skip for Now</button>
                        </div>
                    </div>
                {/if}
            </div>

            <!-- ═══ Section 6: Final Sync ═══ -->
            <div class="card bg-base-200/50 border border-primary/20 overflow-hidden">
                <button
                    class="w-full flex items-center gap-3 px-5 py-4 hover:bg-base-300/30 transition-colors text-left"
                    onclick={() => expandedSection = expandedSection === 'finalSync' ? null : 'finalSync'}
                >
                    {#if completed.finalSync}
                        <span class="text-lg">✅</span>
                    {:else}
                        <span class="text-lg">🔄</span>
                    {/if}
                    <span class="font-medium flex-1">Finish Setup</span>
                    <span class="text-xs text-base-content/40">Sync, enrich, reconcile</span>
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-base-content/30 transition-transform" class:rotate-180={expandedSection === 'finalSync'} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9" /></svg>
                </button>

                {#if expandedSection === 'finalSync'}
                    <div class="px-5 pb-5 space-y-3 border-t border-base-content/5 pt-4">
                        <p class="text-xs text-base-content/50">
                            This will run an incremental Jellyfin sync to catch up any new items, then enrich with people and music data (if not done before), and finally reconcile everything.
                        </p>

                        {#if finalSyncStatus === 'idle'}
                            <button class="btn btn-primary btn-sm gap-2" onclick={runFinalSync}>
                                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" /><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
                                </svg>
                                Run Final Sync
                            </button>
                        {:else}
                            <div class="space-y-2">
                                <div class="flex items-center gap-2 text-sm">
                                    {#if finalSyncStatus === 'syncing'}
                                        <span class="loading loading-spinner loading-xs text-primary"></span>
                                    {:else if finalSyncStatus === 'complete'}
                                        <span>✅</span>
                                    {:else}
                                        <span>❌</span>
                                    {/if}
                                    <span class="font-medium">{finalSyncStep}</span>
                                </div>
                                <LogConsole logs={finalSyncLogs} running={finalSyncStatus === 'syncing'} title="Sync Log" height="h-48" />
                            </div>
                        {/if}
                    </div>
                {/if}
            </div>

        </div>

        <!-- Skip all button at the bottom -->
        <div class="text-center mt-8">
            <button class="btn btn-ghost btn-sm text-base-content/40" onclick={finishWelcome}>
                Skip everything & go to Mediajam →
            </button>
        </div>
    {/if}
</div>
