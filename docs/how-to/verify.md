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
