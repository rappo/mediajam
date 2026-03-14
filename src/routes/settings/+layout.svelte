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
            subsections: [
                { href: "/settings/account", label: "Profile" },
                { href: "/settings/display", label: "Display" },
            ],
        },
        {
            href: "/settings/admin",
            label: "Credentials",
            icon: "M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z",
            tabs: ["creds-local", "creds-metadata", "creds-scrobblers", "server", "api-keys"],
            defaultTab: "creds-local",
            subsections: [
                { tab: "creds-local", label: "Local" },
                { tab: "creds-metadata", label: "Metadata" },
                { tab: "creds-scrobblers", label: "Scrobblers" },
                { tab: "server", label: "LLM" },
                { tab: "api-keys", label: "API Keys" },
            ],
        },
        {
            href: "/settings/admin",
            label: "Data",
            icon: "M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4",
            tabs: ["sync", "cleanup", "import-export"],
            defaultTab: "sync",
            subsections: [
                { tab: "sync", label: "Data Sync" },
                { tab: "cleanup", label: "Data Clean-up" },
                { href: "/settings/backups", label: "Backups" },
                { tab: "import-export", label: "Import / Export" },
                { href: "/settings/audit", label: "Audit" },
                { href: "/settings/pipeline", label: "Pipeline" },
            ],
        },
        {
            href: "/settings/debug",
            label: "Debug",
            icon: "M12 20h9M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z",
        },
    ];

    /**
     * Check if a nav item is the active parent.
     * @param {any} item
     */
    function isItemActive(item) {
        const pathname = $page.url.pathname;
        const currentTab = $page.url.searchParams.get('tab');

        // Check href-based subsections (e.g. Display under Account, Backups under Data)
        if (item.subsections?.some(/** @param {any} s */ (s) => s.href && (pathname === s.href || pathname.startsWith(s.href + "/")))) {
            return true;
        }

        if (item.tabs) {
            if (pathname !== item.href) return false;
            if (!currentTab) {
                // No tab param — check if Admin page default falls into this group
                // Default admin tab is 'server', which is now under Credentials
                return item.tabs.includes('server') || item.tabs.includes(item.defaultTab);
            }
            return item.tabs.includes(currentTab);
        }

        return pathname === item.href || pathname.startsWith(item.href + "/");
    }

    /**
     * Check if a subsection is the active one.
     * @param {any} item
     * @param {any} sub
     */
    function isSubActive(item, sub) {
        const currentTab = $page.url.searchParams.get('tab');
        const pathname = $page.url.pathname;

        if (sub.href) {
            return pathname === sub.href;
        }

        if (pathname !== item.href) return false;
        if (!currentTab) return sub.tab === item.defaultTab;
        return currentTab === sub.tab;
    }

    // Derive active section + subsection labels for the <title>
    let activeLabel = $derived.by(() => {
        for (const item of navItems) {
            if (isItemActive(item)) {
                if (item.subsections) {
                    const activeSub = item.subsections.find((/** @type {any} */ s) => isSubActive(item, s));
                    if (activeSub) return `${activeSub.label} — ${item.label}`;
                }
                return item.label;
            }
        }
        return 'Settings';
    });
</script>

<svelte:head>
    <title>{activeLabel} — Mediajam</title>
</svelte:head>

<div class="max-w-5xl mx-auto p-6 py-10">
    <div class="flex items-center gap-3 mb-8">
        <a href="/history" class="btn btn-ghost btn-sm btn-circle" aria-label="Back">
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
                            href={item.tabs ? `${item.href}?tab=${item.defaultTab}` : item.href}
                            class:active={isItemActive(item)}
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
                        {#if item.subsections}
                            <ul class="ml-2 mt-0.5">
                                {#each item.subsections as sub}
                                    <li>
                                        <a
                                            href={sub.href || `${item.href}?tab=${sub.tab}`}
                                            class="text-xs py-1 px-3 min-h-0 {isSubActive(item, sub) ? 'text-primary font-semibold' : 'text-base-content/60 hover:text-base-content'}"
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
