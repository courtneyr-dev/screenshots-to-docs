---
title: Accessibility
parent: Explanation
nav_order: 2
---

# Accessibility

An annotated screenshot carries information in two places: the image, for readers who see it, and the alt
text, for readers who don't. The pipeline is built so the two can't drift apart.

## Alt text comes from the marks

Numbered step badges tell sighted readers the order to look at things. If the alt text lists areas in a
different order, or skips one, a screen reader user follows different instructions. `draft-alt` builds the
alt text from the annotated frame's `Step N: …` layers, in number order, and refuses gaps or repeats. A
person reads the draft before it's saved, and `set-alt` rejects generic or placeholder text.

## Missing alt text is a source problem

In Google Docs–based publishing, an image with no alt text in the doc is published with no `alt` attribute
at all. Fixing it in the site code doesn't help; it has to be set in the doc. The Google Docs swap writes the
alt text into each image it replaces, so a release swap also repairs missing alt text.

## Marks stay readable on any background

Every mark carries a white halo, so a purple highlight stays visible on the dark parts of the editor as well
as on white panels. Gold variants exist for dark UI, with dark text for contrast. Do and Don't markers use a
check and a cross as well as green and red, so the meaning doesn't depend on color alone.

## Text in images isn't searchable

A callout label on an image can't be searched, translated, or resized by the reader. The kit's guidance:
keep labels to one to four words in the UI's exact wording, and repeat them in the article text.

Component guidance: [Annotation kit](../reference/annotation-kit.html).
