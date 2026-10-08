---
title: Swap images in Markdown docs
parent: How-to guides
nav_order: 8
---

# Swap images in Markdown docs

Replace a release's screenshots in a Markdown docs repository as one reviewable commit.

{% include video.html name="07a-markdown-swap" title="Swap images in Markdown docs" %}

## Before you start

The docs repository has `screenshots.map.json`, mapping each screenshot ID to the image file its pages embed:

```json
{ "images": { "p1.editor.shell": "docs/images/editor-shell.png" } }
```

Image paths never change between releases, so a swap replaces file bytes and alt text only.

## Steps

1. See what would change:

   ```bash
   node scripts/publish-markdown.mjs --inventory <inventory> --assets-dir <assets> --repo <docs repo> --dry-run
   ```

   Each mapped image is listed as `SWAP` or `same`, with any alt text edits.

2. Swap on a new branch:

   ```bash
   node scripts/publish-markdown.mjs --inventory <inventory> --assets-dir <assets> --repo <docs repo> --branch screenshots/<release>
   ```

   It copies each release image over its mapped file, updates the alt text of every Markdown image that points
   at it, and commits only those files. It pushes nothing and prints the push command.

3. Review the commit, push the branch, and open a pull request.

The swap refuses a map path outside the repository, a file that isn't a PNG, an asset whose checksum
doesn't match the inventory, and a record with no alt text.

Next: [Verify and trace](verify.html).
