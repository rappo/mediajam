<script>
	import "../app.css";
	import ThemeSwitcher from "$lib/components/ThemeSwitcher.svelte";
	import SearchBar from "$lib/components/SearchBar.svelte";
	import SyncFooter from "$lib/components/SyncFooter.svelte";
	import NowPlayingBar from "$lib/components/NowPlayingBar.svelte";
	import ToastContainer from "$lib/components/ToastContainer.svelte";
	import ConflictDialog from "$lib/components/ConflictDialog.svelte";
	import ActivityLog from "$lib/components/ActivityLog.svelte";
	import ChatWidget from "$lib/components/ChatWidget.svelte";
	import { addToast } from "$lib/stores/toast.js";
	import { jellyfinAuthInvalid } from "$lib/stores/auth.js";
	import { page, navigating } from "$app/stores";
	import { afterNavigate } from "$app/navigation";

	// Scroll to top on every navigation
	afterNavigate(() => {
		window.scrollTo({ top: 0, behavior: 'instant' });
		document.documentElement.scrollTop = 0;
		document.body.scrollTop = 0;
	});

	// Dynamic favicon: check nested page data for poster/photo URLs
	let faviconSource = $derived.by(() => {
		const d = $page.data;
		return d?.movie?.posterUrl
			|| d?.show?.posterUrl
			|| d?.album?.artUrl
			|| d?.artist?.imageUrl
			|| d?.person?.photoUrl
			|| null;
	});

	// Canvas-based favicon: maintains aspect ratio by drawing image
	// cover-fit into a 32x32 square, avoiding stretched portraits
	let dynamicFavicon = $state('/favicon.png');
	$effect(() => {
		const src = faviconSource;
		if (!src) {
			dynamicFavicon = '/favicon.png';
			return;
		}
		const img = new Image();
		img.crossOrigin = 'anonymous';
		img.onload = () => {
			try {
				const canvas = document.createElement('canvas');
				canvas.width = 32;
				canvas.height = 32;
				const ctx = canvas.getContext('2d');
				if (!ctx) return;
				// Cover-fit: scale to fill, center crop
				const scale = Math.max(32 / img.width, 32 / img.height);
				const w = img.width * scale;
				const h = img.height * scale;
				ctx.drawImage(img, (32 - w) / 2, (32 - h) / 2, w, h);
				dynamicFavicon = canvas.toDataURL('image/png');
			} catch {
				dynamicFavicon = src; // fallback to raw URL if canvas fails
			}
		};
		img.onerror = () => { dynamicFavicon = '/favicon.png'; };
		img.src = src;
	});

	// Current path for nav active state
	let currentPath = $derived($page.url.pathname);

	/** @type {{ data: import('./$types').LayoutData, children: import('svelte').Snippet }} */
	let { data, children } = $props();

	// Show boot warnings as sticky toasts (once on mount)
	let bootWarningsShown = false;
	$effect(() => {
		if (!bootWarningsShown && data.bootWarnings?.length > 0) {
			bootWarningsShown = true;
			for (const w of data.bootWarnings) {
				addToast({
					type: w.type,
					message: w.message,
					detail: w.detail,
					duration: 0,
				});
			}
		}
	});

	// Init auth store from server data
	$effect(() => {
		if (data.jellyfinAuthInvalid) {
			jellyfinAuthInvalid.set(true);
		}
	});

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

	let currentTheme = $state(data.theme);

	async function setTheme(theme) {
		currentTheme = theme;
		document.documentElement.setAttribute("data-theme", theme);
		await fetch("/api/settings", {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ theme }),
		});
	}

	/** @type {ConflictDialog} */
	let conflictDialog = $state();

	// Allow any child page to open the conflict dialog via a custom event
	$effect(() => {
		/** @param {Event} e */
		function onShowConflict(e) {
			conflictDialog?.show();
		}
		window.addEventListener('show-conflict-dialog', onShowConflict);
		return () => window.removeEventListener('show-conflict-dialog', onShowConflict);
	});

	// Jellyfin re-auth banner
	let reauthPassword = $state('');
	let reauthLoading = $state(false);
	let reauthError = $state('');
	let reauthDismissed = $state(false);

	async function reauthJellyfin() {
		if (!reauthPassword) return;
		reauthLoading = true;
		reauthError = '';
		try {
			const res = await fetch('/api/auth/jellyfin-reauth', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ password: reauthPassword })
			});
			const result = await res.json();
			if (res.ok) {
				reauthDismissed = true;
				reauthPassword = '';
				jellyfinAuthInvalid.set(false);
				addToast({ type: 'success', message: 'Jellyfin connection restored!', duration: 3000 });
				setTimeout(() => window.location.reload(), 1000);
			} else {
				reauthError = result.error || 'Authentication failed';
			}
		} catch {
			reauthError = 'Could not reach server';
		}
		reauthLoading = false;
	}
</script>

<svelte:head>
	<link rel="icon" type="image/png" href={dynamicFavicon} />
</svelte:head>

{#if data.isSetupComplete}
	<div class="min-h-screen bg-base-100 flex flex-col">
		<!-- Navbar -->
		<nav
			class="navbar bg-base-200/80 backdrop-blur-lg border-b border-base-300 sticky top-0 z-50 px-6"
		>
			<div class="flex-1 gap-3">
				<div class="flex items-center gap-3">
					<img
						src="/favicon.png"
						alt="Mediajam"
						class="w-9 h-9 rounded-lg"
					/>
					<span
						class="text-xl font-bold tracking-tight bg-gradient-to-r from-primary to-secondary bg-clip-text text-transparent"
					>
						Mediajam
					</span>
				</div>
			</div>

			<!-- Tab Navigation -->
			<div class="flex-1 flex justify-center">
				<div
					role="tablist"
					class="tabs tabs-boxed bg-base-300/50 flex-nowrap"
				>
					{#if data.showWelcome}
					<a
						href="/welcome"
						role="tab"
						class="tab tab-sm font-medium"
					>
						<span class="mr-1.5">👋</span>
						Welcome
					</a>
					{/if}
					<a
						href="/"
						role="tab"
						class="tab tab-sm font-medium {currentPath === '/' ? 'tab-active' : ''}"
					>
						<svg
							xmlns="http://www.w3.org/2000/svg"
							class="h-4 w-4 mr-1.5"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
							stroke-linejoin="round"
						>
							<path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" /><polyline points="9 22 9 12 15 12 15 22" />
						</svg>
						Dashboard
					</a>
					<a
						href="/history"
						role="tab"
						class="tab tab-sm font-medium {currentPath === '/history' ? 'tab-active' : ''}"
					>
						<svg
							xmlns="http://www.w3.org/2000/svg"
							class="h-4 w-4 mr-1.5"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
						>
							<line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" />
							<circle cx="4" cy="6" r="1" fill="currentColor" /><circle cx="4" cy="12" r="1" fill="currentColor" /><circle cx="4" cy="18" r="1" fill="currentColor" />
						</svg>
						History
					</a>
					<a href="/tv" role="tab" class="tab tab-sm font-medium {currentPath.startsWith('/tv') ? 'tab-active' : ''}">
						<svg
							xmlns="http://www.w3.org/2000/svg"
							class="h-4 w-4 mr-1.5"
							style="color: oklch(var(--color-tv))"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
						>
							<rect
								x="2"
								y="7"
								width="20"
								height="15"
								rx="2"
								ry="2"
							/><polyline points="17 2 12 7 7 2" />
						</svg>
						TV
					</a>
					<a href="/movies" role="tab" class="tab tab-sm font-medium {currentPath.startsWith('/movies') ? 'tab-active' : ''}">
						<svg
							xmlns="http://www.w3.org/2000/svg"
							class="h-4 w-4 mr-1.5"
							style="color: oklch(var(--color-movies))"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
						>
							<rect
								x="2"
								y="2"
								width="20"
								height="20"
								rx="2.18"
								ry="2.18"
							/><line x1="7" y1="2" x2="7" y2="22" /><line
								x1="17"
								y1="2"
								x2="17"
								y2="22"
							/><line x1="2" y1="12" x2="22" y2="12" /><line
								x1="2"
								y1="7"
								x2="7"
								y2="7"
							/><line x1="2" y1="17" x2="7" y2="17" /><line
								x1="17"
								y1="7"
								x2="22"
								y2="7"
							/><line x1="17" y1="17" x2="22" y2="17" />
						</svg>
						Movies
					</a>
					<a href="/music" role="tab" class="tab tab-sm font-medium {currentPath.startsWith('/music') ? 'tab-active' : ''}">
						<svg
							xmlns="http://www.w3.org/2000/svg"
							class="h-4 w-4 mr-1.5"
							style="color: oklch(var(--color-music))"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
						>
							<path d="M9 18V5l12-2v13" /><circle
								cx="6"
								cy="18"
								r="3"
							/><circle cx="18" cy="16" r="3" />
						</svg>
						Music
					</a>
				<div class="dropdown dropdown-end">
					<div tabindex="0" role="button" class="tab tab-sm font-medium {['/stats', '/calendar', '/connections', '/wanted'].some(p => currentPath.startsWith(p)) ? 'tab-active' : ''}">
						<svg
							xmlns="http://www.w3.org/2000/svg"
							class="h-4 w-4 mr-1.5"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
							stroke-linejoin="round"
						>
							<path d="M9 2v6l-2 4v1a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2v-1l-2-4V2" />
							<path d="M8 2h8" />
							<path d="M7 16v2a4 4 0 0 0 4 4h2a4 4 0 0 0 4-4v-2" />
						</svg>
						Experimental
						<svg class="h-3 w-3 ml-0.5 opacity-50" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
					</div>
					<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
					<ul tabindex="0" class="dropdown-content menu bg-base-200 rounded-box z-[60] w-48 p-2 shadow-xl border border-base-content/10 mt-2">
						<li>
							<a href="/wanted" class="{currentPath === '/wanted' ? 'active' : ''}">
								<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
									<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
								</svg>
								Wanted
							</a>
						</li>
						<li>
							<a href="/calendar" class="{currentPath === '/calendar' ? 'active' : ''}">
								<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
									<rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
								</svg>
								Calendar
							</a>
						</li>
						<li>
							<a href="/stats" class="{currentPath === '/stats' ? 'active' : ''}">
								<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
									<path d="M18 20V10" /><path d="M12 20V4" /><path d="M6 20v-6" />
								</svg>
								Stats
							</a>
						</li>
						<li>
							<a href="/connections" class="{currentPath === '/connections' ? 'active' : ''}">
								<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
									<circle cx="5" cy="6" r="3" /><circle cx="19" cy="6" r="3" /><circle cx="12" cy="18" r="3" />
									<path d="M7.5 8 12 15.5 16.5 8" />
								</svg>
								6° of Separation
							</a>
						</li>
					</ul>
				</div>
			</div>
			</div>

			<!-- Search & Profile -->
			<div class="flex-1 flex items-center justify-end gap-2">
				<SearchBar />
				<ActivityLog initialUnread={data.activityUnread} {conflictDialog} />
				<div class="dropdown dropdown-end">
					<div
						tabindex="0"
						role="button"
						class="btn btn-ghost btn-sm btn-circle avatar placeholder"
					>
						{#if data.user?.avatarUrl?.startsWith("/api/")}
							<img
								src={data.user.avatarUrl}
								alt=""
								class="w-8 h-8 rounded-full object-cover"
							/>
						{:else}
							<div
								class="bg-primary text-primary-content w-8 h-8 rounded-full flex items-center justify-center"
							>
								{#if data.user?.avatarUrl?.startsWith("icon:")}
									<span class="text-base"
										>{data.user.avatarUrl.split(
											":",
										)[1]}</span
									>
								{:else}
									<span class="text-base">🤩</span>
								{/if}
							</div>
						{/if}
					</div>
					<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
					<ul
						tabindex="0"
						class="dropdown-content menu bg-base-200 rounded-box z-[100] w-56 p-2 shadow-xl border border-base-300 mt-2"
					>
						<li class="menu-title px-3 py-2">
							<div class="flex items-center gap-2">
								{#if data.user?.avatarUrl?.startsWith("/api/")}
									<img
										src={data.user.avatarUrl}
										alt=""
										class="w-6 h-6 rounded-full object-cover"
									/>
								{:else}
									<div
										class="bg-primary text-primary-content w-6 h-6 rounded-full flex items-center justify-center text-xs"
									>
										{#if data.user?.avatarUrl?.startsWith("icon:")}
											{data.user.avatarUrl.split(":")[1]}
										{:else}
											🤩
										{/if}
									</div>
								{/if}
								<span class="text-base-content font-medium"
									>{data.user?.username || "User"}</span
								>
							</div>
						</li>
						<div class="divider my-0"></div>
						<li>
							<a href="/settings/account">
								<svg
									xmlns="http://www.w3.org/2000/svg"
									class="h-4 w-4"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									stroke-width="2"
								>
									<path
										d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"
									/><circle cx="12" cy="7" r="4" />
								</svg>
								Account
							</a>
						</li>
						<li>
							<a href="/settings/admin?tab=creds-local">
								<svg
									xmlns="http://www.w3.org/2000/svg"
									class="h-4 w-4"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									stroke-width="2"
								>
									<path d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
								</svg>
								Credentials
							</a>
						</li>
						<li>
							<a href="/settings/admin?tab=sync">
								<svg
									xmlns="http://www.w3.org/2000/svg"
									class="h-4 w-4"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									stroke-width="2"
								>
									<path d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4" />
								</svg>
								Data
							</a>
						</li>
						<li>
							<a href="/settings/display">
								<svg
									xmlns="http://www.w3.org/2000/svg"
									class="h-4 w-4"
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
									/><line
										x1="12"
										y1="21"
										x2="12"
										y2="23"
									/><line
										x1="4.22"
										y1="4.22"
										x2="5.64"
										y2="5.64"
									/><line
										x1="18.36"
										y1="18.36"
										x2="19.78"
										y2="19.78"
									/><line
										x1="1"
										y1="12"
										x2="3"
										y2="12"
									/><line
										x1="21"
										y1="12"
										x2="23"
										y2="12"
									/><line
										x1="4.22"
										y1="19.78"
										x2="5.64"
										y2="18.36"
									/><line
										x1="18.36"
										y1="5.64"
										x2="19.78"
										y2="4.22"
									/>
								</svg>
								Display
							</a>
						</li>
						<div class="divider my-0"></div>
						<li>
							<a
							href="/login"
							role="button"
							class="text-error/70 hover:text-error whitespace-nowrap flex items-center gap-2"
							onclick={async (e) => { e.preventDefault(); await fetch('/api/auth/logout', { method: 'POST' }); window.location.href = '/login'; }}
						>
							<svg
								xmlns="http://www.w3.org/2000/svg"
								class="h-4 w-4"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								stroke-width="2"
							>
								<path
									d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"
								/><polyline
									points="16 17 21 12 16 7"
								/><line
									x1="21"
									y1="12"
									x2="9"
									y2="12"
								/>
							</svg>
							Logout
						</a>
						</li>
					</ul>
				</div>
			</div>
		</nav>

		<!-- Global loading bar -->
		{#if $navigating}
			<div class="nav-loading-bar"></div>
		{/if}

		<!-- Jellyfin Re-auth Banner -->
		{#if $jellyfinAuthInvalid && !reauthDismissed}
			<div class="bg-warning/10 border-b border-warning/30 px-6 py-3">
				<div class="flex items-center gap-3 max-w-4xl mx-auto">
					<span class="text-warning text-lg">🔑</span>
					<div class="flex-1 min-w-0">
						<p class="text-sm font-medium">Jellyfin session expired</p>
						<p class="text-xs text-base-content/50">Enter your Jellyfin password to reconnect</p>
					</div>
					<form class="flex items-center gap-2" onsubmit={(e) => { e.preventDefault(); reauthJellyfin(); }}>
						<input
							type="password"
							class="input input-sm input-bordered w-48"
							placeholder="Jellyfin password"
							autocomplete="current-password"
							bind:value={reauthPassword}
						/>
						<button
							type="submit"
							class="btn btn-sm btn-warning"
							disabled={!reauthPassword || reauthLoading}
						>
							{#if reauthLoading}
								<span class="loading loading-spinner loading-xs"></span>
							{:else}
								Reconnect
							{/if}
						</button>
					</form>
					{#if reauthError}
						<span class="text-xs text-error">{reauthError}</span>
					{/if}
				</div>
			</div>
		{/if}

		<!-- Main Content -->
		<main class="flex-1">
			{@render children()}
		</main>

		<SyncFooter />
		<NowPlayingBar remoteControlEnabled={$page.data.remoteControlEnabled} />
		<ToastContainer />
		<ChatWidget llmConfigured={data.llmConfigured} />
		<ConflictDialog bind:this={conflictDialog} />
	</div>
{:else}
	{@render children()}
{/if}
