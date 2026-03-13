<script>
    /** @type {{ icon: string, label: string, value: string|number, sub?: string, color?: string }} */
    let { icon, label, value, sub = "", color = "primary" } = $props();
</script>

<div
    class="stat bg-base-300/30 rounded-2xl p-3 sm:p-4 backdrop-blur-sm border border-base-content/5 hover:border-{color}/30 transition-all duration-300 min-w-0 overflow-hidden"
>
    <div class="flex items-center gap-2 mb-2">
        <div
            class="w-7 h-7 sm:w-8 sm:h-8 rounded-lg bg-{color}/15 flex items-center justify-center text-base shrink-0"
        >
            {icon}
        </div>
        <span class="stat-title text-[10px] sm:text-xs font-medium uppercase tracking-wider truncate"
            >{label}</span
        >
    </div>
    <div class="stat-value text-lg sm:text-xl lg:text-2xl font-bold text-{color} truncate">
        {typeof value === "number" ? value.toLocaleString() : value}
    </div>
    {#if sub}
        <div class="stat-desc text-[10px] sm:text-xs mt-1 text-base-content/50 leading-snug truncate">{sub}</div>
    {/if}
</div>
