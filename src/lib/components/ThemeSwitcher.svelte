<script>
	/** @type {{ themes: string[], currentTheme: string, onThemeChange: (theme: string) => void }} */
	let { themes, currentTheme, onThemeChange } = $props();
</script>

<div class="dropdown dropdown-end">
	<div tabindex="0" role="button" class="btn btn-ghost btn-sm gap-2">
		<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
			<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
		</svg>
		<span class="hidden sm:inline text-xs capitalize">{currentTheme}</span>
		<svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3 opacity-60" viewBox="0 0 24 24" fill="currentColor">
			<path d="M7 10l5 5 5-5z"/>
		</svg>
	</div>
	<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
	<ul tabindex="0" class="dropdown-content z-[1] menu menu-sm p-2 shadow-2xl bg-base-200 rounded-box w-56 max-h-80 overflow-y-auto flex-nowrap">
		{#each themes as theme}
			<li>
				<button
					class="flex items-center gap-3"
					class:active={currentTheme === theme}
					onclick={() => onThemeChange(theme)}
				>
					<div class="flex gap-0.5 rounded-md overflow-hidden h-5" data-theme={theme}>
						<span class="w-2 bg-primary"></span>
						<span class="w-2 bg-secondary"></span>
						<span class="w-2 bg-accent"></span>
						<span class="w-2 bg-neutral"></span>
					</div>
					<span class="capitalize text-xs flex-1">{theme}</span>
					{#if currentTheme === theme}
						<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-success" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
							<polyline points="20 6 9 17 4 12"/>
						</svg>
					{/if}
				</button>
			</li>
		{/each}
	</ul>
</div>
