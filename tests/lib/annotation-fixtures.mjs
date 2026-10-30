/**
 * Fixtures for the annotation tests: a dependency-free PNG encoder and rasterizer, node builders that
 * produce what scripts/figma-annotation.mjs extracts from Figma, and the representative screenshots
 * (light, dark, dense, mobile, long labels, many annotations, redacted data, edge targets, mixed regions).
 *
 * The pixels are synthetic: rectangles standing in for UI regions, stripes standing in for text, and marks
 * drawn as rectangles and circles. They exercise the checks that read pixels (contrast beside a mark,
 * background edges under a badge, pixelated personal data) with exact, repeatable values. They are not
 * renders of Figma; see docs/reference/annotation-kit.md.
 */

import { deflateSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { decodePng } from '../../scripts/compare-runs.mjs';
import { loadTokens, tokensIdentity, toneColors, roleHex, expectedVariableValues, estimateTextWidth, grow, kitDefs, MANIFEST_SCHEMA } from '../../scripts/lib/annotation.mjs';

export const T = loadTokens();
export const KIT = kitDefs();
export const TOKENS_HASH = tokensIdentity(T).hash;
export const sha = b => createHash('sha256').update(b).digest('hex');

// ---------------------------------------------------------------- PNG

const CRC = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = buf => { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => { const out = Buffer.alloc(12 + data.length); out.writeUInt32BE(data.length, 0); out.write(type, 4, 'ascii'); data.copy(out, 8); out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length); return out; };

/** 8-bit RGB PNG from a w*h*3 buffer. */
export function encodePng(w, h, rgb) {
  const raw = Buffer.alloc(h * (w * 3 + 1));
  for (let y = 0; y < h; y++) rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3);
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const rgbOf = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));

export class Canvas {
  constructor(w, h, bg = '#FFFFFF') { this.w = w; this.h = h; this.px = Buffer.alloc(w * h * 3); this.rect(0, 0, w, h, bg); }
  rect(x, y, w, h, hex, alpha = 1) {
    const [r, g, b] = rgbOf(hex);
    for (let j = Math.max(0, Math.floor(y)); j < Math.min(this.h, Math.ceil(y + h)); j++) for (let i = Math.max(0, Math.floor(x)); i < Math.min(this.w, Math.ceil(x + w)); i++) {
      const o = (j * this.w + i) * 3;
      this.px[o] = Math.round(this.px[o] * (1 - alpha) + r * alpha); this.px[o + 1] = Math.round(this.px[o + 1] * (1 - alpha) + g * alpha); this.px[o + 2] = Math.round(this.px[o + 2] * (1 - alpha) + b * alpha);
    }
  }
  frame(x, y, w, h, t, hex) { this.rect(x, y, w, t, hex); this.rect(x, y + h - t, w, t, hex); this.rect(x, y, t, h, hex); this.rect(x + w - t, y, t, h, hex); }
  circle(cx, cy, r, hex) { const [R, G, B] = rgbOf(hex); for (let j = Math.floor(cy - r); j <= Math.ceil(cy + r); j++) for (let i = Math.floor(cx - r); i <= Math.ceil(cx + r); i++) { if (i < 0 || j < 0 || i >= this.w || j >= this.h || (i + 0.5 - cx) ** 2 + (j + 0.5 - cy) ** 2 > r * r) continue; const o = (j * this.w + i) * 3; this.px[o] = R; this.px[o + 1] = G; this.px[o + 2] = B; } }
  /** Glyph-like detail: 2 px bars of varying height, as text or initials would leave. */
  texture(x, y, w, h, hex) { for (let i = 0; i + 2 <= w; i += 3) { const bh = Math.max(2, Math.round(h * (0.35 + 0.55 * (((i * 7) % 11) / 10)))); this.rect(x + i, y + h - bh, 2, bh, hex); } }
  /** Pixelate a region the way the policy asks: average each block (shrink), then fill it (enlarge with nearest neighbor). Blocks are at least `block` px. */
  pixelate(x, y, w, h, block) {
    const nx = Math.max(1, Math.floor(w / block)), ny = Math.max(1, Math.floor(h / block));
    for (let by = 0; by < ny; by++) for (let bx = 0; bx < nx; bx++) {
      const x1 = x + Math.floor((bx * w) / nx), x2 = x + Math.floor(((bx + 1) * w) / nx), y1 = y + Math.floor((by * h) / ny), y2 = y + Math.floor(((by + 1) * h) / ny);
      const sum = [0, 0, 0]; let n = 0;
      for (let j = y1; j < y2; j++) for (let i = x1; i < x2; i++) { const o = (j * this.w + i) * 3; sum[0] += this.px[o]; sum[1] += this.px[o + 1]; sum[2] += this.px[o + 2]; n += 1; }
      const c = sum.map(v => Math.round(v / n));
      for (let j = y1; j < y2; j++) for (let i = x1; i < x2; i++) { const o = (j * this.w + i) * 3; this.px[o] = c[0]; this.px[o + 1] = c[1]; this.px[o + 2] = c[2]; }
    }
  }
  /** Box blur: what the policy forbids, for the tests that reject it. */
  blur(x, y, w, h, r) {
    const src = Buffer.from(this.px);
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) {
      const sum = [0, 0, 0]; let n = 0;
      for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) { const u = Math.min(this.w - 1, Math.max(0, i + di)), v = Math.min(this.h - 1, Math.max(0, j + dj)), o = (v * this.w + u) * 3; sum[0] += src[o]; sum[1] += src[o + 1]; sum[2] += src[o + 2]; n += 1; }
      const o = (j * this.w + i) * 3; this.px[o] = Math.round(sum[0] / n); this.px[o + 1] = Math.round(sum[1] / n); this.px[o + 2] = Math.round(sum[2] / n);
    }
  }
  scaled(k) { const out = new Canvas(this.w * k, this.h * k); for (let j = 0; j < out.h; j++) for (let i = 0; i < out.w; i++) this.px.copy(out.px, (j * out.w + i) * 3, ((Math.floor(j / k)) * this.w + Math.floor(i / k)) * 3, ((Math.floor(j / k)) * this.w + Math.floor(i / k)) * 3 + 3); return out; }
  png() { return encodePng(this.w, this.h, this.px); }
}

export const pixelSha = pngBuf => sha(decodePng(pngBuf).pixels);

// ---------------------------------------------------------------- node builders

let seq = 100;
const nid = () => `${++seq}:${seq}`;
const comp = (set, variant, name) => ({ set, name: name || Object.entries(variant).map(([k, v]) => `${k}=${v}`).join(', '), variant, kitStamp: TOKENS_HASH, remote: false });
const solid = hex => ({ type: 'SOLID', hex, opacity: 1 });
const word = s => ({ characters: s, autoResize: 'WIDTH_AND_HEIGHT', truncation: 'DISABLED' });

/** Numbered marker. `target` is the bbox of the control it numbers. */
export function badge(n, x, y, o = {}) {
  const tone = o.tone || 'Purple', size = o.size || 'M';
  const d = T.metrics.badgePx[size], fs = { S: 19, M: 28, L: 36 }[size], c = toneColors(T, tone);
  return {
    role: 'marker',
    node: {
      id: nid(), name: `Step ${n}: ${o.label || 'the control'}`, type: 'INSTANCE', bbox: [x, y, d, d], visible: true, opacity: 1,
      component: comp('Step badge', { Tone: tone, Size: size }), fills: [solid(c.fill)], strokes: [solid(c.halo)], markHex: c.fill,
      texts: [{ ...word(String(n)), family: 'Poppins', style: 'Bold', size: fs, bbox: [x + d / 2 - fs * 0.33, y + d / 2 - fs / 2, fs * 0.66, fs], fillHex: c.text, surfaceHex: c.fill }],
      ...(o.target ? { target: { bbox: o.target } } : {}),
    },
    paint(cv, k) { cv.circle((x + d / 2) * k, (y + d / 2) * k, (d / 2 + T.metrics.haloOutlinePx) * k, c.halo); cv.circle((x + d / 2) * k, (y + d / 2) * k, (d / 2) * k, c.fill); },
  };
}

/** Callout label sized to its text the way the kit's auto-layout hugs it. */
export function label(text, x, y, o = {}) {
  const tone = o.tone || 'Purple', c = toneColors(T, tone), fs = 28;
  const w = Math.ceil(estimateTextWidth(text, fs, 'Poppins', 'Bold')) + 2 * T.metrics.labelPaddingPx.x, h = 52;
  return {
    role: 'label',
    node: {
      id: nid(), name: o.name || `Label: ${text}`, type: 'INSTANCE', bbox: [x, y, w, h], visible: true, opacity: 1,
      component: comp('Callout label', { Tone: tone, Pointer: 'None' }), fills: [solid(c.fill)], strokes: [solid(c.halo)], markHex: c.fill,
      texts: [{ ...word(text), family: 'Poppins', style: 'Bold', size: fs, bbox: [x + 16, y + 8, w - 32, 36], fillHex: c.text, surfaceHex: c.fill }],
    },
    paint(cv, k) { const ho = T.metrics.haloOutlinePx; cv.rect((x - ho) * k, (y - ho) * k, (w + 2 * ho) * k, (h + 2 * ho) * k, c.halo); cv.rect(x * k, y * k, w * k, h * k, c.fill); cv.rect((x + 16) * k, (y + 18) * k, (w - 32) * k, 14 * k, c.text); },
  };
}

/** Note box: a short explanation set in Inter Regular, wrapped inside a fixed width. */
export function note(title, body, x, y, w, o = {}) {
  const tone = o.tone || 'Ink', c = toneColors(T, tone);
  const lines = Math.ceil(estimateTextWidth(body, 22, 'Inter', 'Regular') / (w - 32)), h = 32 + 36 + lines * 30;
  return {
    role: 'label',
    node: {
      id: nid(), name: `Note: ${title}`, type: 'INSTANCE', bbox: [x, y, w, h], visible: true, opacity: 1,
      component: comp('Note box', { Tone: tone }), fills: [solid(c.fill)], strokes: [solid(c.halo)], markHex: c.fill,
      texts: [
        { characters: title, autoResize: 'WIDTH_AND_HEIGHT', truncation: 'DISABLED', family: 'Poppins', style: 'Bold', size: 22, bbox: [x + 16, y + 16, w - 32, 30], fillHex: c.text, surfaceHex: c.fill },
        { characters: body, autoResize: 'HEIGHT', truncation: 'DISABLED', family: 'Inter', style: 'Regular', size: 22, bbox: [x + 16, y + 52, w - 32, lines * 30], fillHex: c.text, surfaceHex: c.fill },
      ],
    },
    paint(cv, k) { cv.rect(x * k, y * k, w * k, h * k, c.fill); },
  };
}

/** Highlight box around `target` (padded). Unfilled. */
export function outline(target, o = {}) {
  const tone = o.tone || 'Purple', c = toneColors(T, tone), pad = o.pad ?? 10, box = grow(target, pad);
  return {
    role: 'outline',
    node: {
      id: nid(), name: o.name || 'Highlight', type: 'INSTANCE', bbox: box, visible: true, opacity: 1,
      component: comp('Highlight box', { Style: o.style || 'Solid', Tone: tone }), fills: [], strokes: [solid(c.fill), solid(c.halo)], markHex: c.fill, strokeMax: T.metrics.strokePx,
      target: { bbox: target, ...(o.selector ? { selector: o.selector } : {}) },
    },
    paint(cv, k) { cv.frame(box[0] * k, box[1] * k, box[2] * k, box[3] * k, T.metrics.haloStrokePx * k, c.halo); cv.frame((box[0] + 3) * k, (box[1] + 3) * k, (box[2] - 6) * k, (box[3] - 6) * k, T.metrics.strokePx * k, c.fill); },
  };
}

export function arrow(box, target, o = {}) {
  const tone = o.tone || 'Purple', c = toneColors(T, tone);
  return {
    role: 'arrow',
    node: { id: nid(), name: o.name || 'Arrow', type: 'INSTANCE', bbox: box, visible: true, opacity: 1, component: comp('Arrow', { Shape: 'Straight', Head: 'End', Tone: tone }), fills: [], strokes: [solid(c.fill), solid(c.halo)], markHex: c.fill, strokeMax: T.metrics.strokePx, target: { bbox: target } },
    paint(cv, k) { cv.rect(box[0] * k, (box[1] + box[3] / 2 - 3) * k, box[2] * k, 6 * k, c.fill); },
  };
}

/** A Redact layer from the retired kit component, for the tests that reject it. */
export function redact(box, style = 'Solid', o = {}) {
  const fill = T.brand.black.hex;
  return {
    role: 'retired',
    node: { id: nid(), name: o.name || `Redact ${style}`, type: 'INSTANCE', bbox: box, visible: true, opacity: 1, component: comp('Redact', { Style: style }), fills: [style === 'Solid' ? solid(fill) : { type: 'SOLID', hex: T.brand.white.hex, opacity: 0.25 }], strokes: [solid(fill)], markHex: fill },
    paint(cv, k) { if (style === 'Solid') cv.rect(box[0] * k, box[1] * k, box[2] * k, box[3] * k, fill); else cv.rect(box[0] * k, box[1] * k, box[2] * k, box[3] * k, '#C8C8D0'); },
  };
}

export function dim(box) {
  const ink = roleHex(T, 'ink');
  return { role: 'highlight', node: { id: nid(), name: 'Dim overlay', type: 'INSTANCE', bbox: box, visible: true, opacity: 1, component: comp('Dim overlay', {}, 'Dim overlay'), fills: [solid(ink)], strokes: [], markHex: ink }, paint(cv, k) { cv.rect(box[0] * k, box[1] * k, box[2] * k, box[3] * k, ink, 0.5); } };
}

export function doDont(kind, x, y) {
  const tone = kind, c = toneColors(T, tone);
  return { role: 'label', node: { id: nid(), name: `${kind} marker`, type: 'INSTANCE', bbox: [x, y, 96, 52], visible: true, opacity: 1, component: comp('Do / Dont marker', { Kind: kind }), fills: [solid(c.fill)], strokes: [solid(c.halo)], markHex: c.fill, texts: [{ ...word(kind === 'Do' ? 'Do' : "Don't"), family: 'Poppins', style: 'Bold', size: 22, bbox: [x + 16, y + 10, 64, 30], fillHex: c.text, surfaceHex: c.fill }] }, paint(cv, k) { cv.rect(x * k, y * k, 96 * k, 52 * k, c.fill); } };
}

// ---------------------------------------------------------------- fixtures

const FIX_ID = name => `fixture.${name}`;

function fx(name, w, h, bg, regions, marks, extra = {}) {
  return { name, w, h, bg, regions, marks, sensitive: [], keepClear: [], alt: null, ...extra };
}

/**
 * The clean capture: regions, then text-like detail, then personal data pixelated in the capture (as the
 * policy asks, before it goes to Figma). `pixelate` entries are [x, y, w, h], CSS px, padding included.
 */
export function cleanCanvas(f, { skipPixelate = false } = {}) {
  const cv = new Canvas(f.w, f.h, f.bg);
  for (const [x, y, w, h, hex] of f.regions) cv.rect(x, y, w, h, hex);
  for (const [x, y, w, h, hex] of f.textures || []) cv.texture(x, y, w, h, hex);
  if (!skipPixelate) for (const [x, y, w, h] of f.pixelate || []) cv.pixelate(x, y, w, h, f.pixelateBlock || T.styles.redaction.pixelate.minBlockCssPx);
  // Test variants: regions blurred or painted over in the capture instead of pixelated.
  for (const [x, y, w, h] of f.blurs || []) cv.blur(x, y, w, h, 3);
  for (const [x, y, w, h, hex] of f.paintOver || []) cv.rect(x, y, w, h, hex);
  return cv;
}

export function exportCanvas(f, { skipPixelate = false } = {}) {
  const cv = cleanCanvas(f, { skipPixelate }).scaled(T.display.exportScale);
  for (const m of f.marks) m.paint(cv, T.display.exportScale);
  return cv;
}

export function manifestFor(f) {
  const h1 = `img-${f.name}`;
  const shot = { id: '90:1', width: f.w, height: f.h, imageHash: h1 };
  const nm = kind => `[${FIX_ID(f.name)}] — ${f.name} — fixture — ${kind}`;
  return JSON.parse(JSON.stringify({
    schema: MANIFEST_SCHEMA, extractedAt: '2026-10-21T00:00:00.000Z', fileKey: 'FxFxFxFxFxFxFxFxFxFxFx', tokens: tokensIdentity(T),
    cleanFrame: { id: '84:13', name: nm('clean'), width: f.w, height: f.h, screenshot: { ...shot, id: '84:14' } },
    annotatedFrame: { id: '87:2', name: nm('annotated'), width: f.w, height: f.h, clipsContent: true, screenshot: shot },
    kitVariables: expectedVariableValues(T),
    nodes: [{ id: '90:1', name: 'screenshot', type: 'RECTANGLE', bbox: [0, 0, f.w, f.h], visible: true, opacity: 1, fills: [{ type: 'IMAGE', imageHash: h1 }] }, ...f.marks.map(m => m.node)],
    sensitive: f.sensitive, keepClear: f.keepClear,
  }));
}

/** Everything verifyAnnotation needs, from a fixture. `mutate(manifest, ctx)` edits it first. */
export function inputFor(f, { mutate, skipPixelate = false, exportOverride } = {}) {
  const cleanBuf = (f.dpr && f.dpr > 1 ? cleanCanvas(f, { skipPixelate }).scaled(f.dpr) : cleanCanvas(f, { skipPixelate })).png();
  const exportBuf = exportOverride || exportCanvas(f, { skipPixelate }).png();
  const manifest = manifestFor(f);
  const ctx = { cleanBuf, exportBuf, alt: f.alt };
  if (mutate) mutate(manifest, ctx, f);
  const cp = decodePng(ctx.cleanBuf), ep = decodePng(ctx.exportBuf);
  return {
    tokens: T, kit: KIT, manifest,
    clean: { sha256: sha(ctx.cleanBuf), width: cp.w, height: cp.h, dpr: ctx.dpr ?? f.dpr ?? 1, png: cp },
    export: { sha256: sha(ctx.exportBuf), width: ep.w, height: ep.h, png: ep },
    alt: ctx.alt,
    ...(ctx.inventory ? { inventory: ctx.inventory } : {}),
    ...(ctx.recorded ? { recorded: ctx.recorded } : {}),
  };
}

const LIGHT = '#F4F4F8', WHITE = '#FFFFFF', DARK = '#1B1B24', PANEL_DARK = '#2B2B36', INKC = '#23232D';

export function fixtures() {
  const out = {};
  const desk = (bg, panel, header) => [[0, 0, 1440, 64, header], [0, 64, 300, 836, panel], [330, 100, 780, 500, panel], [1140, 64, 300, 836, panel]];
  const blocks = [20, 100, 260, 320], canvas = [350, 120, 740, 460], review = [1180, 100, 140, 44];
  const alt3 = 'The P1 editor with three numbered areas: 1 the Blocks panel, 2 the page canvas, 3 the Review button.';

  out['light-ui'] = fx('light-ui', 1440, 900, LIGHT, desk(LIGHT, WHITE, WHITE), [
    outline(blocks), badge(1, 20, 36, { label: 'the Blocks panel', target: blocks }),
    outline(canvas), badge(2, 350, 52, { label: 'the page canvas', target: canvas }),
    outline(review), badge(3, 1336, 98, { label: 'the Review button', target: review }),
    label('Blocks panel', 20, 460), label('Review button', 1150, 200),
  ], { alt: { text: alt3, subject: 'The P1 editor' } });

  out['dark-ui'] = fx('dark-ui', 1440, 900, DARK, desk(DARK, PANEL_DARK, PANEL_DARK), [
    outline(blocks, { tone: 'Gold' }), badge(1, 20, 36, { tone: 'Gold', label: 'the Blocks panel', target: blocks }),
    outline(canvas), badge(2, 350, 52, { label: 'the page canvas', target: canvas }),
    outline(review, { tone: 'Gold' }), badge(3, 1336, 98, { tone: 'Gold', label: 'the Review button', target: review }),
    label('Blocks panel', 20, 460, { tone: 'Gold' }), label('Review button', 1150, 200),
  ], { alt: { text: alt3, subject: 'The P1 editor' } });

  const dense = []; const denseMarks = [];
  for (let i = 0; i < 6; i++) {
    const cx = 30 + (i % 3) * 470, cy = 100 + Math.floor(i / 3) * 400, target = [cx + 20, cy + 20, 140, 36];
    dense.push([cx, cy, 440, 360, WHITE], [target[0], target[1], target[2], target[3], '#E6E6EE']);
    denseMarks.push(outline(target, { style: i < 3 ? 'Solid' : 'Dashed' }), badge(i + 1, cx + 20 + 140 + 14, cy + 22, { size: 'S', label: `the card ${i + 1} action`, target }));
  }
  out['dense-dashboard'] = fx('dense-dashboard', 1440, 900, LIGHT, dense, denseMarks, { alt: { text: 'The dashboard with six numbered areas: 1 the card 1 action, 2 the card 2 action, 3 the card 3 action, 4 the card 4 action, 5 the card 5 action, 6 the card 6 action.', subject: 'The dashboard' } });

  const hamburger = [16, 12, 32, 32], row = [16, 120, 358, 72], cta = [16, 760, 358, 56];
  out['narrow-mobile'] = fx('narrow-mobile', 390, 844, WHITE, [[0, 0, 390, 56, INKC], [16, 120, 358, 72, LIGHT], [16, 760, 358, 56, '#E6E6EE']], [
    badge(1, 60, 12, { size: 'S', tone: 'Gold', label: 'the menu', target: hamburger }),
    outline(row), badge(2, 16, 214, { size: 'S', label: 'the first page', target: row }),
    outline(cta), badge(3, 326, 690, { label: 'the Add page button', target: cta }), label('Add page', 16, 690),
  ], { alt: { text: 'The mobile page list with three numbered areas: 1 the menu, 2 the first page, 3 the Add page button.', subject: 'The mobile page list' } });

  const long = label('Click here to open the page settings panel', 20, 460);
  out['long-label'] = fx('long-label', 1440, 900, LIGHT, desk(LIGHT, WHITE, WHITE), [outline(blocks), badge(1, 20, 36, { label: 'the Blocks panel', target: blocks }), long], { alt: { text: 'The P1 editor with one numbered area: 1 the Blocks panel.', subject: 'The P1 editor' } });

  const search = [200, 200, 300, 60], filter = [200, 400, 300, 60], publish = [900, 400, 300, 60];
  out['multi-annotation'] = fx('multi-annotation', 1440, 900, LIGHT, [[200, 200, 300, 60, WHITE], [200, 400, 300, 60, WHITE], [900, 400, 300, 60, WHITE]], [
    outline(search), badge(1, 200, 128, { label: 'the search box', target: search }), arrow([510, 224, 180, 12], search), label('Search box', 700, 204),
    outline(filter, { style: 'Dashed' }), badge(2, 200, 330, { label: 'the filter list', target: filter }),
    outline(publish), badge(3, 1216, 406, { label: 'the Publish button', target: publish }),
    note('Before you publish', 'Changes save to the workstream, not to Live, until you publish.', 200, 560, 520),
  ], { alt: { text: 'The page editor with three numbered areas: 1 the search box, 2 the filter list, 3 the Publish button.', subject: 'The page editor' } });

  // The email and avatar are pixelated in the capture; the name was replaced with fake data before capture.
  const email = [1190, 90, 190, 20], person = [1190, 118, 150, 20], avatar = [1116, 84, 56, 56], settings = [40, 300, 200, 44];
  out['redacted-pii'] = fx('redacted-pii', 1440, 900, LIGHT, [[1100, 70, 300, 100, WHITE], [avatar[0], avatar[1], avatar[2], avatar[3], '#9A9AA8'], [40, 300, 200, 44, WHITE]], [
    outline(settings), badge(1, 40, 236, { label: 'the Settings link', target: settings }),
  ], {
    textures: [[email[0], email[1], email[2], email[3], '#555566'], [person[0], person[1], person[2], person[3], '#555566'], [avatar[0] + 12, avatar[1] + 14, 32, 28, WHITE]],
    pixelate: [grow(email, 4), grow(avatar, 4)],
    sensitive: [{ id: 'email', kind: 'email', bbox: email, reason: 'account email', declaredBy: 'fixture' }, { id: 'name', kind: 'name', bbox: person, method: 'fake-data', reason: 'person name, replaced with "Anita Agency" before capture', declaredBy: 'fixture' }, { id: 'avatar', kind: 'avatar', bbox: avatar, reason: 'profile photo', declaredBy: 'fixture' }],
    alt: { text: 'The account page with one numbered area: 1 the Settings link.', subject: 'The account page' },
  });

  const icon1 = [20, 20, 40, 40], icon2 = [1380, 840, 40, 40], icon3 = [1380, 20, 40, 40];
  out['edge-targets'] = fx('edge-targets', 1440, 900, LIGHT, [[20, 20, 40, 40, WHITE], [1380, 840, 40, 40, WHITE], [1380, 20, 40, 40, WHITE]], [
    outline(icon1, { pad: 8 }), badge(1, 80, 24, { label: 'the home icon', target: icon1 }),
    outline(icon2, { pad: 8 }), badge(2, 1300, 846, { label: 'the help icon', target: icon2 }),
    outline(icon3, { pad: 8 }), badge(3, 1380, 80, { label: 'the account icon', target: icon3 }),
    label('Home', 6, 830),
  ], { alt: { text: 'The page corners with three numbered areas: 1 the home icon, 2 the help icon, 3 the account icon.', subject: 'The page corners' } });

  const straddle = [340, 250, 120, 50];
  out['mixed-backgrounds'] = fx('mixed-backgrounds', 800, 600, WHITE, [[400, 0, 400, 600, INKC], [340, 250, 120, 50, '#8A8A99']], [
    outline(straddle), badge(1, 330, 186, { label: 'the Switch control', target: straddle }),
  ], { alt: { text: 'The theme preview with one numbered area: 1 the Switch control.', subject: 'The theme preview' } });

  return out;
}

export const PASSING = ['light-ui', 'dark-ui', 'dense-dashboard', 'narrow-mobile', 'multi-annotation', 'redacted-pii', 'edge-targets', 'mixed-backgrounds'];

/** Deterministic summary compared against tests/fixtures/annotation/snapshots/<name>.json. */
export function snapshotOf(f, report, input) {
  const r = n => Math.round(n * 100) / 100;
  return {
    name: f.name, frame: [f.w, f.h], tokens: report.summary.tokens.hash.slice(0, 12),
    nodes: input.manifest.nodes.map(n => ({ name: n.name, component: n.component ? (n.component.set || n.component.name) : n.type, variant: n.component?.variant || null, bbox: n.bbox.map(r), markHex: n.markHex || null, text: (n.texts || []).map(t => `${t.family} ${t.style} ${t.size}: ${t.characters}`) })),
    checks: report.checks.map(c => `${c.id}:${c.status}`),
    humanReview: report.humanReview.map(h => h.id),
    pixels: { clean: input.clean.sha256 && sha(input.clean.png.pixels), export: sha(input.export.png.pixels) },
  };
}
