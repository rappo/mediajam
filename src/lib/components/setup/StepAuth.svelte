<script>
    /** @type {{ wizardData: any, onStepComplete: (data: any) => void, onBack: () => void }} */
    let { wizardData, onStepComplete, onBack } = $props();

    let authType = $state("jellyfin");
    let username = $state("");
    let password = $state("");
    let confirmPassword = $state("");
    let loading = $state(false);
    let error = $state("");

    async function handleAuth() {
        error = "";

        if (authType === "local") {
            if (!username || !password) {
                error = "Please fill in all fields.";
                return;
            }
            if (password !== confirmPassword) {
                error = "Passwords do not match.";
                return;
            }
            if (password.length < 4) {
                error = "Password must be at least 4 characters.";
                return;
            }
        } else {
            if (!username || !password) {
                error = "Please enter your Jellyfin credentials.";
                return;
            }
        }

        loading = true;

        try {
            const res = await fetch("/api/setup/auth", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    authType,
                    username,
                    password,
                    jellyfinUrl: wizardData.jellyfinUrl,
                }),
            });

            const data = await res.json();

            if (data.success) {
                onStepComplete({
                    authType,
                    username,
                    userId: data.userId,
                    accessToken: data.accessToken,
                });
            } else {
                error = data.error || "Authentication failed.";
            }
        } catch (e) {
            error = "An error occurred. Please try again.";
        }

        loading = false;
    }
</script>

<div>
    <h2 class="text-2xl font-bold mb-2">Create Admin Account</h2>
    <p class="text-base-content/60 text-sm mb-6">
        Sign up for your first Mediajam account. You can use your Jellyfin
        credentials or create a standalone local account.
    </p>

    <!-- Auth Type Toggle -->
    <div class="tabs tabs-boxed bg-base-300/50 mb-6 p-1">
        <button
            class="tab flex-1 transition-all"
            class:tab-active={authType === "jellyfin"}
            onclick={() => {
                authType = "jellyfin";
                error = "";
            }}
        >
            <svg
                xmlns="http://www.w3.org/2000/svg"
                class="h-4 w-4 mr-2"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
            >
                <rect x="2" y="2" width="20" height="8" rx="2" ry="2" /><rect
                    x="2"
                    y="14"
                    width="20"
                    height="8"
                    rx="2"
                    ry="2"
                /><line x1="6" y1="6" x2="6.01" y2="6" /><line
                    x1="6"
                    y1="18"
                    x2="6.01"
                    y2="18"
                />
            </svg>
            Sign Up with Jellyfin
        </button>
        <button
            class="tab flex-1 transition-all"
            class:tab-active={authType === "local"}
            onclick={() => {
                authType = "local";
                error = "";
            }}
        >
            <svg
                xmlns="http://www.w3.org/2000/svg"
                class="h-4 w-4 mr-2"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
            >
                <path d="M16 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" /><circle
                    cx="8.5"
                    cy="7"
                    r="4"
                /><line x1="20" y1="8" x2="20" y2="14" /><line
                    x1="23"
                    y1="11"
                    x2="17"
                    y2="11"
                />
            </svg>
            Create Local Account
        </button>
    </div>

    <!-- Form -->
    <form class="space-y-4" onsubmit={(e) => { e.preventDefault(); handleAuth(); }}>
        <div class="form-control">
            <label class="label" for="username">
                <span class="label-text font-medium">Username</span>
            </label>
            <input
                id="username"
                type="text"
                placeholder={authType === "jellyfin"
                    ? "Your Jellyfin username"
                    : "Choose a username"}
                class="input input-bordered w-full"
                bind:value={username}
            />
        </div>

        <div class="form-control">
            <label class="label" for="password">
                <span class="label-text font-medium">Password</span>
            </label>
            <input
                id="password"
                type="password"
                placeholder={authType === "jellyfin"
                    ? "Your Jellyfin password"
                    : "Choose a password"}
                class="input input-bordered w-full"
                bind:value={password}
            />
        </div>

        {#if authType === "local"}
            <div class="form-control">
                <label class="label" for="confirm-password">
                    <span class="label-text font-medium">Confirm Password</span>
                </label>
                <input
                    id="confirm-password"
                    type="password"
                    placeholder="Re-enter password"
                    class="input input-bordered w-full"
                    bind:value={confirmPassword}
                />
            </div>
        {/if}

        {#if authType === "jellyfin"}
            <div class="text-xs text-base-content/40 flex items-center gap-2">
                <svg
                    xmlns="http://www.w3.org/2000/svg"
                    class="h-4 w-4 shrink-0"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                >
                    <rect
                        x="3"
                        y="11"
                        width="18"
                        height="11"
                        rx="2"
                        ry="2"
                    /><path d="M7 11V7a5 5 0 0110 0v4" />
                </svg>
                Your credentials are verified against your Jellyfin server to create
                your Mediajam admin account. Only the access token is stored.
            </div>
        {/if}

        {#if error}
            <div class="alert alert-error alert-sm">
                <span class="text-sm">{error}</span>
            </div>
        {/if}

        <div class="flex gap-3 pt-2">
            <button type="button" class="btn btn-ghost" onclick={onBack}>Back</button>
            <button
                type="submit"
                class="btn btn-primary flex-1"
                disabled={loading}
            >
                {#if loading}
                    <span class="loading loading-spinner loading-sm"></span>
                    Creating Account…
                {:else}
                    Create Account
                {/if}
            </button>
        </div>
    </form>
</div>
