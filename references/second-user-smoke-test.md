# Second-user smoke test

Use this to show that the tool works for someone other than its author, on a project other than the one it was proven on. Two parts: an offline test that runs anywhere, and a live procedure that needs a signed-in P1 account.

## Status

| Part                                                    | Status                                                                                                                                                                                                                                                                 |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Offline second-project test (`npm test`)                | Passes. A second config (`examples/second-project.config.example.json`: another project, workstream, page, block, Chrome port and profile, Figma file key and naming, handoff directory and format) captures six shots from a second fixture editor on its own Chrome. |
| Live run by a second, authenticated person              | **PENDING.** No authenticated second account or second project was available when this was written, and credentials weren't requested. Nothing below has been run live. Record the result in the table at the end of this page when someone does it.                   |
| Live inventory-driven run, current account (2026-10-02) | Passed on a local signed-in editor: brief, capture, record, gallery, Figma plan (planned only), and handoff. The report, asset checksum, alt text, and note matched the record. It doesn't count as a second-user test.                                                |
| Live run against the project the tool was built on      | Done once before the tool was made portable (`poc-results.md`). It doesn't count as a second-user test.                                                                                                                                                                |

The fixture editor follows the DOM contract the presets rely on. It isn't P1, so a pass proves the tool reads its config and fails closed. It doesn't prove P1's markup still matches.

## Offline test

```bash
npm test
```

The section "second contributor and second project" runs these checks:

- The shipped second-project example config passes `preflight.mjs` unchanged.
- Six shots are captured with the second config, on a second Chrome (CDP port 9778, its own temporary profile) while the first project's Chrome is still running.
- The report holds only the second project's values: project, workstream, `/docs/guide`, the deep-linked `/p1/docs/guide` URL on every shot. None of the first project's values appear.
- The Figma plan uses the second config's run ID pattern, page name pattern, and file key.
- The handoff note goes to the second config's directory in the second config's format.

## Live procedure

Run it as the second person, on their own machine, with a project and workstream they can edit. Never use someone else's account, and never ask for their credentials: sign-in stays interactive.

1. **Set up.** Follow `contributor-setup.md` through "First run". Don't copy the first person's config.
2. **Write a config.** Copy `examples/second-project.config.example.json` to `p1-editor.config.json` and replace every value: the P1 origin, your project name as the editor header shows it, a workstream you can open, a page that exists in that workstream, a block type on that page, your own Chrome profile directory and a free port, a Figma file you can edit (or leave `figma` for later), and your handoff directory.
3. **Preflight.** `node scripts/preflight.mjs --config p1-editor.config.json --need capture,figma,handoff --brief briefs/p1-editor.json`. It must print "OK".
4. **Start Chrome and sign in.** `node scripts/chrome.mjs --config p1-editor.config.json` prints the launch command. Run it, then sign in to Google in that window yourself and pick the workstream.
5. **Validation shot.** `--only editor-shell`. Open the PNG: your project, workstream, and page must show.
6. **Six shots.** Open all six PNGs. Each must show your project, workstream, and page, and shots 3 and 4 must show your block selected.
7. **Negative checks.** Each must fail with no PNG saved:
   - `--set workstream=<a workstream that doesn't exist>`
   - `--set projectName="Not My Project"`
   - `--set pagePath=/not-a-page` (the page selector won't match)
8. **Figma and handoff.** If you have a Figma file: `figma-plan.mjs`, then `references/figma-review.md`. Then `handoff.mjs`. Confirm the page name and note follow your patterns.
9. **Clean up.** `node scripts/cleanup.mjs --config p1-editor.config.json --profile --out-dir <out> --yes`, after closing the debugging Chrome.
10. **Check nothing leaked.** `git status` in the repository shows no captures, config, or profile.

## Inventory-driven live check (second person)

Run this after step 6 above, in a scratch folder outside the repository. It proves the inventory path works on your account without touching the real inventory.

1. Copy `examples/inventory.example.json` to `<scratch>/inventory.json`. Keep one record and set its `status` to `approved`, `release_status` to `new`, `capture.project`, `workstream`, and `page` to your config's `projectName`, `workstream`, and `pagePath`, `capture.release` to `second-user-1`, and `capture.checks` to `[{ "selector": "#preview-frame" }]`. Leave the docs destination fields as the example's made-up values. Delete `history`, `asset`, `figma`, and the publication fields except `docs_image_slot`.
2. Run, in order, each with `--inventory <scratch>/inventory.json`:

   ```bash
   node scripts/inventory.mjs validate
   node scripts/inventory.mjs brief --config p1-editor.config.json --release second-user-1 --out <scratch>/brief.json
   node scripts/capture.mjs --brief <scratch>/brief.json --config p1-editor.config.json --out-dir <scratch>/run1
   node scripts/inventory.mjs record-capture --run <scratch>/run1 --assets-dir <scratch>/assets
   node scripts/figma-plan.mjs --dir <scratch>/run1 --config p1-editor.config.json --release second-user-1 --inventory <scratch>/inventory.json
   node scripts/handoff.mjs --config p1-editor.config.json --dir <scratch>/run1 --release second-user-1 --inventory <scratch>/inventory.json
   ```

3. Authentication is the same as above: sign in yourself in the dedicated Chrome. Nothing here asks for credentials.

Evidence to send back (no screenshots of other people's data, no account names or emails):

- The exit code and last line of each command above.
- That `<scratch>/run1/capture-report.json` has the record's `screenshotId`, `release`, and the same `altText` as the record.
- That the record's `asset.sha256` equals `shasum -a 256 <scratch>/run1/<screenshot_id>.png`.
- That `figma-manifest.json` says `planned` and `unverified`, with no node ID or file URL.
- That the handoff note lists the example docs destination and the alt text unchanged.
- PASS or FAIL for each, plus any command that failed and its message.

## What a pass shows

- No value from the first project's config is needed.
- A project name, workstream, or page that doesn't match is rejected, not captured.
- The block shots prove the right block.
- The run's Figma page name, run ID, and handoff note follow the second person's patterns.

## Result log

Add a row after each live run. Don't record account names, emails, or URLs that identify a private project.

| Date | Who (role) | P1 environment | Result  | Notes                                  |
| ---- | ---------- | -------------- | ------- | -------------------------------------- |
|      |            |                | PENDING | No live second-user run has been done. |
