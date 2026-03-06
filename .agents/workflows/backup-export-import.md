---
description: Ensure all data changes and new features are included in the backup export/import process
---

# Backup Export/Import Checklist

Any time a new database table is created or an existing table schema is modified, the backup export and import **must** be updated to include the changes.

## Files to Update

1. **Export** — `src/routes/api/backup/+server.js`
   - Add a `tables['table_name'] = db.prepare('SELECT * FROM table_name').all();` line for each new table

2. **Import** — `src/routes/api/backup/import/+server.js`
   - Add the new table name to the `importOrder` array
   - Respect foreign key dependencies: tables that reference other tables must come **after** the tables they reference
   - If the table has special import logic (like `app_settings`), add a dedicated handler

## Rules

- **Every new table** must be added to both export and import
- **Column additions** to existing tables are handled automatically by the generic import logic (columns map dynamically from the JSON keys)
- **Sensitive fields** (passwords, tokens, API keys) should be stripped from export unless the user opts in via query params (see `includePasswords`, `includeTokens`, `includeApiKeys`)
- **Test round-trips**: after adding a new table, verify that `export → import` preserves all data by doing a manual export, fresh install, and import
