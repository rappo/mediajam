<script>
    import ReconciliationPanel from "$lib/components/ReconciliationPanel.svelte";
    let { data } = $props();
</script>

<ReconciliationPanel settings={data.settings} />
