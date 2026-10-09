---
title: Detect a release
parent: How-to guides
nav_order: 2
---

# Detect a release

When the app you document ships a new version, find the screenshots that show the old UI and approve them for
a reshoot.

{% include video.html name="01-detect-release" title="A release is detected" %}

## Watch everything Pantheon ships

One command checks every product in a watchlist, plus the release notes, and says which screenshots each
change can affect. `watchlists/pantheon.json` covers 23 products: the P1 and Content Publisher SDKs, Terminus,
WordPress and Drupal core, the upstreams, and Pantheon's WordPress plugins and Drupal modules. It also reads
the [release notes feed](https://docs.pantheon.io/release-notes) for changes with no version, such as the
dashboard.

1. Give each inventory record the product whose releases can change it, using a watchlist ID:

   ```json
   {
     "screenshot_id": "dashboard.home.overview",
     "product": "pantheon-dashboard",
     "...": "..."
   }
   ```

2. Run the watch:

   ```bash
   node scripts/watch.mjs --watchlist pantheon --state watch-state.json --inventory <inventory>
   ```

   ```text
   Products
     P1 editor (p1-next-sdk)                   NEW RELEASE  0.20.0 → 0.20.1
                                               → 1 screenshot(s) to refresh: p1.editor.shell
                                                 release-check --product p1-editor --version 0.20.1
     Terminus                                  no change    4.3.3
     WordPress core                            no change    7.1.3
     ...

   Pantheon release notes: 5 new since 2026-10-05
     2026-10-06  New dashboard home experience, bookmarks feature now in beta  [User interface]
                 https://docs.pantheon.io/release-notes/2026/10/dashboard-home-experience-beta
     2026-10-06  WordPress 7.1.3 Security Release now available  [Action required, Security, WordPress]
                 https://docs.pantheon.io/release-notes/2026/10/wordpress-7-1-3
     ...
     → pantheon-dashboard: 1 screenshot(s) to review after "New dashboard home experience, bookmarks feature now in beta": dashboard.home.overview
         release-check --product pantheon-dashboard --version 2026.10.6
   ```

   This is a real run on 2026-10-09, against a saved state from before P1 0.20.1 shipped and a sample
   inventory with two records tagged with a product.

   A release-notes entry tagged **User interface** or **Account management** points at
   `pantheon-dashboard`, **Content Publisher** at `content-publisher-dashboard`, and **Infrastructure** at
   `pantheon-platform`. A change with no version is labeled by its date (`2026.10.6`), so it compares like a
   version.

3. Approve the screenshots that need a reshoot with the `release-check` command it prints, adding
   `--reopen`. The watch itself changes nothing.

4. Mark everything as seen, and commit `watch-state.json` next to the inventory so the next person sees only
   newer changes:

   ```bash
   node scripts/watch.mjs --watchlist pantheon --state watch-state.json --update
   ```

The first run has no state, so it lists every product's current version and the last 14 days of release
notes (`--since-days` changes that). It exits 3 when something is new, 0 when nothing is, and 1 when a source
fails. Another company or product works the same way: copy the watchlist and change its products and feed.

## Check one product

1. List the screenshots and the release each was captured for:

   ```bash
   node scripts/inventory.mjs list --inventory <inventory>
   ```

2. Compare the version the capture app runs with the latest published one. `--config` uses your preset's
   release source: the P1 SDK on npm for `p1-editor`, WordPress core for `wordpress-admin`, Drupal core for
   `drupal-admin`:

   ```bash
   node scripts/inventory.mjs release-check --registry --config p1-editor.config.json --inventory <inventory>
   node scripts/inventory.mjs release-check --app <capture app folder> --config p1-editor.config.json --inventory <inventory>
   ```

   ```text
   @pantheon-systems/p1-next-sdk 0.16.0 (installed in the app), latest published 0.20.0
     WARN: the app you would capture runs @pantheon-systems/p1-next-sdk 0.16.0, but 0.20.0 is the latest published.
   ```

   If the app still runs the old version, update it first: screenshots show the installed UI.

   For any other product, name the source: `--source github:<owner>/<repo>`, `--source npm:<package>`, or
   `--source page:<url> --pattern '<regex>'` for a version printed on a page.
   [Release sources](../reference/commands.html#release-sources) lists them all.

   ```bash
   node scripts/inventory.mjs release-check --registry --source wordpress --inventory <inventory>
   ```

   ```text
   wordpress 7.1.3, latest published 7.1.3
   ```

3. Check the inventory against the new version:

   ```bash
   node scripts/inventory.mjs release-check --version <new version> --inventory <inventory>
   ```

   ```text
   @pantheon-systems/p1-next-sdk 0.20.0
     0 screenshot(s) already captured for 0.20.0
     BEHIND  p1.live.editor-shell  (captured, still targets 0.16.0); finish or retarget it with: transition --id p1.live.editor-shell --to approved --release 0.20.0
   ```

   Each screenshot captured for an older version is listed as `BEHIND`, with the exact command that
   retargets it.

4. Decide which ones need a new image, and approve each for the new release:

   ```bash
   node scripts/inventory.mjs transition --id <id> --to approved --release <new version> --inventory <inventory>
   ```

   The record keeps its earlier release in `history` and moves to `approved` with `release_status: refresh`.
   Nothing is captured until a person approves it.

Next: [Capture the editor](capture.html).
