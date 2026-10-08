# Documentation plan — p1-screenshots-to-docs

## Header

Run date: 2026-10-07 · Output: GitHub Pages site built by Jekyll from `docs/` (theme `just-the-docs` via `remote_theme`, Mermaid on), published from `main` · Reference generator: none (no autodoc rule; reference is hand-written from the scripts' `--help` and code).

## Proposed documents

### Reference — approved scope: **the commands a person runs (`npm run setup`, `scripts/*.mjs` entry points, every `inventory.mjs` subcommand), the config file, the inventory schema and lifecycle, the swap manifest and Apps Script, and the Figma kit's components and variables. Not `scripts/lib/*` internals.**

| Document (path)                      | Need served                                                                 | Source material                                                                            |
| ------------------------------------ | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `docs/reference/commands.md`         | Look up a command, its flags, and what it refuses                           | each script's header and `--help`; `inventory.mjs` help                                    |
| `docs/reference/configuration.md`    | Fill in `p1-editor.config.json`                                             | `references/configuration.md`, `examples/config.example.json`                              |
| `docs/reference/inventory.md`        | Know every inventory field and status transition                            | `references/screenshot-inventory.md`, `scripts/lib/inventory.mjs`                          |
| `docs/reference/google-docs-swap.md` | Know the manifest format, script properties, functions, and report statuses | `references/release-swap.md`, `templates/gdocs-swap/Code.gs`, `scripts/gdocs-manifest.mjs` |
| `docs/reference/annotation-kit.md`   | Pick the right mark, tone, and size; know the variables                     | `figma-plugin/kit.json` (component descriptions, variants, variables)                      |

### How-to guides

| Document (path)                      | Need served                                                | Source material + video                            |
| ------------------------------------ | ---------------------------------------------------------- | -------------------------------------------------- |
| `docs/how-to/set-up.md`              | Install everything with one command                        | `scripts/setup.mjs`, `scripts/setup.sh`            |
| `docs/how-to/detect-a-release.md`    | Find stale screenshots and approve reshoots                | walkthrough §1 · video 1                           |
| `docs/how-to/capture.md`             | Capture the signed-in editor                               | walkthrough §2, README quick start · video 2       |
| `docs/how-to/push-to-figma.md`       | Put a run on a Figma page                                  | `references/figma-review.md` · videos 3, 4         |
| `docs/how-to/annotate.md`            | Annotate with the kit, including redaction and step naming | walkthrough §4, kit descriptions · video 5         |
| `docs/how-to/alt-text.md`            | Draft and approve alt text from the marks                  | walkthrough §5, `draft-alt.mjs` · video 7b         |
| `docs/how-to/export-and-hand-off.md` | Export the annotated frame and hand it off                 | walkthrough §6 · video 6                           |
| `docs/how-to/swap-markdown.md`       | Swap a release into Markdown docs                          | `publish-markdown.mjs` · video 7a                  |
| `docs/how-to/swap-google-docs.md`    | First insert, then swap a release into Google Docs         | `references/release-swap.md` · videos 7d, 7e       |
| `docs/how-to/verify.md`              | Verify published images and trace every image              | walkthrough §9 · video 8                           |
| `docs/how-to/troubleshoot.md`        | Fix the failures seen in practice                          | walkthrough problems table, `known-limitations.md` |

Grouped in navigation as Set up · Each release (detect → verify, 9 pages in order) · Fix problems, so no list exceeds 7 items at one level except the release sequence, which is numbered.

### Explanation

| Document (path)                     | Need served                                                                 | Source material                                         |
| ----------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------- |
| `docs/explanation/how-it-works.md`  | Understand the pipeline and why images are pinned to commits                | the two diagrams, `release-swap.md` "The chain"         |
| `docs/explanation/accessibility.md` | Understand why annotated frames, halos, and alt text from marks             | kit descriptions, research findings in `walkthrough.md` |
| `docs/explanation/safety.md`        | Understand what the tool will never touch (credentials, tokens, publishing) | `references/safety.md`, setup's token handling          |

### Tutorials

| Document (path)               | Need served                                                                       | Source material                                     |
| ----------------------------- | --------------------------------------------------------------------------------- | --------------------------------------------------- |
| `docs/tutorial/first-swap.md` | Learn the release swap end to end on sample data, no P1, Figma, or Google account | test fixtures and `publish-markdown` (runs offline) |

## Not-created entries

| Type / diagram level          | Reason                                                                                                           | Remedy                                        |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| C4 container diagram          | The tool is scripts plus three external services; a container view adds nothing the two flow diagrams don't show | Create if the tool grows a service of its own |
| Tutorial for the live capture | Needs a signed-in P1 account and editor; can't be followed or verified without one                               | Create once a public P1 sandbox exists        |

## Existing docs

`references/` files were kept in place (the agent skill depends on them); the site pages are rewrites that link to them for depth. Nothing was moved or deleted. `README.md` was rewritten as the front door.

## Batched questions & answers

- Audiences: docs writers who run a release; reviewers who annotate in Figma; a maintainer who installs and troubleshoots. (From the project.)
- Top goals: swap screenshots for a new P1 release without inserting images by hand; keep annotation consistent and accessible.
- Decisions worth explaining: commit-pinned manifests; annotated frame is what docs embed; alt text drawn from the marks; the person still publishes.

## Standing decisions

- No license file (the repo is planned to move to Pantheon).
- Videos live in `docs/assets/videos/` with WebVTT captions converted from the `.srt` files; every video gets a `<track kind="captions">`.
- Placeholders in place of personal and project values on every page (the repo's hygiene test enforces this for generic files).

## Tutorial verification status

| Tutorial        | Status                                                                                                                                                                      |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `first-swap.md` | verified 2026-10-07: every command run in a disposable copy of `examples/tutorial/`; outputs on the page are the captured outputs, with commit IDs normalized to `<commit>` |

---

**Approval:** ☑ plan approved ☑ reference scope approved — by the repository owner on 2026-10-07
