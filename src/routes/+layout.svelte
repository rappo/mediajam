<script>
	import "../app.css";
	import ThemeSwitcher from "$lib/components/ThemeSwitcher.svelte";
	import SearchBar from "$lib/components/SearchBar.svelte";

	/** @type {{ data: import('./$types').LayoutData, children: import('svelte').Snippet }} */
	let { data, children } = $props();

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
</script>

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
					<a
						href="/history"
						role="tab"
						class="tab tab-sm font-medium"
					>
						<svg
							xmlns="http://www.w3.org/2000/svg"
							class="h-4 w-4 mr-1.5"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
						>
							<circle cx="12" cy="12" r="10" /><polyline
								points="12 6 12 12 16 14"
							/>
						</svg>
						History
					</a>
					<a href="/tv" role="tab" class="tab tab-sm font-medium">
						<svg
							xmlns="http://www.w3.org/2000/svg"
							class="h-4 w-4 mr-1.5"
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
					<a href="/movies" role="tab" class="tab tab-sm font-medium">
						<svg
							xmlns="http://www.w3.org/2000/svg"
							class="h-4 w-4 mr-1.5"
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
					<a href="/music" role="tab" class="tab tab-sm font-medium">
						<svg
							xmlns="http://www.w3.org/2000/svg"
							class="h-4 w-4 mr-1.5"
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
				</div>
			</div>

			<!-- Search & Profile -->
			<div class="flex-1 flex items-center justify-end gap-2">
				<SearchBar />
				<div class="dropdown dropdown-end">
					<div
						tabindex="0"
						role="button"
						class="btn btn-ghost btn-sm btn-circle avatar placeholder"
					>
						<div
							class="bg-primary text-primary-content w-8 rounded-full"
						>
							<span class="text-sm font-bold"
								>{data.user?.username
									?.charAt(0)
									?.toUpperCase() || "?"}</span
							>
						</div>
					</div>
					<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
					<ul
						tabindex="0"
						class="dropdown-content menu bg-base-200 rounded-box z-[100] w-56 p-2 shadow-xl border border-base-300 mt-2"
					>
						<li class="menu-title px-3 py-2">
							<div class="flex items-center gap-2">
								<div
									class="bg-primary text-primary-content w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold"
								>
									{data.user?.username
										?.charAt(0)
										?.toUpperCase() || "?"}
								</div>
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
								Account Settings
							</a>
						</li>
						<li>
							<a href="/settings/system">
								<svg
									xmlns="http://www.w3.org/2000/svg"
									class="h-4 w-4"
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
								System Settings
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
								Display Settings
							</a>
						</li>
						<div class="divider my-0"></div>
						<li>
							<form
								method="POST"
								action="/api/auth/logout"
								style="display:contents"
							>
								<button
									type="submit"
									class="text-error/70 hover:text-error"
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
								</button>
							</form>
						</li>
					</ul>
				</div>
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
