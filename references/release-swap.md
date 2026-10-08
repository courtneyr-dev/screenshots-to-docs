# Release swap: from the annotated Figma frame to every doc, without hand-inserting images

Status: built and tested against mocks (2026-10-07). Live runs pending: Figma REST export (needs a token
with `file_content:read`), and the Apps Script swap on a scratch Google Doc. Open questions are listed at
the end and decide two defaults.

## Goal

When P1 ships a release, the annotated screenshots in every doc change by a reviewed batch, not by a
person inserting each image. A person still reviews the annotation, approves the alt text, and clicks
Publish in Content Publisher.

## The chain

```text
Figma annotated frame (inventory figma.annotated_node_id)
  │  1. figma-export.mjs: Figma REST GET /v1/images, PNG at 2x, checksum, record-asset
  ▼
Git repository: screenshots/<id>/<release>.png + inventory change, one pull request per release
  │  2. Markdown docs: publish-markdown.mjs swaps the file at a fixed path (built earlier)
  │  3. Google Docs: gdocs-manifest.mjs pins every image to a commit; the Apps Script swaps them
  ▼
Google Doc (image replaced in place, same width, alt text written)
  │  4. A person clicks Publish in the Content Publisher add-on (no documented publish API)
  ▼
Published page
     5. record-publication --published-file, then trace (built earlier)
```

The commit is the version record. A release swap is a pull request whose diff shows each old and new
image, the inventory change, and the manifest. Rolling back means building the manifest from the earlier
commit and running the swap again.

## Alt text from the marks

`draft-alt.mjs` writes alt text from the annotated frame's step marks, so the numbers in the image and in
the text always match. It reads layer names of the form `Step <n>: <label>`:

```bash
node scripts/draft-alt.mjs --marks marks.json --subject "The P1 editor"
# The P1 editor with four numbered areas: 1 the Blocks panel, 2 the page canvas, 3 page settings, 4 the Review button.
```

- The label is used as written, so name each step layer the way it should be read ("Step 4: the Review
  button", not "Step 4: Review").
- Steps must be numbered 1 to N with no gaps or repeats; otherwise it fails.
- `marks.json` is a list of layer names, `{ "marks": [...] }`, or the Figma REST
  `GET /v1/files/:key/nodes?ids=<annotated node>` response.
- It prints a draft. `--id <id> --inventory <file> --apply` saves it through `set-alt`, which runs the
  same text checks as every other write. A person reads the draft before applying it.

## 1. Export from Figma

```bash
FIGMA_TOKEN=... node scripts/figma-export.mjs --inventory <file> --status annotated --out <dir> [--scale 2] [--record --assets-dir <dir>]
```

- Reads each record's `figma.file_url` and `figma.annotated_node_id`; a record without an annotated node
  is skipped and reported, never exported from the clean frame.
- Calls `https://api.figma.com/v1/images/<key>?ids=...&scale=2&format=png` with `X-Figma-Token`. The token
  comes from the environment only and is never printed or sent anywhere else.
- Downloads each returned URL only if it is https on `figma.com` (or a subdomain) or on
  `figma-alpha-api.s3.us-west-2.amazonaws.com`. **That S3 host is unconfirmed**: Figma's reference does
  not name it. If the live run is refused, the message names the host; confirm it and add it to the list.
- Refuses redirects, checks the PNG signature, and prints size and checksum. `--record` runs
  `record-asset` for each file.
- Automating this needs a Figma seat whose token can read the file (Dev or Full seat).

## 2. Markdown docs

Unchanged: `publish-markdown.mjs` (see its header). Images keep their paths; only bytes and alt text
change.

## 3. Google Docs

### The manifest

```bash
node scripts/gdocs-manifest.mjs --inventory <file> --repo <owner/name> --ref <40-char commit> [--assets-root <folder holding screenshots/>] [--title-anchor] [--out manifest.json]
```

One entry per record that is `handed_off` or later, has an asset, and whose `source.docs_document_id`
is a Google Doc ID. Each entry pins the image to a commit:

```json
{
  "screenshot_id": "p1.live.editor-shell",
  "release": "0.20.0",
  "document_id": "1sTE…",
  "image": {
    "repo": "owner/name",
    "ref": "<commit>",
    "path": "screenshots/p1.live.editor-shell/0.20.0.png",
    "sha256": "…"
  },
  "alt": { "title": "…", "description": "…" },
  "match": { "title": "p1.live.editor-shell", "fingerprints": ["…"] }
}
```

- `--ref` must be a full commit SHA, so a manifest always means the same bytes.
- Records it skips are listed with the reason (no Google Doc ID, no asset, wrong status).

### Finding the image in the doc

The script never guesses. An inline image matches an entry when either:

- its alt title equals the screenshot ID (the anchor, only if `--title-anchor`), or
- the fingerprint of its alt description or title is one of `match.fingerprints`: the current alt text
  and the alt text recorded at the last verification.

Zero matches is reported as not found. More than one is reported as ambiguous and nothing is changed in
that doc.

### The Apps Script (`templates/gdocs-swap/Code.gs`)

A standalone Apps Script project, so one run covers every doc in the manifest.

- Script properties: `GITHUB_TOKEN` (fine-grained, read-only contents on the one repository),
  `MANIFEST_REPO`, `MANIFEST_PATH`, `MANIFEST_REF`.
- `dryRunSwap()` fetches the manifest and every image, checks each checksum, finds each match, and logs
  what it would change. It edits nothing.
- `runSwap()` does the same, then for each match inserts the new image at the old image's position at the
  same width, writes the alt title and description, and removes the old image.
- An image whose bytes don't match the manifest checksum is never inserted.
- Images are fetched from the GitHub contents API with the token, so the repository stays private.
  (A Doc cannot pull a private GitHub URL itself, and the Docs REST `ReplaceImageRequest` cannot set alt
  text, which is why this is Apps Script.)
- It logs one JSON report: per entry, `replaced`, `would-replace`, `not-found`, `ambiguous`, or
  `checksum-mismatch`.

Setup, once: create a standalone project at script.google.com, paste `Code.gs`, set the four script
properties, run `dryRunSwap`, approve the Docs and external-request scopes, read the log, then run
`runSwap`.

## 4. Publish

Click Publish in the Content Publisher add-on for each changed doc. The swap report lists them.

## 5. Verify

`record-publication --published-url <url> --published-file <downloaded image> --verified-at <time>`,
then `trace`. Unchanged.

## Open questions (settled by the first manual publish)

1. **Which alt field Content Publisher renders.** Put the alt text in the Google Docs Description field
   only, publish, and read the page. The manifest writes the alt text to both Title and Description until
   this is known. If Content Publisher reads Description, switch on `--title-anchor` so Title can carry the
   screenshot ID as a stable anchor.
2. **Whether publishing resizes.** Live P1 docs images are at most 2048 px wide. If 2880 px exports are
   resized, decide whether to export at 2048 px instead.
3. **The Figma export host** (above).
4. **Access:** a Figma token for the export, and an Apps Script project authorized for the docs' Drive.

## What is tested without Figma, GitHub, or Google

`tests/release-swap-tests.mjs`: the alt drafter (numbering, gaps, inputs), the exporter against a local
mock of the Figma API (host checks, redirects, token handling, PNG checks), the manifest (pinning,
skipping, matching data), and `Code.gs` run in a sandbox with fake `DocumentApp`, `UrlFetchApp`, and
`Utilities` (dry run edits nothing, checksum mismatch, ambiguous and missing matches, width and alt kept).
