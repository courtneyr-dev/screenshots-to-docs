---
title: Detect a release
parent: How-to guides
nav_order: 2
---

# Detect a release

When P1 ships a new version, find the screenshots that show the old UI and approve them for a reshoot.

{% include video.html name="01-detect-release" title="A release is detected" %}

## Steps

1. List the screenshots and the release each was captured for:

   ```bash
   node scripts/inventory.mjs list --inventory <inventory>
   ```

2. Compare the SDK the capture app runs with the latest published version:

   ```bash
   node scripts/inventory.mjs release-check --registry --inventory <inventory>
   node scripts/inventory.mjs release-check --app <capture app folder> --inventory <inventory>
   ```

   If the app still runs the old version, update it first: screenshots show the installed UI.

3. Check the inventory against the new version:

   ```bash
   node scripts/inventory.mjs release-check --version <new version> --inventory <inventory>
   ```

   Each screenshot captured for an older version is listed as `BEHIND`, with the exact command that
   retargets it.

4. Decide which ones need a new image, and approve each for the new release:

   ```bash
   node scripts/inventory.mjs transition --id <id> --to approved --release <new version> --inventory <inventory>
   ```

   The record keeps its earlier release in `history` and moves to `approved` with `release_status: refresh`.
   Nothing is captured until a person approves it.

Next: [Capture the editor](capture.html).
