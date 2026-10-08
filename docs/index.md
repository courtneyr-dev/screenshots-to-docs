---
title: Home
nav_order: 1
---

<div class="hero" markdown="0">
  <div>
    <div class="eyebrow">Screenshots to docs</div>
    <h1>Keep every docs screenshot current, release after release</h1>
    <p>Capture the signed-in app, annotate in Figma with a shared kit, draft alt text from the marks, and swap the new images into Markdown and Google Docs from one reviewed commit.</p>
    <a class="btn" href="{{ '/tutorial/first-swap.html' | relative_url }}">Try the tutorial</a>
    <a class="btn btn-outline" href="{{ '/how-to/set-up.html' | relative_url }}">Set up</a>
  </div>
  <img src="{{ '/assets/images/annotated-example.jpg' | relative_url }}" alt="An annotated screenshot of the P1 editor: four numbered areas, the Blocks panel, the page canvas, page settings, and the Review button, each outlined in purple with a numbered badge.">
</div>

When an app ships a new version, the screenshots in its docs go stale. This tool turns a release into a reviewed
batch of screenshot changes, for the P1 editor, WordPress and Drupal admin screens, Content Publisher, public
websites, or any web app you add a [preset](reference/presets.html) for. People still decide what to reshoot, review the marks, and click Publish.

```mermaid
flowchart LR
  A["New release"] --> B["Capture"] --> C["Annotate in Figma"] --> D["Pinned in git"]
  D --> E["Markdown docs"]
  D --> F["Google Docs"]
```

<div class="cards" markdown="0">
  <a class="card" href="{{ '/tutorial/first-swap.html' | relative_url }}">
    <span class="card-kicker">Tutorial · 10 minutes</span>
    <h3>Your first release swap</h3>
    <p>Run the whole swap on sample data. No accounts needed.</p>
  </a>
  <a class="card" href="{{ '/how-to/' | relative_url }}">
    <span class="card-kicker">How-to guides · with videos</span>
    <h3>Run a release, step by step</h3>
    <p>From detecting a release to verifying every published image.</p>
  </a>
  <a class="card" href="{{ '/reference/' | relative_url }}">
    <span class="card-kicker">Reference</span>
    <h3>Commands, config, inventory, kit</h3>
    <p>Every flag, field, status, and annotation component.</p>
  </a>
  <a class="card" href="{{ '/explanation/how-it-works.html' | relative_url }}">
    <span class="card-kicker">Explanation</span>
    <h3>How it works</h3>
    <p>Why images are pinned to commits, and how alt text stays in step with the marks.</p>
  </a>
</div>
