# AGENTS.md — MediaJam Project Rules

> Authoritative reference for any AI agent (or human) contributing to this codebase.

---

## 1. Build Versioning

Every commit **must** include an updated `src/lib/version.js`:

```js
export const BUILD_VERSION = 'YYYY-MM-DD_HH-MM';
```

- Timestamp = **current local time in Eastern Time (EST/EDT)**, 24-hour format.
- Include the version file change in the **same** `git add` & `git commit`.
- The version is displayed in the Settings footer.

---

## 2. API Documentation (OpenAPI)

`docs/openapi.yaml` is the single source of truth for the REST API and powers Swagger UI at `/api/docs`.

**When adding, modifying, or removing any `src/routes/api/**/+server.js` file:**

1. Update `docs/openapi.yaml` to match the new route, method, parameters, and response schema.
2. Remove entries for deleted routes.
3. Add appropriate tags (see existing tags at the top of the file).
4. The spec is served at runtime from the Docker container; it is copied during the build via `COPY --from=builder /app/docs ./docs` in the `Dockerfile`.
5. Check `src/mcp/tools/` for any MCP tools that wrap the endpoint and update them accordingly.

---

## 3. Backup Export / Import

When a **new database table** is created or an existing schema is modified:

1. **Export** — add a `tables['table_name'] = db.prepare('SELECT * FROM table_name').all();` line in `src/routes/api/backup/+server.js`.
2. **Import** — add the table to the `importOrder` array in `src/routes/api/backup/import/+server.js`. Respect foreign key order.
3. **Sensitive fields** (passwords, tokens, API keys) must be stripped from export unless opted in via query params.

---

## 4. Sync Logging & SSE

All sync operations must implement:

- **SSE streaming** — real-time progress via `EventSource`.
- **Console logging** — `console.log` with timestamped emoji prefixes.
- **File logging** — use `logError` / `logInfo` / `logWarn` from `$lib/server/logger.js`.
- **LogConsole component** — all UI log output uses `<LogConsole>` from `$lib/components/LogConsole.svelte`. Never create custom log divs.
- **Cleanup** — all `EventSource` instances must be closed on component unmount.

---

## 5. Database Conventions

- Database: **SQLite** via `better-sqlite3` (imported as `$lib/server/db.js`).
- Schema defined inline in `db.js` as `CREATE TABLE IF NOT EXISTS` + migration blocks.
- Migrations use `PRAGMA table_info()` to detect missing columns and `ALTER TABLE ADD COLUMN` to add them.
- All new tables need a corresponding entry in the backup export/import (see rule 3).

---

## 6. Route Conventions (SvelteKit)

- API endpoints live in `src/routes/api/<feature>/+server.js`.
- Export named functions: `GET`, `POST`, `PUT`, `PATCH`, `DELETE`.
- Return `json(...)` from `@sveltejs/kit`.
- Auth is enforced centrally in `src/hooks.server.js`; endpoints listed in `publicPaths` bypass auth.
- Dynamic params use `[param]` in folder names (e.g., `[id]`, `[service]`, `[slug]`).

---

## 7. Frontend Conventions

- **Framework**: SvelteKit 5 with Svelte 5 runes (`$state`, `$derived`, `$effect`, `$props`).
- **Styling**: DaisyUI + Tailwind CSS. Use DaisyUI component classes (`btn`, `card`, `badge`, etc.) and oklch color tokens (`oklch(var(--p))`).
- **Image proxy**: Always use `imgUrl()` from `$lib/utils.js` to proxy external images.
- **Slug routing**: Media and people pages use slug-based URLs (e.g., `/movies/the-matrix-1999`).

---

## 8. Git & Commit Rules

- `git pull` at the start of every session before making changes.
- Version bump on every commit (see rule 1).
- Commit messages should be descriptive; use multi-line messages for multi-change commits.
- Push immediately after committing.

---

## 9. Forgejo Integration

- Issue tracker URL and credentials are stored in `.agents/forgejo.env` (gitignored).
- API token stored in `.agents/forgejo.env` (gitignored).
- Create Forgejo issues for non-trivial TODOs instead of leaving code comments.

---

## 10. Debug API Key

- Production API key and base URL are stored in `.agents/debug.env` (gitignored).
- Use `Authorization: Bearer <API_KEY>` header (NOT `x-api-key`).
- Useful for testing endpoints directly: `curl -H "Authorization: Bearer $API_KEY" $BASE_URL/api/sync/status`
- The key has full permissions and does not expire.

---

## 11. MCP Server

The MCP (Model Context Protocol) server lives in `src/mcp/` and exposes the MediaJam API to LLM agents.

- **Architecture**: Pure REST API client — does NOT import DB or server code directly. Connects via `MEDIAJAM_URL` + `MEDIAJAM_API_KEY` environment variables.
- **Tool modules**: Each file in `src/mcp/tools/` exports a `tools` array (tool definitions) and a `handle(name, args)` function.
- **When modifying API endpoints**, check if a corresponding MCP tool exists in `src/mcp/tools/` and update it to match.
- **When adding new API endpoints**, evaluate if an MCP tool should be added (read-only, high LLM value endpoints are best candidates).
- **Tool descriptions** must be clear enough for an LLM to use without examples — describe what the tool does, what inputs it needs, and what it returns.
- **Testing**: `cd src/mcp && npx @modelcontextprotocol/inspector node server.js`
- **Dependencies**: The MCP server has its own `package.json` in `src/mcp/`. Run `npm install` there separately.
