<script>
    import MdiIcon from "$lib/components/MdiIcon.svelte";
    import { mdiWhiteBalanceSunny, mdiViewList, mdiCalendar, mdiClockOutline, mdiMovieOpen, mdiTelevision, mdiMusic, mdiHeart, mdiAccount } from '@mdi/js';

    /** @type {{ data: import('./$types').PageData }} */
    let { data } = $props();

    const DAISY_THEMES = [
        "light",
        "dark",
        "cupcake",
        "bumblebee",
        "emerald",
        "corporate",
        "synthwave",
        "retro",
        "cyberpunk",
        "valentine",
        "halloween",
        "garden",
        "forest",
        "aqua",
        "lofi",
        "pastel",
        "fantasy",
        "wireframe",
        "black",
        "luxury",
        "dracula",
        "cmyk",
        "autumn",
        "business",
        "acid",
        "lemonade",
        "night",
        "coffee",
        "winter",
        "dim",
        "nord",
        "sunset",
    ];

    // svelte-ignore state_referenced_locally
    let currentTheme = $state(data.settings.theme || "dark");
    // svelte-ignore state_referenced_locally
    let includeSpecials = $state(data.settings.includeSpecials || false);
    let savingSpecials = $state(false);

    // Timezone
    const TIMEZONES = [
        'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
        'America/Anchorage', 'America/Phoenix', 'Pacific/Honolulu',
        'America/Toronto', 'America/Vancouver', 'America/Halifax',
        'America/Mexico_City', 'America/Bogota', 'America/Lima', 'America/Sao_Paulo', 'America/Argentina/Buenos_Aires',
        'Europe/London', 'Europe/Dublin', 'Europe/Paris', 'Europe/Berlin', 'Europe/Rome',
        'Europe/Madrid', 'Europe/Amsterdam', 'Europe/Brussels', 'Europe/Zurich', 'Europe/Vienna',
        'Europe/Stockholm', 'Europe/Oslo', 'Europe/Copenhagen', 'Europe/Helsinki',
        'Europe/Warsaw', 'Europe/Prague', 'Europe/Budapest', 'Europe/Bucharest',
        'Europe/Athens', 'Europe/Istanbul', 'Europe/Moscow', 'Europe/Kiev',
        'Asia/Dubai', 'Asia/Karachi', 'Asia/Kolkata', 'Asia/Dhaka',
        'Asia/Bangkok', 'Asia/Singapore', 'Asia/Hong_Kong', 'Asia/Shanghai', 'Asia/Taipei',
        'Asia/Seoul', 'Asia/Tokyo',
        'Australia/Sydney', 'Australia/Melbourne', 'Australia/Brisbane', 'Australia/Perth', 'Australia/Adelaide',
        'Pacific/Auckland', 'Pacific/Fiji',
        'Africa/Cairo', 'Africa/Lagos', 'Africa/Johannesburg', 'Africa/Nairobi',
        'UTC',
    ];
    const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    // svelte-ignore state_referenced_locally
    let timezone = $state(data.userPreferences?.timezone || browserTz || 'UTC');
    let savingTimezone = $state(false);
    let tzSaved = $state(false);

    async function saveTimezone() {
        savingTimezone = true;
        tzSaved = false;
        await fetch('/api/user/preferences', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ timezone }),
        });
        savingTimezone = false;
        tzSaved = true;
        setTimeout(() => tzSaved = false, 2000);
    }

    // Heart border toggles
    // svelte-ignore state_referenced_locally
    let heartBorderMovies = $state(data.settings.heartBorderMovies ?? true);
    // svelte-ignore state_referenced_locally
    let heartBorderShows = $state(data.settings.heartBorderShows ?? true);
    // svelte-ignore state_referenced_locally
    let heartBorderMusic = $state(data.settings.heartBorderMusic ?? true);
    // svelte-ignore state_referenced_locally
    let heartBorderPeople = $state(data.settings.heartBorderPeople ?? true);
    let savingHeartBorder = $state(false);

    async function setTheme(theme) {
        currentTheme = theme;
        document.documentElement.setAttribute("data-theme", theme);
        await fetch("/api/settings", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ theme }),
        });
    }

    async function toggleSpecials() {
        savingSpecials = true;
        await fetch("/api/settings", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ include_specials: includeSpecials ? 1 : 0 }),
        });
        savingSpecials = false;
    }

    async function saveHeartBorder() {
        savingHeartBorder = true;
        await fetch("/api/settings", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                heart_border_movies: heartBorderMovies ? 1 : 0,
                heart_border_shows: heartBorderShows ? 1 : 0,
                heart_border_music: heartBorderMusic ? 1 : 0,
                heart_border_people: heartBorderPeople ? 1 : 0,
            }),
        });
        savingHeartBorder = false;
    }
    // Calendar display settings
    // svelte-ignore state_referenced_locally
    let calendarShowMovies = $state(data.settings.calendarShowMovies ?? true);
    // svelte-ignore state_referenced_locally
    let calendarShowShows = $state(data.settings.calendarShowShows ?? true);
    // svelte-ignore state_referenced_locally
    let calendarShowMusic = $state(data.settings.calendarShowMusic ?? true);
    // svelte-ignore state_referenced_locally
    let calendarMaxPerDay = $state(data.settings.calendarMaxPerDay ?? 2);
    let savingCalendar = $state(false);

    async function saveCalendarSettings() {
        savingCalendar = true;
        await fetch("/api/settings", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                calendar_show_movies: calendarShowMovies ? 1 : 0,
                calendar_show_shows: calendarShowShows ? 1 : 0,
                calendar_show_music: calendarShowMusic ? 1 : 0,
                calendar_max_per_day: calendarMaxPerDay,
            }),
        });
        savingCalendar = false;
    }
</script>

<div class="space-y-6">
    <!-- Theme -->
    <div class="card bg-base-200/50 border border-base-300">
        <div class="card-body">
            <h2 class="card-title text-lg">
                <MdiIcon icon={mdiWhiteBalanceSunny} size={20} class="text-accent" />
                Appearance
            </h2>
            <p class="text-sm text-base-content/60 mb-3">
                Choose your preferred theme. Changes are saved automatically.
            </p>
            <div class="grid grid-cols-4 sm:grid-cols-6 gap-2">
                {#each DAISY_THEMES as theme}
                    <button
                        class="btn btn-sm capitalize rounded-lg"
                        class:btn-primary={currentTheme === theme}
                        class:btn-ghost={currentTheme !== theme}
                        onclick={() => setTheme(theme)}
                        data-theme={theme}
                    >
                        <div
                            class="flex gap-0.5 rounded overflow-hidden h-3 mr-1"
                        >
                            <span class="w-1.5 bg-primary"></span>
                            <span class="w-1.5 bg-secondary"></span>
                            <span class="w-1.5 bg-accent"></span>
                        </div>
                        <span class="text-[10px] truncate">{theme}</span>
                    </button>
                {/each}
            </div>
        </div>
    </div>

    <!-- Data Display Options -->
    <div class="card bg-base-200/50 border border-base-300">
        <div class="card-body">
            <h2 class="card-title text-lg">
                <MdiIcon icon={mdiViewList} size={20} class="text-info" />
                Data Display
            </h2>
            <div class="form-control">
                <label class="label cursor-pointer justify-start gap-3">
                    <input
                        type="checkbox"
                        class="toggle toggle-primary toggle-sm"
                        bind:checked={includeSpecials}
                        onchange={toggleSpecials}
                        disabled={savingSpecials}
                    />
                    <div>
                        <span class="label-text"
                            >Include Specials (Season 0) in statistics</span
                        >
                        <p class="text-xs text-base-content/50 mt-0.5">
                            When enabled, special episodes are counted in show
                            statistics and charts.
                        </p>
                    </div>
                </label>
            </div>
        </div>
    </div>

    <!-- Calendar Display -->
    <div class="card bg-base-200/50 border border-base-300">
        <div class="card-body">
            <h2 class="card-title text-lg">
                <MdiIcon icon={mdiCalendar} size={20} class="text-secondary" />
                Calendar
            </h2>
            <p class="text-sm text-base-content/60 mb-2">
                Choose which media types appear on the dashboard calendar widget and the <a href="/calendar" class="link link-primary">/calendar</a> page.
            </p>
            <div class="space-y-2">
                <label class="label cursor-pointer justify-start gap-3">
                    <input
                        type="checkbox"
                        class="toggle toggle-primary toggle-sm"
                        bind:checked={calendarShowMovies}
                        onchange={saveCalendarSettings}
                        disabled={savingCalendar}
                    />
                    <span class="label-text"><MdiIcon icon={mdiMovieOpen} size={16} /> Movies</span>
                </label>
                <label class="label cursor-pointer justify-start gap-3">
                    <input
                        type="checkbox"
                        class="toggle toggle-primary toggle-sm"
                        bind:checked={calendarShowShows}
                        onchange={saveCalendarSettings}
                        disabled={savingCalendar}
                    />
                    <span class="label-text"><MdiIcon icon={mdiTelevision} size={16} /> TV Shows</span>
                </label>
                <label class="label cursor-pointer justify-start gap-3">
                    <input
                        type="checkbox"
                        class="toggle toggle-primary toggle-sm"
                        bind:checked={calendarShowMusic}
                        onchange={saveCalendarSettings}
                        disabled={savingCalendar}
                    />
                    <span class="label-text"><MdiIcon icon={mdiMusic} size={16} /> Music / Albums</span>
                </label>
            </div>
            <div class="divider my-1"></div>
            <div class="form-control">
                <label class="label cursor-pointer justify-start gap-3">
                    <span class="label-text">Events per day</span>
                    <select
                        class="select select-bordered select-sm w-20"
                        bind:value={calendarMaxPerDay}
                        onchange={saveCalendarSettings}
                        disabled={savingCalendar}
                    >
                        {#each [1, 2, 3, 4, 5] as n}
                            <option value={n}>{n}</option>
                        {/each}
                    </select>
                    <span class="text-xs text-base-content/50">shown before "show more"</span>
                </label>
            </div>
        </div>
    </div>

    <!-- Timezone -->
    <div class="card bg-base-200/50 border border-base-300">
        <div class="card-body">
            <h2 class="card-title text-lg">
                <MdiIcon icon={mdiClockOutline} size={20} class="text-warning" />
                Timezone
            </h2>
            <p class="text-sm text-base-content/60 mb-2">
                Timestamps on the history page and elsewhere will be displayed in this timezone.
            </p>
            <div class="flex items-center gap-2">
                <select
                    class="select select-bordered select-sm flex-1 font-mono text-xs"
                    bind:value={timezone}
                    onchange={saveTimezone}
                    disabled={savingTimezone}
                >
                    {#each TIMEZONES as tz}
                        <option value={tz}>{tz.replace(/_/g, ' ')}</option>
                    {/each}
                    {#if !TIMEZONES.includes(timezone)}
                        <option value={timezone}>{timezone.replace(/_/g, ' ')}</option>
                    {/if}
                </select>
                {#if tzSaved}
                    <span class="badge badge-success badge-sm gap-1">✓ Saved</span>
                {/if}
            </div>
            {#if data.userPreferences?.timezone && data.userPreferences.timezone !== browserTz}
                <p class="text-[11px] text-warning/80 mt-1">
                    ⚠ Your browser reports <strong>{browserTz}</strong> but your setting is <strong>{timezone}</strong>.
                    <button class="link link-primary text-[11px]" onclick={() => { timezone = browserTz; saveTimezone(); }}>Update to browser timezone</button>
                </p>
            {/if}
        </div>
    </div>

    <!-- Favorite Heart Border -->
    <div class="card bg-base-200/50 border border-base-300">
        <div class="card-body">
            <h2 class="card-title text-lg">
                <MdiIcon icon={mdiHeart} size={20} class="text-error" />
                Favorite Heart Border
            </h2>
            <p class="text-sm text-base-content/60 mb-2">
                Show a decorative heart border around poster images for
                favorited items. Toggle per media type.
            </p>
            <div class="space-y-2">
                <label class="label cursor-pointer justify-start gap-3">
                    <input
                        type="checkbox"
                        class="toggle toggle-error toggle-sm"
                        bind:checked={heartBorderMovies}
                        onchange={saveHeartBorder}
                        disabled={savingHeartBorder}
                    />
                    <span class="label-text"><MdiIcon icon={mdiMovieOpen} size={16} /> Movies</span>
                </label>
                <label class="label cursor-pointer justify-start gap-3">
                    <input
                        type="checkbox"
                        class="toggle toggle-error toggle-sm"
                        bind:checked={heartBorderShows}
                        onchange={saveHeartBorder}
                        disabled={savingHeartBorder}
                    />
                    <span class="label-text"><MdiIcon icon={mdiTelevision} size={16} /> TV Shows</span>
                </label>
                <label class="label cursor-pointer justify-start gap-3">
                    <input
                        type="checkbox"
                        class="toggle toggle-error toggle-sm"
                        bind:checked={heartBorderMusic}
                        onchange={saveHeartBorder}
                        disabled={savingHeartBorder}
                    />
                    <span class="label-text"><MdiIcon icon={mdiMusic} size={16} /> Music / Artists</span>
                </label>
                <label class="label cursor-pointer justify-start gap-3">
                    <input
                        type="checkbox"
                        class="toggle toggle-error toggle-sm"
                        bind:checked={heartBorderPeople}
                        onchange={saveHeartBorder}
                        disabled={savingHeartBorder}
                    />
                    <span class="label-text"><MdiIcon icon={mdiAccount} size={16} /> People</span>
                </label>
            </div>
        </div>
    </div>
</div>

