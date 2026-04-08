<!--
  ReasonTag — small inline "why" label for recommendations.
  Usage: <ReasonTag reason="starring Bill Murray" />
-->
<script>
    /** @type {{ reason: string, class?: string }} */
    let { reason, class: className = '' } = $props();
</script>

<span class="reason-tag {className}" title={reason}>
    {reason}
</span>

<style>
    .reason-tag {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        font-size: 0.675rem;
        color: oklch(var(--bc) / 0.45);
        font-style: italic;
        line-height: 1.2;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        max-width: 100%;
    }
</style>
