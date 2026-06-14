<script>
    /**
     * MdiIcon — renders a Material Design Icon from @mdi/js paths.
     * Usage: <MdiIcon icon={mdiHome} size={24} />
     *
     * @component
     */

    /** @type {{ icon: string, size?: number, class?: string, style?: string }} */
    let { icon, size = 24, class: className = '', style = '' } = $props();
</script>

<svg
    class="mdi-icon {className}"
    viewBox="0 0 24 24"
    width={size}
    height={size}
    aria-hidden="true"
    style={style || undefined}
>
    <path fill="currentColor" d={icon} />
</svg>

<style>
    .mdi-icon {
        display: inline-block;
        vertical-align: middle;
        flex-shrink: 0;
    }
</style>
