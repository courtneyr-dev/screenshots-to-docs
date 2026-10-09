---
title: Write alt text from the marks
parent: How-to guides
nav_order: 6
---

# Write alt text from the marks

Draft alt text from the annotated frame's step layers, so the numbers in the text match the numbers in the
image.

{% include video.html name="07b-alt-from-marks" title="Alt text from the marks" %}

## Steps

1. Save the annotated frame's layer names to a file, as a JSON list, or as the Figma REST
   `GET /v1/files/<key>/nodes?ids=<annotated node>` response. Only layers named `Step <n>: <label>` count.

   ```json
   [
     "screenshot",
     "Step 1: the Blocks panel",
     "Step 2: the page canvas",
     "Step 3: page settings",
     "Step 4: the Review button"
   ]
   ```

2. Draft the alt text:

   ```bash
   node scripts/draft-alt.mjs --marks marks.json --subject "The P1 editor"
   ```

   ```text
   The P1 editor with four numbered areas: 1 the Blocks panel, 2 the page canvas, 3 page settings, 4 the Review button.
   ```

   `--subject` names the screen and opens the sentence, for example `"The WordPress dashboard"`,
   `"Drupal's Status report"`, or `"The P1 editor's workstream selector open"`.

3. Read the draft. If it's right, save it:

   ```bash
   node scripts/draft-alt.mjs --marks marks.json --subject "The P1 editor" --id <id> --inventory <inventory> --apply
   ```

   `--apply` saves it through `set-alt`, which refuses generic or placeholder text. When the record already
   has that text, nothing changes.

To change alt text by hand: `node scripts/inventory.mjs set-alt --id <id> --text "<alt text>"`. On a verified
record, update the published doc first, check it, and add `--verified-at <time of that check>`.

Next: [Export and hand off](export-and-hand-off.html).
