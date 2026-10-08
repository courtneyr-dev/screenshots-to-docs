---
title: Presets
parent: Reference
nav_order: 2.5
---

# Presets

A preset holds everything that differs between kinds of web app: the settings it needs, how you sign in, CSS that hides what changes from day to day, the checks and steps a brief can name, and where `release-check` finds the latest version. The capture engine itself knows no product. Presets live in `scripts/presets/<name>.json`; a config picks one with `"preset"`, and a brief lists the ones it uses in `"presets"`.

| Preset                                    | Sign-in                                      | Release source                         | Starter brief                   |
| ----------------------------------------- | -------------------------------------------- | -------------------------------------- | ------------------------------- |
| [`p1-editor`](#p1-editor)                 | You, in the dedicated Chrome                 | `npm:@pantheon-systems/p1-next-sdk`    | `briefs/p1-editor.json`         |
| [`wordpress-admin`](#wordpress-admin)     | Login form: `WP_USER`, `WP_PASSWORD`         | `wordpress`                            | `briefs/wordpress-admin.json`   |
| [`drupal-admin`](#drupal-admin)           | Login form: `DRUPAL_USER`, `DRUPAL_PASSWORD` | `drupal`                               | `briefs/drupal-admin.json`      |
| [`content-publisher`](#content-publisher) | You, in the dedicated Chrome                 | (none; pass `--version` or `--source`) | `briefs/content-publisher.json` |
| [`public-site`](#public-site)             | None                                         | (none; pass `--version` or `--source`) | `briefs/public-site.json`       |

## p1-editor

Actions for the P1 editor (the /p1 route by default). Selectors come from the editor's data-testid attributes and from Puck's data-puck-component attribute on canvas blocks, which holds the same props.id the P1 MCP returns from get_document. Values such as the project, page, workstream, and block type are parameters: the brief passes them in, and they come from the per-run config file. Re-check the selectors after a P1 editor upgrade. editorReady also restores the left panel, because the editor keeps panel state across page loads in the same browser. The block-selection actions end with a selectedBlock check: exactly one selected overlay, matching the intended block's box, and the properties panel naming its type. A neighboring block fails it.

**Settings** (under `params` in the config, or at the top level in configs written before presets):

| Key                | Required | Default                | Meaning                                                                                                                                   |
| ------------------ | -------- | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `projectName`      | yes      |                        | The project or site name as the editor header shows it. Find it with the P1 MCP (list_sites) or in the editor.                            |
| `workstream`       | yes      |                        | The workstream to show, as the editor's workstream selector lists it. Choose it for each run (P1 MCP list_branches); there is no default. |
| `pagePath`         | yes      |                        | The page being edited, for example "/" or "/about" (P1 MCP list_documents); it must start with "/" and contain no spaces.                 |
| `pageNavigation`   | no       | `url`                  | "url" opens the page through the editor URL; "manual" opens the editor route only and you select the page. One of `url`, `manual`.        |
| `pageLabel`        | no       | `{pagePath}`           | The page label the editor's page selector shows (default: pagePath).                                                                      |
| `editorRoute`      | no       | `/p1`                  | The editor route; it must start with "/".                                                                                                 |
| `blockCategory`    | no       | `P1 Layout`            | The block category to expand in the blocks browser.                                                                                       |
| `blockType`        | no       |                        | A block type that selects reliably.                                                                                                       |
| `blockSelector`    | no       |                        | A CSS selector for the block to select, instead of blockType.                                                                             |
| `publishMenuLabel` | no       | `Publish this page to` | The publish menu's label.                                                                                                                 |

**Actions:**

| Action                     | Parameters                 | Checks                                                                                                                                                                            |
| -------------------------- | -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `editorReady`              | `projectName`, `pageLabel` | `[data-testid=p1-editor-header]`; `[data-testid=site-label] contains “{projectName}”`; `[data-testid=page-selector] contains “{pageLabel}”`; `[data-testid=workstream-trigger]` … |
| `selectWorkstream`         | `name`                     | `[data-testid=workstream-trigger] contains “{name}”`; `h1`                                                                                                                        |
| `openWorkstreamMenu`       |                            | `[data-testid=workstream-dropdown]`; `[data-testid=workstream-list]`                                                                                                              |
| `closeMenu`                |                            |                                                                                                                                                                                   |
| `expandAllBlockCategories` |                            |                                                                                                                                                                                   |
| `expandBlockCategory`      | `name`                     |                                                                                                                                                                                   |
| `selectBlockByType`        | `type`                     | `selected block`                                                                                                                                                                  |
| `selectBlock`              | `id`                       | `selected block`                                                                                                                                                                  |
| `centerBlockByType`        | `type`                     |                                                                                                                                                                                   |
| `workstreamMenuClosed`     |                            | `[data-testid=workstream-dropdown]`                                                                                                                                               |
| `collapseLeftPanel`        |                            | `[aria-label="Toggle left panel"][aria-pressed=false]`; `#p1-cat-btn-p1Layout`                                                                                                    |
| `openPublishMenu`          | `label`                    | `[role=menu] contains “{label}”`                                                                                                                                                  |
| `selectBlockBySelector`    | `selector`                 | `selected block`                                                                                                                                                                  |
| `centerBlockBySelector`    | `selector`                 |                                                                                                                                                                                   |

## wordpress-admin

WordPress admin (wp-admin), the block editor, and the Site Editor. Signs in at /wp-login.php with WP_USER and WP_PASSWORD from the environment, for a local or test site; for a production site with SSO or two-factor, set "signIn": "chrome" in the config and sign in yourself in the dedicated Chrome. Hides admin notices, update counts, and the editor's welcome guide, so shots don't depend on what a plugin printed that day. Adapted from the wp-screenshots skill. Selectors checked against WordPress 6.8 on 2026-10-08.

**Settings:** none beyond `topic` and `baseUrl`.

**Sign-in:** opens `/wp-login.php`, types the values of `WP_USER` and `WP_PASSWORD` from your shell environment, submits `#loginform`, and expects a URL containing `/wp-admin`. Set `"signIn": "chrome"` in the config to sign in yourself instead.

**Actions:**

| Action             | Parameters | Checks                                                                       |
| ------------------ | ---------- | ---------------------------------------------------------------------------- |
| `adminReady`       |            | `#wpadminbar`; `#adminmenu`; `#wpbody-content`                               |
| `adminPage`        | `title`    | `#wpadminbar`; `#adminmenu`; `.wrap h1 contains “{title}”`                   |
| `blockEditorReady` |            | `.editor-editor-interface`; `.editor-header`; `iframe[name="editor-canvas"]` |
| `siteEditorReady`  |            | `.edit-site-layout`; `iframe[name="editor-canvas"]`                          |

## drupal-admin

Drupal administration pages (Claro theme, with the Navigation sidebar in Drupal 11.3 and later or the classic toolbar before it). Signs in at /user/login with DRUPAL_USER and DRUPAL_PASSWORD from the environment, for a local or test site; for a hosted site with SSO, set "signIn": "chrome" in the config and sign in yourself in the dedicated Chrome. Hides status messages so a leftover "saved" message doesn't end up in a shot. Selectors checked against Drupal 11.4 on 2026-10-08.

**Settings:** none beyond `topic` and `baseUrl`.

**Sign-in:** opens `/user/login`, types the values of `DRUPAL_USER` and `DRUPAL_PASSWORD` from your shell environment, submits `#user-login-form`, and expects a URL containing `/user/`. Set `"signIn": "chrome"` in the config to sign in yourself instead.

**Actions:**

| Action       | Parameters | Checks                                                                        |
| ------------ | ---------- | ----------------------------------------------------------------------------- |
| `adminReady` |            | `#admin-toolbar, #toolbar-administration`; `main`; `h1.page-title`            |
| `adminPage`  | `title`    | `#admin-toolbar, #toolbar-administration`; `h1.page-title contains “{title}”` |

## content-publisher

Pantheon Content Publisher's dashboard (content.pantheon.io): overview, collections, sites, and one collection's settings. You sign in yourself, with Google, in the dedicated Chrome. Hides the support chat launcher, toast notifications, first-visit onboarding dialogs (without dismissing them, which would save a preference to the account), and the buttons some browser extensions inject; a capture profile with no extensions is cleaner still. Selectors checked against the live dashboard on 2026-10-08. The starter brief leaves out Accounts and Tokens, which show account data. A trial account also shows a free-trial banner across the top, which has no stable selector and is left in.

**Settings** (under `params` in the config):

| Key            | Required | Default | Meaning                                                                                                                                           |
| -------------- | -------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `collectionId` | no       |         | A collection ID from the collection's URL (content.pantheon.io/dashboard/collections/<collectionId>). Shots of one collection's settings need it. |

**Actions:**

| Action            | Parameters | Checks                                                                                                       |
| ----------------- | ---------- | ------------------------------------------------------------------------------------------------------------ |
| `dashboardReady`  |            | `nav[aria-label="Main navigation"]`; `main#app-layout-main`                                                  |
| `pageHeading`     | `text`     | `nav[aria-label="Main navigation"]`; `main h1 contains “{text}”`                                             |
| `collectionReady` |            | `nav[aria-label="Main navigation"]`; `nav[aria-label="Collection settings secondary navigation"]`; `main h1` |

## public-site

Any public website: no sign-in. Hides the cookie and consent banners of common consent platforms (OneTrust, Cookiebot, CookieYes, Osano, Usercentrics, Cookie Notice, Cookie Consent), so shots don't depend on a stored consent choice. A site behind a bot challenge fails closed: no PNG is saved.

**Settings:** none beyond `topic` and `baseUrl`.

**Actions:**

| Action    | Parameters | Checks                 |
| --------- | ---------- | ---------------------- |
| `visible` | `selector` | `{selector}`           |
| `heading` | `text`     | `h1 contains “{text}”` |

## Write a preset

Copy the closest preset and change what differs. Every field is optional except `description` and `actions`:

| Field           | Meaning                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `description`   | What the preset is for, which version its selectors were checked against, and when.                                                                                                                                                                                                                                                                                                                                                     |
| `params`        | Settings the preset needs from the config: `{ "name": { "required", "what", "pattern", "enum", "default" } }`. A default can name another setting, as in `"{pagePath}"`.                                                                                                                                                                                                                                                                |
| `atMostOne`     | Groups of settings where only one may be set.                                                                                                                                                                                                                                                                                                                                                                                           |
| `warnUnlessAny` | `[{ "keys": [...], "message": "..." }]`: preflight warns when none of the keys is set.                                                                                                                                                                                                                                                                                                                                                  |
| `signIn`        | `{ "mode": "chrome" }`, `{ "mode": "none" }`, or `{ "mode": "form", "login": { "url", "fields": { "<selector>": "<ENV_VAR>" }, "form", "success" } }`. A form sign-in only names environment variables; values never appear in a file.                                                                                                                                                                                                  |
| `css`           | CSS added before every shot. Hide notices, counts, banners, and first-visit dialogs here rather than clicking them away: a click can save a preference to the account.                                                                                                                                                                                                                                                                  |
| `release`       | `{ "source": "..." }`, the default for `release-check --config`. See [Commands](commands.html#release-sources).                                                                                                                                                                                                                                                                                                                         |
| `actions`       | Named steps and checks. Each is `{ "params", "steps", "expect", "expectAfter" }`; `{param}` in any string is replaced. Steps: `{ "click": selector, "text"?, "frame"?, "skipIf"?, "optional"? }`, `{ "scroll": selector }`, `{ "wait": selector or ms }`, `{ "key": "Escape" }`, `{ "moveMouse": { x, y } }`. Checks: a selector, or `{ "selector", "text"?, "frame"?, "absent"? }`; a shot fails and saves nothing when a check fails. |

Check selectors against the real app before you rely on them, and add a starter brief in `briefs/<preset>.json`. The preset tests (`node tests/presets-tests.mjs`) load every preset, refuse a step that names a destructive control, and dry-run every starter brief.
