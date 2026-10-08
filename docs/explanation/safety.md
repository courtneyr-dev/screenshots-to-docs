---
title: Safety
parent: Explanation
nav_order: 3
---

# Safety

The tool works next to a signed-in editor, a design file, and published docs. Its rules are about what it
never touches.

## Credentials and sign-in

The tool never asks for, stores, or types a password, cookie, or token. A person signs in to P1 in a
dedicated Chrome profile that lives outside every repository; the capture attaches to that window over a local
debugging port. `cleanup` removes the profile when the work is done, and refuses while that Chrome is running.

## The two tokens

| Token                            | Who creates it         | Where it lives                   | What it can do                              |
| -------------------------------- | ---------------------- | -------------------------------- | ------------------------------------------- |
| GitHub (Google Docs swap)        | You, on github.com     | Apps Script script property only | Read one repository's contents, for 90 days |
| Figma (`figma-export`, optional) | You, in Figma settings | `FIGMA_TOKEN` in your shell      | Read files your account can read            |

Setup opens GitHub's form already filled in for read-only access and never sees the token. `figma-export`
sends its token to `api.figma.com` only and never prints it.

## Uploads and downloads go only where expected

Screenshots are uploaded only to https hosts on `figma.com`; any other host, or a redirect to one, stops the
upload before anything is sent. Exported images are downloaded only from allowed Figma hosts, with redirects
refused. The Google Docs swap fetches only from `api.github.com`, for the one configured repository, at a
pinned commit.

## Nothing is published or pushed for you

`publish-markdown --branch` commits locally and prints the push command. The Google Docs swap edits docs but
never publishes them; a person clicks Publish. Before you publish a test doc, check the add-on's **Publish to**
site: a test doc connected to a public collection would publish to the public site.

## Personal data in screenshots

Redact names, emails, avatars, and IDs with the kit's Redact component before export. The inventory rejects
records whose text looks like a token, key, signed URL, or a personal email address.

More detail: [safety reference]({{ site.github.repository_url }}/blob/main/references/safety.md).
