<script>
    import { page } from "$app/state";
    import { goto } from "$app/navigation";

    let newPassword = $state("");
    let confirmPassword = $state("");
    let error = $state("");
    let success = $state(false);
    let loading = $state(false);

    const token = $derived(page.url.searchParams.get("token"));

    async function handleReset(e) {
        e.preventDefault();
        error = "";

        if (newPassword.length < 4) {
            error = "Password must be at least 4 characters.";
            return;
        }
        if (newPassword !== confirmPassword) {
            error = "Passwords do not match.";
            return;
        }

        loading = true;
        try {
            const res = await fetch("/api/auth/reset-password", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ token, newPassword }),
            });
            const result = await res.json();

            if (result.success) {
                success = true;
                setTimeout(() => goto("/login", { replaceState: true }), 2000);
            } else {
                error = result.error || "Reset failed.";
            }
        } catch {
            error = "Connection error.";
        }
        loading = false;
    }
</script>

<svelte:head>
    <title>Reset Password — Mediajam</title>
</svelte:head>

<div class="min-h-screen flex items-center justify-center bg-base-100 px-4">
    <div
        class="card w-full max-w-sm bg-base-200/50 border border-base-300 shadow-xl"
    >
        <div class="card-body">
            <div class="text-center mb-4">
                <h1
                    class="text-3xl font-bold tracking-tight bg-gradient-to-r from-primary to-secondary bg-clip-text text-transparent"
                >
                    mediajam
                </h1>
                <p class="text-sm text-base-content/50 mt-1">
                    Set a new password
                </p>
            </div>

            {#if !token}
                <div class="alert alert-error py-2 text-sm">
                    Missing reset token. Use the link provided by an admin.
                </div>
            {:else if success}
                <div class="alert alert-success py-2 text-sm">
                    ✅ Password updated! Redirecting to login...
                </div>
            {:else}
                <form onsubmit={handleReset} class="space-y-4">
                    {#if error}
                        <div class="alert alert-error py-2 text-sm">
                            {error}
                        </div>
                    {/if}

                    <div class="form-control">
                        <label class="label" for="reset-new-pw">
                            <span class="label-text">New Password</span>
                        </label>
                        <input
                            id="reset-new-pw"
                            type="password"
                            class="input input-bordered"
                            bind:value={newPassword}
                            placeholder="Enter new password"
                            autocomplete="new-password"
                            required
                        />
                    </div>

                    <div class="form-control">
                        <label class="label" for="reset-confirm-pw">
                            <span class="label-text">Confirm Password</span>
                        </label>
                        <input
                            id="reset-confirm-pw"
                            type="password"
                            class="input input-bordered"
                            bind:value={confirmPassword}
                            placeholder="Confirm new password"
                            autocomplete="new-password"
                            required
                        />
                    </div>

                    <button
                        type="submit"
                        class="btn btn-primary w-full"
                        disabled={loading}
                    >
                        {#if loading}
                            <span class="loading loading-spinner loading-sm"
                            ></span>
                        {/if}
                        Set Password
                    </button>
                </form>
            {/if}

            <div class="text-center mt-3">
                <a href="/login" class="link link-primary text-sm"
                    >← Back to login</a
                >
            </div>
        </div>
    </div>
</div>
