---
title: Swap images in Google Docs
parent: How-to guides
nav_order: 9
---

# Swap images in Google Docs

Insert each screenshot into its Google Doc once. After that, every release swaps it in place, with its alt
text, without anyone inserting images.

Set up the Apps Script first: [Set up the tool, step 5](set-up.html#5-google-docs-swap).

## The first time: insert the image

{% include video.html name="07d-gdoc-first-insert" title="The first insert in Google Docs" poster="gdoc-alt-text.jpg" %}

1. In the doc, add the heading the inventory records as the docs slot.
2. Choose **Insert > Image > Upload from computer** and pick the annotated PNG.

   {% include figure.html src="gdoc-insert-image.jpg" alt="Google Docs Insert menu open at Image, with Upload from computer in the submenu." caption="Insert > Image > Upload from computer." %}

3. Right-click the image, choose **Alt text**, and paste the record's alt text from the handoff.

   {% include figure.html src="gdoc-alt-text.jpg" alt="The Google Docs Image options panel with the alt text field filled in: The P1 editor with four numbered areas." caption="The alt text, pasted from the handoff. The swap finds the image by it later." %}

4. Publish the doc from the Content Publisher add-on. Check the add-on's **Publish to** site first.

The swap finds this image later by its alt text.

## Every release: swap

{% include video.html name="07e-gdoc-swap" title="Swap images in Google Docs" poster="apps-script-replaced.jpg" %}

1. Commit the release's images to the screenshots repository and note the commit.
2. Write the swap list, pinned to that commit:

   ```bash
   node scripts/gdocs-manifest.mjs --inventory <inventory> --repo <owner/name> --ref <commit> --out release-swap/<release>.json
   ```

   Commit and push it. Records without a Google Doc ID, an asset, or alt text are listed as skipped.

3. Point the script at it: set `MANIFEST_REF` (the commit holding the manifest) and, if it changed,
   `MANIFEST_PATH`, in `build/gdocs-swap/Config.gs` (then `npx @google/clasp@3.4.1 push` from that folder),
   or as script properties.

   {% include figure.html src="apps-script-properties.jpg" alt="Apps Script Script Properties with MANIFEST_REPO, MANIFEST_PATH, and MANIFEST_REF filled in." caption="The three manifest settings. GITHUB_TOKEN is added the same way, by you." %}

4. In the Apps Script editor, run `dryRunSwap` and read the execution log. Each entry says `would-replace`,
   `not-found`, `ambiguous`, or `checksum-mismatch`.

   {% include figure.html src="apps-script-dry-run.jpg" alt="The Apps Script execution log after dryRunSwap: the editor shell reports would-replace and the workstream selector reports not-found." caption="Dry run: nothing changes. One image would be replaced; the other isn't in this doc." %}

5. Run `runSwap`. Each `replaced` image now holds the new release, at the same width, with the alt text.

   <div class="shot-pair" markdown="1">

   {% include figure.html src="apps-script-replaced.jpg" alt="The execution log after runSwap reporting status replaced for the editor shell." caption="runSwap: replaced." %}

   {% include figure.html src="gdoc-swapped-image.jpg" alt="The Google Doc with the new image in place and its alt text shown in the Image options panel." caption="The new image, same place and width, alt text written." %}

   </div>

6. Publish each changed doc from the add-on.

Report statuses and safety rules: [Google Docs swap](../reference/google-docs-swap.html).

Next: [Verify and trace](verify.html).
