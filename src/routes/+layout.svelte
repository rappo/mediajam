<script>
	import '../app.css';
	import ThemeSwitcher from '$lib/components/ThemeSwitcher.svelte';

	/** @type {{ data: import('./$types').LayoutData, children: import('svelte').Snippet }} */
	let { data, children } = $props();

	const DAISY_THEMES = [
		'light', 'dark', 'cupcake', 'bumblebee', 'emerald', 'corporate',
		'synthwave', 'retro', 'cyberpunk', 'valentine', 'halloween',
		'garden', 'forest', 'aqua', 'lofi', 'pastel', 'fantasy',
		'wireframe', 'black', 'luxury', 'dracula', 'cmyk', 'autumn',
		'business', 'acid', 'lemonade', 'night', 'coffee', 'winter',
		'dim', 'nord', 'sunset'
	];

	let currentTheme = $state(data.theme);

	async function setTheme(theme) {
		currentTheme = theme;
		document.documentElement.setAttribute('data-theme', theme);
		await fetch('/api/settings', {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ theme })
		});
	}
</script>

{#if data.isSetupComplete}
	<div class="min-h-screen bg-base-100 flex flex-col">
		<!-- Navbar -->
		<nav class="navbar bg-base-200/80 backdrop-blur-lg border-b border-base-300 sticky top-0 z-50 px-6">
			<div class="flex-1 gap-3">
				<div class="flex items-center gap-3">
					<div class="w-9 h-9 rounded-xl bg-gradient-to-br from-primary to-secondary flex items-center justify-center">
						<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-primary-content" viewBox="0 0 24 24" fill="currentColor">
							<path d="M4 8V6a2 2 0 012-2h2M4 16v2a2 2 0 002 2h2M16 4h2a2 2 0 012 2v2M16 20h2a2 2 0 002-2v-2M9 12h6M12 9v6"/>
						</svg>
					</div>
					<span class="text-xl font-bold tracking-tight bg-gradient-to-r from-primary to-secondary bg-clip-text text-transparent">
						Mediajam
					</span>
				</div>
			</div>

			<!-- Tab Navigation -->
			<div class="flex-none">
				<div role="tablist" class="tabs tabs-boxed bg-base-300/50 mr-4">
					<a href="/tv" role="tab" class="tab tab-sm font-medium">
						<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 mr-1.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
							<rect x="2" y="7" width="20" height="15" rx="2" ry="2"/><polyline points="17 2 12 7 7 2"/>
						</svg>
						TV
					</a>
					<a href="/movies" role="tab" class="tab tab-sm font-medium">
						<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 mr-1.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
							<rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"/><line x1="7" y1="2" x2="7" y2="22"/><line x1="17" y1="2" x2="17" y2="22"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="2" y1="7" x2="7" y2="7"/><line x1="2" y1="17" x2="7" y2="17"/><line x1="17" y1="7" x2="22" y2="7"/><line x1="17" y1="17" x2="22" y2="17"/>
						</svg>
						Movies
					</a>
					<a href="/music" role="tab" class="tab tab-sm font-medium">
						<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 mr-1.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
							<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>
						</svg>
						Music
					</a>
				</div>
			</div>

			<!-- Theme & Settings -->
			<div class="flex-none flex items-center gap-2">
				<ThemeSwitcher themes={DAISY_THEMES} {currentTheme} onThemeChange={setTheme} />
				<a href="/settings" class="btn btn-ghost btn-sm btn-circle">
					<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
						<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z"/>
					</svg>
				</a>
			</div>
		</nav>

		<!-- Main Content -->
		<main class="flex-1">
			{@render children()}
		</main>
	</div>
{:else}
	{@render children()}
{/if}
