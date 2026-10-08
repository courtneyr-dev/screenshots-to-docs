---
title: Google Docs swap
parent: Reference
nav_order: 4
---

# Google Docs swap

The swap replaces release screenshots inside Google Docs from a list pinned to a git commit. Two parts: the
manifest (`scripts/gdocs-manifest.mjs` writes it) and the Apps Script (`templates/gdocs-swap/Code.gs`) that
reads it. Set it up with `npm run setup -- --only gdocs`.

## Manifest

```json
{
  "version": 1,
  "repo": "owner/name",
  "ref": "<40-character commit>",
  "entries": [
    {
      "screenshot_id": "p1.editor.shell",
      "release": "0.20.0",
      "document_id": "<Google Doc ID>",
      "image": {
        "repo": "owner/name",
        "ref": "<commit>",
        "path": "screenshots/p1.editor.shell/0.20.0.png",
        "sha256": "<64 hex>",
        "width": 2880,
        "height": 1800
      },
      "alt": { "title": "<alt text>", "description": "<alt text>" },
      "match": { "title": null, "fingerprints": ["<16 hex>"] }
    }
  ],
  "skipped": [
    {
      "id": "p1.editor.other",
      "reason": "status is approved; only handed_off or later is swapped"
    }
  ]
}
```

| Field                          | Meaning                                                                                                                                                 |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `image.ref`                    | The commit that holds the image bytes. Always a full SHA, so a manifest always means the same bytes.                                                    |
| `image.sha256`                 | The checksum the script checks before inserting anything.                                                                                               |
| `alt.title`, `alt.description` | Written to the image's alt title and description. Both carry the alt text, unless `--title-anchor` puts the screenshot ID in the title.                 |
| `match.fingerprints`           | How the script finds the old image: the fingerprint (normalized, hashed) of the current alt text and of the alt text recorded at the last verification. |
| `match.title`                  | With `--title-anchor`, an image whose alt title is the screenshot ID also matches.                                                                      |

A record is included when it is `handed_off` or later, has a recorded asset, has alt text, and its
`source.docs_document_id` is a Google Doc ID. Everything else is listed in `skipped` with the reason.

## Script settings

| Setting         | Where                                                       | Value                                                                                |
| --------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `GITHUB_TOKEN`  | Script property only (Project Settings > Script properties) | A fine-grained token with read-only Contents on the one repository. Never in a file. |
| `MANIFEST_REPO` | `Config.gs` (written by setup) or a script property         | `owner/name`                                                                         |
| `MANIFEST_PATH` | `Config.gs` or a script property                            | Path of the manifest in the repository                                               |
| `MANIFEST_REF`  | `Config.gs` or a script property                            | The commit that holds the manifest (40 characters)                                   |

A script property overrides `Config.gs`. The project asks for two Google permissions only: Docs, and
connecting to an external service (`appsscript.json`).

## Functions

| Function     | What it does                                                                                                                         |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| `dryRunSwap` | Fetches the manifest and every image, checks each checksum, finds each image in its doc, and logs what it would do. Changes nothing. |
| `runSwap`    | The same, then replaces each match in place at the same width and writes its alt text.                                               |

Both log one JSON report to the execution log.

## Report statuses

| Status              | Meaning                                                        | What changed           |
| ------------------- | -------------------------------------------------------------- | ---------------------- |
| `would-replace`     | Dry run: exactly one image matches.                            | Nothing                |
| `replaced`          | The image was replaced and its alt text written.               | That image             |
| `not-found`         | No image in the doc has a matching alt text or title.          | Nothing                |
| `ambiguous`         | More than one image matches, or the match was already claimed. | Nothing for this entry |
| `checksum-mismatch` | The bytes fetched from GitHub don't match the manifest.        | Nothing                |
| `error`             | The doc couldn't be opened, or GitHub refused the request.     | Nothing for this entry |

## Safety rules the script enforces

- The token is sent only to `api.github.com`, only for `MANIFEST_REPO`, with redirects refused.
- A ref that isn't a full commit SHA, a path with `..`, or a repository other than `MANIFEST_REPO` is refused.
- An image whose bytes don't match the manifest is never inserted.
- Nothing is published. A person clicks Publish in the Content Publisher add-on.
