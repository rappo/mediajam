<script>
    import { onMount } from "svelte";

    /** @type {{ options: any, height?: number }} */
    let { options, height = 300 } = $props();

    let containerEl = $state(null);
    let chart = $state(null);

    onMount(async () => {
        const CanvasJS = (await import("@canvasjs/charts")).default;

        if (containerEl) {
            // Apply dark-friendly defaults
            const mergedOptions = {
                animationEnabled: true,
                backgroundColor: "transparent",
                theme: "dark2",
                ...options,
                axisX: {
                    labelFontColor: "#a6adba",
                    lineColor: "#3d4451",
                    tickColor: "#3d4451",
                    gridColor: "#2a303c",
                    ...(options.axisX || {}),
                },
                axisY: {
                    labelFontColor: "#a6adba",
                    lineColor: "#3d4451",
                    tickColor: "#3d4451",
                    gridColor: "#2a303c",
                    ...(options.axisY || {}),
                },
                legend: {
                    fontColor: "#a6adba",
                    ...(options.legend || {}),
                },
                title: options.title
                    ? {
                          fontColor: "#a6adba",
                          fontSize: 16,
                          fontFamily: "Inter, sans-serif",
                          ...options.title,
                      }
                    : undefined,
                toolTip: {
                    cornerRadius: 8,
                    borderThickness: 0,
                    fontFamily: "Inter, sans-serif",
                    ...(options.toolTip || {}),
                },
                creditHref: "",
                creditText: "",
            };

            chart = new CanvasJS.Chart(containerEl, mergedOptions);
            chart.render();
        }

        return () => {
            if (chart) chart.destroy();
        };
    });

    // Re-render when options change
    $effect(() => {
        if (chart && options) {
            // We need to reference options to track it
            const _opts = options;
        }
    });
</script>

<div
    class="rounded-2xl bg-base-300/20 border border-base-content/5 p-4 backdrop-blur-sm"
>
    <div bind:this={containerEl} style="height: {height}px; width: 100%;"></div>
</div>
