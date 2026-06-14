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
	import SidebarHealth from "$lib/components/SidebarHealth.svelte";
	import MdiIcon from "$lib/components/MdiIcon.svelte";
	import { mdiHome, mdiFormatListBulleted, mdiTelevision, mdiMovie, mdiMusic, mdiMagnify, mdiCalendar, mdiChartBar, mdiGraphOutline, mdiAccount, mdiKey, mdiDatabase, mdiWhiteBalanceSunny, mdiLogout, mdiHandWave, mdiEmoticonCoolOutline, mdiBell, mdiArrowLeft } from '@mdi/js';
	import { addToast } from "$lib/stores/toast.js";
	import { jellyfinAuthInvalid } from "$lib/stores/auth.js";
	import { notificationCount } from "$lib/stores/notifications.js";
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

	// User menu popup state
	let userMenuOpen = $state(false);
	let userMenuView = $state('main'); // 'main' | 'notifications'
	let userMenuPos = $state({ bottom: 8, left: 208 });
	function openUserMenu(/** @type {HTMLElement} */ btn) {
		const rect = btn.closest('.sidebar-user-wrap')?.getBoundingClientRect();
		if (rect) {
			userMenuPos = { bottom: window.innerHeight - rect.top + 4, left: rect.left };
		}
		if (!userMenuOpen) userMenuView = 'main';
		userMenuOpen = !userMenuOpen;
	}

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
	<div class="app-shell">
		<!-- Left Sidebar -->
		<nav class="sidebar">
			<!-- Logo -->
			<a href="/" class="sidebar-logo">
				<img src="/favicon.png" alt="Mediajam" class="sidebar-logo-img" />
				<span class="sidebar-logo-text">Mediajam</span>
			</a>

			<!-- Primary Nav -->
			<div class="sidebar-nav">
				{#if data.showWelcome}
					<a href="/welcome" class="sidebar-link" class:active={currentPath === '/welcome'}>
						<MdiIcon icon={mdiHandWave} size={18} />
						<span class="sidebar-label">Welcome</span>
					</a>
				{/if}
				<a href="/" class="sidebar-link" class:active={currentPath === '/'}>
					<MdiIcon icon={mdiHome} size={18} />
					<span class="sidebar-label">Dashboard</span>
				</a>
				<a href="/history" class="sidebar-link" class:active={currentPath === '/history'}>
					<MdiIcon icon={mdiFormatListBulleted} size={18} />
					<span class="sidebar-label">History</span>
				</a>

				<div class="sidebar-divider"></div>

				<a href="/tv" class="sidebar-link" class:active={currentPath.startsWith('/tv')}>
					<MdiIcon icon={mdiTelevision} size={18} style="color: oklch(var(--color-tv))" />
					<span class="sidebar-label">TV</span>
				</a>
				<a href="/movies" class="sidebar-link" class:active={currentPath.startsWith('/movies')}>
					<MdiIcon icon={mdiMovie} size={18} style="color: oklch(var(--color-movies))" />
					<span class="sidebar-label">Movies</span>
				</a>
				<a href="/music" class="sidebar-link" class:active={currentPath.startsWith('/music')}>
					<MdiIcon icon={mdiMusic} size={18} style="color: oklch(var(--color-music))" />
					<span class="sidebar-label">Music</span>
				</a>

				<div class="sidebar-divider"></div>

				<a href="/wanted" class="sidebar-link" class:active={currentPath === '/wanted'}>
					<MdiIcon icon={mdiMagnify} size={18} />
					<span class="sidebar-label">Wanted</span>
				</a>
				<a href="/calendar" class="sidebar-link" class:active={currentPath === '/calendar'}>
					<MdiIcon icon={mdiCalendar} size={18} />
					<span class="sidebar-label">Calendar</span>
				</a>
				<a href="/stats" class="sidebar-link" class:active={currentPath === '/stats'}>
					<MdiIcon icon={mdiChartBar} size={18} />
					<span class="sidebar-label">Stats</span>
				</a>
				<a href="/connections" class="sidebar-link" class:active={currentPath === '/connections'}>
					<MdiIcon icon={mdiGraphOutline} size={18} />
					<span class="sidebar-label">6°</span>
				</a>
			</div>

			<!-- Service Health -->
			<SidebarHealth />

			<!-- Bottom section -->
			<div class="sidebar-bottom">
				<!-- User menu -->
				<div class="sidebar-user-wrap">
					<div
						tabindex="0"
						role="button"
						class="sidebar-user-btn"
						onclick={(e) => openUserMenu(e.currentTarget)}
						onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') openUserMenu(e.currentTarget); }}
					>
						<div class="sidebar-avatar-wrap">
							{#if data.user?.avatarUrl?.startsWith("/api/")}
								<img
									src={data.user.avatarUrl}
									alt=""
									class="sidebar-avatar"
								/>
							{:else}
								<div class="sidebar-avatar-placeholder">
									{#if data.user?.avatarUrl?.startsWith("icon:")}
										<span class="text-xs">{data.user.avatarUrl.split(":")[1]}</span>
									{:else}
										<MdiIcon icon={mdiEmoticonCoolOutline} size={14} />
									{/if}
								</div>
							{/if}
							<ActivityLog initialUnread={data.activityUnread} {conflictDialog} badgeOnly />
						</div>
						<span class="sidebar-label sidebar-username">{data.user?.username || "User"}</span>
					</div>
			</div>
		</nav>

		<!-- User menu popup (outside sidebar to escape backdrop-filter containment) -->
		{#if userMenuOpen}
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<!-- svelte-ignore a11y_click_events_have_key_events -->
			<div class="user-menu-backdrop" onclick={() => { userMenuOpen = false; }}></div>
			<div class="user-menu-popup" style="bottom: {userMenuPos.bottom}px; left: {userMenuPos.left}px;">
				{#if userMenuView === 'main'}
					<ul class="menu bg-base-200 rounded-box w-56 p-2 shadow-xl border border-base-300">
						<li><a href="/settings/account" onclick={() => { userMenuOpen = false; }}><MdiIcon icon={mdiAccount} size={16} /> Account</a></li>
						<li><a href="/settings/admin?tab=creds-local" onclick={() => { userMenuOpen = false; }}><MdiIcon icon={mdiKey} size={16} /> Credentials</a></li>
						<li><a href="/settings/admin?tab=sync" onclick={() => { userMenuOpen = false; }}><MdiIcon icon={mdiDatabase} size={16} /> Data</a></li>
						<li><a href="/settings/display" onclick={() => { userMenuOpen = false; }}><MdiIcon icon={mdiWhiteBalanceSunny} size={16} /> Display</a></li>
						<div class="divider my-0"></div>
						<li>
							<button onclick={() => { userMenuView = 'notifications'; }}>
								<MdiIcon icon={mdiBell} size={16} />
								{$notificationCount > 0 ? `${$notificationCount} Notification${$notificationCount !== 1 ? 's' : ''}` : 'Notifications'}
							</button>
						</li>
						<div class="divider my-0"></div>
						<li>
							<a
								href="/login"
								role="button"
								class="text-error/70 hover:text-error"
								onclick={async (e) => { e.preventDefault(); userMenuOpen = false; await fetch('/api/auth/logout', { method: 'POST' }); window.location.href = '/login'; }}
							>
								<MdiIcon icon={mdiLogout} size={16} /> Logout
							</a>
						</li>
					</ul>
				{:else}
					<div class="bg-base-200 rounded-box w-80 shadow-xl border border-base-300 overflow-hidden">
						<button class="flex items-center gap-2 px-4 py-2.5 text-sm text-base-content/60 hover:text-base-content w-full border-b border-base-300 transition-colors" onclick={() => { userMenuView = 'main'; }}>
							<MdiIcon icon={mdiArrowLeft} size={16} /> Back
						</button>
						<ActivityLog initialUnread={data.activityUnread} {conflictDialog} inline />
					</div>
				{/if}
			</div>
		{/if}

		<!-- Main area -->
		<div class="main-area">
			<!-- Top bar: search -->
			<div class="main-topbar">
				<SearchBar />
			</div>

			<!-- Global loading bar -->
			{#if $navigating}
				<div class="nav-loading-bar"></div>
			{/if}

			<!-- Jellyfin Re-auth Banner -->
			{#if $jellyfinAuthInvalid && !reauthDismissed}
				<div class="bg-warning/10 border-b border-warning/30 px-6 py-3">
					<div class="flex items-center gap-3 max-w-4xl mx-auto">
						<MdiIcon icon={mdiKey} size={20} class="text-warning" />
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
			<main class="main-content">
				{@render children()}
			</main>

			<SyncFooter />
			<NowPlayingBar remoteControlEnabled={$page.data.remoteControlEnabled} />
			<ToastContainer />
			<ChatWidget llmConfigured={data.llmConfigured} />
			<ConflictDialog bind:this={conflictDialog} />
		</div>
	</div>
{:else}
	{@render children()}
{/if}

<style>
	/* ══════════════ APP SHELL ══════════════ */
	.app-shell {
		display: flex;
		min-height: 100vh;
	}

	/* ══════════════ SIDEBAR ══════════════ */
	.sidebar {
		position: fixed;
		top: 0;
		left: 0;
		bottom: 0;
		width: 200px;
		display: flex;
		flex-direction: column;
		background: oklch(var(--b2) / 0.9);
		backdrop-filter: blur(20px);
		-webkit-backdrop-filter: blur(20px);
		border-right: 1px solid oklch(var(--bc) / 0.08);
		z-index: 50;
		padding: 0.75rem 0.5rem;
		overflow-y: auto;
		scrollbar-width: none;
	}
	.sidebar::-webkit-scrollbar { display: none; }

	/* ── Logo ── */
	.sidebar-logo {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem 0.6rem;
		margin-bottom: 0.75rem;
		text-decoration: none;
	}
	.sidebar-logo-img {
		width: 28px;
		height: 28px;
		border-radius: 0.4rem;
		flex-shrink: 0;
	}
	.sidebar-logo-text {
		font-size: 1rem;
		font-weight: 800;
		letter-spacing: -0.02em;
		color: oklch(var(--bc));
	}

	/* ── Nav Links ── */
	.sidebar-nav {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
	}
	.sidebar-link {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		padding: 0.45rem 0.6rem;
		border-radius: 0.5rem;
		font-size: 0.8rem;
		font-weight: 500;
		color: oklch(var(--bc) / 0.6);
		text-decoration: none;
		transition: all 0.15s;
		white-space: nowrap;
	}
	.sidebar-link:hover {
		background: oklch(var(--bc) / 0.06);
		color: oklch(var(--bc) / 0.9);
	}
	.sidebar-link.active {
		background: oklch(var(--p) / 0.15);
		color: oklch(var(--p));
		font-weight: 600;
		border-left: 3px solid oklch(var(--p));
		padding-left: calc(0.6rem - 3px);
	}
	.sidebar-label {
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.sidebar-divider {
		height: 1px;
		background: oklch(var(--bc) / 0.08);
		margin: 0.4rem 0.6rem;
	}

	/* ── Bottom ── */
	.sidebar-bottom {
		position: relative;
		padding-top: 0.5rem;
		border-top: 1px solid oklch(var(--bc) / 0.08);
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}

	/* ── User ── */
	.sidebar-user-wrap {
		width: 100%;
	}
	.sidebar-user-btn {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.4rem 0.6rem;
		border-radius: 0.5rem;
		cursor: pointer;
		transition: background 0.15s;
		width: 100%;
	}
	.sidebar-user-btn:hover {
		background: oklch(var(--bc) / 0.06);
	}
	.sidebar-avatar {
		width: 26px;
		height: 26px;
		border-radius: 50%;
		object-fit: cover;
		flex-shrink: 0;
	}
	.sidebar-avatar-placeholder {
		width: 26px;
		height: 26px;
		border-radius: 50%;
		background: oklch(var(--p));
		color: oklch(var(--pc));
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
	}
	.sidebar-username {
		font-size: 0.75rem;
		font-weight: 600;
		color: oklch(var(--bc) / 0.7);
	}
	.sidebar-avatar-wrap {
		position: relative;
		flex-shrink: 0;
	}

	/* ── User Menu Popup ── */
	.user-menu-backdrop {
		position: fixed;
		inset: 0;
		z-index: 999;
	}
	.user-menu-popup {
		position: fixed;
		z-index: 1000;
	}
	.user-menu-notif-item {
		padding: 0;
	}
	.user-menu-notif-item :global(.relative) {
		width: 100%;
	}
	.user-menu-notif-item :global(.btn) {
		width: 100%;
		justify-content: flex-start;
		border-radius: 0.5rem;
	}
	/* ══════════════ MAIN AREA ══════════════ */
	.main-area {
		margin-left: 200px;
		flex: 1;
		display: flex;
		flex-direction: column;
		min-height: 100vh;
	}
	.main-topbar {
		position: sticky;
		top: 0;
		z-index: 40;
		padding: 0.6rem 1.5rem;
		background: oklch(var(--b1) / 0.85);
		backdrop-filter: blur(12px);
		-webkit-backdrop-filter: blur(12px);
		border-bottom: 1px solid oklch(var(--bc) / 0.06);
	}
	.main-content {
		flex: 1;
		padding-top: 1rem;
	}

	/* ══════════════ MOBILE: sidebar collapses to icons ══════════════ */
	@media (max-width: 767px) {
		.sidebar {
			width: 52px;
			padding: 0.5rem 0.25rem;
		}
		.sidebar-logo-text,
		.sidebar-label {
			display: none;
		}
		.sidebar-logo {
			justify-content: center;
			padding: 0.4rem;
		}
		.sidebar-logo-img {
			width: 24px;
			height: 24px;
		}
		.sidebar-link {
			justify-content: center;
			padding: 0.5rem;
		}
		.sidebar-user-btn {
			justify-content: center;
			padding: 0.4rem;
		}
		.sidebar-bottom-row {
			flex-direction: column;
			padding: 0;
		}
		.main-area {
			margin-left: 52px;
		}
	}
</style>

