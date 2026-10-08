---
title: Verify and trace
parent: How-to guides
nav_order: 10
---

# Verify and trace

Confirm each published image is the one you recorded, and audit every image's chain.

{% include video.html name="08-verify" title="Verify and trace" %}

## Steps

1. Trace every image from release to checksum, Figma frames, and docs slot. It also checks each file on disk:

   ```bash
   node scripts/inventory.mjs trace --inventory <inventory> --assets-dir <assets>
   ```

   ```text
   Images checked: 2. With problems: 0. Inventory gaps: 0. Records not captured yet: 0.

   p1.live.editor-shell
     → release 0.20.0
     → screenshots/p1.live.editor-shell/0.20.0.png  sha256 88ed609b652aded5…  2880x1800  (file checked)
     → Figma uploaded: page RUN-2026-10-07 · p1-live-20261007-1423 / clean node 63:8 / annotated node 63:38
     → docs <doc ID> / "Live test: tour the editor" / Live test: tour the editor #1 (annotated frame)
     → published (not known)
     → verification unverified
   ```

   It exits 1 on any missing link.

2. List what isn't verified yet:

   ```bash
   node scripts/inventory.mjs lookup --unverified --inventory <inventory>
   ```

3. For each published image, open the page, check the image shows the right state, and compare its alt text:

   ```bash
   node scripts/inventory.mjs check-alt --id <id> --notes "<alt text copied from the page>" --inventory <inventory>
   ```

4. Download the image the page serves, record it, and mark it verified:

   ```bash
   node scripts/inventory.mjs record-publication --id <id> --published-url <image url> --published-file <downloaded image> --verified-at <time> --inventory <inventory>
   node scripts/inventory.mjs transition --id <id> --to verified --inventory <inventory>
   ```

   The published checksum can differ from the export: publishing may resize or re-encode the image.

For Markdown docs, the swap commit itself is the check: the checksum of the image in the commit equals the
one in the inventory.
