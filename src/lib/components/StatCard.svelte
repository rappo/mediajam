<script>
    /** @type {{ icon: string, label: string, value: string|number, sub?: string, color?: string }} */
    let { icon, label, value, sub = "", color = "primary" } = $props();
</script>

<div
    class="stat bg-base-300/30 rounded-2xl p-5 backdrop-blur-sm border border-base-content/5 hover:border-{color}/30 transition-all duration-300 min-w-0"
>
    <div class="flex items-center gap-3 mb-3">
        <div
            class="w-9 h-9 rounded-xl bg-{color}/15 flex items-center justify-center text-lg shrink-0"
        >
            {icon}
        </div>
        <span class="stat-title text-xs font-medium uppercase tracking-wider"
            >{label}</span
        >
    </div>
    <div class="stat-value text-2xl lg:text-3xl font-bold text-{color}">
        {typeof value === "number" ? value.toLocaleString() : value}
    </div>
    {#if sub}
        <div class="stat-desc text-xs mt-1.5 text-base-content/50 leading-snug">{sub}</div>
    {/if}
</div>
