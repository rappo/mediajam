<script>
	/** @type {{ wizardData: any, onStepComplete: (data: any) => void }} */
	let { wizardData, onStepComplete } = $props();

	let jellyfinUrl = $state(wizardData.jellyfinUrl || "");
	let isProbing = $state(true);
	let probeResults = $state([]);
	let selectedUrl = $state("");
	let manualEntry = $state(false);
	let serverInfo = $state(null);
	let error = $state("");
	let validating = $state(false);

	// Import from backup
	let showImport = $state(false);
	let importingBackup = $state(false);
	let importError = $state("");

	async function importBackup(event) {
		const file = event.target?.files?.[0];
		if (!file) return;
		importingBackup = true;
		importError = "";
		try {
			const res = await fetch("/api/backup/import?mode=overwrite", {
				method: "POST",
				body: file,
			});

			if (res.status === 413) {
				importError = `File too large (${(file.size / 1024 / 1024).toFixed(1)} MB). The server rejected the upload.`;
			} else if (res.status === 403) {
				importError =
					"Permission denied. Only admins can import backups.";
			} else if (!res.ok) {
				let detail = "";
				try {
					const body = await res.json();
					detail = body.error || JSON.stringify(body);
				} catch {
					detail = await res.text().catch(() => `HTTP ${res.status}`);
				}
				importError = `Import failed (${res.status}): ${detail}`;
			} else {
				const result = await res.json();
				if (result.success) {
					window.location.href = "/";
				} else {
					importError =
						result.error || "Import completed but reported errors.";
				}
			}
		} catch (e) {
			if (e instanceof TypeError && e.message.includes("fetch")) {
				importError = "Network error — could not reach the server.";
			} else {
				importError =
					e instanceof Error
						? e.message
						: "An unexpected error occurred.";
			}
		}
		importingBackup = false;
	}

	const DEFAULT_PROBES = [
		"http://localhost:8096",
	];

	async function probeServers() {
		isProbing = true;
		probeResults = [];
		error = "";

		try {
			const res = await fetch("/api/setup/discover", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ urls: DEFAULT_PROBES }),
			});
			const data = await res.json();
			probeResults = data.results || [];
		} catch (e) {
			console.error("Probe failed:", e);
		}

		isProbing = false;

		// Auto-advance when exactly one server found
		const found = probeResults.filter((r) => r.success);
		if (found.length === 1) {
			validateAndContinue(found[0].url);
			return;
		}

		if (probeResults.length === 0 || found.length === 0) {
			manualEntry = true;
		}
	}

	async function validateAndContinue(url) {
		validating = true;
		error = "";

		try {
			const res = await fetch("/api/setup/discover", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ urls: [url], validate: true }),
			});
			const data = await res.json();

			if (
				data.results &&
				data.results.length > 0 &&
				data.results[0].success
			) {
				serverInfo = data.results[0].info;
				onStepComplete({ jellyfinUrl: url });
			} else {
				error =
					"Could not connect to Jellyfin server at this URL. Please check the address and try again.";
			}
		} catch (e) {
			error = "Connection failed. Please verify the URL is correct.";
		}

		validating = false;
	}

	// Start probing on mount
	$effect(() => {
		probeServers();
	});
</script>

<div>
	<h2 class="text-2xl font-bold mb-2">Find Your Jellyfin Server</h2>
	<p class="text-base-content/60 text-sm mb-6">
		We'll search your network for a running Jellyfin instance.
	</p>

	{#if isProbing}
		<div class="flex flex-col items-center py-10">
			<span class="loading loading-spinner loading-lg text-primary"
			></span>
			<p class="text-sm text-base-content/60 mt-4">
				Scanning network for Jellyfin servers...
			</p>
			<div class="flex gap-2 mt-3">
				{#each DEFAULT_PROBES as url}
					<span class="badge badge-outline badge-sm">{url}</span>
				{/each}
			</div>
		</div>
	{:else if probeResults.length > 0 && !manualEntry}
		<div class="space-y-3 mb-6">
			<div class="flex items-center gap-2 text-success mb-4">
				<svg
					xmlns="http://www.w3.org/2000/svg"
					class="h-5 w-5"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
				>
					<path d="M22 11.08V12a10 10 0 11-5.93-9.14" />
					<polyline points="22 4 12 14.01 9 11.01" />
				</svg>
				<span class="font-medium text-sm">Jellyfin server found!</span>
			</div>

			{#each probeResults as result}
				{#if result.success}
					<div
						class="card bg-base-300/50 border border-primary/30 hover:border-primary/60 transition-all cursor-pointer"
						role="button"
						tabindex="0"
						onclick={() => validateAndContinue(result.url)}
						onkeydown={(e) =>
							e.key === "Enter" &&
							validateAndContinue(result.url)}
					>
						<div class="card-body p-4 flex-row items-center gap-4">
							<div
								class="w-10 h-10 rounded-xl bg-primary/20 flex items-center justify-center"
							>
								<svg
									xmlns="http://www.w3.org/2000/svg"
									class="h-5 w-5 text-primary"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									stroke-width="2"
								>
									<rect
										x="2"
										y="2"
										width="20"
										height="8"
										rx="2"
										ry="2"
									/><rect
										x="2"
										y="14"
										width="20"
										height="8"
										rx="2"
										ry="2"
									/><line
										x1="6"
										y1="6"
										x2="6.01"
										y2="6"
									/><line x1="6" y1="18" x2="6.01" y2="18" />
								</svg>
							</div>
							<div class="flex-1">
								<h3 class="font-semibold">
									{result.info?.ServerName ||
										"Jellyfin Server"}
								</h3>
								<p class="text-xs text-base-content/50">
									{result.url} • v{result.info?.Version ||
										"unknown"}
								</p>
							</div>
							<svg
								xmlns="http://www.w3.org/2000/svg"
								class="h-5 w-5 text-base-content/30"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								stroke-width="2"
							>
								<polyline points="9 18 15 12 9 6" />
							</svg>
						</div>
					</div>
				{/if}
			{/each}
		</div>

		<div class="divider text-xs">OR</div>
		<button
			class="btn btn-ghost btn-sm w-full"
			onclick={() => {
				manualEntry = true;
			}}
		>
			Enter URL manually
		</button>
	{:else}
		<!-- Manual Entry -->
		<div class="space-y-4">
			{#if probeResults.length === 0}
				<div class="alert alert-info alert-sm">
					<svg
						xmlns="http://www.w3.org/2000/svg"
						class="h-5 w-5 shrink-0"
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
					<span class="text-sm"
						>No Jellyfin server found automatically. Please enter
						the URL manually.</span
					>
				</div>
			{/if}

			<div class="form-control">
				<label class="label" for="jellyfin-url">
					<span class="label-text font-medium"
						>Jellyfin Server URL</span
					>
				</label>
				<input
					id="jellyfin-url"
					type="url"
					placeholder="http://192.168.1.100:8096"
					class="input input-bordered w-full"
					bind:value={jellyfinUrl}
					onkeydown={(e) =>
						e.key === "Enter" &&
						jellyfinUrl &&
						validateAndContinue(jellyfinUrl)}
				/>
				<label class="label" for="jellyfin-url">
					<span class="label-text-alt text-base-content/40"
						>Include the port number (default: 8096)</span
					>
				</label>
			</div>

			{#if error}
				<div class="alert alert-error alert-sm">
					<svg
						xmlns="http://www.w3.org/2000/svg"
						class="h-5 w-5 shrink-0"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
					>
						<circle cx="12" cy="12" r="10" /><line
							x1="15"
							y1="9"
							x2="9"
							y2="15"
						/><line x1="9" y1="9" x2="15" y2="15" />
					</svg>
					<span class="text-sm">{error}</span>
				</div>
			{/if}

			<div class="flex gap-3">
				{#if probeResults.length > 0}
					<button
						class="btn btn-ghost"
						onclick={() => {
							manualEntry = false;
						}}>Back</button
					>
				{/if}
				<button
					class="btn btn-primary flex-1"
					disabled={!jellyfinUrl || validating}
					onclick={() => validateAndContinue(jellyfinUrl)}
				>
					{#if validating}
						<span class="loading loading-spinner loading-sm"></span>
					{/if}
					Connect
				</button>
			</div>
		</div>
	{/if}

	{#if validating && !manualEntry}
		<div class="flex justify-center mt-4">
			<span class="loading loading-spinner loading-sm text-primary"
			></span>
			<span class="text-sm text-base-content/60 ml-2">Connecting...</span>
		</div>
	{/if}

	<!-- Import from backup -->
	<div class="mt-6 pt-4 border-t border-base-300/50 text-center">
		{#if !showImport}
			<button
				class="btn btn-ghost btn-xs text-base-content/40 gap-1"
				onclick={() => (showImport = true)}
			>
				<svg
					xmlns="http://www.w3.org/2000/svg"
					class="w-3.5 h-3.5"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"
					><path
						d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"
					/><polyline points="17 8 12 3 7 8" /><line
						x1="12"
						y1="3"
						x2="12"
						y2="15"
					/></svg
				>
				Import Data from another install
			</button>
		{:else}
			<div class="space-y-2">
				<p class="text-xs text-base-content/50">
					Upload a Mediajam backup ZIP to restore all data and skip
					setup.
				</p>
				{#if importingBackup}
					<div class="flex items-center justify-center gap-2">
						<span
							class="loading loading-spinner loading-sm text-primary"
						></span>
						<span class="text-sm text-base-content/60"
							>Importing...</span
						>
					</div>
				{:else}
					<input
						type="file"
						accept=".zip"
						class="file-input file-input-xs file-input-bordered"
						onchange={importBackup}
					/>
				{/if}
				{#if importError}
					<p class="text-xs text-error">{importError}</p>
				{/if}
			</div>
		{/if}
	</div>
</div>
