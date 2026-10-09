---
title: Your first release swap
parent: Tutorial
nav_order: 1
---

# Your first release swap

In this tutorial you take one screenshot from a new release into a Markdown docs page: you draft its alt text
from the annotation marks, swap the image and alt text into the docs on a branch, and see the swap list the
Google Docs script would read. It uses sample data in `examples/tutorial/`, so you need no P1, Figma, Google,
or GitHub account. It takes about ten minutes.

You need the tool installed (`npm run setup -- --only tools`) and a terminal open in the repository folder.

## 1. Make a working copy

Copy the sample so you can change it freely, and turn its docs folder into a git repository:

```bash
cp -R examples/tutorial ~/p1-tutorial
git -C ~/p1-tutorial/docs-repo init -q -b main
git -C ~/p1-tutorial/docs-repo add .
git -C ~/p1-tutorial/docs-repo commit -q -m "Docs at release 1.0.0"
```

The copy holds an inventory with one screenshot, the release 2.0.0 image of that screenshot, the layer names
of its annotated Figma frame, and a docs repository whose page still shows the release 1.0.0 image.

## 2. Look at the screenshot's record

```bash
node scripts/inventory.mjs list --inventory ~/p1-tutorial/inventory.json
```

```text
p1.tutorial.editor                           handed_off refresh   2.0.0        docs-team

1 of 1 records.
```

The screenshot was captured and annotated for release 2.0.0 and handed off to the docs.

## 3. Draft the alt text from the marks

Open `~/p1-tutorial/marks.json`. The layers named `Step 1: …`, `Step 2: …`, and `Step 3: …` are the numbered
badges on the image. Draft the alt text from them:

```bash
node scripts/draft-alt.mjs --marks ~/p1-tutorial/marks.json --subject "The P1 editor"
```

```text
The P1 editor with three numbered areas: 1 the Blocks panel, 2 the page canvas, 3 page settings.
```

The record's current alt text is vaguer than that. Save the draft:

```bash
node scripts/draft-alt.mjs --marks ~/p1-tutorial/marks.json --subject "The P1 editor" --id p1.tutorial.editor --inventory ~/p1-tutorial/inventory.json --apply
```

```text
p1.tutorial.editor: alt text updated (fingerprint 6d1a5c994e9f4ff5).
```

Notice that the numbers in the alt text now match the badges in the image.

## 4. See what the swap would change

```bash
node scripts/publish-markdown.mjs --inventory ~/p1-tutorial/inventory.json --assets-dir ~/p1-tutorial/assets --repo ~/p1-tutorial/docs-repo --dry-run
```

```text
SWAP  p1.tutorial.editor  -> docs/images/editor.png  (alt text updated in 1 place)

2 file(s) would change for release 2.0.0.
```

The docs repository's `screenshots.map.json` told the tool which file the page embeds.

## 5. Swap on a branch

```bash
node scripts/publish-markdown.mjs --inventory ~/p1-tutorial/inventory.json --assets-dir ~/p1-tutorial/assets --repo ~/p1-tutorial/docs-repo --branch screenshots/2.0.0
```

```text
SWAP  p1.tutorial.editor  -> docs/images/editor.png  (alt text updated in 1 place)

2 file(s) changed for release 2.0.0.
Committed on screenshots/2.0.0: <commit>. Nothing was pushed.
```

## 6. Read the commit

```bash
git -C ~/p1-tutorial/docs-repo show --stat --format='%s' HEAD
git -C ~/p1-tutorial/docs-repo diff HEAD~1 -- docs/tour.md
```

```text
Refresh P1 screenshots for 2.0.0

 docs/images/editor.png | Bin 6033 -> 6126 bytes
 docs/tour.md           |   2 +-
```

```diff
-![P1 editor with panels on the left, center, and right.](images/editor.png)
+![The P1 editor with three numbered areas: 1 the Blocks panel, 2 the page canvas, 3 page settings.](images/editor.png)
```

The swap changed exactly two things: the image bytes and the alt text. The image path stayed the same, so no
other page needed to change. This commit is what a reviewer sees in the pull request.

## 7. See the Google Docs swap list

The same record can be swapped into a Google Doc. Build the list the Apps Script would read, pinned to a
commit:

```bash
node scripts/gdocs-manifest.mjs --inventory ~/p1-tutorial/inventory.json --repo sample-owner/sample-screenshots --ref $(git -C ~/p1-tutorial/docs-repo rev-parse HEAD)
```

The summary at the end says:

```text
  swap p1.tutorial.editor [2.0.0] in doc 1TutorialSampleDocIdXXXXXXXXXXXXXX <- screenshots/p1.tutorial.editor/2.0.0.png@<commit>
1 to swap, 0 skipped.
```

The JSON above it is the list itself: the image, its checksum, the alt text to write, and how to find the old
image in the doc.

## What you did

You took a release image from the inventory to a docs page in one reviewable commit, with alt text drawn from
the annotation marks, and saw the pinned list that drives the same swap in Google Docs.

Next, set up the real thing: [Set up the tool](../how-to/set-up.html), then follow the release steps from
[Detect a release](../how-to/detect-a-release.html). To clean up, delete `~/p1-tutorial`.
