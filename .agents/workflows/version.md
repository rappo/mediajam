---
description: Version the build with a timestamp on every commit
---

# Build Versioning

Every time code is committed (or about to be committed), the build version **MUST** be updated.

## Steps

// turbo-all

1. Update `src/lib/version.js` with the current EST timestamp in `YYYY-MM-DD_HH-MM` format:
   ```js
   export const BUILD_VERSION = 'YYYY-MM-DD_HH-MM';
   ```
   The timestamp should reflect the **current local time** at the moment of the commit, in **Eastern Time (EST/EDT)**.

2. Include the version file change in the commit — it should be part of the same `git add` and `git commit`.

## Rules

- **Every commit** must include an updated `src/lib/version.js`, no exceptions.
- The version is displayed in the Settings layout footer so users can verify which build is deployed.
- Use 24-hour format for the time portion (e.g., `2026-03-07_14-30`).
