# Screenshot inventory

The inventory answers, for every screenshot: why it exists, what UI state to capture, which release and capture produced it, which Figma frame was reviewed, which docs article, heading, and image slot it belongs in, and which published image and alt text were verified.

Claude Code users: the project skill `p1-screenshot-inventory` (`.claude/skills/p1-screenshot-inventory/SKILL.md` at the repository root) carries the rules and commands below in short form.

## Who owns what

| Layer                           | Role                                                                                                                              |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `inventory/screenshots.json`    | **Source of truth.** Git-tracked, reviewed in pull requests. Defines coverage, text, and status.                                  |
| Capture harness                 | Evidence producer. Runs only approved inventory records and writes a report that carries each record's ID, caption, and alt text. |
| Figma                           | Visual review and annotation. Frames and metadata point back to the inventory. It's evidence, not the record.                     |
| Google Docs / Content Publisher | Publication target. A person inserts and publishes the image. Nothing in this repository writes to it (`docs-handoff.md`).        |

The harness never invents coverage. It doesn't scan routes or existing image files. A screenshot nobody asked for isn't captured, and a captured shot with no record is reported as an inventory gap.

## File and schema

One JSON file, `inventory/screenshots.json` (override with `--inventory <file>`). The tool already uses JSON for configuration, briefs, and presets, so the inventory follows suit and needs no new dependency. `scripts/lib/inventory.mjs` validates it. `examples/inventory.example.json` is a complete worked example with made-up values.

```json
{
  "version": 1,
  "records": [{ "screenshot_id": "p1.topic.short-purpose", "...": "..." }]
}
```

A record has these sections. Unknown fields are errors, so a typo can't hide.

| Section       | Fields                                                                                                                                                                                                                  |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| top level     | `screenshot_id`, `title` (optional short title), `status`, `release_status`, `priority`, `owner`, `reviewer`, `history`, `retired_at`, `retired_reason`, `notes`                                                        |
| `source`      | `type` (docs, issue, pr, release, support, design, other), `docs_url`, `docs_document_id`, `docs_heading`, `request_url`, `reason`                                                                                      |
| `capture`     | `project`, `workstream`, `page`, `release`, `state`, `actions`, `checks`, `constraints`                                                                                                                                 |
| `content`     | `caption`, `alt_text`, `annotations`                                                                                                                                                                                    |
| `figma`       | `evidence`, `not_used_reason`, `file_url`, `page_name`, `frame_name`, `annotated_frame_name`, `node_id`, `annotated_node_id`, `version_name`, `branch_url`, `dev_resource_urls`, `manifest_commit`, `annotation_status` |
| `asset`       | `path`, `sha256`, `width`, `height`, `captured_at`, `source` (`capture` or `figma_export`)                                                                                                                              |
| `publication` | `docs_image_slot`, `published_url`, `published_sha256`, `alt_text_fingerprint`, `inserted_at`, `verified_at`, `verified_release`, `verified_asset_sha256`, `verification_notes`                                         |

Differences from the shape in the original request: `title`, `history`, `retired_*`, `figma.evidence`, `figma.annotated_frame_name`, `figma.annotation_status`, `asset.source`, `publication.verified_release`, and `publication.verified_asset_sha256` are additions. They carry the retirement record, the clean-versus-annotated rule, the honest "what do we actually know about Figma" level, and the check that the published image is the recorded one.

### IDs

`screenshot_id` looks like `p1.topic.short-purpose`: lowercase letters, digits, and hyphens, in two to five dot-separated parts. It's stable. Keep the same ID across releases while the screenshot shows the same concept. Create a new ID only when the concept changes. Never put the ID in a caption or alt text.

### Status (lifecycle)

`proposed`, `approved`, `captured`, `annotated`, `handed_off`, `inserted`, `verified`, `retired`.

A record moves one step at a time. It can return to `approved` to be re-captured, and any status can become `retired`. A retired record can't change or return. Each status has requirements, checked on every `validate`:

| To reach     | The record needs                                                                                                                                                                                                                                            |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `approved`   | A reviewer, `source` (type, reason, heading, and a docs document ID or URL, plus a request URL for issue, PR, release, or support requests), and `publication.docs_image_slot`.                                                                             |
| `captured`   | `capture.project`, `workstream`, `page`, `release`, `state`, an `actions` list, at least one `checks` entry, and the asset: deterministic `path`, `sha256`, `width`, `height`, `captured_at`.                                                               |
| `annotated`  | Figma evidence `uploaded` or `verified` with file URL, node ID, the exact clean frame name, and `annotation_status: complete`. Or `evidence: not_used` with a `not_used_reason`.                                                                            |
| `handed_off` | A caption and alt text that pass the text rules. If Figma evidence is `verified`, a `version_name` and `manifest_commit`.                                                                                                                                   |
| `inserted`   | The asset checksum and `publication.inserted_at`.                                                                                                                                                                                                           |
| `verified`   | `published_url` (https), `published_sha256` (the checksum of the bytes that URL serves), `verified_at`, `verified_release` equal to `capture.release`, `alt_text_fingerprint` of the current alt text, and `verified_asset_sha256` equal to `asset.sha256`. |
| `retired`    | `retired_reason`, `retired_at`, and `release_status: retire`. The record and its assets stay.                                                                                                                                                               |

`release_status` says what a release needs: `new` (capture a new screenshot), `refresh` (the same concept needs a new asset), `unchanged` (the published image is still right; only valid at `inserted` or `verified`), `retire`.

### Actions and checks

`capture.actions` uses the same named actions as briefs (`scripts/presets/p1-editor.json`), for example `"openWorkstreamMenu"` or `{ "selectBlockByType": { "type": "PullQuote" } }`. It may be empty. The generated brief adds the editor-ready check, the workstream selection, and, unless your actions open the workstream menu on purpose, a step that closes it. `capture.checks` uses the same check shapes as `expectAfter` (`{ "selector": "...", "text": "..." }`, `selectedBlock`, and so on). A check must fail when the state is wrong. A capture with no checks isn't allowed.

### Text rules

Caption and alt text are written once, in the record, and copied unchanged into the brief, the capture report, the gallery, the Figma manifest, and the docs handoff. Validation rejects text that is missing, has placeholder wording (`TO FILL`, `TODO`, `{{...}}`, `<...>`), is generic ("Screenshot", fewer than four words), contains filler or test data, contains a URL, host, or local path, contains an inventory ID, spans lines, or contains `|` (so tables can show it verbatim). A leading "screenshot of" or an alt text over 250 characters is a warning. There is no fallback text: a missing alt text stops the handoff.

### Secrets and customer data

Any string in a record that looks like a token, key, JWT, bearer header, credential assignment, signed or credentialed URL, or an email address (other than `@example.com` and `@example.org`) is an error. Use a person or team handle for `owner` and `reviewer`.

## Adding a screenshot

1. **Record the request.** Add a record with `status: proposed`, an `owner`, a `source` that includes the `reason` (the documentation claim or task the image explains), and the `capture` target. Anything from a docs gap, issue, PR, release note, or support request can start one. The record exists before any capture, so coverage comes from a documented need.
2. **See what's missing.** `node scripts/inventory.mjs prereqs --id <id>` lists what's needed for the next status.
3. **Approve it.** Fill in the docs destination (`source.docs_document_id` or `docs_url`, `docs_heading`, and `publication.docs_image_slot`), a `reviewer`, and, for capture, the `state`, `actions`, and `checks`. Then `node scripts/inventory.mjs transition --id <id> --to approved`. The command validates first and writes nothing if the record is incomplete. A pull request that changes the inventory is where the reviewer approves.

## Capturing

```bash
node scripts/inventory.mjs validate
node scripts/inventory.mjs brief --config p1-editor.config.json --release 2026.10 --out <out>/brief.json
node scripts/capture.mjs --brief <out>/brief.json --config p1-editor.config.json --out-dir <out>/run1
node scripts/inventory.mjs record-capture --run <out>/run1 --assets-dir <out>/assets
node scripts/make-gallery.mjs --dir <out>/run1
```

- `brief` picks records that are `approved` with `release_status` `new` or `refresh`. It stops, naming the fields, if any such record can't be reproduced. It never skips one quietly.
- One run covers one project, workstream, and page, because that is what a capture report records. `--config` selects the target from its `projectName`, `workstream`, and `pagePath`. The command lists other targets that need their own runs.
- Each generated shot has `slug` equal to the screenshot ID, so the PNG is `<id>.png` and the report, gallery, and Figma rectangle all carry the same ID.
- `record-capture` copies each PNG to `<assets-dir>/screenshots/<id>/<release>.png`, records its checksum, size, and capture time, and moves the record to `captured`. It refuses if the report's release, caption, or alt text differs from the record (the record changed after the brief was made).
- `asset-path --id <id>` prints the deterministic path. The folder `screenshots/` is git-ignored: the PNGs show a signed-in editor, so the checksum is in git and the image is not.

## Figma

Use these conventions. The tool plans and records them; it doesn't create them in Figma.

- **Pages:** one per capture run. Use a pattern such as `RUN-{date} · {runId}` in `figma.pageNamePattern` (the run ID keeps two runs on one day apart and keeps the duplicate guard working), or a release-specific page with `{release}`. `figma-plan.mjs` warns when the name follows neither.
- **Frames:** `[screenshot_id] — short title — release — kind`, where kind is `clean` or `annotated`. The plan names each row's frame this way. The clean frame holds the unmodified capture. Annotate a duplicate named `... — annotated`.
- **Export:** the annotated frame goes to the docs, and the clean frame stays in Figma as the unannotated capture. Build the annotated frame from the image rectangle only, without the run page's ID label and HTTP caption, so the export shows nothing but the screenshot and its callouts. Record the export with `record-asset`. The handoff says so for every record, and `trace` requires `figma.frame_name` to be the clean name, `figma.annotated_frame_name` to be the annotated name, and `figma.annotation_status` to be `complete`.
- **Versions:** name a Figma version at approval, at annotation completion, and at final handoff, and record the name in `figma.version_name`.
- **Branches:** use a branch for a release rehearsal or concurrent proposed changes, record it in `figma.branch_url`, and archive it after the work merges or is rejected.
- **Dev Resources:** add links on the clean frame to the docs destination, the source request, and the inventory (a URL to the file at the manifest commit). The plan lists these as `dev_resources_planned` with a status; a link without a URL stays `unverified`.
- **Plugin data:** the tool doesn't write Figma plugin data. Git stays authoritative.

```bash
node scripts/figma-plan.mjs --dir <out>/run1 --config p1-editor.config.json --release 2026.10 --inventory inventory/screenshots.json
```

This writes `figma-plan.json`, `figma-page.js`, and `figma-manifest.json`. The manifest is deterministic (sorted by ID) and marks every record `planned`. A record's recorded evidence is reported as it is: `none` shows as `unverified`, never as uploaded. The plan fails, writing nothing, if a captured shot has no record, or if the report's release, caption, or alt text differs from the record.

After the push (`figma-review.md`), record what really happened:

```bash
node scripts/inventory.mjs record-figma --id <id> --evidence uploaded --file-url <url> --page-name <page> --node-id <clean frame node> --annotated-node-id <annotated frame node>
node scripts/inventory.mjs record-figma --id <id> --annotation-status complete --version-name "<name>" --branch-url <url>
```

Only the fields you pass are written. `evidence` is never inferred from other fields. `--node-id` is the clean frame and `--annotated-node-id` is the annotated frame, a separate node; the handoff links the annotated one, and `trace` fails without it. Record the exported annotated frame with `record-asset --id <id> --file <png>` so the checksum matches what goes to the docs.

If the annotation changes what the image shows (numbered areas, for example), update the alt text to match with `set-alt --id <id> --text "<alt text>"`. On a verified record, change the published document first, check it, and pass `--verified-at <time of that check>`.

## Docs handoff

```bash
node scripts/inventory.mjs handoff --release 2026.10 --out <out>/docs-handoff.md
node scripts/handoff.mjs --config p1-editor.config.json --dir <out>/run1 --release 2026.10 --inventory inventory/screenshots.json
```

The first prints the report from the inventory. The second adds the same mapping to the run's handoff note. For each record the report gives the screenshot ID, the source request, the target article and heading, the image slot, the asset path and checksum, the caption and alt text, the Figma links, the required reviewer, the publication status, and a list of unverified fields.

The docs author then:

1. Finds the image slot by the **composite anchor**: document ID, heading, image position under the heading, and the caption and alt-text fingerprint. Google Docs images and published CDN images have no stable ID, so the anchor is how a future operator finds the right image.
2. Exports the clean Figma frame, inserts it with the recorded alt text and caption, and publishes the way that document is normally published.
3. Runs `record-publication --id <id> --inserted-at <time>`, then `transition --id <id> --to inserted`.

## Verifying a published image

After publication:

1. Open the published article at the recorded heading and find the image by its slot.
2. Check by eye that it shows the state in `capture.state` for the right release.
3. Copy the image's alt text from the page and run `node scripts/inventory.mjs check-alt --id <id> --notes "<alt text from the page>"`. It compares fingerprints, ignoring case and spacing.
4. Download the image the page serves, then record the result and move on:

```bash
curl -fsSL -o served.png "<https image URL>"
node scripts/inventory.mjs record-publication --id <id> --published-url <https image URL> --published-file served.png --verified-at <ISO time> --notes "<what you checked>"
node scripts/inventory.mjs transition --id <id> --to verified
```

`record-publication` takes the alt-text fingerprint and `verified_asset_sha256` from the record, not from you. `verified_asset_sha256` records which capture was inserted and verified, so a later capture marks the publication stale. `published_sha256` is the checksum of the file the published URL serves (`--published-file`, or `--published-sha256` if you hashed it yourself). It is never compared with `asset.sha256`: publishing can resize or re-encode an image, and on 2026-10-06 no image on the P1 docs site was wider than 2048 px, while captures are 2880 px. It lets a later check match a published image to its record exactly, by URL and checksum.

## Reverse lookup

```bash
node scripts/inventory.mjs lookup --id <id>                           # where is this screenshot used?
node scripts/inventory.mjs lookup --doc <document ID or URL> [--heading "<heading>"]   # which screenshots does this article serve?
node scripts/inventory.mjs lookup --refresh 2026.10                   # which images need a refresh for this release?
node scripts/inventory.mjs lookup --unverified                        # active records with no verified publication
node scripts/inventory.mjs lookup --stale                             # published images that no longer match the record
```

Add `--json` for the full mapping: inventory, Figma file, page, frame, node, version, asset path and checksum, docs document, heading and slot, caption and alt fingerprint, published URL, and verification release and time. A record is **stale** when the alt text, the capture release, or the asset checksum changed after verification, and **unverifiable** when it is marked verified but has no https URL, time, or docs location. Both fail validation.

## Traceability audit

```bash
node scripts/inventory.mjs trace [--assets-dir <dir>] [--run <capture run>] [--json] [--out <file>]
```

Read-only. For every image the inventory knows about (records with an asset, not retired) it prints the chain: screenshot ID, release, asset path and checksum, Figma run page, clean frame and node, docs article, heading and image slot, published URL, and verification state. It exits 1 if any link is missing:

- The asset path isn't `screenshots/<id>/<release>.png`, or the checksum, size, or capture time is missing.
- The caption or alt text fails the text rules, or there's no reviewer.
- There's no Figma reference (evidence `uploaded` or `verified` with a file URL, run page, node ID, and the exact clean frame name). A record with Figma marked `not_used` is reported as missing a Figma reference.
- The annotated frame is misnamed, or its annotation isn't `complete`. The docs embed the annotated frame.
- The docs article, heading, or image slot is missing, or the publication is stale or unverifiable.
- With `--assets-dir`, the file is missing or its checksum or size differs from the record.
- With `--run`, a captured image has no screenshot ID or no inventory record (an inventory gap).

Records not captured yet are listed separately; they have no image to trace. Earlier versions in `history` are checked for their path and checksum.

## Release comparison

```bash
node scripts/inventory.mjs release --release 2026.10 [--old <previous run> --new <new run>]
```

Records marked `new`, `refresh`, or `retire` for that release are listed with the reason, capture target, docs location, Figma evidence, replacement asset path, handoff state, and verification state. `unchanged` records need no capture and are only counted. With `--old` and `--new`, the pixel comparison (`release-refresh.md`) is attached:

- A record marked `unchanged` whose pixels changed is listed for review. It is not turned into a refresh.
- A shot in the new run with no record is an **inventory gap**, listed separately. The command exits 2. A missing record is never assumed to need a refresh.
- Records that need a new image but aren't in the new run are listed as not captured.

To refresh a verified record for a new release, reopen it: `transition --id <id> --to approved --release 2026.11`. The previous asset, Figma pointers, and published URL move into `history`, the per-release evidence is cleared, and `release_status` becomes `refresh`. Retire a record with `transition --id <id> --to retired --reason "<why>"`. Records are never deleted.

`validate --against git:main` compares with another version of the file and rejects skipped statuses, deleted records, and edits to retired records.

## When a new P1 version ships

The editor UI ships inside the `@pantheon-systems/p1-next-sdk` package, so a new SDK release is the trigger, not every code change. Use the SDK version as the screenshot's release (`capture.release`, for example `0.20.0`).

```bash
node scripts/inventory.mjs release-check --registry --app <path to the app you capture>
node scripts/inventory.mjs release-check --version 0.20.0 --reopen
```

- `--registry` asks npm for the latest published version. `--app` reads the version the capture target runs, from its `package-lock.json` or `node_modules`, because screenshots show the installed version's UI. If the app is behind the latest, the command warns you: update the app first.
- Every published screenshot (`inserted` or `verified`) captured for an older version is listed as `REFRESH`. Records still working toward an older version are `BEHIND`. Records whose release isn't a version (such as `2026.09`) are `UNVERSIONED`: they can't be compared and are never guessed. Retired records and records captured on a newer version are left out.
- Without `--reopen` nothing is written, and the exit code is 3 when there are candidates (0 when there are none, 1 on an error), so a scheduled job can notice. With `--reopen`, all candidates become `approved` with `release_status: refresh` in one write, or none do. What was published goes into `history`, and the docs slot stays.
- A prerelease or canary version is refused.

Then run `brief`, `capture`, and `record-capture` as usual, and `release --release 0.20.0 --old <previous run> --new <new run>` to see which screenshots really changed. A reopened screenshot whose pixels didn't change needs no docs update; say so in the record's notes and move it on.

The capture step needs a signed-in editor, and sign-in stays interactive (`safety.md`), so a person runs it. Detecting the release and preparing the records and brief is automatic; the capture is one command in your dedicated Chrome. Running capture unattended would need a stored test-account session, which this tool doesn't hold.

## Example, from request to verified publication

A support request reports that readers can't find the workstream selector.

1. **Request.** Add `p1.editor.workstream-selector` as `proposed`, `release_status: new`, with `source.type: support`, the ticket URL, and the reason "Readers keep asking how to switch workstreams." Run `prereqs`: it lists the missing docs heading, document ID, and image slot.
2. **Approve.** The docs owner supplies `source.docs_document_id`, `docs_heading: "Switch workstreams"`, and `publication.docs_image_slot: "Switch workstreams #1"`. The record gets `capture.state`, `actions: ["openWorkstreamMenu"]`, `checks: [{ "selector": "[data-testid=workstream-list]", "text": "<workstream>" }]`, a caption, and alt text. `transition --to approved`.
3. **Capture.** `brief`, `capture.mjs`, `record-capture`. The record is `captured` with a checksum, and `screenshots/p1.editor.workstream-selector/2026.10.png` is the asset.
4. **Figma.** `figma-plan --inventory`, the push, then `record-figma` with the real file URL and node ID, `annotation_status complete`, and the named version. `transition --to annotated`.
5. **Handoff.** `transition --to handed_off`, then `inventory.mjs handoff`. The report names the article, heading `Switch workstreams`, slot `#1`, the clean frame `[p1.editor.workstream-selector] — workstream selector — 2026.10 — clean`, the caption, the alt text, and the reviewer.
6. **Insert.** The docs author inserts the exported image at that slot and publishes. `record-publication --inserted-at ...`, `transition --to inserted`.
7. **Verify.** They open the published article, check the image and run `check-alt`, then download the served image and run `record-publication --published-url ... --published-file ... --verified-at ...` and `transition --to verified`.
8. **Later.** `lookup --doc <document ID>` lists this screenshot under that article. In release 2026.11, `release` shows whether it needs work; if so, reopen it with `--release 2026.11`.

## Not automated, on purpose

- Uploading to Figma, annotating, naming versions, creating branches, and adding Dev Resources. The tool plans and records them but doesn't call Figma.
- Reading Figma back. The inventory holds what a person recorded, and nothing checks it against the live file.
- Inserting or publishing in Google Docs or Content Publisher, and fetching the published page. A person verifies the published image.
- Deciding that a screenshot is needed. That's a request a person adds.
- Choosing which release a pixel change belongs to. The comparison surfaces a change; a person decides.

Unverified until someone runs them live: the Figma push with real frame names, the Dev Resource links, and the publication check against a real article.
