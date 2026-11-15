---
title: Annotate with the kit
parent: How-to guides
nav_order: 5
---

# Annotate with the kit

Add numbered marks and highlights to each screenshot in an annotated frame the docs embed. Personal data is
handled before the image reaches Figma: see [Keep personal data out](#keep-personal-data-out).

{% include video.html name="05-annotate" title="Annotating with the kit" poster="kit-assets-panel.jpg" %}

## Check the kit first

An older kit has the wrong colors and nothing flags it until an extraction comes back wrong. Check the file before
you annotate or extract in it:

1. Write the check and run it with `use_figma` in the review file. It only reads:

   ```bash
   node scripts/figma-kit-check.mjs --out kit-check.js
   ```

2. Save what it returns as JSON and verify it against `figma-plugin/annotation-tokens.json`:

   ```bash
   node scripts/figma-kit-check.mjs --result kit-check-result.json
   node scripts/preflight.mjs --config p1-editor.config.json --need figma --kit-result kit-check-result.json
   ```

   Preflight can't call Figma, so without `--kit-result` it prints these steps instead of passing the kit.

It exits 1 with a plain fix. Missing or different stamps (the file root's `tokensSchema` and `tokensHash`, and each
of the 13 components' `kit` stamp): run Plugins > Development > Screenshot annotation kit in this file. Variables
that don't hold the contract's values, or alias anything but the `brand/*` variables in `Annotation primitives`:
repoint them to the brand primitives, or delete the old Annotation collection and re-run the plugin. Fix the
variables first. The plugin reuses variables that already exist, so re-running it alone stamps the file and keeps
the old colors.

## Steps

1. Make the annotated frame beside the clean one: a frame the size of the image, holding a copy of the image
   only. Name it `[<id>] — <title> — <release> — annotated`. The clean frame stays untouched.
2. Open the Assets panel (**Option+2**) and drag marks onto the image:

   - **Highlight box** over the area the step is about. Resize it with the corner handles; never fill it.
   - **Step badge** next to each area, numbered in reading order.
   - **Callout label** when the UI element needs its name on the image.

   Don't draw a box over personal data. The kit no longer has a Redact component, and a Redact layer left
   from an older kit fails verification.

   {% include figure.html src="kit-assets-panel.jpg" alt="Figma's Assets panel listing the kit components: Arrow, Callout label, Click indicator, Cursor, Dim overlay, Highlight box, and more." caption="The kit in the Assets panel. Drag a component onto the image." %}

   <div class="shot-pair" markdown="1">

   {% include figure.html src="kit-highlight-box.jpg" alt="A purple Highlight box resized to fit the Blocks panel." caption="Highlight box, resized to the Blocks panel." %}

   {% include figure.html src="kit-step-badge.jpg" alt="A purple numbered Step badge placed beside the highlighted Blocks panel." caption="Step badge 1 beside it." %}

   </div>

3. Keep every mark inside the annotated frame, so it exports with the image. Check the Layers panel.

   {% include figure.html src="figma-annotated-layers.jpg" alt="Figma's Layers panel for an annotated frame: Step 1 to 4, Highlight 1 to 4, two Redact layers, and the screenshot, all nested in the frame." caption="Every mark nested inside the annotated frame. Step layers are named the way the alt text should read. This screenshot predates the retired Redact component: an annotated frame today has no Redact layers." %}

4. **Name each step layer the way it should be read**, for example `Step 4: the Review button`. The alt text
   is drafted from these names.
5. **Say what each mark points at.** On each Step badge, Highlight box, and Arrow, set its target
   (`s2d` shared plugin data: a bounding box in image pixels, and a selector if you have one). On the frame,
   declare every region of personal data. The protocol is in
   [Annotation kit](../reference/annotation-kit.html#placing-marks-so-they-can-be-verified).
6. Pick tones by the job: **Ink** is the default and works on light and dark. **Yellow** marks the one focal step of the frame (its badge and its outline); don't use it for a second step.
7. **Give marks room.** Keep 3 px of clear space between the outer edges of two Highlight boxes, halo
   included. A box drawn inside another box clears the outer box's inner stroke edge by 3 px. A Step badge
   sits wholly inside a box or clear of its stroke, and wholly on one surface of the screenshot: never half
   on a dialog and half on the dimmed backdrop.
8. When the UI didn't change since the last release, copy last release's annotated frame and swap in the new
   image, then check the new image is the faked or pixelated capture.

Which mark to use for what: [Annotation kit](../reference/annotation-kit.html).

## Keep personal data out

Do this before `figma-plan.mjs` uploads the capture. Solid boxes and blur are not allowed: a box reads as a
broken screenshot, and blur can be reversed.

1. **Preferred: fake data.** Replace names, emails, avatars, and IDs in the page before capture with plausible
   fake data: names like "Anita Agency", emails like jordan.lee@example.com, avatars with fake initials. Use a
   sandbox seeded with sample users, or a brief's `evaluateBefore` script. Declare each region with
   `"method": "fake-data"`; a person confirms the values are invented.
2. **Otherwise: pixelate** each declared region, plus 4 px of padding, in the capture PNG in the run folder:

   ```bash
   node scripts/pixelate.mjs --in <run>/<slug>.png --sensitive <regions.json> --dpr 2 --in-place
   ```

   The regions file is the one you pass to `record-annotation.mjs --sensitive`. Blocks are 14 image px,
   raised to at least 7 CSS px at the capture's dpr (16 px at 2.2), and each block is one color averaged from
   the pixels under it. Regions declared `"method": "fake-data"` are left alone. Keep the unredacted original
   out of the run folder and out of anything you deliver: the clean capture is published too
   (`publish-markdown.mjs --variant clean`).

Declare every region either way. The verifier fails a region that is one flat color, a plain box, blurred, or
pixelated in blocks smaller than 7 CSS px, in the export or in the clean capture.

## Verify and record it

1. Export the annotated frame as PNG at 2x, and read the frames out of Figma:

   ```bash
   node scripts/figma-annotation.mjs --clean-node-id <clean frame> --annotated-node-id <annotated frame> --out extract.js
   ```

   Run `extract.js` with `use_figma` and save the JSON it returns as `manifest.json`.

2. Verify and record the shot:

   ```bash
   node scripts/record-annotation.mjs --dir <out>/run1 --slug <shot> --manifest manifest.json --export annotated.png
   ```

   It prints every check. A failure names the layer and the rule; fix the frame and run it again. When all
   checks pass, the shot is `pending-human-review`. The run folder now holds the clean capture (untouched),
   `annotated/<shot>.png`, and `review/<shot>.validation.json`.

3. Open the export and read the validation file's human-review list: no personal data outside the declared
   regions, the export looks right, and the alt text says what the reader does. Then confirm:

   ```bash
   node scripts/record-annotation.mjs --dir <out>/run1 --slug <shot> --manifest manifest.json --export annotated.png --human-reviewed "<your name>"
   ```

4. After a reviewer approves the marks, record the frame in the inventory:

   ```bash
   node scripts/inventory.mjs record-figma --id <id> --annotated-node-id <annotated frame node> --annotation-status complete --inventory <inventory>
   node scripts/inventory.mjs transition --id <id> --to annotated --inventory <inventory>
   ```

The handoff refuses a shot that isn't `complete`, and refuses it again if the clean capture, the export, or the
tokens change afterward. Use the clean capture where a docs system doesn't allow markup.

Next: [Write alt text from the marks](alt-text.html).
