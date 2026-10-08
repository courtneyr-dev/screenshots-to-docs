# Capture harness reference

Reference for the capture harness behind this tool: the brief schema, steps, checks, actions, and failure modes. The harness started as a Next.js screenshot tool and grew into the P1 editor workflow; it still supports plain and parity captures of ordinary sites.

You write a **brief** (JSON listing each shot), run `scripts/capture.mjs`, and get PNGs plus an HTML gallery. For the P1 editor, the per-run settings come from a config file and the brief is a template; see `configuration.md`.

Two modes:

- **Plain capture**: shots of one site for docs, release posts, or design review.
- **Parity capture**: set `baseline` to the site being replaced (for example a WordPress site) and every shot is captured on both, at the same path. The gallery shows each page as a pair and sorts pages with a 404, a failed capture, or a missing side to the top under "Needs attention". It is the visual half of a migration check; it doesn't inventory URLs.

## Scope

In scope: sites you own or are authorized to capture (local, staging, preview, and production front ends), and the sites they replace.

Out of scope, say so and stop:

- Sites you don't own or have permission to capture.
- Logging in to the **baseline** (WordPress) side. Parity runs compare public pages; baseline shots are always anonymous. WordPress admin shots are out of scope.
- Pixel-diff scoring. The gallery shows pairs for a human to judge; it doesn't compute a diff percentage.

## Setup

```bash
bash scripts/setup.sh
```

Idempotent: checks node, npm, and Chrome, runs `npm install` if needed, and syntax-checks the scripts. Chrome is found at the usual macOS and Linux paths, or set `NEXTJS_SCREENSHOTS_CHROMIUM=/path/to/chrome`.

## Workflow

### Start here: ask which site to capture

Every run begins with a question. Don't assume a site from the brief, the project folder, or an earlier run. Ask:

1. **Which site should I capture?** Get an origin URL. Offer the usual choices:
   - a local production build (`next build && next start`, usually `http://localhost:3000`), best for final shots because `next dev` renders differently;
   - a deployed preview or Multidev URL;
   - the hosted dev, staging, or production site.
2. **Is it running, and who starts it?** If it's a local build that isn't listening, ask the person to start it in their own terminal so it stays up for the whole run. Don't start a long-lived server yourself.
3. **Is there a site it replaces?** A WordPress baseline turns on parity mode. No baseline means a target-only run.
4. **Which pages?** A brief, a sitemap, or a list of paths.

If a brief already names a `site`, show it and ask whether to use it or override it with `--site`.

Then check the origin can be captured before writing or running a brief: pre-flight it, and capture one shot (`--only <slug>`). Pre-flight uses a plain HTTP request, so it can pass on a site whose edge challenges headless Chrome; only a real capture shows that. If the one shot fails as `blocked` (see Known failure modes, item 8), go back to the person and ask for a different origin. Don't work around it.

### Steps

1. **Pre-flight the site(s):**

   ```bash
   node scripts/verify-site.mjs --site http://localhost:3000 --baseline https://old-site.com
   ```

   Reports homepage status, whether the site is Next.js and which router, whether it looks like `next dev`, and whether a sitemap exists. The dev check is a heuristic on the HTML.

2. **Generate a starter brief** (or copy `briefs/example.json`):

   ```bash
   # Parity: use the WordPress sitemap as the page list
   node scripts/routes.mjs --topic acme --site http://localhost:3000 \
     --baseline https://acme.com --sitemap-url https://acme.com/sitemap_index.xml --mobile

   # Plain: read the Next.js project's app/ and pages/ directories
   node scripts/routes.mjs --topic acme --site http://localhost:3000 --app-dir <path to the project>

   # Plain: read the Next.js site's own sitemap.xml
   node scripts/routes.mjs --topic acme --site http://localhost:3000 --sitemap
   ```

   `--app-dir` drops route groups like `(marketing)`, skips `api/`, `_private`, and `@parallel` folders, and lists dynamic routes (`[slug]`) as skipped so you can add real URLs by hand. Sitemap mode follows sitemap indexes (WordPress core, Yoast, Rank Math, Next's `app/sitemap.ts`). Filter with `--include` / `--exclude` (regex) and `--limit`.

3. **Capture:**

   ```bash
   node scripts/capture.mjs --brief briefs/acme.json
   ```

   Writes `screenshots/<topic>/<slug>.png`, `screenshots/<topic>/baseline/<slug>.png` in parity mode, and `capture-report.json` with each shot's HTTP status and final URL. `--target next|baseline` captures one side only.

4. **Build the gallery:**

   ```bash
   node scripts/make-gallery.mjs --dir screenshots/acme
   ```

5. **Look at every PNG before calling it done** (see "Prove it" below).

6. **Push to Figma** (only when the team will annotate the run; see "Push to Figma").

## What the harness does for Next.js

On every shot, before capturing:

- Emulates `prefers-reduced-motion: reduce` and zeroes CSS animation and transition durations, so shots don't catch mid-animation frames.
- Hides `nextjs-portal` (the dev overlay and build indicator), and warns once if it was present: final shots belong on `next build && next start`, not `next dev`.
- Waits for `document.fonts.ready` (covers `next/font`).
- On `fullPage` shots, scrolls the whole page first so `next/image` lazy-loads every below-the-fold image, then waits for all images to finish.
- Sets `prefers-color-scheme` per shot (`light` by default).
- Viewports under 768px wide also set `isMobile` and `hasTouch`.

## Brief schema

```json
{
  "topic": "acme",
  "site": "http://localhost:3000",
  "baseline": "https://acme.com",
  "dpr": 2,
  "colorScheme": "light",
  "auth": {},
  "shots": []
}
```

### Top-level fields

| Field         | Required                  | Notes                                                              |
| ------------- | ------------------------- | ------------------------------------------------------------------ |
| `topic`       | yes                       | kebab-case slug; default output folder name.                       |
| `site`        | yes                       | Next.js base URL. `--site` overrides.                              |
| `baseline`    | no                        | Site being replaced. Turns on parity mode. `--baseline` overrides. |
| `dpr`         | no                        | Device scale factor, default 2.                                    |
| `colorScheme` | no                        | `light` (default) or `dark` for every shot.                        |
| `auth`        | only for `loggedIn` shots | See Auth.                                                          |
| `outDir`      | no                        | Default `./screenshots/<topic>/`.                                  |

### Shot fields

| Field                        | Notes                                                                                      |
| ---------------------------- | ------------------------------------------------------------------------------------------ |
| `slug`                       | Required. Filename stem, e.g. `02-pricing-mobile`.                                         |
| `url`                        | Required. Path or full URL.                                                                |
| `label`                      | Gallery caption.                                                                           |
| `baselineUrl`                | Path on the baseline when it differs, e.g. `/2024/05/hello-world/` vs `/blog/hello-world`. |
| `compare`                    | `false` skips the baseline capture for this shot (Next.js-only pages).                     |
| `loggedIn`                   | `true` uses the authenticated session. Shots are public by default.                        |
| `viewport`                   | `[width, height]`, default `[1440, 900]`. Use `[390, 844]` for mobile.                     |
| `fullPage`                   | Capture the full scroll height.                                                            |
| `colorScheme`                | Per-shot `light` / `dark`.                                                                 |
| `hide`                       | Array of selectors to hide (`visibility: hidden`): emails, cookie banners, live chat.      |
| `scrollTo`, `click`, `hover` | Selectors to act on before capture.                                                        |
| `evaluateBefore`             | JS string run in the page. Flaky; use last.                                                |
| `delay`                      | Extra ms after settling, default 800.                                                      |
| `section`                    | Gallery group.                                                                             |

## Auth

Most sites you capture are public; shots only need auth when they set `loggedIn: true`. Two options, usable together:

```json
"auth": {
  "cookiesFile": "acme.cookies.json",
  "login": {
    "url": "/login",
    "fields": { "input[name=email]": "ACME_EMAIL", "input[name=password]": "ACME_PASS" },
    "submit": "button[type=submit]",
    "success": "/account"
  }
}
```

- `cookiesFile`: a JSON array of cookies (`[{ "name": "session", "value": "..." }]`), path relative to the brief. Domain defaults to the site's host. `*.cookies.json` is gitignored.
- `login`: types each field's value from the **named env var**, clicks submit, and checks the URL contains `success`.

Never put a password or token in a brief. If a `loggedIn` shot ends up on a different path (an expired session bounced to `/login`), the shot fails instead of saving a login page as the account page.

## Actions and the signed-in editor

Some shots need things done first: choose a workstream, open a menu, select a block. A shot lists them as **actions**, and the harness checks that each one worked before it saves the PNG.

### Specifying actions

The shipped brief (`briefs/p1-editor.json`) is a template. Its values are double-brace placeholders that `--config` fills from the per-run config file (`configuration.md`):

```json
{
  "presets": ["p1-editor"],
  "shots": [
    {
      "slug": "block-selected-properties",
      "url": "{{editorRoute}}",
      "requires": ["blockType"],
      "actions": [
        {
          "editorReady": {
            "projectName": "{{projectName}}",
            "pageLabel": "{{pageLabel}}"
          }
        },
        { "selectWorkstream": { "name": "{{workstream}}" } },
        { "selectBlockByType": { "type": "{{blockType}}" } },
        "workstreamMenuClosed"
      ]
    }
  ]
}
```

- `presets` names files in `scripts/presets/` (or a path relative to the brief). A preset maps each action name to steps and checks, with single-brace `{param}` placeholders filled from the action's parameters.
- An action is a name, or `{ name: { param: value } }`. Actions run in order, then any raw `steps` on the shot.
- `requires` (all must be set) and `requiresAny` (one must be set) skip a shot when a config value is missing. Skipped shots are reported in the console and in `capture-report.json`; they aren't failures. A brief can hold two variants of one slug with different `requires`; only the variant the config satisfies runs.
- Unknown actions, missing action parameters, and unset `{{placeholders}}` fail before a browser opens.
- `scripts/presets/p1-editor.json` defines the P1 editor actions. Copy it to add actions for another app.

Raw building blocks, for shots the presets don't cover:

| Field         | Form                                                                                 | Does                                                                                                                                                                |
| ------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `steps`       | `{ click, text?, frame?, offset?, skipIf?, optional? }`                              | Click the first visible match. `text` matches case-insensitively. `frame` looks inside a same-origin iframe. `skipIf` skips when the element matches that selector. |
| `steps`       | `{ scroll, frame? }`, `{ wait: selector or ms }`, `{ key }`, `{ moveMouse: {x, y} }` | Scroll to center, wait, press a key, move the pointer (clears a hover tooltip).                                                                                     |
| `expect`      | selector, or `{ selector, text?, absent?, frame? }`                                  | Must pass before the steps run.                                                                                                                                     |
| `expectAfter` | same forms                                                                           | Must pass after the steps.                                                                                                                                          |

A failed step or check saves no PNG, records `blocked: expectation` with a snippet of what the page showed, and exits 1. Check that a shot shows the right state (workstream name, selected block) with `expectAfter`, not only that a click landed.

### Per-run settings and the editor

See `configuration.md` for every setting, `safety.md` for how to start the dedicated Chrome and sign in, and `six-shot-workflow.md` for the shots. The P1 MCP supplies the values: `list_sites` (project name), `list_branches` (workstream names), `list_documents` and `get_document` (pages, block types, and each block's stable `props.id`, which the canvas carries as `data-puck-component`).

The MCP can't see your browser session, select a workstream in the editor, or tell you whether you're signed in. Those come from the editor itself, and the checks cover them.

### Known limits

See `known-limitations.md`.

## Known failure modes

Check for these while working, not only at the end:

1. **Capturing `next dev`.** The dev overlay is hidden, but dev builds render differently (no optimization, slower hydration). Final shots come from `next build && next start` or a deployed preview.
2. **Expired auth.** `loggedIn` shots fail loudly on redirect; re-export cookies or check the env vars.
3. **Trailing-slash redirects in parity runs.** WordPress URLs end in `/`; Next.js 308-redirects `/about/` to `/about` unless `trailingSlash: true`. The gallery tags these "redirected". That's a real SEO finding to report, not noise to suppress.
4. **Dynamic routes missing from `--app-dir` briefs.** They're listed as skipped; add real slugs or use a sitemap.
5. **Blank below the fold.** Content that loads on scroll through something other than `<img>` (IntersectionObserver-driven sections, client fetches) needs `delay` or `evaluateBefore`.
6. **Cookie banners and chat widgets** covering content: add them to `hide`.
7. **Personal data in logged-in shots**: hide it with `hide` before the shot ships.
8. **Bot challenges and access denials.** A Cloudflare browser challenge answers headless Chrome with 403 and a "Performing security verification" page, even when `curl` gets 200, so pre-flight can pass while every shot is a challenge page. `capture.mjs` fails a shot, saves no PNG, and sets `blocked` in `capture-report.json` when it sees a `__cf_chl` URL token, a `cf-mitigated` header, challenge text, or a plain HTTP 403. `blocked` is `challenge` or `http-403`. The run exits 1, and `figma-plan.mjs` refuses a report with no usable shots.

   The harness does not bypass challenges: no user-agent spoofing, challenge solving, or stealth tooling. Capture from an unchallenged origin instead: a local `next start`, a Multidev URL, or a narrowly scoped WAF exception the site owner adds (pass the origin with `--site`).

   Routes behind sign-in (for example a docs site that redirects to `/auth/signin`) are gated, not harness defects. Leave them out of the brief and record them in its `description`.

## Push to Figma

Use this when the team will annotate a capture run in Figma and each run should stay available for comparison.

### Version convention

Each capture run becomes one **page** in a Figma design file, named `<topic> · <YYYY-MM-DD HH:mm> · <runId>`, where `runId` is `<topic>-<YYYYMMDD>-<HHmm>` from the report's `capturedAt`. Runs stack up as pages, so annotations on an older run survive the next one.

This is a naming convention, not Figma version history. Figma's Plugin API can't create version-history entries. When the file's history must record a run, a person saves a version by hand (Cmd+Opt+S) in Figma after the push.

Content Publisher and Figma synchronization is future-state only. Nothing here reads from or writes to Content Publisher, and no skill step should assume it exists.

### Prerequisites

- The Figma MCP server is connected, with `use_figma`, `upload_assets`, and `get_screenshot` available. The agent runs the Figma steps; the scripts alone can't.
- Edit access to the target Figma **design** file (URL path `/design/`; `figma.createPage()` only works in design files, not FigJam or Slides). A test file can be made with `create_new_file` and a plan key from `whoami`; a View seat on the Pantheon plan was able to create and edit one.
- Enough Figma MCP quota. Each run uses at least three calls (`use_figma`, `upload_assets`, and a verifying `use_figma`), and the Pantheon View seat hit its tool-call limit after about a dozen. When the limit is hit, the error links to a seat upgrade; wait for the quota to reset or use a seat with a higher limit. Nothing is half-pushed if the failure is on the first `use_figma` call.
- You have the file key: the `:fileKey` in `figma.com/design/:fileKey/...`.
- Load the `figma:figma-use` skill before the first `use_figma` call, and pass `skillNames: "figma-use"`.
- A finished `capture.mjs` run: `capture-report.json` and its PNGs in the output folder.
- Ask before pushing to a file that isn't yours or the team's agreed review file. A push adds a page to a shared file.

### Workflow: capture, plan, page, upload

`createImageAsync` is blocked in `use_figma`, so images go in through `upload_assets`. The page gets one named placeholder rectangle per PNG, and each upload URL fills the rectangle whose node id you passed in the same position.

1. **Capture** (see Workflow above), then look at the gallery.

2. **Plan the run:**

   ```bash
   node scripts/figma-plan.mjs --dir screenshots/acme
   ```

   Writes `figma-plan.json` and `figma-page.js` next to the report. `--only slug,slug` pushes a subset. PNGs over Figma's 10 MB limit are flagged and left out as failed cells; recapture them at a lower `dpr`.

   The plan **fails with exit 1 and writes nothing** if the report says a shot was captured but its PNG is missing, truncated, or not a PNG. That means the run is broken, not the page: rerun `capture.mjs --only slug,slug`, then plan again.

3. **Build the page.** Call `use_figma` with the contents of `figma-page.js` as `code`, the target `fileKey`, and `skillNames: "figma-use"`. It returns `pageId`, `rootId`, and `nodeIds` (one per PNG, in upload order). If a page with the same name exists, it throws `Page already exists: <name>. This run is already pushed.` and changes nothing. Run IDs have minute resolution, so a recapture in the same minute as the last one collides with it; wait a minute or remove the old page.

4. **Get upload URLs.** Call `upload_assets` with `fileKey`, `count` = number of `nodeIds`, `currentPageId` = `pageId`, `nodeIds` exactly as returned, and `scaleMode: "FIT"`. Save the result's `uploads` array to `urls.json`. Each entry's field is `submitUrl`, not `url`. `upload_assets` takes 60 at a time; `figma-plan.json` lists the `chunks`.

5. **Upload the bytes:**

   ```bash
   node scripts/figma-upload.mjs --dir screenshots/acme --urls urls.json [--chunk 0]
   ```

   For more than 60 PNGs, repeat steps 4 and 5 per chunk, passing that chunk's slice of `nodeIds`.

6. **Check the page.** `get_screenshot` on `rootId`. Every rectangle must show an image, and the top rows must match the gallery's "Needs attention".

### Parity attention rows

Rows with a 404 or other HTTP error, a redirect, a failed capture, or a missing side sort to the top of the page and are titled `<slug>  ·  NEEDS ATTENTION` in red, the same grouping the gallery uses. Inside a row:

- A side with a status of 400 or higher, or a redirect, keeps its image. Its caption turns red (`NEXT  ·  HTTP 404`, `redirected`).
- A failed capture (`ok: false`) or a side that wasn't captured has a dashed red box instead of an image, with the recorded reason.

A 404 on the new site is a finding, not an error to suppress.

### Upload retry and expiry

Upload URLs are single-use and expire after 10 minutes. The uploader prints one line per file with its index, key, local path, and the HTTP status or network error, then exits 1 if any file failed. Files that uploaded keep their image.

To retry, call `upload_assets` again with `count` = the number of failed files and `nodeIds` for just those rectangles, in the order the uploader listed them. Save the new `uploads` array and run the command the uploader printed:

```bash
node scripts/figma-upload.mjs --dir screenshots/acme --urls urls.json --chunk 0 --only "01-home|next,02-pricing|next"
```

| Symptom                                    | Likely cause                                        | Fix                                                         |
| ------------------------------------------ | --------------------------------------------------- | ----------------------------------------------------------- |
| `network error: ECONNREFUSED` or a timeout | Network or proxy                                    | Fix connectivity, request fresh URLs, retry with `--only`   |
| `HTTP 4xx` on a fresh URL                  | Bad PNG, over 10 MB, or URL already used or expired | Check the file, then request fresh URLs                     |
| `urls.json has N usable URL(s)`            | Count or field mismatch                             | `count` must equal the PNGs in the chunk (or `--only` list) |

## Prove it

Before saying a run is done:

- Read the capture summary: `N/N captured, 0 failed, K with HTTP >= 400`. Report every failure and every HTTP error by slug, and say which failures are `blocked` (challenge or 403) rather than harness errors.
- Open the gallery and look at every image, or every pair in parity mode. Start with "Needs attention".
- For parity runs, report what's under "Needs attention" and what it means (missing page on the new site, redirect, 404 on the old site).
- If a shot can't be fixed in two tries, drop it from the brief and say which one and why. Don't ship a broken shot.

## Output

```
screenshots/<topic>/
├── 01-home.png
├── 01-home-mobile.png
├── baseline/            # parity mode only
│   └── 01-home.png
├── capture-report.json  # status + final URL per shot
├── index.html           # make-gallery.mjs
├── figma-plan.json      # figma-plan.mjs
└── figma-page.js        # figma-plan.mjs, code for use_figma
```

`node_modules/` and `screenshots/` are gitignored in the skill folder. When running from a project, `.gitignore` the output there too.
