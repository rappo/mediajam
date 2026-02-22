<script>
    /**
     * @type {{
     *   columns: Array<{ key: string, label: string, sortable?: boolean, render?: (row: any) => string, class?: string }>,
     *   data: Array<any>,
     *   searchKey?: string,
     *   pageSize?: number,
     *   hideCollectedKey?: string
     * }}
     */
    let {
        columns,
        data,
        searchKey = "title",
        pageSize = 25,
        hideCollectedKey = "",
    } = $props();

    let search = $state("");
    let sortKey = $state("");
    let sortDir = $state("asc");
    let page = $state(0);
    let showAll = $state(false);
    let hideCollected = $state(false);

    function filteredData() {
        let result = data;
        if (search) {
            const q = search.toLowerCase();
            result = result.filter((row) => {
                const val = row[searchKey];
                return val && String(val).toLowerCase().includes(q);
            });
        }
        if (hideCollected && hideCollectedKey) {
            result = result.filter((row) => {
                const pct = row[hideCollectedKey];
                return pct === null || pct === undefined || pct < 100;
            });
        }
        if (sortKey) {
            result = [...result].sort((a, b) => {
                const aVal = a[sortKey] ?? "";
                const bVal = b[sortKey] ?? "";
                if (typeof aVal === "number" && typeof bVal === "number") {
                    return sortDir === "asc" ? aVal - bVal : bVal - aVal;
                }
                return sortDir === "asc"
                    ? String(aVal).localeCompare(String(bVal))
                    : String(bVal).localeCompare(String(aVal));
            });
        }
        return result;
    }

    function pagedData() {
        const filtered = filteredData();
        if (showAll) return filtered;
        const start = page * pageSize;
        return filtered.slice(start, start + pageSize);
    }

    function totalPages() {
        return Math.max(1, Math.ceil(filteredData().length / pageSize));
    }

    function toggleSort(key) {
        if (sortKey === key) {
            sortDir = sortDir === "asc" ? "desc" : "asc";
        } else {
            sortKey = key;
            sortDir = "asc";
        }
        page = 0;
    }
</script>

<div class="space-y-3">
    <!-- Toolbar -->
    <div class="flex flex-wrap items-center gap-3">
        <input
            type="text"
            placeholder="Search..."
            class="input input-bordered input-sm flex-1 min-w-[180px] bg-base-300/30"
            bind:value={search}
            oninput={() => (page = 0)}
        />
        <span class="text-xs text-base-content/50">
            {filteredData().length} results
        </span>
        <div class="flex items-center gap-2">
            {#if hideCollectedKey}
                <label class="label cursor-pointer gap-2">
                    <input
                        type="checkbox"
                        class="toggle toggle-xs toggle-info"
                        bind:checked={hideCollected}
                        onchange={() => (page = 0)}
                    />
                    <span class="label-text text-xs">Hide 100%</span>
                </label>
            {/if}
            <label class="label cursor-pointer gap-2">
                <input
                    type="checkbox"
                    class="toggle toggle-xs toggle-primary"
                    bind:checked={showAll}
                />
                <span class="label-text text-xs">Show all</span>
            </label>
        </div>
    </div>

    <!-- Table -->
    <div class="overflow-x-auto rounded-xl border border-base-content/5">
        <table class="table table-sm">
            <thead>
                <tr class="bg-base-300/30">
                    {#each columns as col}
                        <th class={col.class || ""}>
                            {#if col.sortable !== false}
                                <button
                                    class="flex items-center gap-1 hover:text-primary transition-colors cursor-pointer"
                                    onclick={() => toggleSort(col.key)}
                                >
                                    {col.label}
                                    {#if sortKey === col.key}
                                        <span class="text-primary text-xs"
                                            >{sortDir === "asc"
                                                ? "▲"
                                                : "▼"}</span
                                        >
                                    {/if}
                                </button>
                            {:else}
                                {col.label}
                            {/if}
                        </th>
                    {/each}
                </tr>
            </thead>
            <tbody>
                {#each pagedData() as row, i}
                    <tr class="hover:bg-base-300/20 transition-colors">
                        {#each columns as col}
                            <td class={col.class || ""}>
                                {#if col.render}
                                    {@html col.render(row)}
                                {:else}
                                    {row[col.key] ?? "—"}
                                {/if}
                            </td>
                        {/each}
                    </tr>
                {/each}
                {#if pagedData().length === 0}
                    <tr>
                        <td
                            colspan={columns.length}
                            class="text-center text-base-content/40 py-8"
                        >
                            No results found
                        </td>
                    </tr>
                {/if}
            </tbody>
        </table>
    </div>

    <!-- Pagination (only when not show-all) -->
    {#if !showAll && totalPages() > 1}
        <div class="flex justify-center gap-2">
            <button
                class="btn btn-xs btn-ghost"
                onclick={() => (page = Math.max(0, page - 1))}
                disabled={page === 0}
            >
                ←
            </button>
            <span class="text-xs self-center text-base-content/60">
                Page {page + 1} of {totalPages()}
            </span>
            <button
                class="btn btn-xs btn-ghost"
                onclick={() => (page = Math.min(totalPages() - 1, page + 1))}
                disabled={page >= totalPages() - 1}
            >
                →
            </button>
        </div>
    {/if}
</div>
