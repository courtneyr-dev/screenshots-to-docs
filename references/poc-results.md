# Proof-of-concept results

Everything in this skill comes from a proof of concept run on 2026-09-30. This file records what was verified, so reviewers can tell proven behavior from intent. The proof of concept started as a Next.js screenshot harness and grew into the P1 editor workflow; the original harness documentation is kept in `nextjs-screenshots-harness.md`.

The names in this file (the demo project, its playground workstream, and the topic in the page names below) are the proof of concept's example values, kept as a historical record. The tool itself has no project-specific defaults: the proof of concept's two hard-coded briefs were replaced by a generic brief template and a per-run config file in a later change, and the equivalence of the resolved shots was checked with `--dry-run` (steps identical; the only differences were a new project-name check and removing two assumptions about a workstream called "Live").

## Verified end to end

| Stage                                                 | Result                                                                                                                                                                    |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dedicated Chrome, debugging port, non-default profile | Attached with `--connect`; the harness opened and closed only its own tabs; Chrome stayed up                                                                              |
| Interactive Google sign-in                            | Completed by the person in the dedicated window; no credentials passed through the harness                                                                                |
| Sign-in detection                                     | A fresh tab before sign-in showed "Loading Authenticating…", then "Log in to your Pantheon P1 account"; the harness's checks refused both                                 |
| Workstream per tab                                    | New tabs opened on the site's default workstream; the playground workstream was chosen through the selector in each shot                                                  |
| Six-shot capture                                      | 6/6 captured, 0 failed, for two independent runs                                                                                                                          |
| Visual inspection                                     | Every PNG of the delivered run opened and checked; two defects found and fixed (stray tooltip, panel state leaking from shot 4 into shots 5 and 6)                        |
| Figma                                                 | Two run pages pushed to one design file; each has six uniquely named rectangles with image fills and no wrapper fills                                                     |
| Coexistence                                           | Both run pages present in the file after the second push                                                                                                                  |
| Duplicate guard                                       | Re-running the first run's complete generated code threw `Page already exists: … This run is already pushed.` at the guard line; the page list showed one page per run ID |

Runs pushed (page names; the topic and timestamps are the proof of concept's example values):

- `p1-trogdor-editor · 2026-09-30 17:56 · p1-trogdor-editor-20260930-1756`
- `p1-trogdor-editor · 2026-09-30 17:59 · p1-trogdor-editor-20260930-1759`

The Figma file and its key are not recorded in this repository.

## Verified against local fixtures

Two small local sites (a stand-in for the new site and for a WordPress baseline) and a third that always returns 403. These cases are in `tests/run-tests.sh`.

- Parity capture: 3 shots on each side, 6/6 captured. The new site's `/legacy` returns 404 and is reported as a captured shot with status 404, not a failure.
- The planner puts the attention row first and marks it `NEEDS ATTENTION`.
- A plain 403 fails the shot, saves no PNG, and exits 1 (`blocked: http-403`).
- The planner exits 1 for a report with no usable shots, and for a "captured" shot whose PNG is missing, not a PNG, or truncated.
- The uploader exits 1 for a refused connection, an HTTP 404, and a wrong URL count, and prints a retry command.
- Unknown actions and missing action parameters fail before a browser opens.

## Verified against a hosted site

A hosted demo site served a Cloudflare challenge to headless Chrome (HTTP 403 with `cf-mitigated: challenge`) while `curl` got 200. The harness marked all six shots `blocked: challenge`, saved no PNGs, and the planner refused the report. No bypass was attempted.

## Commit history

The skill's history was carried into this repository with `git subtree split`, so the six proof-of-concept commits are preserved. Their hashes changed in the split; the originals are in the author's private configuration repository.

| Original  | In this repository | Summary                                                             |
| --------- | ------------------ | ------------------------------------------------------------------- |
| `18162f2` | `9374f7e`          | Next.js screenshot harness, forked from a WordPress one             |
| `9f667d4` | `d0e9fcf`          | Push each capture run to Figma as one page                          |
| `7d67d81` | `278267c`          | Fail bot-challenged shots; P1 target-only brief                     |
| `ed8d594` | `09466d2`          | Start every run by asking which site to capture                     |
| `f14b752` | `6d0cb3d`          | Named actions, P1 editor preset, `--connect`, six-shot editor brief |
| `d4c0cd4` | `97e5ce9`          | Distinct shots 4 and 6; restore panel state per shot                |

A packaging commit then added this reference set, the README, the tests, and the skill's `SKILL.md`. Importing the tool into p1-docs as `tools/p1-editor-screenshots-to-docs/` flattened the folder layout and replaced a personal author email on the proof-of-concept commits with a GitHub noreply address, so the hashes changed again. `git log --follow` does not cross the import. To see a file's imported history, run `git log <merge>^2 -- <path inside the tool>` on the `feat(tools): import p1-editor-screenshots-to-docs` merge commit, or use `git blame`, which credits lines to the original commits.
