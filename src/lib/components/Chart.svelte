<script>
    import { onMount } from "svelte";

    /** @type {{ options: any, height?: number }} */
    let { options, height = 300 } = $props();

    /** @type {HTMLCanvasElement|null} */
    let canvasEl = $state(null);
    /** @type {any} */
    let chart = $state(null);

    /**
     * Translate CanvasJS options → Chart.js config.
     * Supports: doughnut, pie, column (→ bar), bar (→ bar + indexAxis:'y')
     * @param {any} opts CanvasJS-style options
     * @returns {any} Chart.js config
     */
    function translate(opts) {
        const series = opts.data?.[0] || {};
        const canvasType = series.type || "column";

        // Map CanvasJS type → Chart.js type + orientation
        let chartType = "bar";
        let indexAxis = "x";
        if (canvasType === "doughnut") chartType = "doughnut";
        else if (canvasType === "pie") chartType = "pie";
        else if (canvasType === "bar") {
            chartType = "bar";
            indexAxis = "y";
        } else if (canvasType === "column") {
            chartType = "bar";
            indexAxis = "x";
        }

        const points = series.dataPoints || [];
        const labels = points.map(
            (/** @type {any} */ p) => p.label ?? p.x ?? "",
        );
        const values = points.map((/** @type {any} */ p) => p.y ?? 0);
        const colors = points
            .map((/** @type {any} */ p) => p.color)
            .filter(Boolean);

        const isPieType = chartType === "doughnut" || chartType === "pie";

        /** @type {any} */
        const dataset = {
            data: values,
            borderWidth: 0,
        };

        if (isPieType) {
            dataset.backgroundColor =
                colors.length === values.length ? colors : undefined;
        } else {
            dataset.backgroundColor = series.color || colors[0] || "#7c3aed";
            dataset.borderRadius = series.cornerRadius || 0;
        }

        // Axis colors
        const labelColor = "#a6adba";
        const gridColor = "#2a303c";

        /** @type {any} */
        const config = {
            type: chartType,
            data: { labels, datasets: [dataset] },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                indexAxis: isPieType ? undefined : indexAxis,
                plugins: {
                    legend: { display: false },
                    title: opts.title?.text
                        ? {
                              display: true,
                              text: opts.title.text,
                              color: labelColor,
                              font: {
                                  size: 14,
                                  family: "Inter, sans-serif",
                                  weight: "600",
                              },
                              padding: { bottom: 12 },
                          }
                        : { display: false },
                    tooltip: {
                        cornerRadius: 8,
                        titleFont: { family: "Inter, sans-serif" },
                        bodyFont: { family: "Inter, sans-serif" },
                    },
                },
                animation: { duration: 600 },
            },
        };

        // Pie/doughnut specific
        if (isPieType) {
            config.options.cutout = chartType === "doughnut" ? "55%" : 0;
            config.options.rotation =
                series.startAngle != null ? series.startAngle - 90 : -90;

            // Custom tooltip using CanvasJS-style toolTipContent
            if (series.toolTipContent) {
                config.options.plugins.tooltip.callbacks = {
                    label: (/** @type {any} */ ctx) => {
                        const point = points[ctx.dataIndex];
                        let text = series.toolTipContent;
                        text = text.replace("{label}", point.label || "");
                        text = text.replace(
                            "{y}",
                            (point.y ?? 0).toLocaleString(),
                        );
                        if (point.percentage != null)
                            text = text.replace(
                                "{percentage}",
                                point.percentage,
                            );
                        return text;
                    },
                };
            }
        } else {
            // Bar/column axes
            const xAxisOpts = opts.axisX || {};
            const yAxisOpts = opts.axisY || {};

            /** @type {any} */
            const scales = {};

            scales.x = {
                ticks: {
                    color: labelColor,
                    font: { size: xAxisOpts.labelFontSize || 11 },
                    maxRotation: xAxisOpts.labelAngle
                        ? Math.abs(xAxisOpts.labelAngle)
                        : undefined,
                },
                grid: { color: gridColor, lineWidth: 0.5 },
                title: xAxisOpts.title
                    ? {
                          display: true,
                          text: xAxisOpts.title,
                          color: xAxisOpts.titleFontColor || labelColor,
                      }
                    : undefined,
            };

            scales.y = {
                ticks: { color: labelColor },
                grid: { color: gridColor, lineWidth: 0.5 },
                title: yAxisOpts.title
                    ? {
                          display: true,
                          text: yAxisOpts.title,
                          color: yAxisOpts.titleFontColor || labelColor,
                      }
                    : undefined,
            };

            // For numeric x-axis (e.g. years), use the x values directly
            if (points.length > 0 && typeof points[0].x === "number") {
                scales.x.type = "linear";
                scales.x.ticks.stepSize = xAxisOpts.interval || undefined;
                // Use {x, y} format for dataset
                dataset.data = points.map((/** @type {any} */ p) => ({
                    x: p.x,
                    y: p.y,
                }));
                config.data.labels = undefined;
            }

            config.options.scales = scales;
        }

        return config;
    }

    onMount(async () => {
        const { Chart, registerables } = await import("chart.js");
        Chart.register(...registerables);

        // Global dark theme defaults
        Chart.defaults.color = "#a6adba";

        if (canvasEl) {
            const cfg = translate(options);
            chart = new Chart(canvasEl, cfg);
        }

        return () => {
            if (chart) chart.destroy();
        };
    });

    // Re-render when options change
    $effect(() => {
        if (chart && options) {
            const cfg = translate(options);
            chart.data = cfg.data;
            chart.options = cfg.options;
            chart.update();
        }
    });
</script>

<div
    class="rounded-2xl bg-base-300/20 border border-base-content/5 p-4 backdrop-blur-sm"
>
    <div style="height: {height}px; width: 100%; position: relative;">
        <canvas bind:this={canvasEl}></canvas>
    </div>
</div>
