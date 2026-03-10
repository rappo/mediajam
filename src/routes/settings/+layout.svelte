<script>
    import { page } from "$app/stores";
    import { BUILD_VERSION } from "$lib/version.js";

    /** @type {{ children: import('svelte').Snippet }} */
    let { children } = $props();

    const navItems = [
        {
            href: "/settings/account",
            label: "Account",
            icon: "M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2M12 3a4 4 0 100 8 4 4 0 000-8z",
        },
        {
            href: "/settings/admin",
            label: "Admin",
            icon: "M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065zM15 12a3 3 0 11-6 0 3 3 0 016 0z",
            subsections: [
                { tab: "server", label: "Server" },
                { tab: "credentials", label: "Credentials" },
                { tab: "sync", label: "Data Sync" },
                { tab: "cleanup", label: "Data Clean-up" },
                { tab: "import-export", label: "Import / Export" },
                { tab: "api-keys", label: "API Keys" },
            ],
        },
        {
            href: "/settings/display",
            label: "Display",
            icon: "M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z",
        },
        {
            href: "/settings/debug",
            label: "Debug",
            icon: "M12 20h9M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z",
        },
    ];
</script>

<svelte:head>
    <title>Settings — Mediajam</title>
</svelte:head>

<div class="max-w-5xl mx-auto p-6 py-10">
    <div class="flex items-center gap-3 mb-8">
        <a href="/history" class="btn btn-ghost btn-sm btn-circle">
            <svg
                xmlns="http://www.w3.org/2000/svg"
                class="h-5 w-5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
            >
                <polyline points="15 18 9 12 15 6" />
            </svg>
        </a>
        <h1 class="text-3xl font-bold">Settings</h1>
    </div>

    <div class="flex gap-8">
        <!-- Sidebar -->
        <nav
            class="w-48 shrink-0 sticky top-20 self-start max-h-[calc(100vh-6rem)] overflow-y-auto"
        >
            <ul class="menu bg-base-200/50 rounded-box w-full p-2 gap-1">
                {#each navItems as item}
                    <li>
                        <a
                            href={item.href}
                            class:active={$page.url.pathname === item.href ||
                                $page.url.pathname.startsWith(item.href + "/")}
                        >
                            <svg
                                xmlns="http://www.w3.org/2000/svg"
                                class="h-4 w-4"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                stroke-width="2"
                                stroke-linecap="round"
                                stroke-linejoin="round"
                            >
                                <path d={item.icon} />
                            </svg>
                            {item.label}
                        </a>
                        {#if item.subsections && $page.url.pathname === item.href}
                            <ul class="ml-2 mt-0.5">
                                {#each item.subsections as sub}
                                    <li>
                                        <a
                                            href="{item.href}?tab={sub.tab}"
                                            class="text-xs py-1 px-3 min-h-0 {$page.url.searchParams.get('tab') === sub.tab || (!$page.url.searchParams.get('tab') && sub.tab === 'server') ? 'text-primary font-semibold' : 'text-base-content/60 hover:text-base-content'}"
                                        >
                                            {sub.label}
                                        </a>
                                    </li>
                                {/each}
                            </ul>
                        {/if}
                    </li>
                {/each}
            </ul>
            <div class="px-3 pt-3 text-[10px] text-base-content/25 select-all">
                Build {BUILD_VERSION}
            </div>
        </nav>

        <!-- Content -->
        <div class="flex-1 min-w-0">
            {@render children()}
        </div>
    </div>


</div>
