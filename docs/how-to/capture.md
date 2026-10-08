---
title: Capture the editor
parent: How-to guides
nav_order: 3
---

# Capture the editor

Capture the approved screenshots from the signed-in P1 editor.

{% include video.html name="02-capture" title="Capture the new release" poster="capture-results.jpg" %}

## Steps

1. Write a brief from the approved records:

   ```bash
   node scripts/inventory.mjs brief --inventory <inventory> --config p1-editor.config.json --release <new version> --out brief.json
   ```

2. Start the dedicated Chrome. This prints the command; run it yourself:

   ```bash
   node scripts/chrome.mjs --config p1-editor.config.json
   ```

   In that window, sign in to P1, choose the workstream in the editor, and wait until the Blocks panel,
   canvas, and page settings are on screen. The tool never signs in for you or sees your credentials.

3. Take one validation shot and look at it:

   ```bash
   node scripts/capture.mjs --brief brief.json --config p1-editor.config.json --only <id> --out-dir <out>/validate
   ```

4. Capture the full set, then record it in the inventory:

   ```bash
   node scripts/capture.mjs --brief brief.json --config p1-editor.config.json --out-dir <out>/run1
   node scripts/inventory.mjs record-capture --run <out>/run1 --assets-dir <assets> --inventory <inventory>
   ```

   `record-capture` stores each image's checksum, size, and release, and moves the records to `captured`.

   ```text
   p1.live.editor-shell                         captured   refresh   0.20.0       docs-team
   p1.live.workstream-selector                  captured   refresh   0.20.0       docs-team
   ```

   {% include figure.html src="capture-results.jpg" alt="Two captures side by side: the P1 editor shell and the editor with the workstream selector open." caption="The two 0.20.0 captures from one run. Each passed the signed-in, project, and workstream checks before it was saved." %}

## If a shot fails

A shot fails, and nothing is saved, when the page shows a sign-in screen, a loading state, a bot challenge,
the public site, the wrong project or workstream, or no editor. Fix the window and rerun with
`--only <id>`. A navigation timeout is usually transient; rerun it. More in
[Troubleshoot](troubleshoot.html).

Next: [Push a run to Figma](push-to-figma.html).
