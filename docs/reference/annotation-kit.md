---
title: Annotation kit
parent: Reference
nav_order: 5
---

# Annotation kit

The Figma plugin in `figma-plugin/` builds these components and variables in any design file. This page is generated from `figma-plugin/kit.json`, the same data the plugin uses.

## Components

### Step badge

Numbered step marker. Number runs in reading order and matches the numbered step in the article text. Purple is the default; Gold for dark UI; Ink for low emphasis; Do/Dont for correct vs mistaken examples. Size M in a 1440x900 frame; S for dense UI; L for hero shots.

15 variants. Properties: `Number` text (default "1"); `Tone`: Purple, Gold, Ink, Do, Dont (default Purple); `Size`: S, M, L (default S).

### Callout label

Short label (1-4 words) naming a UI element in its exact wording. Pointer aims at the element; None when it sits beside a Highlight box. Purple default, Gold on dark UI, Ink low emphasis, Info for neutral notes. Repeat the words in the article text: text in an image is not searchable or translatable.

20 variants. Properties: `Label` text (default "Blocks panel"); `Tone`: Purple, Gold, Ink, Info (default Purple); `Pointer`: None, Left, Right, Up, Down (default None).

### Highlight box

Outlines the UI area the step is about. Resize to fit; never fill it. Solid for the focus of the step; Dashed for a secondary or optional area. Do/Dont tones pair with Do/Dont badges in comparison images.

8 variants. Properties: `Style`: Solid, Dashed (default Solid); `Tone`: Purple, Gold, Do, Dont (default Purple).

### Arrow

Points at one UI element. Rotate, flip, and resize the instance. Straight for short pointers; Curved to route around UI; Elbow to come from a margin label. Head=Both only for "move between" or range steps. Keep one arrow per step at most; prefer a Highlight box for areas.

12 variants. Properties: `Shape`: Straight, Curved, Elbow (default Straight); `Head`: End, Both (default End); `Tone`: Purple, Gold (default Purple).

### Key cap

One keyboard key. Combine instances for shortcuts (Shift + 2). Use the key name as macOS shows it; mention Windows equivalents in the text, not the image.

2 variants. Properties: `Key` text (default "Shift"); `Tone`: Light, Ink (default Light).

### Redact

Hides personal or sensitive data: names, emails, avatars, IDs, tokens. Pantheon docs style forbids personal information in screenshots. Blur keeps the layout readable; Solid when blur might still leak text. Prefer re-capturing with sample data.

2 variants. Properties: `Style`: Blur, Solid (default Blur).

### Dim overlay

Darkens areas that distract from the step. Place over the parts to de-emphasize, never over the focus. Text under it must not be needed.

A single component.

### Click indicator

Marks the exact spot to click. Use when a Highlight box would be too big (a small icon or menu item). Pair with a Step badge.

2 variants. Properties: `Tone`: Purple, Gold (default Purple).

### Note box

A short explanation that must sit on the image (one or two sentences). Use sparingly: anything a reader needs also goes in the article text. Ink default, Info for tips, Purple when it belongs to a numbered step.

3 variants. Properties: `Title` text (default "Note"); `Body` text (default "Changes save to the workstream, not to Live, until you publish."); `Show title` on/off (default on); `Tone`: Ink, Info, Purple (default Ink).

### Do / Dont marker

Labels a comparison image as the right or wrong way. Shape (check vs cross) carries the meaning, not only the color. Pair with Highlight box Tone=Do/Dont.

2 variants. Properties: `Kind`: Do, Dont (default Do).

### Highlight ellipse

Circles a small round target: an icon, avatar, toggle, or badge. Use Highlight box for rectangular UI.

2 variants. Properties: `Tone`: Purple, Gold (default Purple).

### Underline

Underlines a word or field label in the UI when a box would hide nearby text.

2 variants. Properties: `Tone`: Purple, Gold (default Purple).

### Cursor

A mouse pointer for when the capture did not record one. Place its tip on the click target; pair with a Click indicator.

A single component.

## Variables

Collection **Annotation**. Colors alias the Pantheon Design System library when it is enabled for the file; otherwise the plugin creates the same values locally.

| Variable              | Value                                   | Notes                                                                                                                                                   |
| --------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `color/mark`          | #7952A8 (PDS `primitive/discovery/600`) | PDS discovery/600 #7952A8. Main mark color. White text 5.86:1; vs white 5.86:1, vs #F3F3F5 5.29:1; needs the white halo on dark UI (2.99:1 vs #241612). |
| `color/halo`          | #FFFFFF                                 | White outline that keeps marks visible on dark screenshots.                                                                                             |
| `color/on-mark`       | #FFFFFF                                 | Text on badges and labels.                                                                                                                              |
| `size/stroke`         | 6                                       | Arrow and highlight stroke in a 1440x900 frame (about 3 px on an 800 px docs column).                                                                   |
| `size/halo-line`      | 12                                      | Halo stroke drawn under arrows and highlights: stroke + 2x halo.                                                                                        |
| `size/halo`           | 3                                       | Halo outline on badges and labels.                                                                                                                      |
| `size/badge`          | 48                                      | Step badge diameter.                                                                                                                                    |
| `radius/label`        | 8                                       | —                                                                                                                                                       |
| `radius/highlight`    | 8                                       | —                                                                                                                                                       |
| `spacing/label-x`     | 16                                      | —                                                                                                                                                       |
| `spacing/label-y`     | 8                                       | —                                                                                                                                                       |
| `color/mark-gold`     | #FFCA28 (PDS `primitive/brand/500`)     | PDS brand/500 #FFCA28. For marks on dark UI. Use color/on-gold text (5.96:1).                                                                           |
| `color/info`          | #207DDE (PDS `primitive/info/600`)      | PDS info/600 #207DDE. Neutral notes.                                                                                                                    |
| `color/do`            | #3C6C0F (PDS `primitive/success/700`)   | PDS success/700 #3C6C0F. Correct examples. White text 6.28:1.                                                                                           |
| `color/dont`          | #BE3232 (PDS `primitive/critical/600`)  | PDS critical/600 #BE3232. Mistakes to avoid. White text 5.69:1.                                                                                         |
| `color/caution`       | #B15C16 (PDS `primitive/warning/700`)   | PDS warning/700 #B15C16. Warnings. White text 4.76:1.                                                                                                   |
| `color/ink`           | #4A4844 (PDS `primitive/warm/900`)      | PDS warm/900 #4A4844. Dark notes, key caps, dimming. White text 9.12:1.                                                                                 |
| `color/neutral`       | #9C9890 (PDS `primitive/warm/600`)      | PDS warm/600 #9C9890. Redaction blocks.                                                                                                                 |
| `color/on-gold`       | #4A4844 (PDS `primitive/warm/900`)      | Text on gold marks (5.96:1).                                                                                                                            |
| `size/badge-s`        | 32                                      | Small step badge.                                                                                                                                       |
| `size/badge-l`        | 64                                      | Large step badge.                                                                                                                                       |
| `size/stroke-thin`    | 4                                       | Thin marks: underlines, small boxes.                                                                                                                    |
| `size/halo-line-thin` | 8                                       | Halo under thin marks.                                                                                                                                  |
