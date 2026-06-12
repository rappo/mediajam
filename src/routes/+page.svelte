<script>
    import { onMount, onDestroy } from "svelte";
    import { imgUrl } from "$lib/utils.js";
    import Skeleton from "$lib/components/Skeleton.svelte";
    import PosterRow from "$lib/components/PosterRow.svelte";
    // import DashboardCalendar from "$lib/components/DashboardCalendar.svelte";
    import DashboardCalendarHero from "$lib/components/DashboardCalendarHero.svelte";

    let { data } = $props();

    let loading = $state(true);
    let dash = $state(null);
    let error = $state(null);

    // Calendar settings
    let calendarDays = $state(14);
    let calendarTypes = $state(['movie', 'show', 'artist']);

    // Trending pagination
    let trendingMoviePage = $state(1);
    let trendingShowPage = $state(1);
    let loadingMoreMovies = $state(false);
    let loadingMoreShows = $state(false);

    async function fetchDashboard() {
        try {
            const params = new URLSearchParams({
                calendarDays: String(calendarDays),
                calendarTypes: calendarTypes.join(','),
            });
            const res = await fetch(`/api/pages/dashboard?${params}`);
            if (!res.ok) throw new Error('Failed to load dashboard');
            dash = await res.json();
            loading = false;
        } catch (e) {
            error = e.message;
            loading = false;
        }
    }

    async function refreshCalendar(settings) {
        calendarDays = settings.calendarDays;
        calendarTypes = settings.calendarTypes;
        try {
            const params = new URLSearchParams({
                calendarDays: String(calendarDays),
                calendarTypes: calendarTypes.join(','),
            });
            const res = await fetch(`/api/pages/dashboard?${params}`);
            if (res.ok) {
                const fresh = await res.json();
                dash = { ...dash, upcoming: fresh.upcoming };
            }
        } catch { /* silent */ }
    }

    async function loadMoreTrendingMovies() {
        if (loadingMoreMovies || !dash?.trendingMovies) return;
        loadingMoreMovies = true;
        try {
            const nextPage = trendingMoviePage + 1;
            const res = await fetch(`/api/pages/dashboard?section=trendingMovies&trendingMoviePage=${nextPage}`);
            if (res.ok) {
                const moreData = await res.json();
                if (moreData.items?.length > 0) {
                    dash = {
                        ...dash,
                        trendingMovies: {
                            ...moreData,
                            items: [...dash.trendingMovies.items, ...moreData.items],
                        },
                    };
                    trendingMoviePage = nextPage;
                }
            }
        } catch { /* silent */ }
        loadingMoreMovies = false;
    }

    async function loadMoreTrendingShows() {
        if (loadingMoreShows || !dash?.trendingShows) return;
        loadingMoreShows = true;
        try {
            const nextPage = trendingShowPage + 1;
            const res = await fetch(`/api/pages/dashboard?section=trendingShows&trendingShowPage=${nextPage}`);
            if (res.ok) {
                const moreData = await res.json();
                if (moreData.items?.length > 0) {
                    dash = {
                        ...dash,
                        trendingShows: {
                            ...moreData,
                            items: [...dash.trendingShows.items, ...moreData.items],
                        },
                    };
                    trendingShowPage = nextPage;
                }
            }
        } catch { /* silent */ }
        loadingMoreShows = false;
    }

    // Trending movie items formatted for PosterRow
    let trendingMovieItems = $derived(
        (dash?.trendingMovies?.items || []).map(m => ({
            href: m.in_library ? `/movies/${m.library_slug || m.tmdb_id}` : `/movies/${m.library_slug || m.tmdb_id}`,
            title: m.title,
            subtitle: m.release_year || '',
            poster_url: m.poster_url,
            badge: m.in_library ? '✓ Library' : null,
        }))
    );

    let trendingShowItems = $derived(
        (dash?.trendingShows?.items || []).map(s => ({
            href: s.in_library ? `/tv/${s.library_slug || s.tmdb_id}` : `/tv/${s.library_slug || s.tmdb_id}`,
            title: s.title,
            subtitle: s.release_year || '',
            poster_url: s.poster_url,
            badge: s.in_library ? '✓ Library' : null,
        }))
    );

    let recommendedItems = $derived(
        (dash?.recommended || []).map(m => ({
            href: `/movies/${m.slug || m.id}`,
            title: m.title,
            subtitle: m.reason || String(m.release_year || ''),
            poster_url: m.poster_url,
        }))
    );

    let actorUnwatchedItems = $derived(
        (dash?.actorDeepDive?.unwatched || []).map(m => ({
            href: m.href || `/movies/${m.slug || m.id}`,
            title: m.title,
            subtitle: String(m.release_year || ''),
            poster_url: m.poster_url,
        }))
    );

    let recentlyAddedFilter = $state('all'); // 'all' | 'show' | 'movie' | 'artist'
    let recentlyAddedAll = $derived(
        (dash?.recentlyAdded || []).map(m => ({
            href: m.href,
            title: m.title,
            subtitle: String(m.subtitle || ''),
            poster_url: m.poster_url,
            icon: m.icon,
            badge: m.badge || null,
            media_type: m.media_type,
        }))
    );
    let recentlyAddedItems = $derived(
        recentlyAddedFilter === 'all'
            ? recentlyAddedAll
            : recentlyAddedAll.filter(m => m.media_type === recentlyAddedFilter)
    );

    let hotAlbumItems = $derived(
        (dash?.hotAlbums || []).map(a => ({
            href: a.href,
            title: a.title,
            subtitle: a.subtitle,
            poster_url: a.poster_url,
            badge: a.badge,
            icon: a.icon,
        }))
    );

    // Hero card: rotate through watchlist every 60s
    let heroIndex = $state(0);
    let heroProgress = $state(0);
    let heroInterval = null;
    let heroProgressInterval = null;
    const HERO_ROTATE_MS = 60000;
    const HERO_TICK_MS = 100;

    let hero = $derived.by(() => {
        const wl = dash?.watchlist;
        if (!wl || wl.length === 0) return null;
        return wl[heroIndex % wl.length];
    });
    let heroPath = $derived(
        hero
            ? `/${hero.media_type === 'movie' ? 'movies' : hero.media_type === 'show' ? 'tv' : 'music'}/${hero.slug || hero.id}`
            : null
    );

    function startHeroRotation() {
        stopHeroRotation();
        heroProgress = 0;
        heroProgressInterval = setInterval(() => {
            heroProgress = Math.min(heroProgress + (HERO_TICK_MS / HERO_ROTATE_MS) * 100, 100);
        }, HERO_TICK_MS);
        heroInterval = setInterval(() => {
            const wl = dash?.watchlist;
            if (wl && wl.length > 1) {
                heroIndex = (heroIndex + 1) % wl.length;
            }
            heroProgress = 0;
        }, HERO_ROTATE_MS);
    }

    function stopHeroRotation() {
        if (heroInterval) { clearInterval(heroInterval); heroInterval = null; }
        if (heroProgressInterval) { clearInterval(heroProgressInterval); heroProgressInterval = null; }
    }

    onMount(() => {
        fetchDashboard().then(() => {
            // Pick a random starting index
            const wl = dash?.watchlist;
            if (wl && wl.length > 0) {
                heroIndex = Math.floor(Math.random() * wl.length);
            }
            startHeroRotation();
        });
    });
    onDestroy(stopHeroRotation);
</script>

<svelte:head>
    <title>Mediajam — Dashboard</title>
</svelte:head>

<div class="dashboard">
    {#if loading}
        <!-- Skeleton loading state -->
        <div class="dash-skeleton">
            <div class="skel-greeting">
                <div class="skel-bar skel-wide"></div>
                <div class="skel-bar skel-narrow"></div>
            </div>
            <Skeleton type="stat-cards" />
            <div class="skel-hero-block"></div>
            <Skeleton type="poster-row" />
            <Skeleton type="poster-row" />
        </div>
    {:else if error}
        <div class="dash-error">
            <span class="dash-error-icon">⚠️</span>
            <p>{error}</p>
            <button class="btn btn-primary btn-sm" onclick={fetchDashboard}>Retry</button>
        </div>
    {:else if dash}
        <!-- Hero / Watchlist spotlight -->
        {#if hero}
            <div class="dash-hero-glow-wrap">
                <div class="dash-hero-glow" style="background-image: url({imgUrl(hero.backdrop_url || hero.poster_url)});"></div>
                <a href={heroPath} class="dash-hero">
                    <img class="dash-hero-bg" src={imgUrl(hero.backdrop_url || hero.poster_url)} alt="" />
                    <div class="dash-hero-overlay">
                        <span class="dash-hero-badge">FROM YOUR WATCHLIST</span>
                        <h2 class="dash-hero-title">{hero.title}</h2>
                        <p class="dash-hero-year">{hero.release_year || ''}</p>
                        {#if hero.overview}
                            <p class="dash-hero-overview">{hero.overview.slice(0, 160)}{hero.overview.length > 160 ? '…' : ''}</p>
                        {/if}
                        <span class="dash-hero-btn">▶ View Details</span>
                    </div>
                    <!-- Progress bar -->
                    {#if dash?.watchlist?.length > 1}
                        <div class="dash-hero-progress">
                            <div class="dash-hero-progress-fill" style="width: {heroProgress}%"></div>
                        </div>
                    {/if}
                </a>
            </div>
        {/if}

        <!-- Stats bar (thin inline) -->
        <div class="dash-stats-bar">
            <div class="stat-cell">
                <div class="stat-cell-top">
                    <svg xmlns="http://www.w3.org/2000/svg" class="stat-cell-icon" style="color: oklch(var(--color-movies))" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"/><line x1="7" y1="2" x2="7" y2="22"/><line x1="17" y1="2" x2="17" y2="22"/><line x1="2" y1="12" x2="22" y2="12"/></svg>
                    <span class="stat-cell-value" style="color: oklch(var(--color-movies))">{(dash.stats?.movies || 0).toLocaleString()}</span>
                </div>
                <span class="stat-cell-label">Movies</span>
            </div>
            <div class="stat-cell">
                <div class="stat-cell-top">
                    <svg xmlns="http://www.w3.org/2000/svg" class="stat-cell-icon" style="color: oklch(var(--color-movies) / 0.5)" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>
                    <span class="stat-cell-value" style="color: oklch(var(--color-movies) / 0.5)">{dash.stats?.movieGB >= 1000 ? (dash.stats.movieGB / 1024).toFixed(1) + ' TB' : (dash.stats?.movieGB || 0).toLocaleString() + ' GB'}</span>
                </div>
                <span class="stat-cell-label">Movie Size</span>
            </div>
            {#if dash.watchlist?.length > 0}
                <div class="stat-cell">
                    <div class="stat-cell-top">
                        <svg xmlns="http://www.w3.org/2000/svg" class="stat-cell-icon" style="color: oklch(var(--color-movies) / 0.7)" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
                        <span class="stat-cell-value" style="color: oklch(var(--color-movies) / 0.7)">{dash.watchlist.length}</span>
                    </div>
                    <span class="stat-cell-label">Watchlist</span>
                </div>
            {/if}

            <div class="stat-cell-divider"></div>

            <div class="stat-cell">
                <div class="stat-cell-top">
                    <svg xmlns="http://www.w3.org/2000/svg" class="stat-cell-icon" style="color: oklch(var(--color-tv))" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="7" width="20" height="15" rx="2" ry="2"/><polyline points="17 2 12 7 7 2"/></svg>
                    <span class="stat-cell-value" style="color: oklch(var(--color-tv))">{(dash.stats?.shows || 0).toLocaleString()}</span>
                </div>
                <span class="stat-cell-label">TV Shows</span>
            </div>
            <div class="stat-cell">
                <div class="stat-cell-top">
                    <svg xmlns="http://www.w3.org/2000/svg" class="stat-cell-icon" style="color: oklch(var(--color-tv) / 0.7)" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="8 12 12 16 16 12"/><line x1="12" y1="8" x2="12" y2="16"/></svg>
                    <span class="stat-cell-value" style="color: oklch(var(--color-tv) / 0.7)">{(dash.stats?.episodes || 0).toLocaleString()}</span>
                </div>
                <span class="stat-cell-label">Episodes</span>
            </div>
            <div class="stat-cell">
                <div class="stat-cell-top">
                    <svg xmlns="http://www.w3.org/2000/svg" class="stat-cell-icon" style="color: oklch(var(--color-tv) / 0.5)" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>
                    <span class="stat-cell-value" style="color: oklch(var(--color-tv) / 0.5)">{dash.stats?.showGB >= 1000 ? (dash.stats.showGB / 1024).toFixed(1) + ' TB' : (dash.stats?.showGB || 0).toLocaleString() + ' GB'}</span>
                </div>
                <span class="stat-cell-label">TV Size</span>
            </div>

            <div class="stat-cell-divider"></div>

            <div class="stat-cell">
                <div class="stat-cell-top">
                    <svg xmlns="http://www.w3.org/2000/svg" class="stat-cell-icon" style="color: oklch(var(--color-music))" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
                    <span class="stat-cell-value" style="color: oklch(var(--color-music))">{(dash.stats?.artists || 0).toLocaleString()}</span>
                </div>
                <span class="stat-cell-label">Artists</span>
            </div>
            <div class="stat-cell">
                <div class="stat-cell-top">
                    <svg xmlns="http://www.w3.org/2000/svg" class="stat-cell-icon" style="color: oklch(var(--color-music) / 0.7)" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="1"/></svg>
                    <span class="stat-cell-value" style="color: oklch(var(--color-music) / 0.7)">{(dash.stats?.albums || 0).toLocaleString()}</span>
                </div>
                <span class="stat-cell-label">Albums</span>
            </div>
            <div class="stat-cell">
                <div class="stat-cell-top">
                    <svg xmlns="http://www.w3.org/2000/svg" class="stat-cell-icon" style="color: oklch(var(--color-music) / 0.5)" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>
                    <span class="stat-cell-value" style="color: oklch(var(--color-music) / 0.5)">{dash.stats?.musicGB >= 1000 ? (dash.stats.musicGB / 1024).toFixed(1) + ' TB' : (dash.stats?.musicGB || 0).toLocaleString() + ' GB'}</span>
                </div>
                <span class="stat-cell-label">Music Size</span>
            </div>
        </div>

        <!-- Calendar -->
        {#if dash.upcoming}
            <!-- <DashboardCalendar upcoming={dash.upcoming} onSettingsChange={refreshCalendar} /> -->
            <DashboardCalendarHero upcoming={dash.upcoming} onSettingsChange={refreshCalendar} />
        {/if}

        <!-- Recently Added -->
        {#if recentlyAddedAll.length > 0}
            <div class="poster-section">
                <div class="poster-title-row">
                    <h3 class="poster-section-title">🆕 Recently Added to Your Library</h3>
                    <div class="media-type-chips">
                        <button class="media-chip" class:active={recentlyAddedFilter === 'all'} onclick={() => recentlyAddedFilter = 'all'}>All</button>
                        <button class="media-chip chip-tv" class:active={recentlyAddedFilter === 'show'} onclick={() => recentlyAddedFilter = 'show'}>📺 TV</button>
                        <button class="media-chip chip-movie" class:active={recentlyAddedFilter === 'movie'} onclick={() => recentlyAddedFilter = 'movie'}>🎬 Movies</button>
                        <button class="media-chip chip-music" class:active={recentlyAddedFilter === 'artist'} onclick={() => recentlyAddedFilter = 'artist'}>🎵 Music</button>
                    </div>
                </div>
            </div>
            <PosterRow title="" items={recentlyAddedItems} />
        {/if}

        <!-- Trending Movies -->
        {#if trendingMovieItems.length > 0}
            <div class="dash-section">
                <PosterRow title="🔥 Trending Movies" items={trendingMovieItems} />
                {#if dash.trendingMovies?.totalPages > trendingMoviePage}
                    <button class="show-more-btn" onclick={loadMoreTrendingMovies} disabled={loadingMoreMovies}>
                        {#if loadingMoreMovies}
                            <span class="loading loading-spinner loading-xs"></span> Loading…
                        {:else}
                            Show More
                        {/if}
                    </button>
                {/if}
            </div>
        {/if}

        <!-- Trending Shows -->
        {#if trendingShowItems.length > 0}
            <div class="dash-section">
                <PosterRow title="📺 Trending Shows" items={trendingShowItems} />
                {#if dash.trendingShows?.totalPages > trendingShowPage}
                    <button class="show-more-btn" onclick={loadMoreTrendingShows} disabled={loadingMoreShows}>
                        {#if loadingMoreShows}
                            <span class="loading loading-spinner loading-xs"></span> Loading…
                        {:else}
                            Show More
                        {/if}
                    </button>
                {/if}
            </div>
        {/if}

        <!-- Recommended for You -->
        {#if recommendedItems.length > 0}
            <PosterRow title="✨ Recommended for You" items={recommendedItems} />
        {/if}

        <!-- Actor Deep Dive -->
        {#if dash.actorDeepDive && actorUnwatchedItems.length > 0}
            <div class="dash-actor-section">
                <div class="dash-actor-header">
                    {#if dash.actorDeepDive.person?.profile_url}
                        <img src={imgUrl(dash.actorDeepDive.person.profile_url)} alt={dash.actorDeepDive.person.name} class="actor-avatar" />
                    {:else}
                        <div class="actor-avatar-placeholder">🎭</div>
                    {/if}
                    <div class="actor-info">
                        <h3 class="actor-name">{dash.actorDeepDive.person.name}</h3>
                        <p class="actor-stats">
                            {dash.actorDeepDive.watchedCount} of {dash.actorDeepDive.totalCount} films watched
                        </p>
                    </div>
                </div>
                <PosterRow
                    title="Unwatched Films"
                    items={actorUnwatchedItems}
                />
            </div>
        {/if}

        <!-- Hot Albums -->
        {#if hotAlbumItems.length > 0}
            <PosterRow title="🎵 Hot Albums" items={hotAlbumItems} square />
        {/if}

    {/if}
</div>

<style>
    .dashboard {
        max-width: 1200px;
        margin: 0 auto;
        padding: 0.25rem 1rem 3rem;
    }

    /* ── Skeleton ──────────────────────────────────────────── */
    .dash-skeleton {
        display: flex;
        flex-direction: column;
        gap: 1.5rem;
    }
    .skel-greeting {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
        padding: 1rem 0;
    }
    .skel-bar {
        height: 1.2rem;
        border-radius: 0.5rem;
        background: linear-gradient(90deg, oklch(var(--bc) / 0.06) 25%, oklch(var(--bc) / 0.12) 50%, oklch(var(--bc) / 0.06) 75%);
        background-size: 200% 100%;
        animation: shimmer 1.5s infinite;
    }
    .skel-wide { width: 40%; height: 2rem; }
    .skel-narrow { width: 60%; height: 0.8rem; }
    .skel-hero-block {
        height: 200px;
        border-radius: 1rem;
        background: linear-gradient(90deg, oklch(var(--bc) / 0.06) 25%, oklch(var(--bc) / 0.12) 50%, oklch(var(--bc) / 0.06) 75%);
        background-size: 200% 100%;
        animation: shimmer 1.5s infinite;
    }
    @keyframes shimmer {
        0% { background-position: -200% 0; }
        100% { background-position: 200% 0; }
    }

    /* ── Error ──────────────────────────────────────────────── */
    .dash-error {
        text-align: center;
        padding: 4rem 2rem;
        color: oklch(var(--bc) / 0.6);
    }
    .dash-error-icon {
        font-size: 2.5rem;
        display: block;
        margin-bottom: 1rem;
    }

    /* ── Greeting (removed - hero goes first) ─────────────── */

    /* ── Stats bar (thin inline) ──────────────────────────── */
    .dash-stats-bar {
        display: flex;
        align-items: stretch;
        gap: 0;
        margin-bottom: 0.75rem;
        background: oklch(var(--b1) / 0.65);
        backdrop-filter: blur(16px) brightness(0.85);
        -webkit-backdrop-filter: blur(16px) brightness(0.85);
        border: 1px solid oklch(var(--bc) / 0.1);
        border-radius: 0.6rem;
        overflow: hidden;
    }
    .stat-cell {
        flex: 1;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: 0.4rem 0.3rem;
        gap: 0.1rem;
    }
    .stat-cell-top {
        display: flex;
        align-items: center;
        gap: 0.3rem;
    }
    .stat-cell-icon {
        width: 13px;
        height: 13px;
        flex-shrink: 0;
        opacity: 0.9;
    }
    .stat-cell-value {
        font-size: 0.85rem;
        font-weight: 800;
        line-height: 1;
        white-space: nowrap;
    }
    .stat-cell-label {
        font-size: 0.5rem;
        font-weight: 600;
        letter-spacing: 0.03em;
        color: oklch(var(--bc) / 0.35);
        text-transform: uppercase;
        white-space: nowrap;
    }
    .stat-cell-divider {
        width: 1px;
        background: oklch(var(--bc) / 0.08);
        align-self: stretch;
        margin: 0.35rem 0;
    }
    @media (max-width: 767px) {
        .dash-stats-bar {
            flex-wrap: wrap;
        }
        .stat-cell {
            flex: 0 0 25%;
        }
        .stat-cell-divider {
            display: none;
        }
    }

    /* ── Hero / Watchlist ───────────────────────────────────── */
    .dash-hero-glow-wrap {
        position: relative;
        isolation: isolate;
        margin-bottom: 0.75rem;
        border-radius: 1rem;
    }
    .dash-hero-glow {
        position: absolute;
        inset: -20px;
        z-index: -1;
        pointer-events: none;
        background-size: cover;
        background-position: center;
        filter: blur(50px) saturate(2.5);
        opacity: 0.7;
    }
    .dash-hero {
        display: block;
        position: relative;
        border-radius: 1rem;
        overflow: hidden;
        height: 220px;
        text-decoration: none;
        color: inherit;
        transition: transform 0.2s;
    }
    .dash-hero-bg {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        object-fit: cover;
    }
    .dash-hero:hover {
        transform: scale(1.005);
    }
    .dash-hero-overlay {
        position: absolute;
        inset: 0;
        background: linear-gradient(to right, rgba(0,0,0,0.6) 35%, rgba(0,0,0,0.05) 100%);
        padding: 1.5rem;
        display: flex;
        flex-direction: column;
        justify-content: flex-end;
    }
    .dash-hero-badge {
        font-size: 0.6rem;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: oklch(var(--p));
        background: oklch(var(--p) / 0.15);
        padding: 0.15rem 0.5rem;
        border-radius: 999px;
        width: fit-content;
        margin-bottom: 0.4rem;
    }
    .dash-hero-title {
        font-size: 1.5rem;
        font-weight: 800;
        color: #fff;
        margin: 0;
        line-height: 1.15;
    }
    .dash-hero-year {
        font-size: 0.8rem;
        color: rgba(255,255,255,0.6);
        margin: 0.15rem 0 0;
    }
    .dash-hero-overview {
        font-size: 0.75rem;
        color: rgba(255,255,255,0.5);
        margin: 0.35rem 0 0;
        line-height: 1.4;
        max-width: 400px;
    }
    .dash-hero-btn {
        display: inline-flex;
        align-items: center;
        gap: 0.3rem;
        font-size: 0.75rem;
        font-weight: 700;
        color: oklch(var(--p));
        margin-top: 0.6rem;
        transition: color 0.15s;
    }
    .dash-hero:hover .dash-hero-btn {
        color: oklch(var(--pc));
        background: oklch(var(--p));
        padding: 0.25rem 0.75rem;
        border-radius: 999px;
        width: fit-content;
    }
    .dash-hero-progress {
        position: absolute;
        bottom: 0;
        left: 0;
        right: 0;
        height: 2px;
        background: rgba(255,255,255,0.08);
        z-index: 3;
        pointer-events: none;
    }
    .dash-hero-progress-fill {
        height: 100%;
        background: oklch(var(--p));
        transition: width 0.1s linear;
    }

    /* ── Section ────────────────────────────────────────────── */
    .dash-section {
        margin-bottom: 0.5rem;
    }
    .show-more-btn {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 0.3rem;
        width: 100%;
        padding: 0.4rem;
        font-size: 0.75rem;
        font-weight: 600;
        color: oklch(var(--p));
        background: oklch(var(--p) / 0.08);
        border: 1px solid oklch(var(--p) / 0.15);
        border-radius: 0.5rem;
        cursor: pointer;
        transition: all 0.15s;
        margin-top: 0.5rem;
    }
    .show-more-btn:hover:not(:disabled) {
        background: oklch(var(--p) / 0.15);
        border-color: oklch(var(--p) / 0.3);
    }
    .show-more-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
    }

    /* ── Actor Deep Dive ────────────────────────────────────── */
    .dash-actor-section {
        background: oklch(var(--b2) / 0.5);
        border: 1px solid oklch(var(--bc) / 0.06);
        border-radius: 1rem;
        padding: 1rem;
        margin-bottom: 1.5rem;
        backdrop-filter: blur(12px);
    }
    .dash-actor-header {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        margin-bottom: 0.5rem;
    }
    .actor-avatar {
        width: 48px;
        height: 48px;
        border-radius: 50%;
        object-fit: cover;
        border: 2px solid oklch(var(--p) / 0.3);
    }
    .actor-avatar-placeholder {
        width: 48px;
        height: 48px;
        border-radius: 50%;
        background: oklch(var(--b3));
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 1.5rem;
        border: 2px solid oklch(var(--p) / 0.3);
    }
    .actor-info {
        flex: 1;
        min-width: 0;
    }
    .actor-name {
        font-size: 1rem;
        font-weight: 700;
        color: oklch(var(--bc));
        margin: 0;
    }
    .actor-stats {
        font-size: 0.75rem;
        color: oklch(var(--bc) / 0.5);
        margin: 0.15rem 0 0;
    }

    @media (min-width: 768px) {
        .dashboard {
            padding: 1rem 2rem 4rem;
        }
        .dash-hero {
            height: 280px;
        }
        .dash-hero-title {
            font-size: 2rem;
        }
    }

    /* Filter chips for Recently Added */
    .poster-title-row {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        margin-bottom: 0.25rem;
    }
    .poster-title-row::after {
        content: '';
        flex: 1;
        height: 1px;
        background: currentColor;
        opacity: 0.12;
        min-width: 2rem;
        margin-left: 0.5rem;
    }
    .poster-section-title {
        font-size: 1.1rem;
        font-weight: 700;
        opacity: 0.9;
        white-space: nowrap;
    }
    .media-type-chips {
        display: flex;
        gap: 0.3rem;
    }
    .media-chip {
        font-size: 0.65rem;
        font-weight: 600;
        padding: 0.15rem 0.5rem;
        border-radius: 999px;
        border: 1px solid oklch(var(--bc) / 0.15);
        background: oklch(var(--b2) / 0.5);
        color: oklch(var(--bc) / 0.6);
        cursor: pointer;
        transition: all 0.15s;
        white-space: nowrap;
    }
    .media-chip:hover {
        border-color: oklch(var(--bc) / 0.3);
        color: oklch(var(--bc) / 0.8);
    }
    .media-chip.active {
        background: oklch(var(--bc) / 0.12);
        border-color: oklch(var(--bc) / 0.3);
        color: oklch(var(--bc));
    }
    .chip-tv.active {
        background: oklch(0.55 0.15 160 / 0.2);
        border-color: oklch(0.55 0.15 160 / 0.5);
        color: oklch(0.75 0.15 160);
    }
    .chip-movie.active {
        background: oklch(0.65 0.15 85 / 0.2);
        border-color: oklch(0.65 0.15 85 / 0.5);
        color: oklch(0.8 0.15 85);
    }
    .chip-music.active {
        background: oklch(0.55 0.15 300 / 0.2);
        border-color: oklch(0.55 0.15 300 / 0.5);
        color: oklch(0.75 0.15 300);
    }
</style>
