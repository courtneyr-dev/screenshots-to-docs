# Safety

The capture uses a real signed-in browser session on a real P1 site. These rules keep that session, and anything it can reach, out of the harness, the repo, and Figma.

## Credentials and sign-in

- The per-run config holds names, ports, and paths only. Validation rejects keys that look like credentials (password, secret, token, cookie, session, storage state, API key) at any depth, rejects a base URL with a username or password, and refuses a Chrome profile directory that is the regular Chrome profile, inside this tool's folder, or inside any git repository.

- A person signs in to Google in the dedicated Chrome window. The harness doesn't type into sign-in forms, read cookies, or run a login flow.
- Never ask the person for a password, MFA code, recovery code, cookie, or token, and never print one. If a page asks for one, stop and tell the person.
- The harness has an `auth` block (`cookiesFile`, `login`) inherited from the Next.js harness. Don't use it for the P1 editor. `--connect` makes it unnecessary.

## Browser profile and debugging port

- Start Chrome with a dedicated `--user-data-dir` (set as `chrome.profileDir` in the config, for example a folder under `~/.cache/`). Current Chrome refuses `--remote-debugging-port` on the default profile, and the default profile holds the person's real sessions.
- That profile directory stores the login. Keep it outside every repository. Delete it when the work is done.
- While that Chrome runs, any process on the machine can drive it through the port you set as `chrome.cdpPort`. Start it only for the capture and close it afterward.
- `--connect` opens its own tabs and closes only those. It disconnects without closing Chrome. It stores no cookies, tokens, or storage state.
- Don't copy the profile to another machine, into a repo, into Figma, or into a chat.

## Storage state and generated files

`.gitignore` excludes `node_modules/`, `screenshots/`, Chrome profiles, cookie files, storage-state files, `.env*`, `urls.json`, `figma-plan.json`, `figma-page.js`, and `capture-report.json`. Output goes to a directory you choose with `--out-dir`; keep it outside the repo or in an ignored path.

- `urls.json` holds single-use Figma upload URLs. They expire in 10 minutes but shouldn't be committed or shared.
- Screenshots of the signed-in editor include the account avatar and real page content. Check them before sharing the Figma file.
- `capture.mjs` refuses an `--out-dir` inside a git work tree unless git ignores that path. `--allow-tracked-output` overrides it and exists for tests.
- Remove what a run leaves behind with `node scripts/cleanup.mjs` (`contributor-setup.md`). It lists first and removes only with `--yes`, only the configured Chrome profile and capture folders, and never while the debugging Chrome runs.
- **Symlink-safe containment.** `docs.handoffDir` and `chrome.profileDir` are checked as canonical paths (`scripts/lib/paths.mjs`): symlinks in the existing part of the path are resolved, a directory that doesn't exist yet is placed under its resolved nearest ancestor, and only whole path segments are compared (a sibling named like the tool folder plus a suffix is fine). A destination that resolves inside the tool folder is an error, and so is a path that can't be resolved (a dangling or looping symlink, or a path through a file). `handoff.mjs` checks again just before writing.
- Before any commit: `git status`, then `gitleaks detect --source . --no-git` and `gitleaks detect --source .` if gitleaks is installed. CI runs both, and `node scripts/check-identity.mjs --range origin/main..HEAD --files` checks commit and file emails.

## Menus and destructive actions

- The More actions menu on a workstream lists publish and scheduling options and **Delete page** (in the proof of concept: "Publish this page to Live", "Schedule publish", and "Delete page"). `openPublishMenu` opens it and stops. Don't add a step that clicks a menu item.
- The harness clicks only selectors named in a preset or brief. Review any new `click` step for anything that edits, publishes, or deletes.
- Selecting a block is read-only. Don't type into the properties panel.

## Bot protection

A hosted P1 dev site behind a Cloudflare browser challenge serves headless Chrome a "Performing security verification" page with HTTP 403, even when `curl` gets 200. The harness detects this (`__cf_chl` URL token, `cf-mitigated` header, challenge text, plain 403), saves no PNG, and exits 1.

Don't work around it: no user-agent spoofing, challenge solving, or stealth plugins. Use a local production build, a Multidev URL without the challenge, or a narrowly scoped WAF exception that the site owner adds.

## Fail-closed checks

A shot is saved only when its checks pass. The checks cover the editor header, page path, workstream name, panels, menu state, and selected block. A failure records `blocked: expectation` and quotes the first 100 characters of what the page showed, which is usually enough to tell sign-in from loading from the wrong workstream.

## Gated documentation

The P1 docs site redirects to `/auth/signin`, and the docs repository returns 404 without authentication. Treat both as gated, not as harness defects. Don't capture them and don't use credentials to reach them.
