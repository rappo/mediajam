<script>
    /**
     * Dialog for selecting quality profile and monitor level before adding media to *arr.
     * Fetches profiles from /api/arr/[service]/defaults, checks skip-dialog preference,
     * and either auto-adds or shows dropdowns.
     *
     * @component
     * @example
     * <ArrAddDialog service="radarr" mediaParentId={42} onComplete={() => invalidateAll()} />
     */

    /** @type {{ service: string, mediaParentId: number, onComplete?: () => void }} */
    let { service, mediaParentId, onComplete } = $props();

    let open = $state(false);
    let loading = $state(false);
    let adding = $state(false);
    let error = $state("");
    /** @type {any[]} */
    let profiles = $state([]);
    /** @type {any[]} */
    let rootFolders = $state([]);
    let selectedProfileId = $state(0);
    let selectedRootFolder = $state("");
    let selectedMonitor = $state("");

    const serviceLabel =
        service === "radarr"
            ? "Radarr"
            : service === "sonarr"
              ? "Sonarr"
              : "Lidarr";

    /** @type {Record<string, { value: string, label: string }[]>} */
    const monitorOptions = {
        radarr: [
            { value: "movieOnly", label: "Movie Only" },
            { value: "movieAndCollection", label: "Movie & Collection" },
            { value: "none", label: "None" },
        ],
        sonarr: [
            { value: "all", label: "All Episodes" },
            { value: "future", label: "Future Episodes" },
            { value: "missing", label: "Missing Episodes" },
            { value: "existing", label: "Existing Episodes" },
            { value: "firstSeason", label: "First Season" },
            { value: "lastSeason", label: "Last Season" },
            { value: "pilot", label: "Pilot Only" },
            { value: "none", label: "None" },
        ],
        lidarr: [
            { value: "all", label: "All Albums" },
            { value: "future", label: "Future Albums" },
            { value: "missing", label: "Missing Albums" },
            { value: "existing", label: "Existing Albums" },
            { value: "first", label: "First Album" },
            { value: "latest", label: "Latest Album" },
            { value: "none", label: "None" },
        ],
    };

    const options = monitorOptions[service] || monitorOptions.radarr;

    /** Svelte action: portal – moves the node to document.body */
    function portal(node) {
        document.body.appendChild(node);
        return {
            destroy() {
                node.remove();
            },
        };
    }

    async function openDialog() {
        loading = true;
        error = "";
        selectedMonitor = options[0]?.value || "all";
        try {
            const res = await fetch(`/api/arr/${service}/defaults`);
            if (!res.ok) throw new Error("Failed to fetch profiles");
            const data = await res.json();
            profiles = data.profiles || [];
            rootFolders = data.rootFolders || [];
            selectedProfileId = data.defaultQualityProfileId || profiles[0]?.id || 0;
            selectedRootFolder = data.defaultRootFolder || rootFolders[0]?.path || "";
            selectedMonitor = data.defaultMonitor || options[0]?.value || "all";

            // If skip dialog is enabled, go straight to adding
            if (data.skipDialog && selectedProfileId) {
                loading = false;
                await addToArr();
                return;
            }
        } catch (e) {
            error = e instanceof Error ? e.message : "Failed";
        }
        loading = false;
        open = true;
    }

    async function addToArr() {
        adding = true;
        error = "";
        try {
            const res = await fetch(`/api/arr/${service}/add`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    mediaParentId,
                    qualityProfileId: selectedProfileId,
                    rootFolderPath: selectedRootFolder,
                    monitorLevel: selectedMonitor,
                }),
            });
            const result = await res.json();
            if (!res.ok) throw new Error(result.error || "Failed");
            open = false;
            onComplete?.();
        } catch (e) {
            error = e instanceof Error ? e.message : "Failed";
            // If we were in skip-dialog mode and it failed, show the dialog
            if (!open) {
                open = true;
            }
        }
        adding = false;
    }

    function close() {
        open = false;
        error = "";
    }
</script>

<button
    class="btn btn-xs btn-primary gap-1"
    onclick={openDialog}
    disabled={adding || loading}
>
    {#if adding || loading}
        <span class="loading loading-spinner loading-xs"></span>
    {:else}
        ✨
    {/if}
    Add to {serviceLabel}
</button>

{#if open}
    <!-- Portal: rendered at document.body so it escapes the gear dropdown -->
    <div use:portal>
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div class="modal modal-open" style="z-index: 1000;">
            <div class="modal-box max-w-md" onclick={(e) => e.stopPropagation()}>
                <h3 class="font-bold text-lg">Add to {serviceLabel}</h3>
                <p class="text-xs text-base-content/50 mt-1">Will automatically search for downloads after adding</p>

                {#if loading}
                    <div class="flex justify-center py-6">
                        <span class="loading loading-spinner loading-md"></span>
                    </div>
                {:else if error && profiles.length === 0}
                    <div class="alert alert-error mt-3 text-sm">{error}</div>
                    <div class="modal-action">
                        <button class="btn btn-sm" onclick={close}>Close</button>
                    </div>
                {:else}
                    <div class="space-y-4 mt-4">
                        <div class="form-control">
                            <label class="label" for="qp-select">
                                <span class="label-text"
                                    >Quality Profile</span
                                >
                            </label>
                            <select
                                id="qp-select"
                                class="select select-bordered w-full"
                                bind:value={selectedProfileId}
                            >
                                {#each profiles as p}
                                    <option value={p.id}>{p.name}</option>
                                {/each}
                            </select>
                        </div>

                        <div class="form-control">
                            <label class="label" for="mon-select">
                                <span class="label-text">Monitor</span>
                            </label>
                            <select
                                id="mon-select"
                                class="select select-bordered w-full"
                                bind:value={selectedMonitor}
                            >
                                {#each options as opt}
                                    <option value={opt.value}>{opt.label}</option>
                                {/each}
                            </select>
                        </div>

                        {#if rootFolders.length > 1}
                            <div class="form-control">
                                <label class="label" for="rf-select">
                                    <span class="label-text"
                                        >Root Folder</span
                                    >
                                </label>
                                <select
                                    id="rf-select"
                                    class="select select-bordered w-full"
                                    bind:value={selectedRootFolder}
                                >
                                    {#each rootFolders as rf}
                                        <option value={rf.path}>{rf.path}</option>
                                    {/each}
                                </select>
                            </div>
                        {/if}

                        {#if error}
                            <div class="alert alert-error text-sm py-2">
                                {error}
                            </div>
                        {/if}
                    </div>

                    <div class="modal-action">
                        <button class="btn btn-ghost" onclick={close}
                            >Cancel</button
                        >
                        <button
                            class="btn btn-primary"
                            onclick={addToArr}
                            disabled={adding || !selectedProfileId}
                        >
                            {#if adding}
                                <span class="loading loading-spinner loading-xs"
                                ></span>
                            {/if}
                            Add & Search
                        </button>
                    </div>

                    <p class="text-[10px] text-base-content/40 mt-2">
                        💡 Set defaults in Settings → Media Management to skip this dialog
                    </p>
                {/if}
            </div>
            <div class="modal-backdrop" onclick={close}></div>
        </div>
    </div>
{/if}
