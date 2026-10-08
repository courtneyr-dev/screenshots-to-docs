# P1 docs handoff

The last step is manual. Figma holds the reviewed, annotated screenshots; a docs author puts the approved images into the P1 documentation.

## What is and isn't known

Evidence from inspecting the p1-docs repository on 2026-09-30 (base `origin/main` at `83ebfa0`). Nothing here was run against Google, Figma, or the hosted docs site.

**Found in the repository**

- The docs site is built on Pantheon Content Publisher: `PCC_SITE_ID` and `PCC_TOKEN` configuration, the `cpub-react-sdk`, and a webhook at `app/api/pcc-webhook/route.ts` that handles `article.update`, `article.publish`, and `article.unpublish`.
- An article's ID is the ID of a Google Doc. `components/article-actions.tsx` links each article's "Contribute in Gdocs" action to `https://docs.google.com/document/d/<article id>`.
- Body images in articles come from the Google Doc. The styling code targets them (`preserveImageStyles` in `components/article-view.tsx`, `.pantheon-img-container-inline` in `styles/globals.css`). Pages composed in the P1 editor use files under `public/`.

**Not found**

- No reference to Figma anywhere in the repository outside this tool. Nothing reads from Figma or writes to Google Docs.
- No documented place or process for putting a Figma export into a Google Doc.

**What that means**

- The likely route for an image in a Content Publisher article is: a person exports the image from Figma, inserts it into the article's Google Doc, and publishes through Content Publisher. That's an inference from how the site is built. It hasn't been observed or confirmed with the docs team.
- Images used on editor-composed pages would be added to the repository or P1 by a person. Also unconfirmed.
- This tool doesn't touch Google Docs, Drive, Content Publisher, or the docs site. It produces approved Figma pages and a handoff note, and stops there.
- The P1 docs site and the docs repository need sign-in, so this tool doesn't read either at run time.
- Don't write "screenshots were exported to the docs" unless you watched the export happen and can name where the image now lives.
- If the Google Docs connection does something unexpected, record what you saw (what you did, what happened, where) and stop. Don't change unrelated integrations, sharing settings, or credentials.

## The inventory names the exact slot

When the run came from the screenshot inventory (`screenshot-inventory.md`), the handoff doesn't leave the destination as `TO FILL`. `node scripts/handoff.mjs ... --inventory inventory/screenshots.json` fills the table from the records: screenshot ID, Figma rectangle, docs article, heading, and image slot, with the caption and alt text copied unchanged. `node scripts/inventory.mjs handoff` prints the longer report with the asset checksum, the clean Figma frame to export, the reviewer, and the unverified fields. Google Docs and published images have no stable image ID, so the slot is identified by document ID, heading, image position, and the caption and alt-text fingerprint.

## What the docs author does

The handoff is manual. After the run's Figma page is annotated and approved, the docs author:

1. Opens the handoff note and the approved Figma page it names.
2. Picks the destination for each shot from the note's mapping: a Google Doc (published through Content Publisher) or an editor-composed page. If the note says "Unconfirmed: ask the docs owner", asks the docs owner first.
3. Exports each image from Figma (PNG, 2x), with a stable file name, and adds the alt text from the note.
4. Inserts or replaces the image in the destination and publishes it the way that destination is normally published.
5. Opens the published page and checks the image is the new one. Then records in the note where each image now lives, and marks the line as verified.

Until step 5 is done and recorded, the note must not claim the screenshots reached the docs. Record it in the inventory with `record-publication` and `transition --to verified` so a later operator can find the image from the article without opening Figma (`inventory.mjs lookup --doc <document ID>`).

## What the handoff note must contain

The note has to let a writer who didn't run the capture finish the job. Generate the note with `node scripts/handoff.mjs --config p1-editor.config.json --dir <out>/run1 --release "<release or change>"`. It fills in what the tools know (release, source, run IDs, Figma pages, a shot table with suggested captions and alt text) from the run's report and plan, using `templates/handoff-note.template.md`, and writes the note to `docs.handoffDir` as markdown or json (`docs.format`). Every line a person has to decide is marked `TO FILL`. `examples/handoff-note.example.md` shows a filled-in example with made-up values. The note should cover:

1. **Release or change:** version or release name, date, and the repository commit used for the capture.
2. **Source:** origin captured, site, workstream, page edited, and the run IDs.
3. **Figma:** file name, the page name for each run, and which page is the approved one.
4. **Mapping:** for each screenshot, the docs section it belongs in, the suggested caption, and suggested alt text.
5. **Changes:** which shots changed since the last release and what changed in the UI. Pass `--previous <earlier run folder>` to `handoff.mjs` and it fills a table from `compare-runs.mjs`; a person adds the description.
6. **Annotations:** what the annotated frames show and any callouts that must appear in the docs.
7. **Manual next step:** exactly where the docs author should export or copy each annotated image (format and size), and who reviews it. If this isn't known, write "Unconfirmed: ask the docs owner" and name the question.
8. **Open items:** anything unverified, including the Google Docs connection.

## Export guidance for the docs author

- In Figma, select the annotated frame and export PNG at 2x, or export the original image rectangle if the docs want unannotated images.
- The original captures are 2880 × 1800 px (1440 × 900 at device scale 2).
- Keep file names stable and descriptive, for example `p1-editor-shell.png`, so later refreshes replace the same asset.
- Each image needs alt text. The example note has suggested text for all six shots.
