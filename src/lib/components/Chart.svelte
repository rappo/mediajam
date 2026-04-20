<script>
    import { onMount } from "svelte";

    /** @type {{ options: any, height?: number, onclick?: (detail: {label: string, x: any, datasetIndex: number, dataIndex: number}) => void }} */
    let { options, height = 300, onclick } = $props();

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
    /** Convert hex color to rgba string */
    function hexToRgba(/** @type {string} */ hex, /** @type {number} */ alpha) {
        const h = hex.replace('#', '');
        const r = parseInt(h.substring(0, 2), 16);
        const g = parseInt(h.substring(2, 4), 16);
        const b = parseInt(h.substring(4, 6), 16);
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }

    function translate(opts) {
        const allSeries = opts.data || [];
        const series = allSeries[0] || {};
        const canvasType = series.type || "column";
        const isStacked = canvasType === "stackedColumn" || canvasType === "stackedBar" || canvasType === "stackedArea";
        const isArea = canvasType === "stackedArea";

        // Map CanvasJS type → Chart.js type + orientation
        let chartType = "bar";
        let indexAxis = "x";
        if (canvasType === "doughnut") chartType = "doughnut";
        else if (canvasType === "pie") chartType = "pie";
        else if (canvasType === "bar" || canvasType === "stackedBar") {
            chartType = "bar";
            indexAxis = "y";
        } else if (canvasType === "stackedArea") {
            chartType = "line";
        } else if (canvasType === "column" || canvasType === "stackedColumn") {
            chartType = "bar";
            indexAxis = "x";
        }

        const isPieType = chartType === "doughnut" || chartType === "pie";

        // Build datasets — support multiple series
        const datasets = [];
        let labels = [];

        for (const s of allSeries) {
            const points = s.dataPoints || [];
            if (labels.length === 0) {
                labels = points.map((/** @type {any} */ p) => p.label ?? p.x ?? "");
            }
            const values = points.map((/** @type {any} */ p) => p.y ?? 0);
            const colors = points.map((/** @type {any} */ p) => p.color).filter(Boolean);

            /** @type {any} */
            const dataset = {
                data: values,
                borderWidth: isArea ? (s.lineThickness ?? 2) : 0,
                label: s.name || undefined,
            };

            if (isPieType) {
                dataset.backgroundColor = colors.length === values.length ? colors : undefined;
            } else {
                dataset.backgroundColor = s.color || colors[0] || "#7c3aed";
                dataset.borderColor = s.color || colors[0] || "#7c3aed";
                dataset.borderRadius = s.cornerRadius || 0;
            }

            if (isArea) {
                dataset.fill = 'origin';
                dataset.tension = 0.3;
                dataset.pointRadius = s.markerSize ?? 0;
                dataset.spanGaps = false;
                // Apply fillOpacity via rgba
                const hex = s.color || "#7c3aed";
                const opacity = s.fillOpacity ?? 0.4;
                dataset.backgroundColor = hexToRgba(hex, opacity);
            }

            if (isStacked) {
                dataset.stack = "stack0";
            }

            datasets.push(dataset);
        }

        // Axis colors
        const labelColor = "#a6adba";
        const gridColor = "#2a303c";

        /** @type {any} */
        const config = {
            type: chartType,
            data: { labels, datasets },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                indexAxis: isPieType ? undefined : indexAxis,
                plugins: {
                    legend: { display: allSeries.length > 1 && allSeries.some((/** @type {any} */ s) => s.showInLegend), fontColor: opts.legend?.fontColor || labelColor },
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
                              padding: { bottom: opts.subtitle?.text ? 2 : 12 },
                          }
                        : { display: false },
                    subtitle: opts.subtitle?.text
                        ? {
                              display: true,
                              text: opts.subtitle.text,
                              color: "#6b7280",
                              font: { size: 11, family: "Inter, sans-serif", weight: "400", style: "italic" },
                              padding: { bottom: 10 },
                          }
                        : { display: false },
                    tooltip: {
                        cornerRadius: 8,
                        titleFont: { family: "Inter, sans-serif" },
                        bodyFont: { family: "Inter, sans-serif" },
                        mode: opts.toolTip?.shared ? "index" : "nearest",
                        ...(opts.toolTip?.callbacks ? { callbacks: opts.toolTip.callbacks } : {}),
                        filter: opts.toolTip?.filter || undefined,
                    },
                },
                animation: { duration: 600 },
                onClick: onclick ? (/** @type {any} */ evt, /** @type {any[]} */ elements, /** @type {any} */ ch) => {
                    if (elements.length === 0) return;
                    const el = elements[0];
                    const idx = el.index;
                    const dsIdx = el.datasetIndex;
                    const ds = ch.data.datasets[dsIdx];
                    const point = ds.data[idx];
                    const label = ch.data.labels?.[idx] ?? '';
                    const x = typeof point === 'object' && point !== null ? point.x : label;
                    onclick({ label: String(label), x, datasetIndex: dsIdx, dataIndex: idx });
                } : undefined,
            },
        };

        // Pie/doughnut specific
        if (isPieType) {
            config.options.cutout = chartType === "doughnut" ? "55%" : 0;
            config.options.rotation =
                series.startAngle != null ? series.startAngle - 90 : -90;

            // Custom tooltip using CanvasJS-style toolTipContent
            const points = series.dataPoints || [];
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
                stacked: isStacked,
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
                stacked: isStacked,
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
            const firstPoints = (allSeries[0]?.dataPoints || []);
            if (firstPoints.length > 0 && typeof firstPoints[0].x === "number") {
                scales.x.type = "linear";
                scales.x.ticks.stepSize = xAxisOpts.interval || undefined;
                // Use {x, y} format for all datasets
                for (const ds of datasets) {
                    const pts = allSeries[datasets.indexOf(ds)]?.dataPoints || [];
                    ds.data = pts.map((/** @type {any} */ p) => ({
                        x: p.x,
                        y: p.y,
                    }));
                }
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
            // Chart.js can't change type in-place — must destroy and recreate
            if (chart.config.type !== cfg.type) {
                chart.destroy();
                if (canvasEl) {
                    // @ts-ignore — Chart constructor works with canvas element
                    import("chart.js").then(({ Chart }) => {
                        chart = new Chart(canvasEl, cfg);
                    });
                }
            } else {
                chart.data = cfg.data;
                chart.options = cfg.options;
                chart.update();
            }
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
