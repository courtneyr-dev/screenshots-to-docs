---
title: Push a run to Figma
parent: How-to guides
nav_order: 4
---

# Push a run to Figma

Put a capture run on its own Figma page, one clean frame per screenshot, ready to annotate.

{% include video.html name="03-capture-to-figma" title="Capture run to Figma" %}

## Steps

1. Review the run side by side, and reject any bad shot before it reaches Figma:

   ```bash
   node scripts/make-gallery.mjs --dir <out>/run1
   ```

2. Plan the Figma page:

   ```bash
   node scripts/figma-plan.mjs --dir <out>/run1 --inventory <inventory> --config p1-editor.config.json --release <new version>
   ```

   It writes `figma-plan.json` and `figma-page.js`. It uploads nothing.

3. With an AI agent that has the Figma connector (`use_figma` and `upload_assets`), or by hand:

   1. Run `figma-page.js` with `use_figma`. It creates the page `RUN-<date> · <run id>` and one empty,
      named rectangle per screenshot, and returns their node IDs. If a page with that name exists, it stops.
   2. Call `upload_assets` with those node IDs and `scaleMode: "FIT"`. Save the result's `uploads` to
      `urls.json`. The URLs are single-use and expire in 10 minutes.
   3. Upload the images:

      ```bash
      node scripts/figma-upload.mjs --dir <out>/run1 --urls urls.json
      ```

      It refuses any URL that isn't https on `figma.com`, before sending anything.

4. Record where each screenshot lives:

   ```bash
   node scripts/inventory.mjs record-figma --id <id> --evidence uploaded --file-url <file url> --page-name "<run page>" --node-id <clean frame node> --inventory <inventory>
   ```

{% include video.html name="04-figma-run" title="The run in Figma" %}

Next: [Annotate with the kit](annotate.html).
