---
title: Pantheon docs coverage
parent: Reference
nav_order: 2.7
---

# Pantheon docs coverage

What Pantheon's three docs sites show in their images, and which preset and release source covers each area.
Counted on 2026-10-09; [how it was counted](#how-this-was-counted).

## By docs site

| Site                     | Pages                         | Images                             | Most-shown screens                                                                   |
| ------------------------ | ----------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------ |
| docs.pantheon.io         | 759 guides, 832 release notes | 1,003 references, 803 unique files | Pantheon dashboard 438, WordPress admin 119, Drupal admin 72, terminal 34            |
| docs.content.pantheon.io | 48                            | 149 references, 148 unique         | Google Docs add-on 45, Content Publisher dashboard 32, preview and publish window 16 |
| docs.p1.pantheon.io      | 39                            | 20, plus 2 videos                  | content.pantheon.io dashboard 10, P1 editor 7                                        |

## By screen

| Screen                                   | Images | Preset                                        | Release source                                                         |
| ---------------------------------------- | -----: | --------------------------------------------- | ---------------------------------------------------------------------- |
| Pantheon dashboard, site and environment |    282 | `pantheon-dashboard`                          | release notes tagged User interface → `pantheon-dashboard`             |
| Pantheon dashboard, workspace            |    141 | `pantheon-dashboard`                          | same                                                                   |
| Pantheon dashboard, personal settings    |     15 | `pantheon-dashboard` (routes not yet checked) | same                                                                   |
| WordPress admin                          |    122 | `wordpress-admin`                             | `wordpress` and each plugin's `wporg-plugin:` or `github:` source      |
| Drupal admin                             |     78 | `drupal-admin`                                | `drupal` and each module's `drupal:` or `github:` source               |
| content.pantheon.io dashboard            |     42 | `content-publisher`                           | release notes tagged Content Publisher → `content-publisher-dashboard` |
| Google Docs add-on                       |     45 | not built yet                                 | release notes tagged Content Publisher                                 |
| Content Publisher preview and publish    |     16 | not built yet                                 | same                                                                   |
| P1 editor                                |      7 | `p1-editor`                                   | `npm:@pantheon-systems/p1-next-sdk`                                    |
| Microsoft Word add-in                    |      6 | not built yet                                 | release notes tagged Content Publisher                                 |
| Terminal output                          |     38 | use text instead                              | the CLI's source, for example `github:pantheon-systems/terminus`       |
| Other companies' screens                 |    234 | `public-site`, or `signIn: "chrome"`          | not tracked                                                            |
| Diagrams                                 |     68 | not a capture                                 | not tracked                                                            |

WordPress and Drupal admin counts add the Content Publisher docs' 3 and 6 to docs.pantheon.io's 119 and 72.
The 42 content.pantheon.io images are the Content Publisher docs' 32 and the P1 docs' 10.

## Products watched

`watchlists/pantheon.json` watches 35 products, each from where it's released, plus the release notes feed. Two
products with docs can't be watched: wp-audit-tool has no releases or tags, and the Drupal 7 upstream
(drops-7) is tagged on GitHub only.

| Kind               | Products                                                                                                                                                                                                                                                                                                 |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SDKs and CLIs      | P1 Next.js SDK, P1 starter kit, Content Publisher React, Browser, and PHP SDKs and CLI, Next.js Cache Handler, Terminus, Terminus Build Tools, Terminus GitHub Action, Push to Pantheon, WP Launch Check, Customer Secrets PHP SDK, Pantheon Secrets JS, Pantheon Design System React toolkit and tokens |
| WordPress plugins  | Content Publisher, Advanced Page Cache, HUD, Solr Power, WP Redis, Native PHP Sessions, WP SAML Auth, TLS Compatibility Checker, Pantheon Migrations, Pantheon MU plugin                                                                                                                                 |
| Drupal modules     | Content Publisher, Advanced Page Cache, Search API Pantheon, Pantheon Secrets, Domain Masking, TLS Checker                                                                                                                                                                                               |
| Core and upstreams | WordPress core, Drupal core, WordPress Composer Managed                                                                                                                                                                                                                                                  |

Most of these products keep their screenshots on docs.pantheon.io or docs.content.pantheon.io, not in their
own repositories. Ten have screenshots in their own repository or WordPress.org listing: Pantheon HUD,
Pantheon Advanced Page Cache (WordPress), Push to Pantheon, Pantheon Secrets (Drupal), WordPress Composer
Managed, WP Audit Tool, WP Launch Check, Pantheon Migrations, and both TLS checkers.

## Signs of out-of-date images

- **Content Publisher dashboard:** the docs show three different sidebars across the two sites, so the 32
  Content Publisher dashboard images likely predate the current one.
- **Pantheon dashboard:** 121 of 438 references sit in the folders used for the current dashboard
  (`images/dashboard/new-dashboard/`, `images/release-notes/`); the rest are in older folders.
- **Older guides on docs.pantheon.io:** WordPress with Git, WooCommerce, the certification study guide, the
  Edge Integrations analytics guide, and the Drupal 7 pages.
- **Content Publisher CLI:** 5 pages and 4 terminal screenshots still use the old `@pantheon-systems/pcc`
  name; 6 pages use `@pantheon-systems/cpub-cli`.

## How this was counted

- **docs.pantheon.io:** a script read every page and the navigation in its source repository
  (`pantheon-systems/documentation`, `main` at `48d1ac04`, 2026-10-08) and every image reference with its alt
  text. Screens were classified from file names and alt text; 4 images were opened to check. Dates are from a
  sample of about 30 files.
- **docs.content.pantheon.io and docs.p1.pantheon.io:** both are published from Content Publisher, so their
  repositories don't hold the pages. Every live page was read and all 169 images were looked at.
- **Products:** about 25 GitHub API calls plus WordPress.org, Drupal.org, and npm. Every release source was
  resolved once, and the watch resolved all 35 on 2026-10-09.
- **Not checked:** the live Pantheon and content.pantheon.io dashboards against the images, the 2 P1 videos
  (classified from their captions), and pds-react.pantheon.io.
