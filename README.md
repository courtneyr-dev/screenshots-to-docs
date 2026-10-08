# screenshots-to-docs

Keeps docs screenshots current across releases, for any web app. When the app ships a new version, the tool captures it through a target preset (the P1 editor, WordPress admin, Drupal admin, Content Publisher, public sites, or your own), puts each run on a Figma page for annotation with a shared kit, drafts alt text from the annotation marks, and swaps the new images into Markdown docs and Google Docs from a list pinned to a git commit. People decide what to reshoot, review the marks, and click Publish.

## Documentation

The full docs are in [`docs/`](docs/index.md) and published with GitHub Pages (Settings > Pages shows the address):

- **Tutorial:** [your first release swap](docs/tutorial/first-swap.md), end to end on sample data, no accounts.
- **How-to guides:** [set up](docs/how-to/set-up.md), then each release step from [detect a release](docs/how-to/detect-a-release.md) to [verify and trace](docs/how-to/verify.md), each with a narrated video.
- **Reference:** [commands](docs/reference/commands.md), [configuration](docs/reference/configuration.md), [inventory](docs/reference/inventory.md), [Google Docs swap](docs/reference/google-docs-swap.md), [annotation kit](docs/reference/annotation-kit.md).
- **Explanation:** [how it works](docs/explanation/how-it-works.md), [accessibility](docs/explanation/accessibility.md), [safety](docs/explanation/safety.md).

## Quick start

```bash
npm run setup            # tools, capture config, Figma kit plugin, Markdown and Google Docs targets
npm run setup -- --status
npm test                 # no P1, Figma, Google, or GitHub access needed
```

An AI coding agent can run the workflow by reading [`SKILL.md`](SKILL.md); the `references/` files are its detailed guides. The scripts work without one.

## Layout

```
SKILL.md              the skill: safety rules, workflow, checklist
references/           configuration, safety, six-shot workflow, Figma review, release refresh,
                      docs handoff, screenshot inventory, contributor setup, second-user smoke test, known limitations,
                      POC results, harness reference
examples/             config.example.json, handoff note example, and proof-of-concept/ (the proof-of-concept config shape, with placeholders)
briefs/               p1-editor.json: the generic six-shot brief (placeholders only)
templates/            handoff note template, suggested captions, and gdocs-swap/ (the Google Docs Apps Script)
inventory/            screenshots.json: the screenshot inventory (source of truth)
scripts/              capture, preflight, chrome, figma-plan, figma-upload, handoff, inventory, compare-runs, cleanup,
                      validate-skill, check-identity, presets/, lib/
figma-plugin/         the annotation kit plugin: manifest.json, kit.json, src/, and the built code.js
docs/                 the GitHub Pages documentation site and its videos
tests/                run-tests.sh, e2e.sh, Figma and upload mocks, and fixtures (fixture editor, servers, briefs)
package.json          scripts and the one dependency (puppeteer-core)
```

## Tests

```bash
npm test        # same as: bash tests/run-tests.sh
```

Setup, the CI checks to run locally, cleanup, and contributing: [`references/contributor-setup.md`](references/contributor-setup.md).

Runs the harness, planner, uploader, and configuration checks against local fixture sites: parity capture, report fields, attention rows, HTTP 403 and corrupt-PNG failures, uploader errors, action validation, missing configuration, custom workstream, page, Chrome port and profile, custom Figma naming, handoff generation, and scans for personal identifiers and secrets. Also: deep-linked page URLs, instance-level block proof with a neighbor-selecting editor that must be rejected, a two-release rehearsal with screenshot comparison, the generated Figma code run against a Plugin API mock, the uploader against a mock endpoint, a second project on a second Chrome, cleanup and output guards, the skill validator, the identity checker, and mutation checks that remove a guard and expect a failure. It needs Chrome but no P1, Figma, or Google access. It does not cover the live signed-in capture or a real Figma push; the fixtures follow the documented contracts but aren't P1 or Figma. The live second-user run is pending (`references/second-user-smoke-test.md`).

## Safety

The short version: a person signs in; the harness never sees credentials; the config never holds them; the Chrome profile, cookies, upload URLs, and screenshots stay out of the repository; menus are opened, never used (the More actions menu contains a delete action). The full list is in [`references/safety.md`](references/safety.md).

## Origin

The tool was built in the `pantheon-systems/p1-docs` repository (`tools/p1-editor-screenshots-to-docs/`) and copied here without its history. The capture harness started as a Next.js screenshot tool; its original documentation is kept at [`references/nextjs-screenshots-harness.md`](references/nextjs-screenshots-harness.md).

## Contributing

Run `npm test` and `npm run lint` before a pull request. Details: [`references/contributor-setup.md`](references/contributor-setup.md).

## License

This repository has no license file.
