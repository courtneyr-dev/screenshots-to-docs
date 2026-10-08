# Contributor setup

For someone who has never run the tool. Everything here works without P1, Figma, or Google access except the "live run" at the end.

## What you need

| Need                      | Detail                                                                                                                     |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Node                      | 18 or later (the tool's floor, and the repo's `engines`). CI uses Node 20, so use 20 if you want the same result.          |
| npm                       | Ships with Node. The repo uses npm and `package-lock.json`.                                                                |
| Google Chrome or Chromium | Any current version. The tests start it headless on a debugging port. Set `CHROME_BIN` if it isn't in a standard location. |
| bash, git, python3        | The test script uses them.                                                                                                 |
| gitleaks (optional)       | Local secret scan. CI runs a pinned version regardless. Without it, `npm test` falls back to a pattern scan.               |

## Install

From the repository root, once, for the repository's Prettier and ESLint:

```bash
npm ci
```

Then in the tool folder:

```bash
cd tools/p1-editor-screenshots-to-docs
bash scripts/setup.sh        # checks Node, npm and Chrome, then runs npm ci
```

## Check your setup

```bash
npm test                      # 100+ checks against local fixtures; needs Chrome only
node scripts/validate-skill.mjs
```

Both must pass before you change anything. The tests start fixture editors on ports 4301 to 4304 and Chrome on 9777 and 9778, so stop anything using them.

Match what CI runs before you push:

```bash
# from the repository root
npx prettier "tools/p1-editor-screenshots-to-docs/**/*.{js,jsx,md}" --check --ignore-path .prettierignore
npx eslint tools/p1-editor-screenshots-to-docs
# from the tool folder
node scripts/check-identity.mjs --range origin/main..HEAD --files
gitleaks detect --no-git --source . --redact
```

The repository has lint errors outside this folder. Don't count them, and don't fix them in a change to this tool.

## First live run

Needs a P1 account that can edit the project you choose.

1. **Config.** Copy `examples/config.example.json` to `p1-editor.config.json` and fill it in (`configuration.md`). The file is git-ignored. Keep profiles and output outside the repository.
2. **Preflight.** `node scripts/preflight.mjs --config p1-editor.config.json --need capture,figma,handoff --brief briefs/p1-editor.json`.
3. **Browser.** `node scripts/chrome.mjs --config p1-editor.config.json` prints a command that starts a separate Chrome with your profile directory and debugging port. Run it yourself. The tool never starts it for you and never touches your regular Chrome.
4. **Sign in.** In that window, sign in to Google yourself and choose the workstream. The tool never sees credentials, and you must never put them in the config, a brief, or a chat.
5. **Capture, Figma, handoff.** `SKILL.md` steps 4 to 7. Figma needs the Figma MCP and edit access to a design file. A person annotates in Figma.

## Clean up

When you finish:

1. Close the debugging Chrome window. While it runs, any local process can drive it through the port.
2. List what the run left behind, then remove it:

```bash
node scripts/cleanup.mjs --config p1-editor.config.json --profile --out-dir <out>/run1          # lists only
node scripts/cleanup.mjs --config p1-editor.config.json --profile --out-dir <out>/run1 --yes    # removes
```

It removes only the configured Chrome profile (if it looks like one, and isn't in a git repository) and capture folders (if they hold a `capture-report.json` and no tracked files). It refuses while Chrome still runs on the port. It never removes handoff notes.

3. Run `git status`. It should be clean.

## What can't be committed by accident

- `.gitignore` covers captures, reports, Figma plans and code, upload URLs, Chrome profiles, cookies, storage state, `.env` files, and `p1-editor.config.json`.
- `capture.mjs` refuses an `--out-dir` inside a git work tree unless git ignores it. `--allow-tracked-output` overrides that and is for tests.
- Config validation rejects a Chrome profile inside a git repository, and keys that look like credentials.
- `npm test` fails if any profile, cookie, config, or capture artifact is tracked, or if a personal identifier, email, UUID, hosted URL, or machine path appears in a generic file.
- CI scans the tool with gitleaks and checks commit author, committer, and message emails.

## Contributing

- Branch from `main`. Commit with Conventional Commits (`feat(tools): …`, `fix(tools): …`, `docs(tools): …`).
- Add a ticket reference such as `PCC-1234` only if you have a real one. Don't invent one.
- Use your Pantheon or GitHub noreply address in commit metadata. `check-identity.mjs` rejects other addresses.
- The repository squash-merges pull requests. A squash collapses the imported proof-of-concept history into one commit.
- The repository is GPL-3.0-or-later (`LICENSE.md`). The tool adds no license of its own.
- A test must fail when the behavior it guards is removed. The suite has mutation checks for the Figma code and the block-selection proof; follow that pattern.
