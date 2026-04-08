<script>
    import { goto } from "$app/navigation";

    let username = $state("");
    let password = $state("");
    let error = $state("");
    let loading = $state(false);

    async function handleLogin(e) {
        e.preventDefault();
        error = "";
        loading = true;

        try {
            const res = await fetch("/api/auth/login", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ username, password }),
            });
            const result = await res.json();

            if (result.success) {
                goto("/", { replaceState: true, invalidateAll: true });
            } else {
                error = result.error || "Login failed.";
            }
        } catch {
            error = "Connection error. Please try again.";
        }

        loading = false;
    }
</script>

<svelte:head>
    <title>Login — Mediajam</title>
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
                    Sign in to continue
                </p>
            </div>

            <form onsubmit={handleLogin} class="space-y-4">
                {#if error}
                    <div class="alert alert-error py-2 text-sm">
                        <svg
                            xmlns="http://www.w3.org/2000/svg"
                            class="h-4 w-4 shrink-0"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="2"
                        >
                            <circle cx="12" cy="12" r="10" /><line
                                x1="15"
                                y1="9"
                                x2="9"
                                y2="15"
                            /><line x1="9" y1="9" x2="15" y2="15" />
                        </svg>
                        {error}
                    </div>
                {/if}

                <div class="form-control">
                    <label class="label" for="login-username">
                        <span class="label-text">Username</span>
                    </label>
                    <input
                        id="login-username"
                        type="text"
                        class="input input-bordered"
                        bind:value={username}
                        placeholder="Enter your username"
                        autocomplete="username"
                        required
                    />
                </div>

                <div class="form-control">
                    <label class="label" for="login-password">
                        <span class="label-text">Password</span>
                    </label>
                    <input
                        id="login-password"
                        type="password"
                        class="input input-bordered"
                        bind:value={password}
                        placeholder="Enter your password"
                        autocomplete="current-password"
                        required
                    />
                </div>

                <button
                    type="submit"
                    class="btn btn-primary w-full"
                    disabled={loading}
                >
                    {#if loading}
                        <span class="loading loading-spinner loading-sm"></span>
                    {/if}
                    Sign In
                </button>
            </form>
        </div>
    </div>
</div>
