<script>
	import StepWelcome from "$lib/components/setup/StepWelcome.svelte";
	import StepDiscover from "$lib/components/setup/StepDiscover.svelte";
	import StepAuth from "$lib/components/setup/StepAuth.svelte";
	import StepLibraries from "$lib/components/setup/StepLibraries.svelte";

	const STEPS = [
		{ label: "Welcome", icon: "👋" },
		{ label: "Discover", icon: "🔍" },
		{ label: "Account", icon: "👤" },
		{ label: "Libraries", icon: "📚" },
	];

	let currentStep = $state(0);
	let wizardData = $state({
		jellyfinUrl: "",
		authType: "jellyfin",
		username: "",
		userId: "",
		accessToken: "",
		selectedLibraries: [],
	});

	let stepKey = $state(0); // for transition

	function nextStep() {
		if (currentStep < STEPS.length - 1) {
			currentStep++;
			stepKey++;
		}
	}

	function prevStep() {
		if (currentStep > 0) {
			currentStep--;
			stepKey++;
		}
	}

	function onStepComplete(data) {
		wizardData = { ...wizardData, ...data };
		nextStep();
	}
</script>

<svelte:head>
	<title>Mediajam — Setup</title>
</svelte:head>

<div
	class="min-h-screen bg-base-100 flex items-center justify-center p-4 relative overflow-hidden"
>
	<!-- Background decoration -->
	<div class="absolute inset-0 overflow-hidden pointer-events-none">
		<div
			class="absolute -top-40 -right-40 w-96 h-96 bg-primary/10 rounded-full blur-3xl"
		></div>
		<div
			class="absolute -bottom-40 -left-40 w-96 h-96 bg-secondary/10 rounded-full blur-3xl"
		></div>
		<div
			class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-accent/5 rounded-full blur-3xl"
		></div>
	</div>

	<div class="w-full max-w-2xl relative z-10">
		<!-- Header -->
		<div class="text-center mb-8">
			<div class="inline-flex items-center gap-3 mb-4">
				<div
					class="w-12 h-12 rounded-2xl bg-gradient-to-br from-primary to-secondary flex items-center justify-center shadow-lg shadow-primary/25"
				>
					<svg
						xmlns="http://www.w3.org/2000/svg"
						class="h-7 w-7 text-primary-content"
						viewBox="0 0 24 24"
						fill="currentColor"
					>
						<path
							d="M4 8V6a2 2 0 012-2h2M4 16v2a2 2 0 002 2h2M16 4h2a2 2 0 012 2v2M16 20h2a2 2 0 002-2v-2M9 12h6M12 9v6"
						/>
					</svg>
				</div>
				<h1
					class="text-4xl font-extrabold tracking-tight bg-gradient-to-r from-primary via-secondary to-accent bg-clip-text text-transparent"
				>
					Mediajam
				</h1>
			</div>
			<p class="text-base-content/60 text-sm">
				Beautiful analytics for your Jellyfin media server
			</p>
		</div>

		<!-- Step Indicators -->
		<ul class="steps steps-horizontal w-full mb-8">
			{#each STEPS as step, i}
				<li class="step" class:step-primary={i <= currentStep}>
					<span class="text-xs hidden sm:inline">{step.label}</span>
				</li>
			{/each}
		</ul>

		<!-- Step Content Card -->
		<div
			class="card bg-base-200/60 backdrop-blur-xl shadow-2xl border border-base-300/50"
		>
			<div class="card-body p-6 sm:p-8">
				{#key stepKey}
					<div class="step-enter">
						{#if currentStep === 0}
							<StepWelcome {onStepComplete} />
						{:else if currentStep === 1}
							<StepDiscover {wizardData} {onStepComplete} />
						{:else if currentStep === 2}
							<StepAuth
								{wizardData}
								{onStepComplete}
								onBack={prevStep}
							/>
						{:else if currentStep === 3}
							<StepLibraries
								{wizardData}
								onBack={prevStep}
							/>
						{/if}
					</div>
				{/key}
			</div>
		</div>

		<!-- Footer -->
		<p class="text-center text-base-content/30 text-xs mt-6">
			Step {currentStep + 1} of {STEPS.length}
		</p>
	</div>
</div>
