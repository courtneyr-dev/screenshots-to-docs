---
title: Inventory
parent: Reference
nav_order: 3
---

# Inventory

The inventory is the git-tracked source of truth: one record per screenshot the docs need, carrying its release, checksum, Figma frames, docs slot, alt text, and verification.

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

## IDs

`screenshot_id` looks like `p1.topic.short-purpose`: lowercase letters, digits, and hyphens, in two to five dot-separated parts. It's stable. Keep the same ID across releases while the screenshot shows the same concept. Create a new ID only when the concept changes. Never put the ID in a caption or alt text.

## Status (lifecycle)

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

## Actions and checks

`capture.actions` uses the same named actions as briefs (`scripts/presets/p1-editor.json`), for example `"openWorkstreamMenu"` or `{ "selectBlockByType": { "type": "PullQuote" } }`. It may be empty. The generated brief adds the editor-ready check, the workstream selection, and, unless your actions open the workstream menu on purpose, a step that closes it. `capture.checks` uses the same check shapes as `expectAfter` (`{ "selector": "...", "text": "..." }`, `selectedBlock`, and so on). A check must fail when the state is wrong. A capture with no checks isn't allowed.

## Text rules

Caption and alt text are written once, in the record, and copied unchanged into the brief, the capture report, the gallery, the Figma manifest, and the docs handoff. Validation rejects text that is missing, has placeholder wording (`TO FILL`, `TODO`, `{{...}}`, `<...>`), is generic ("Screenshot", fewer than four words), contains filler or test data, contains a URL, host, or local path, contains an inventory ID, spans lines, or contains `|` (so tables can show it verbatim). A leading "screenshot of" or an alt text over 250 characters is a warning. There is no fallback text: a missing alt text stops the handoff.

## Secrets and customer data

Any string in a record that looks like a token, key, JWT, bearer header, credential assignment, signed or credentialed URL, or an email address (other than `@example.com` and `@example.org`) is an error. Use a person or team handle for `owner` and `reviewer`.

## Trace requirements

`trace` checks more than `validate`. Besides the status requirements, every captured image needs the annotated frame: `figma.annotated_frame_name` and `figma.annotated_node_id` (record it with `record-figma --annotated-node-id`), because the docs embed the annotated frame, not the clean one.
