# p1-editor-screenshots-to-docs

A tool for capturing screenshots of the signed-in **P1 editor** for P1 documentation and releases. A person signs in to a dedicated Chrome window; the harness attaches to it, takes a fixed set of six validated editor screenshots, and pushes each run to Figma as its own page for manual annotation. A written handoff note gets the approved images to the docs author.

It works for any authorized P1 user, project, workstream, and page. Nothing is hard-coded: you describe the run in a config file, and the tool checks that file before it opens a browser.

Status: proof of concept, packaged for review. It was built and run end to end once on a demo project. See [`references/poc-results.md`](references/poc-results.md) for what was verified and [`references/known-limitations.md`](references/known-limitations.md) for what wasn't.

## What it does

1. Attaches to a Chrome you start with a dedicated profile and sign in to yourself.
2. Checks that the page is the signed-in P1 editor, on your project, workstream, and page, before saving each shot. A sign-in screen, loading state, bot challenge, public page, wrong workstream, or missing editor UI fails the shot and saves nothing.
3. Captures six editor states: shell, Blocks browser, selected block with properties, wider canvas, workstream selector, and the publish menu.
4. Pushes each run to a Figma design file as one page, named from your pattern, and rejects a repeat push of the same run.
5. Writes a handoff note from a template. Annotation and the docs update stay with people.
6. Detects a new P1 SDK version and reopens the published screenshots it may change (`release-check`), so a refresh starts from the release, not from a code change.
7. Keeps a git-tracked **screenshot inventory** (`inventory/screenshots.json`) as the source of truth: why each screenshot exists, the state to capture, the Figma frame, the exact docs article, heading, and image slot, and the verified published image. See [`references/screenshot-inventory.md`](references/screenshot-inventory.md).

## What it doesn't do

- It doesn't capture the published site, sign in for you, or handle credentials.
- It doesn't export to Google Docs or the P1 docs. Nothing in the docs repository connects Figma to Google Docs, so the handoff is manual (`references/docs-handoff.md`).
- It doesn't create Figma version history. A person saves a Figma version if the history must show a run.
- It doesn't bypass bot protection.

## Requirements

- Node 18 or later (CI uses 20), npm, and Google Chrome (macOS tested locally, Linux in CI).
- A P1 site you can reach, preferably a local production build.
- For Figma: the Figma MCP and edit access to a design file.
- The P1 MCP, to look up projects, workstreams, pages, and block types.

## Quick start

All commands run from this folder (`tools/p1-editor-screenshots-to-docs/` in the p1-docs repository).

```bash
bash scripts/setup.sh

# 1. Describe the run. Copy the template, fill in every <placeholder>, then check it.
cp examples/config.example.json p1-editor.config.json
node scripts/preflight.mjs --config p1-editor.config.json --need capture,figma,handoff --brief briefs/p1-editor.json

# 2. Start the dedicated Chrome (the command is printed, not run) and sign in to Google in that window yourself.
node scripts/chrome.mjs --config p1-editor.config.json

# 3. One validation shot first, and look at it. Then the full set.
node scripts/capture.mjs --brief briefs/p1-editor.json --config p1-editor.config.json --only editor-shell --out-dir <out>/validate
node scripts/capture.mjs --brief briefs/p1-editor.json --config p1-editor.config.json --out-dir <out>/run1

# 4. Plan the Figma push, then follow references/figma-review.md. Afterward, the handoff note.
node scripts/figma-plan.mjs --dir <out>/run1 --config p1-editor.config.json
node scripts/handoff.mjs --config p1-editor.config.json --dir <out>/run1 --release "<release or change>"
```

Keep `p1-editor.config.json` and `<out>` outside the repository (or in a path the ignore rules cover) so they never reach a commit. [`references/configuration.md`](references/configuration.md) explains every setting.

An AI coding agent can run the workflow by reading [`SKILL.md`](SKILL.md). The scripts work without one.

## Layout

This folder lives at `tools/p1-editor-screenshots-to-docs/` in the p1-docs repository. It is self-contained and has its own `package.json`; it is not part of the Next.js app.

```
SKILL.md              the skill: safety rules, workflow, checklist
references/           configuration, safety, six-shot workflow, Figma review, release refresh,
                      docs handoff, screenshot inventory, contributor setup, second-user smoke test, known limitations,
                      POC results, harness reference
examples/             config.example.json, handoff note example, and proof-of-concept/ (the proof-of-concept config shape, with placeholders)
briefs/               p1-editor.json: the generic six-shot brief (placeholders only)
templates/            handoff note template and suggested captions
inventory/            screenshots.json: the screenshot inventory (source of truth)
scripts/              capture, preflight, chrome, figma-plan, figma-upload, handoff, inventory, compare-runs, cleanup,
                      validate-skill, check-identity, presets/, lib/
tests/                run-tests.sh, e2e.sh, Figma and upload mocks, and fixtures (fixture editor, servers, briefs)
package.json          scripts and the one dependency (puppeteer-core)
```

## Claude Code skill

The inventory workflow is also a Claude Code project skill at `.claude/skills/p1-screenshot-inventory/SKILL.md` in the repository root. `SKILL.md` in this folder is the separate skill for the capture and Figma workflow.

## Tests

```bash
npm test        # same as: bash tests/run-tests.sh
```

Setup, the CI checks to run locally, cleanup, and contributing: [`references/contributor-setup.md`](references/contributor-setup.md).

Runs the harness, planner, uploader, and configuration checks against local fixture sites: parity capture, report fields, attention rows, HTTP 403 and corrupt-PNG failures, uploader errors, action validation, missing configuration, custom workstream, page, Chrome port and profile, custom Figma naming, handoff generation, and scans for personal identifiers and secrets. Also: deep-linked page URLs, instance-level block proof with a neighbor-selecting editor that must be rejected, a two-release rehearsal with screenshot comparison, the generated Figma code run against a Plugin API mock, the uploader against a mock endpoint, a second project on a second Chrome, cleanup and output guards, the skill validator, the identity checker, and mutation checks that remove a guard and expect a failure. It needs Chrome but no P1, Figma, or Google access. It does not cover the live signed-in capture or a real Figma push; the fixtures follow the documented contracts but aren't P1 or Figma. The live second-user run is pending (`references/second-user-smoke-test.md`).

## Safety

The short version: a person signs in; the harness never sees credentials; the config never holds them; the Chrome profile, cookies, upload URLs, and screenshots stay out of the repository; menus are opened, never used (the More actions menu contains a delete action). The full list is in [`references/safety.md`](references/safety.md).

## Origin

The capture harness started as a Next.js screenshot tool and grew into this workflow. Its proof-of-concept commits are preserved in this repository's history (imported with `git subtree`: the imported commits are the second parent of the `feat(tools): import p1-editor-screenshots-to-docs` merge commit, and `git blame` on any file in this folder credits lines to them). The original harness documentation is kept, cleaned of personal references, at [`references/nextjs-screenshots-harness.md`](references/nextjs-screenshots-harness.md).

## Contributing

Commit with Conventional Commits and a Pantheon or GitHub noreply address. Add a ticket reference only if you have a real one. The repository squash-merges pull requests. A workflow (`.github/workflows/p1-editor-screenshots-tool.yml`) runs the tests, skill validator, Prettier, ESLint, identity check, and gitleaks on changes to this folder. Details: [`references/contributor-setup.md`](references/contributor-setup.md).

## License

This tool is part of the p1-docs repository and is covered by the repository's `LICENSE.md` (GNU General Public License v3). It adds no separate license.
