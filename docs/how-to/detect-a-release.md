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

   ```text
   @pantheon-systems/p1-next-sdk 0.16.0 (installed in the app), latest published 0.20.0
     WARN: the app you would capture runs @pantheon-systems/p1-next-sdk 0.16.0, but 0.20.0 is the latest published.
   ```

   If the app still runs the old version, update it first: screenshots show the installed UI.

3. Check the inventory against the new version:

   ```bash
   node scripts/inventory.mjs release-check --version <new version> --inventory <inventory>
   ```

   ```text
   @pantheon-systems/p1-next-sdk 0.20.0
     0 screenshot(s) already captured for 0.20.0
     BEHIND  p1.live.editor-shell  (captured, still targets 0.16.0); finish or retarget it with: transition --id p1.live.editor-shell --to approved --release 0.20.0
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
