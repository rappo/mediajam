<script>
    /** @type {{ icon: string, label: string, value: string|number, sub?: string, color?: string }} */
    let { icon, label, value, sub = "", color = "primary" } = $props();
</script>

<div
    class="stat bg-base-300/30 rounded-2xl p-4 backdrop-blur-sm border border-base-content/5 hover:border-{color}/30 transition-all duration-300"
>
    <div class="flex items-center gap-3 mb-2">
        <div
            class="w-9 h-9 rounded-xl bg-{color}/15 flex items-center justify-center text-lg"
        >
            {icon}
        </div>
        <span class="stat-title text-xs font-medium uppercase tracking-wider"
            >{label}</span
        >
    </div>
    <div class="stat-value text-2xl font-bold text-{color}">
        {typeof value === "number" ? value.toLocaleString() : value}
    </div>
    {#if sub}
        <div class="stat-desc text-xs mt-1 text-base-content/50">{sub}</div>
    {/if}
</div>
