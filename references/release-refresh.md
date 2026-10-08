# Release-time refresh

Use this when a P1 release changes the editor UI and the docs screenshots need to match. Each release gets its own run, its own Figma page, and its own handoff note. Nothing from an earlier release is overwritten.

## Inputs

| Input                            | Where it comes from                                                                             |
| -------------------------------- | ----------------------------------------------------------------------------------------------- |
| Release name or version          | You. Passed as `--release "<name>"` to `figma-plan.mjs` and `handoff.mjs`.                      |
| Target origin                    | A production build of the release (`next build && next start`). `next dev` renders differently. |
| Project, workstream, page, block | Chosen again for this run in the config (`configuration.md`). Don't reuse an old run's.         |
| Menu wording                     | `publishMenuLabel` and `blockCategory`, as the new release shows them.                          |
| Previous run                     | The capture folder of the last approved run, kept until the new one is approved.                |

## Steps

1. **Ask** for the release name and confirm the inputs above.
2. **Rebuild the target** from the release and start it.
3. **Sign in** through the dedicated Chrome (`SKILL.md`, steps 2 and 3).
4. **Re-check the targets** with the P1 MCP (`list_branches`, `list_documents`, `get_document`) and the signed-in editor: workstream names, block types, menu wording. A reworded menu fails `openPublishMenu` until `publishMenuLabel` is updated.
5. **Capture** the validation shot, then the complete brief, into a new folder. A failure names the selector or text that didn't match and quotes what the page showed. Update the preset selectors or brief text to match the new UI. Don't loosen a check to get a pass.
6. **Inspect every PNG** from the delivered run.
7. **Compare** with the previous run:

   ```bash
   node scripts/compare-runs.mjs --old <previous run> --new <new run> --json <out>/compare.json
   ```

   Each shot is `identical`, `changed`, `resized`, `new`, `removed`, or `failed`. Add `--fail-on-change` to exit 2 when any shot isn't identical.

8. **Plan the Figma page** with the release in the name:

   ```bash
   node scripts/figma-plan.mjs --dir <new run> --config p1-editor.config.json --release "<release>"
   ```

   Put `{release}` in `figma.pageNamePattern` (for example `{topic} · {release} · {runId}`) so the release is visible in the page list. Without the token, `--release` is still recorded in `figma-plan.json`.

9. **Push** the page (`figma-review.md`).
10. **Write the handoff note** with the comparison:

    ```bash
    node scripts/handoff.mjs --config p1-editor.config.json --dir <new run> --release "<release>" --previous <previous run>
    ```

    The "What changed" table lists each shot's status, and the note names both runs.

11. **Clean up** (`contributor-setup.md`).

## With the screenshot inventory

If the screenshots come from the inventory (`screenshot-inventory.md`), `node scripts/inventory.mjs release --release <name> --old <previous run> --new <new run>` lists only the records marked `new`, `refresh`, or `retire` for that release, with the reason, capture target, docs location, Figma evidence, and replacement asset path. A record marked `unchanged` whose pixels changed is flagged for review, not refreshed. A shot in the new run with no record is reported separately as an inventory gap, and the command exits 2. An absent record is never assumed to need a refresh.

## How the comparison works

`compare-runs.mjs` reads both runs' `capture-report.json` files and decodes the PNGs. It compares pixels, not file bytes.

- Headless Chrome renders about 10 of 5 million pixels differently between identical runs, so an exact match reports false changes. The image is split into 16 by 16 pixel squares. A shot is `changed` when any square has at least 8 differing pixels. Differing pixels outside those squares are counted as noise and shown ("12 isolated pixels ignored as noise"), not as a change. `--block` and `--min-diff` tune this. `--exact` treats any difference as a change.
- A reworded label differs in a dense cluster and is reported. The fixture rehearsal shows this: changing one menu label between two releases flags only that shot, and the other five stay identical.
- It can't say what changed, only where. A person looks at the two images and writes the description.
- Dynamic content in a screenshot (a date, a recent-activity list) shows as a change. Note it in the handoff rather than weakening the comparison.

## Run IDs, page names, and replacement policy

- The run ID comes from `figma.runIdPattern` and the capture time, to the minute. A new capture, even of unchanged UI, gets a new ID.
- The Figma page name comes from `figma.pageNamePattern`. The planner refuses a pattern without `{runId}`, because the name is how a repeat push is detected.
- **Pages are immutable.** A refresh adds a page. It never edits or deletes the earlier one. The generated code throws `Page already exists` before creating anything if the name is taken, and the sandbox tests prove the first page is untouched when a second is added.
- A docs image is replaced by the docs author, from the new approved page, using a stable file name (`docs-handoff.md`). Replacing the image in the docs is a manual decision. The tool never does it.

## Rollback

There is nothing to roll back in Figma: earlier pages are unchanged. To go back to the previous release's screenshots, tell the docs author to use the earlier run's approved page, and note it in the handoff. If a pushed page is wrong (bad capture, wrong workstream), leave it, capture again for a new run ID, and mark the bad page as superseded in the handoff note. Delete a Figma page only by hand, and only if nobody has linked or approved it.

## Rehearsal without P1

`npm test` rehearses a release against two fixture editors. Release A and release B differ in one menu label. The test shows that:

- release A captures six shots, and release B fails only `publish-menu-open` until the label in the config is updated;
- with the updated label, release B captures six shots, and `compare-runs.mjs` flags only that shot (`--fail-on-change` exits 2; the same run against itself exits 0);
- the two runs get different run IDs and Figma page names with `{release}`, and both pages coexist in the Figma API mock with the first one untouched;
- the handoff note for release B names the previous run and lists the changed shot.

This proves the tooling. It isn't a rehearsal against a real P1 release, which hasn't been run.

## What usually breaks after an editor upgrade

- `data-testid` names and ARIA labels the preset relies on (`p1-editor-header`, `workstream-trigger`, `workstream-list`, `publish-split-button`, `inspector-collapse-button`, the `Toggle left panel` label, the `p1-cat-btn-` ids).
- Puck's `data-puck-component` attribute, the selection overlay class (`--isSelected`), and the preview iframe id `preview-frame`.
- Menu and button wording.
- Block names: a renamed or removed block type makes `selectBlockByType` fail.
- The page URL scheme (`/p1/<path>`).
