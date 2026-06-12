<script>
    import { goto } from "$app/navigation";

    let username = $state("");
    let password = $state("");
    let error = $state("");
    let loading = $state(false);
    let mode = $state("local"); // 'local' | 'jellyfin'

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

            <!-- Mode toggle -->
            <div class="flex gap-1 bg-base-300/50 rounded-lg p-1 mb-2">
                <button
                    type="button"
                    class="flex-1 text-xs font-medium py-1.5 px-3 rounded-md transition-all"
                    class:bg-base-100={mode === 'local'}
                    class:shadow-sm={mode === 'local'}
                    class:text-base-content={mode === 'local'}
                    class:text-base-content/50={mode !== 'local'}
                    onclick={() => { mode = 'local'; error = ''; }}
                >
                    Local Account
                </button>
                <button
                    type="button"
                    class="flex-1 text-xs font-medium py-1.5 px-3 rounded-md transition-all flex items-center justify-center gap-1.5"
                    class:bg-base-100={mode === 'jellyfin'}
                    class:shadow-sm={mode === 'jellyfin'}
                    class:text-base-content={mode === 'jellyfin'}
                    class:text-base-content/50={mode !== 'jellyfin'}
                    onclick={() => { mode = 'jellyfin'; error = ''; }}
                >
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 512 512" fill="currentColor">
                        <path d="M256 0C114.6 0 0 114.6 0 256s114.6 256 256 256 256-114.6 256-256S397.4 0 256 0zm0 480C132.3 480 32 379.7 32 256S132.3 32 256 32s224 100.3 224 224-100.3 224-224 224z"/>
                        <path d="M256 96c-88.4 0-160 71.6-160 160s71.6 160 160 160 160-71.6 160-160S344.4 96 256 96zm0 288c-70.7 0-128-57.3-128-128s57.3-128 128-128 128 57.3 128 128-57.3 128-128 128z"/>
                    </svg>
                    Jellyfin
                </button>
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
                        <span class="label-text">{mode === 'jellyfin' ? 'Jellyfin Username' : 'Username'}</span>
                    </label>
                    <input
                        id="login-username"
                        type="text"
                        class="input input-bordered"
                        bind:value={username}
                        placeholder={mode === 'jellyfin' ? 'Your Jellyfin username' : 'Enter your username'}
                        autocomplete="username"
                        required
                    />
                </div>

                <div class="form-control">
                    <label class="label" for="login-password">
                        <span class="label-text">{mode === 'jellyfin' ? 'Jellyfin Password' : 'Password'}</span>
                    </label>
                    <input
                        id="login-password"
                        type="password"
                        class="input input-bordered"
                        bind:value={password}
                        placeholder={mode === 'jellyfin' ? 'Your Jellyfin password' : 'Enter your password'}
                        autocomplete="current-password"
                        required
                    />
                </div>

                <button
                    type="submit"
                    class="btn w-full"
                    class:btn-primary={mode === 'local'}
                    class:btn-secondary={mode === 'jellyfin'}
                    disabled={loading}
                >
                    {#if loading}
                        <span class="loading loading-spinner loading-sm"></span>
                    {/if}
                    {mode === 'jellyfin' ? 'Sign in with Jellyfin' : 'Sign In'}
                </button>

                {#if mode === 'jellyfin'}
                    <p class="text-xs text-base-content/40 text-center">
                        An account will be created automatically on first sign-in.
                    </p>
                {/if}
            </form>
        </div>
    </div>
</div>
