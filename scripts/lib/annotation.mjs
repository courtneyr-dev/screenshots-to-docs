/**
 * screenshots-to-docs / lib/annotation
 *
 * The annotation design contract (figma-plugin/annotation-tokens.json) and the checks that prove an
 * annotated Figma frame follows it. Shared by record-annotation, handoff, figma-annotation, the plugin
 * build, and the tests.
 *
 * What it can prove: the extracted frame data (a manifest read out of Figma) against the tokens and the
 * kit, plus pixels from the clean capture and the exported PNG. What it cannot prove is returned as
 * `humanReview` items, never as a pass. See docs/reference/annotation-kit.md.
 */

import { readFileSync, existsSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, basename } from 'node:path';
import { TOOL_DIR } from './config.mjs';
import { decodePng } from '../compare-runs.mjs';

export const TOKENS_FILE = join(TOOL_DIR, 'figma-plugin', 'annotation-tokens.json');
export const KIT_FILE = join(TOOL_DIR, 'figma-plugin', 'kit.json');
export const PLUGIN_NS = 's2d';
export const MANIFEST_SCHEMA = 'screenshots-to-docs/annotation-manifest@1';
export const sha256 = buf => createHash('sha256').update(buf).digest('hex');

// ---------------------------------------------------------------- tokens

export function loadTokens(file = TOKENS_FILE) {
  return JSON.parse(readFileSync(file, 'utf-8'));
}

export function canonicalJson(v) {
  if (Array.isArray(v)) return '[' + v.map(canonicalJson).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canonicalJson(v[k])).join(',') + '}';
  return JSON.stringify(v);
}

/** Stable identity of a token set: its schema version and a hash of its canonical JSON. */
export function tokensIdentity(tokens = loadTokens()) {
  return { schemaVersion: tokens.schemaVersion, hash: sha256(canonicalJson(tokens)) };
}

export const roleHex = (t, role) => t.brand[t.roles[role].color].hex.toUpperCase();

export function metric(t, path) {
  return path.split('.').reduce((o, k) => o?.[k], t.metrics);
}

/** Resolved colors of a tone: { fill, text, halo } as upper-case hex. */
export function toneColors(t, tone) {
  const d = t.tones[tone];
  return d ? { fill: roleHex(t, d.fill), text: roleHex(t, d.text), halo: roleHex(t, d.halo) } : null;
}

/** Every color an annotation may use: the roles, plus white. */
export function allowedColors(t) {
  return new Set([...Object.keys(t.roles).map(r => roleHex(t, r)), t.brand.white.hex.toUpperCase()]);
}

const rgbOf = hex => { const h = hex.replace('#', ''); return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16) / 255); };
export const hexOf = rgb => '#' + rgb.map(c => Math.round(c * 255).toString(16).padStart(2, '0')).join('').toUpperCase();

/** The `variables` array the Figma plugin builds, derived from the tokens (kit.json holds components only). */
export function figmaVariables(t) {
  const rgba = hex => { const [r, g, b] = rgbOf(hex); return { r, g, b, a: 1 }; };
  return t.figmaVariables.collections.map(col => ({
    name: col.name,
    vars: col.vars.map(v => {
      const spec = { name: v.name, type: v.type, scopes: v.scopes || [], description: '' };
      if (v.brand) spec.values = { Value: rgba(t.brand[v.brand].hex) };
      else if (v.role) {
        const brand = t.roles[v.role].color;
        spec.description = t.roles[v.role].note;
        spec.values = { Value: { alias: `brand/${brand}`, remote: false, collection: 'Annotation primitives', value: rgba(t.brand[brand].hex) } };
      } else spec.values = { Value: v.metric ? metric(t, v.metric) : v.value };
      return spec;
    }),
  }));
}

/** Expected value of every Annotation-collection variable: upper-case hex for colors, a number otherwise. */
export function expectedVariableValues(t) {
  const out = {};
  for (const col of t.figmaVariables.collections) {
    if (col.name !== 'Annotation') continue;
    for (const v of col.vars) out[v.name] = v.type === 'COLOR' ? roleHex(t, v.role) : (v.metric ? metric(t, v.metric) : v.value);
  }
  return out;
}

export function kitDefs(file = KIT_FILE) {
  const kit = JSON.parse(readFileSync(file, 'utf-8'));
  const defs = new Map();
  for (const c of kit.components) {
    const variants = {};
    for (const [k, d] of Object.entries(c.defs || {})) if (d.type === 'VARIANT') variants[k] = d.variantOptions;
    defs.set(c.n, { variants });
  }
  return defs;
}

export function roleOfComponent(t, name) {
  for (const [role, d] of Object.entries(t.taxonomy)) if (d.components.includes(name)) return role;
  return null;
}

// ---------------------------------------------------------------- color math (WCAG 2.2)

const lin = c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
export function luminance(hex) { const [r, g, b] = rgbOf(hex); return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b); }
export function contrastL(a, b) { const [hi, lo] = a >= b ? [a, b] : [b, a]; return (hi + 0.05) / (lo + 0.05); }
export const contrast = (a, b) => contrastL(luminance(a), luminance(b));
/** Rec. 601 luma, as a gray hex: what a grayscale conversion of the color looks like. */
export function grayOf(hex) { const [r, g, b] = rgbOf(hex); const y = 0.299 * r + 0.587 * g + 0.114 * b; return hexOf([y, y, y]); }
const round2 = n => Math.round(n * 100) / 100;

export function isLargeText(t, px, bold) {
  return px >= t.contrast.largeTextMinPx || (bold && px >= t.contrast.largeTextMinPxBold);
}

export const displayScale = (t, frameWidth) => Math.min(1, t.display.docsColumnWidthPx / frameWidth);

// ---------------------------------------------------------------- geometry

export const area = ([, , w, h]) => Math.max(0, w) * Math.max(0, h);
export function intersect(a, b) {
  const x1 = Math.max(a[0], b[0]), y1 = Math.max(a[1], b[1]), x2 = Math.min(a[0] + a[2], b[0] + b[2]), y2 = Math.min(a[1] + a[3], b[1] + b[3]);
  return x2 > x1 && y2 > y1 ? [x1, y1, x2 - x1, y2 - y1] : null;
}
export const overlapArea = (a, b) => { const i = intersect(a, b); return i ? area(i) : 0; };
export const grow = (b, n) => [b[0] - n, b[1] - n, b[2] + 2 * n, b[3] + 2 * n];
export const contains = (outer, inner, tol = 0) => inner[0] >= outer[0] - tol && inner[1] >= outer[1] - tol && inner[0] + inner[2] <= outer[0] + outer[2] + tol && inner[1] + inner[3] <= outer[1] + outer[3] + tol;
export function gap(a, b) {
  const dx = Math.max(b[0] - (a[0] + a[2]), a[0] - (b[0] + b[2]), 0), dy = Math.max(b[1] - (a[1] + a[3]), a[1] - (b[1] + b[3]), 0);
  return Math.hypot(dx, dy);
}

/** Fraction of `target` covered by the union of `rects` (coordinate compression, exact). */
export function coverage(target, rects) {
  const clipped = rects.map(r => intersect(target, r)).filter(Boolean);
  if (!clipped.length) return 0;
  const xs = [...new Set([target[0], target[0] + target[2], ...clipped.flatMap(r => [r[0], r[0] + r[2]])])].sort((a, b) => a - b);
  const ys = [...new Set([target[1], target[1] + target[3], ...clipped.flatMap(r => [r[1], r[1] + r[3]])])].sort((a, b) => a - b);
  let covered = 0;
  for (let i = 0; i < xs.length - 1; i++) for (let j = 0; j < ys.length - 1; j++) {
    const cx = (xs[i] + xs[i + 1]) / 2, cy = (ys[j] + ys[j + 1]) / 2;
    if (clipped.some(r => cx > r[0] && cx < r[0] + r[2] && cy > r[1] && cy < r[1] + r[3])) covered += (xs[i + 1] - xs[i]) * (ys[j + 1] - ys[j]);
  }
  return covered / area(target);
}

const CHAR_EM = { 'Poppins Bold': 0.66, 'Inter Bold': 0.6, 'Inter Regular': 0.56 };
/** Upper-bound-ish width of a single line of text. A heuristic: Figma does not expose measured overflow. */
export function estimateTextWidth(chars, size, family, style) {
  return String(chars).length * size * (CHAR_EM[`${family} ${style}`] ?? 0.66);
}

// ---------------------------------------------------------------- pixels

const LUT = Array.from({ length: 256 }, (_, i) => lin(i / 255));
/** Mean relative luminance of a pixel region (png from decodePng), clipped to the image. Null if empty. */
export function regionLuminance(png, box) {
  const x1 = Math.max(0, Math.floor(box[0])), y1 = Math.max(0, Math.floor(box[1])), x2 = Math.min(png.w, Math.ceil(box[0] + box[2])), y2 = Math.min(png.h, Math.ceil(box[1] + box[3]));
  if (x2 <= x1 || y2 <= y1) return null;
  let sum = 0, n = 0;
  for (let y = y1; y < y2; y++) for (let x = x1; x < x2; x++) {
    const i = (y * png.w + x) * png.bpp;
    sum += 0.2126 * LUT[png.pixels[i]] + 0.7152 * LUT[png.pixels[i + 1]] + 0.0722 * LUT[png.pixels[i + 2]];
    n += 1;
  }
  return sum / n;
}

/** Luminance of the strips just outside a box (top, bottom, left, right): the screenshot a mark sits on. */
export function surroundLuminance(png, box, w = 8) {
  const [x, y, bw, bh] = box;
  return [[x - w, y - w, bw + 2 * w, w], [x - w, y + bh, bw + 2 * w, w], [x - w, y, w, bh], [x + bw, y, w, bh]].map(b => regionLuminance(png, b)).filter(v => v !== null);
}

/** Pixel at (x, y) of a decoded PNG as hex. */
export const pixelHex = (png, x, y) => { const i = (y * png.w + x) * png.bpp; return hexOf([png.pixels[i] / 255, png.pixels[i + 1] / 255, png.pixels[i + 2] / 255]); };

/**
 * Is a pixel region pixelated: uniform blocks of at least `minBlock` px? `box` is [x, y, w, h] in image px.
 * A block edge is a column (or row) where neighboring pixels differ by more than `colorTol` in some channel.
 * Pixelation puts every edge on a shared grid: changes cluster in narrow bands (at most `edgeTol` + 1 px wide,
 * for edges softened by resampling) that are at least `minBlock` - 1 px apart. Text, photos, and blur put
 * changes everywhere. A `core` box (the region without its padding) that is all one color is a solid box,
 * not pixelation: pixelating real content leaves more than one block color there.
 * A plain shape inside the region (two edges per axis) is a box too.
 * Returns { status: 'pixelated'|'flat'|'box'|'detail', block, hex }: `block` is the smallest spacing between
 * edges found, `hex` the color of a flat region or box.
 */
export function pixelation(png, box, { minBlock, edgeTol = 2, colorTol = 3, core = box }) {
  const P = png.pixels, bpp = png.bpp, w = png.w;
  const differ = (i, j) => Math.abs(P[i] - P[j]) > colorTol || Math.abs(P[i + 1] - P[j + 1]) > colorTol || Math.abs(P[i + 2] - P[j + 2]) > colorTol;
  const clip = b => [Math.max(0, Math.ceil(b[0])), Math.max(0, Math.ceil(b[1])), Math.min(png.w, Math.floor(b[0] + b[2])), Math.min(png.h, Math.floor(b[1] + b[3]))];
  {
    const [cx1, cy1, cx2, cy2] = clip(core);
    let flat = true;
    const first = (cy1 * w + cx1) * bpp;
    for (let y = cy1; y < cy2 && flat; y++) for (let x = cx1; x < cx2; x++) if (differ(first, (y * w + x) * bpp)) { flat = false; break; }
    if (flat) return { status: 'flat', block: Infinity, hex: cx2 > cx1 && cy2 > cy1 ? pixelHex(png, cx1, cy1) : null };
  }
  const [x1, y1, x2, y2] = clip(box);
  const cols = new Uint8Array(x2 - x1), rows = new Uint8Array(y2 - y1);
  for (let y = y1; y < y2; y++) for (let x = x1; x < x2; x++) {
    const i = (y * w + x) * bpp;
    if (x + 1 < x2 && differ(i, i + bpp)) cols[x - x1] = 1;
    if (y + 1 < y2 && differ(i, i + w * bpp)) rows[y - y1] = 1;
  }
  const bands = flags => {
    const out = [];
    for (let i = 0; i < flags.length; i++) if (flags[i]) { if (out.length && i - out[out.length - 1][1] <= 1) out[out.length - 1][1] = i; else out.push([i, i]); }
    return out;
  };
  const cb = bands(cols), rb = bands(rows);
  if (!cb.length && !rb.length) return { status: 'flat', block: Infinity, hex: pixelHex(png, x1, y1) };
  let block = Infinity, wide = false;
  for (const b of [cb, rb]) for (let i = 0; i < b.length; i++) {
    if (b[i][1] - b[i][0] + 1 > edgeTol + 1) wide = true;
    if (i) block = Math.min(block, (b[i][0] + b[i][1]) / 2 - (b[i - 1][0] + b[i - 1][1]) / 2);
  }
  if (wide || block < minBlock - 1) return { status: 'detail', block: wide ? 1 : block, hex: null };
  // A plain shape inside the region has two edges per axis; a pixel grid has more.
  if (Math.max(cb.length, rb.length) < 3) {
    const [cx1, cy1, cx2, cy2] = clip(core);
    return { status: 'box', block, hex: pixelHex(png, Math.floor((cx1 + cx2) / 2), Math.floor((cy1 + cy2) / 2)) };
  }
  return { status: 'pixelated', block, hex: null };
}

/**
 * Background luma (Rec. 601, 0-255) on opposite sides of a circular mark, from a ring between `rIn` and `rOut`
 * px from its center, skipping pixels within `skipDist` (summed channel difference) of any `skip` color.
 * Returns [{ a, b, la, lb }] for each pair of opposite sides (left/right, top/bottom) whose medians differ
 * by more than `edge`: the mark sits across a background edge.
 */
export function straddledEdges(png, cx, cy, r, rIn, rOut, { skip = [], skipDist = 40, edge = 40, minSamples = 6 } = {}) {
  const skipRgb = skip.map(h => rgbOf(h).map(c => c * 255));
  const sides = { left: [], right: [], top: [], bottom: [] };
  const step = Math.max(1, Math.round(rOut / 30));
  for (let dy = -Math.ceil(rOut); dy <= rOut; dy += step) for (let dx = -Math.ceil(rOut); dx <= rOut; dx += step) {
    const d2 = dx * dx + dy * dy;
    if (d2 < rIn * rIn || d2 > rOut * rOut) continue;
    const x = Math.floor(cx + dx), y = Math.floor(cy + dy);
    if (x < 0 || y < 0 || x >= png.w || y >= png.h) continue;
    const i = (y * png.w + x) * png.bpp, p = [png.pixels[i], png.pixels[i + 1], png.pixels[i + 2]];
    if (skipRgb.some(q => Math.abs(p[0] - q[0]) + Math.abs(p[1] - q[1]) + Math.abs(p[2] - q[2]) < skipDist)) continue;
    const L = 0.299 * p[0] + 0.587 * p[1] + 0.114 * p[2];
    if (dx < -r * 0.5) sides.left.push(L); else if (dx > r * 0.5) sides.right.push(L);
    if (dy < -r * 0.5) sides.top.push(L); else if (dy > r * 0.5) sides.bottom.push(L);
  }
  const median = v => [...v].sort((p, q) => p - q)[Math.floor(v.length / 2)];
  const out = [];
  for (const [a, b] of [['left', 'right'], ['top', 'bottom']]) {
    if (sides[a].length < minSamples || sides[b].length < minSamples) continue;
    const la = median(sides[a]), lb = median(sides[b]);
    if (Math.abs(la - lb) > edge) out.push({ a, b, la, lb });
  }
  return out;
}

// ---------------------------------------------------------------- alt text

const GENERIC_LABEL = new Set(['button', 'icon', 'area', 'section', 'field', 'item', 'thing', 'here', 'this', 'link', 'menu', 'panel', 'element', 'control', 'it', 'box']);
const COLOR_SHAPE = /\b(red|blue|purple|violet|yellow|gold|green|pink|black|white|gr[ae]y|orange)\s+(box|boxes|arrow|arrows|circle|circles|outline|outlines|badge|badges|highlight|highlights|rectangle|rectangles|square|squares|label|labels|marker|markers)\b/i;
const SHAPE_WORD = /\b(arrow|arrows|callout|callouts|badge|badges|annotation|annotations|marker|markers|circled|boxed|highlighted)\b/i;
const norm = s => String(s).toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * Alt text against the annotated frame's step labels. Returns { status: pass|review|fail, reasons }.
 * fail: it does not match the marks, or it describes the marks instead of the interface.
 * review: it matches but is ambiguous; a person must read it.
 */
export function checkAltAgainstSteps(alt, steps, subject = '') {
  const fail = [], review = [];
  const a = norm(alt);
  if (!a) return { status: 'fail', reasons: ['alt text is empty'] };
  if (COLOR_SHAPE.test(alt)) fail.push('alt text describes a colored shape (for example "blue box"), not the interface');
  let at = 0;
  for (const s of steps) {
    const label = norm(s.label);
    const i = a.indexOf(label, at);
    if (!label || i < 0) fail.push(`alt text does not name step ${s.n} ("${s.label}") in order`);
    else at = i + label.length;
  }
  if (!fail.length) {
    if (SHAPE_WORD.test(alt)) review.push('alt text uses annotation words (arrow, badge, callout, highlighted); say what the interface shows instead');
    const seen = new Set();
    for (const s of steps) {
      const words = norm(s.label).split(' ').filter(Boolean);
      if (words.length < 2 && GENERIC_LABEL.has(words[0])) review.push(`step ${s.n} is labeled "${s.label}", which does not say which control it is`);
      if (seen.has(norm(s.label))) review.push(`two steps share the label "${s.label}"`);
      seen.add(norm(s.label));
    }
    if (subject && subject.trim().split(/\s+/).length < 2) review.push('the subject is a single word; name the screen (for example "The WordPress dashboard")');
    if (String(alt).length > 250) review.push('alt text is over 250 characters; consider moving detail into the caption');
  }
  return { status: fail.length ? 'fail' : review.length ? 'review' : 'pass', reasons: [...fail, ...review] };
}

// ---------------------------------------------------------------- manifest

/** Problems with the manifest's shape, before any check reads it. */
export function manifestShapeErrors(m) {
  const e = [];
  const need = (ok, msg) => { if (!ok) e.push(msg); };
  need(m && typeof m === 'object', 'manifest is not an object');
  if (!m || typeof m !== 'object') return e;
  need(m.schema === MANIFEST_SCHEMA, `manifest.schema must be "${MANIFEST_SCHEMA}"`);
  need(m.tokens && Number.isInteger(m.tokens.schemaVersion) && /^[0-9a-f]{64}$/.test(m.tokens.hash || ''), 'manifest.tokens needs schemaVersion and a 64-hex hash (the extraction reads them from the Figma file)');
  for (const k of ['cleanFrame', 'annotatedFrame']) {
    const f = m[k];
    need(f && typeof f.id === 'string' && /^\d+:\d+$/.test(f.id), `manifest.${k}.id must be a Figma node ID such as 87:2`);
    need(f && Number.isFinite(f.width) && Number.isFinite(f.height), `manifest.${k} needs width and height`);
  }
  need(Array.isArray(m.nodes), 'manifest.nodes must be a list');
  for (const [i, n] of (m.nodes || []).entries()) {
    need(n && typeof n.id === 'string' && typeof n.name === 'string' && typeof n.type === 'string', `nodes[${i}] needs id, name, and type`);
    need(n && Array.isArray(n.bbox) && n.bbox.length === 4 && n.bbox.every(Number.isFinite), `nodes[${i}] (${n?.name}) needs a numeric bbox [x, y, w, h]`);
  }
  return e;
}

const bboxOk = b => Array.isArray(b) && b.length === 4 && b.every(Number.isFinite) && b[2] > 0 && b[3] > 0;

/**
 * Verify an extracted annotated frame. Input:
 *   tokens, kit (kitDefs), manifest,
 *   clean:  { sha256, width, height, dpr, png } the clean capture (png from decodePng); dpr is the capture's device pixel ratio.
 *           Figma frames are sized in CSS pixels, round(width / dpr), as figma-plan.mjs draws them
 *   export: { sha256, width, height, png }      the exported annotated PNG
 *   inventory: optional inventory record, for frame names and the recorded clean asset
 *   recorded: optional { cleanNodeId, annotatedNodeId } given on the command line
 *   alt: optional { text, subject }
 * Returns { status: 'pass'|'fail', checks: [{ id, status, detail }], humanReview: [{ id, reason }], summary }.
 */
export function verifyAnnotation(input) {
  const { tokens: t, kit, manifest: m, clean, export: exp, inventory = null, recorded = {}, alt = null } = input;
  const checks = [];
  const human = new Map();
  const add = (id, status, detail) => checks.push({ id, status, detail });
  const review = (id, reason) => { if (!human.has(id)) human.set(id, reason); };
  const results = (id, problems, okDetail) => add(id, problems.length ? 'fail' : 'pass', problems.length ? problems.join('; ') : okDetail);

  const shape = manifestShapeErrors(m);
  if (shape.length) {
    add('manifest-shape', 'fail', shape.join('; '));
    return finish();
  }
  add('manifest-shape', 'pass', `${m.nodes.length} nodes`);

  const id = tokensIdentity(t);
  const W = m.annotatedFrame.width, H = m.annotatedFrame.height;
  const frame = [0, 0, W, H];
  const dpr = clean.dpr || 1;
  const wantW = Math.round(clean.width / dpr), wantH = Math.round(clean.height / dpr);
  const px = (clean.width / W), py = (clean.height / H);
  const allowed = allowedColors(t);
  const scale = displayScale(t, W);

  // ---- token identity
  {
    const p = [];
    if (m.tokens.schemaVersion !== id.schemaVersion) p.push(`the Figma kit was built from token schema ${m.tokens.schemaVersion}; this repository is on ${id.schemaVersion}`);
    if (m.tokens.hash !== id.hash) p.push(`the Figma kit's token hash ${m.tokens.hash.slice(0, 12)} is not this repository's ${id.hash.slice(0, 12)} (rebuild the kit with the plugin, then re-annotate)`);
    if (m.kitVariables && typeof m.kitVariables === 'object') {
      const want = expectedVariableValues(t);
      for (const [name, value] of Object.entries(want)) {
        const got = m.kitVariables[name];
        if (got === undefined) p.push(`variable ${name} is missing from the Figma file`);
        else if ((typeof value === 'string' ? String(got).toUpperCase() : Number(got)) !== value) p.push(`variable ${name} is ${got} in Figma but ${value} in the tokens`);
      }
    } else p.push('the manifest has no kitVariables, so the kit variables cannot be compared with the tokens');
    results('token-identity', p, `schema ${id.schemaVersion}, hash ${id.hash.slice(0, 12)}; ${Object.keys(expectedVariableValues(t)).length} variables match`);
  }

  // ---- frame mapping
  {
    const p = [];
    if (m.cleanFrame.id === m.annotatedFrame.id) p.push('the annotated frame is the clean frame');
    if (recorded.cleanNodeId && recorded.cleanNodeId !== m.cleanFrame.id) p.push(`--clean-node-id ${recorded.cleanNodeId} is not the manifest's clean frame ${m.cleanFrame.id}`);
    if (recorded.annotatedNodeId && recorded.annotatedNodeId !== m.annotatedFrame.id) p.push(`--annotated-node-id ${recorded.annotatedNodeId} is not the manifest's annotated frame ${m.annotatedFrame.id}`);
    if (m.annotatedFrame.width !== wantW || m.annotatedFrame.height !== wantH) p.push(`the annotated frame is ${m.annotatedFrame.width}x${m.annotatedFrame.height}; the ${clean.width}x${clean.height} capture at dpr ${dpr} is ${wantW}x${wantH} in Figma`);
    const cs = m.cleanFrame.screenshot, as = m.annotatedFrame.screenshot;
    if (!cs?.imageHash || !as?.imageHash) p.push('the manifest has no image hash for the screenshot in one of the frames');
    else if (cs.imageHash !== as.imageHash) p.push('the screenshot in the annotated frame is a different image from the one in the clean frame');
    if (cs && (cs.width !== wantW || cs.height !== wantH)) p.push(`the clean frame's image is ${cs.width}x${cs.height}; the capture is ${wantW}x${wantH} in Figma`);
    if (as && (as.width !== W || as.height !== H)) p.push('the screenshot layer does not fill the annotated frame');
    if (inventory) {
      const nm = (kind) => `[${inventory.screenshot_id}] — ${inventory.title || String(inventory.screenshot_id).split('.').pop().replace(/-/g, ' ')} — ${inventory.capture?.release || 'unreleased'} — ${kind}`;
      if (m.cleanFrame.name !== nm('clean')) p.push(`the clean frame is named "${m.cleanFrame.name}", expected "${nm('clean')}"`);
      if (m.annotatedFrame.name !== nm('annotated')) p.push(`the annotated frame is named "${m.annotatedFrame.name}", expected "${nm('annotated')}"`);
      if (inventory.figma?.node_id && inventory.figma.node_id !== m.cleanFrame.id) p.push(`the inventory records the clean frame as ${inventory.figma.node_id}, not ${m.cleanFrame.id}`);
    }
    results('frame-mapping', p, `annotated ${m.annotatedFrame.id} maps to clean ${m.cleanFrame.id}; same image, ${W}x${H}`);
  }

  // ---- provenance of the clean source
  {
    const p = [];
    if (inventory?.clean_asset?.sha256 && inventory.clean_asset.sha256 !== clean.sha256) p.push(`the inventory's clean asset checksum ${inventory.clean_asset.sha256.slice(0, 12)} is not the clean capture's ${clean.sha256.slice(0, 12)}`);
    if (exp.sha256 === clean.sha256) p.push('the export is byte-identical to the clean capture (no annotations were exported)');
    results('provenance', p, `clean capture sha256 ${clean.sha256.slice(0, 12)}, export sha256 ${exp.sha256.slice(0, 12)}`);
  }

  // ---- classify nodes
  const marks = [];
  const retired = [];
  const kitProblems = [], typoProblems = [], colorProblems = [];
  let fallbackFonts = false;
  const screenshots = m.nodes.filter(n => n.name === 'screenshot' && n.type === 'RECTANGLE');
  if (screenshots.length !== 1) kitProblems.push(`the annotated frame must hold exactly one layer named "screenshot" (found ${screenshots.length})`);
  for (const n of m.nodes) {
    if (screenshots.includes(n)) continue;
    const comp = n.type === 'INSTANCE' ? (n.component?.set || n.component?.name) : null;
    if (n.type !== 'INSTANCE') { kitProblems.push(`"${n.name}" is an ad hoc ${n.type}, not a kit instance`); continue; }
    // Redaction boxes left from an older kit: the redaction check reports them.
    if (t.styles.redaction.retiredComponents.includes(comp)) { retired.push({ n, comp }); continue; }
    const role = roleOfComponent(t, comp);
    if (!role) { kitProblems.push(`"${n.name}" is an instance of "${comp}", which is not an approved kit component`); continue; }
    if (!n.component.kitStamp) kitProblems.push(`"${n.name}" is not an instance of a kit built by the plugin (no kit stamp on its main component)`);
    else if (n.component.kitStamp !== id.hash) kitProblems.push(`"${n.name}" comes from a kit built with token hash ${n.component.kitStamp.slice(0, 12)}, not ${id.hash.slice(0, 12)}`);
    const def = kit.get(comp);
    for (const [prop, val] of Object.entries(n.component.variant || {})) {
      if (!def?.variants?.[prop]) kitProblems.push(`"${n.name}": "${prop}" is not a property of ${comp}`);
      else if (!def.variants[prop].includes(val)) kitProblems.push(`"${n.name}": ${prop}=${val} is not a ${comp} variant`);
    }
    if (n.visible === false) kitProblems.push(`"${n.name}" is hidden`);
    for (const p of [...(n.fills || []), ...(n.strokes || [])]) {
      if (t.forbidden.fills.includes(p.type) || p.type === 'IMAGE') kitProblems.push(`"${n.name}" has a ${p.type} paint; annotation components take solid token colors only`);
      else if (p.hex && !allowed.has(p.hex.toUpperCase())) colorProblems.push(`"${n.name}" uses ${p.hex}, which is not a token color`);
    }
    for (const tx of n.texts || []) {
      const key = `${tx.family} ${tx.style}`;
      if (t.typography.disallowed.includes(tx.family)) typoProblems.push(`"${n.name}" text uses ${tx.family}, which annotations must not use`);
      else if (!['Poppins Bold', 'Inter Bold', 'Inter Regular'].includes(key)) typoProblems.push(`"${n.name}" text uses ${key}; allowed are Poppins Bold, Inter Regular, and the Inter Bold fallback`);
      else if (key === 'Inter Bold') fallbackFonts = true;
      if (tx.fillHex && !allowed.has(tx.fillHex.toUpperCase())) colorProblems.push(`"${n.name}" text is ${tx.fillHex}, which is not a token color`);
    }
    marks.push({ n, comp, role, tone: n.component.variant?.Tone || null, bbox: n.bbox });
  }
  results('kit-components', kitProblems, `${marks.length} marks, all approved kit instances built from the current tokens`);
  results('token-colors', colorProblems, 'every fill, stroke, and text color is a token color');
  results('typography', typoProblems, 'fonts are Poppins Bold and Inter Regular');
  if (fallbackFonts) review('font-fallback', 'some text uses the Inter Bold fallback because Poppins was unavailable when the kit was built; rebuild the kit once Poppins loads');

  // ---- targets, numbering
  const targets = marks.map(x => x.n.target?.bbox).filter(bboxOk);
  const keepClear = (m.keepClear || []).map(k => k.bbox).filter(bboxOk);
  {
    const p = [];
    const markers = marks.filter(x => x.role === 'marker');
    const nums = [];
    for (const x of markers) {
      const num = (x.n.texts || []).map(tx => tx.characters).join('').trim();
      if (!/^\d+$/.test(num)) p.push(`"${x.n.name}" has no numeral (a marker must carry its step number, not only a color)`);
      else {
        nums.push(Number(num));
        const nm = /^Step (\d+): (.+)$/.exec(x.n.name);
        if (!nm) p.push(`marker "${x.n.name}" must be named "Step ${num}: the <element>" (alt text is drafted from these names)`);
        else if (Number(nm[1]) !== Number(num)) p.push(`marker "${x.n.name}" shows ${num} but is named for step ${nm[1]}`);
      }
    }
    const sorted = [...nums].sort((a, b) => a - b);
    sorted.forEach((v, i) => { if (v !== i + 1) p.push(`steps must be numbered 1 to ${sorted.length} with no gaps or repeats (found ${sorted.join(', ')})`); });
    for (const x of marks.filter(y => ['marker', 'outline', 'arrow'].includes(y.role))) {
      const tg = x.n.target;
      if (!tg || (!bboxOk(tg.bbox) && !(typeof tg.selector === 'string' && tg.selector.trim()))) { p.push(`${x.role} "${x.n.name}" has no target (give a bounding box or a selector)`); continue; }
      if (!bboxOk(tg.bbox)) { review('target-geometry', `"${x.n.name}" has a selector but no bounding box, so its position was not checked`); continue; }
      if (!contains(frame, tg.bbox, 0.5)) p.push(`the target of "${x.n.name}" is outside the image`);
      else if (x.role === 'marker' && gap(x.bbox, tg.bbox) > Math.max(2 * x.bbox[2], 96)) p.push(`marker "${x.n.name}" is ${Math.round(gap(x.bbox, tg.bbox))} px from its target; place it next to the control`);
      else if (x.role === 'outline' && !contains(x.bbox, tg.bbox, 4) && x.comp !== 'Click indicator' && x.comp !== 'Underline') p.push(`outline "${x.n.name}" does not surround its target`);
      else if (x.role === 'arrow' && gap(x.bbox, tg.bbox) > 24) p.push(`arrow "${x.n.name}" does not reach its target (${Math.round(gap(x.bbox, tg.bbox))} px away)`);
    }
    results('targets', p, `${markers.length} numbered markers; every marker, outline, and arrow has a target`);
  }

  // ---- bounds, clipping, overflow
  const outsetOf = x => (['marker', 'label'].includes(x.role) ? metric(t, 'haloOutlinePx') : ['outline', 'arrow'].includes(x.role) ? metric(t, 'haloStrokePx') / 2 : 0);
  {
    const p = [];
    for (const x of marks) {
      const ext = grow(x.bbox, outsetOf(x));
      if (!contains(frame, ext, 0.5)) p.push(`"${x.n.name}" extends past the image edge (${Math.round(ext[0])}, ${Math.round(ext[1])}, ${Math.round(ext[2])}x${Math.round(ext[3])} in ${W}x${H})`);
      for (const tx of x.n.texts || []) {
        if (tx.truncation && tx.truncation !== 'DISABLED') p.push(`"${x.n.name}" truncates its text`);
        if (tx.bbox && !contains(x.bbox, tx.bbox, 1)) p.push(`text in "${x.n.name}" is clipped by the component (${tx.bbox.map(Math.round).join(', ')} is not inside ${x.bbox.map(Math.round).join(', ')})`);
        if (tx.autoResize === 'NONE' && tx.bbox) {
          const est = estimateTextWidth(tx.characters, tx.size, tx.family, tx.style);
          if (est > tx.bbox[2] * 1.15) p.push(`text "${String(tx.characters).slice(0, 30)}" in "${x.n.name}" overflows its box (about ${Math.round(est)} px of text in ${Math.round(tx.bbox[2])} px)`);
          else if (est > tx.bbox[2] * 0.9) review('text-fit', `text in "${x.n.name}" is close to its box width; confirm it does not wrap or clip`);
        }
      }
      if (x.comp === 'Callout label') {
        const words = (x.n.texts || []).map(tx => tx.characters).join(' ').trim().split(/\s+/).filter(Boolean);
        if (words.length > t.styles.label.maxWords) p.push(`label "${words.join(' ')}" is ${words.length} words; keep a Callout label to ${t.styles.label.maxWords} or use a Note box`);
      }
    }
    results('bounds', p, 'every mark and its halo is inside the image, unclipped, and its text fits');
  }

  // ---- collisions and covered content
  {
    const p = [];
    const solid = marks.filter(x => ['marker', 'label'].includes(x.role));
    const rect = x => grow(x.bbox, outsetOf(x));
    const name = x => `"${x.n.name}"`;
    for (let i = 0; i < solid.length; i++) for (let j = i + 1; j < solid.length; j++) {
      if (overlapArea(rect(solid[i]), rect(solid[j])) > 1) p.push(`"${solid[i].n.name}" overlaps "${solid[j].n.name}"`);
    }
    for (const a of marks.filter(x => x.role === 'arrow')) for (const s of solid) {
      if (s.role === 'marker' && overlapArea(rect(a), rect(s)) > 1) p.push(`arrow "${a.n.name}" overlaps marker "${s.n.name}"`);
    }

    // Outlines and highlights against each other. The outer edge is the bbox grown by the halo; the inner
    // stroke edge is the bbox shrunk by half the halo stroke (the kit centers its strokes on the bbox). A Dim
    // overlay has no stroke, so both edges are its bbox.
    const gapPx = metric(t, 'outlineGapPx');
    const boxes = marks.filter(x => ['outline', 'highlight'].includes(x.role));
    const innerOf = x => (x.role === 'outline' ? grow(x.bbox, -metric(t, 'haloStrokePx') / 2) : x.bbox);
    const clearance = (outer, inner) => Math.min(inner[0] - outer[0], inner[1] - outer[1], outer[0] + outer[2] - (inner[0] + inner[2]), outer[1] + outer[3] - (inner[1] + inner[3]));
    const centerIn = (b, r) => { const cx = b[0] + b[2] / 2, cy = b[1] + b[3] / 2; return cx > r[0] && cx < r[0] + r[2] && cy > r[1] && cy < r[1] + r[3]; };
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const [a, b] = area(boxes[i].bbox) >= area(boxes[j].bbox) ? [boxes[i], boxes[j]] : [boxes[j], boxes[i]];
      const oa = rect(a), ob = rect(b), ia = innerOf(a);
      if (centerIn(ob, ia)) {
        // b is drawn inside a: it must clear a's inner stroke edge.
        const c = clearance(ia, ob);
        if (c < gapPx) p.push(c < 0
          ? `${name(b)} lies inside ${name(a)} and crosses its stroke by ${Math.round(-c)} px; a mark nested in another must clear the outer mark's inner stroke edge by ${gapPx} px`
          : `${name(b)} lies inside ${name(a)} but clears its inner stroke edge by only ${Math.round(c)} px; nested marks need ${gapPx} px`);
        continue;
      }
      const g = overlapArea(oa, ob) > 0 ? -1 : gap(oa, ob);
      if (g < 0) p.push(`${name(a)} and ${name(b)} overlap; outlines and highlights need ${gapPx} px of clear space between their outer edges (halo included)`);
      else if (g < gapPx) p.push(`${name(a)} and ${name(b)} are ${Math.round(g * 10) / 10} px apart at their outer edges (halo included); they need ${gapPx} px`);
    }

    // Markers against other marks' outline strokes: a badge may sit wholly inside a box or clear of it,
    // never on the line. The band is the colored stroke; halos are white and may touch.
    for (const mk of marks.filter(x => x.role === 'marker')) for (const b of boxes) {
      const half = (b.role === 'outline' ? (b.n.strokeMax ?? metric(t, 'strokePx')) : 0) / 2;
      const outer = grow(b.bbox, half), inner = grow(b.bbox, -half);
      if (overlapArea(mk.bbox, outer) > 0 && !contains(inner, mk.bbox)) p.push(`marker ${name(mk)} crosses the edge of ${name(b)}; place it wholly inside the ${b.role === 'outline' ? 'box' : 'overlay'} or clear of its ${b.role === 'outline' ? 'stroke' : 'edge'}`);
    }

    // Markers across a background edge in the screenshot (half on a dialog, half on the dimmed backdrop):
    // compare the clean capture on opposite sides of a ring just outside the badge.
    const ring = t.styles.marker.edgeRing;
    const k = px / t.display.exportScale; // clean px per export px
    for (const mk of marks.filter(x => x.role === 'marker')) {
      const r = (mk.bbox[2] / 2) * px;
      const cx = (mk.bbox[0] + mk.bbox[2] / 2) * px, cy = (mk.bbox[1] + mk.bbox[3] / 2) * py;
      const hits = straddledEdges(clean.png, cx, cy, r, r + ring.innerPx * k, r + ring.outerPx * k, { skip: [roleHex(t, 'mark')], skipDist: ring.skipDistance, edge: ring.edgeLuma });
      if (hits.length) p.push(`marker ${name(mk)} straddles a background edge in the screenshot (${hits.map(h => `${h.a} ${Math.round(h.la)} vs ${h.b} ${Math.round(h.lb)}`).join('; ')}: median luma ${ring.innerPx}-${ring.outerPx} px outside the badge differs by more than ${ring.edgeLuma}); move it wholly onto one surface`);
    }

    const protect = [...targets.map(b => ({ b, what: 'a step target' })), ...keepClear.map(b => ({ b, what: 'a keep-clear region' }))];
    for (const x of marks.filter(y => ['marker', 'label', 'highlight'].includes(y.role))) {
      for (const pr of protect) {
        if (overlapArea(rect(x), pr.b) <= 1) continue;
        p.push(`"${x.n.name}" covers ${pr.what}`);
      }
    }
    for (const x of marks.filter(y => y.role === 'outline')) {
      if ((x.n.fills || []).some(f => f.visible !== false && (f.opacity ?? 1) > 0)) p.push(`outline "${x.n.name}" is filled and hides what it marks`);
    }
    results('collisions', [...new Set(p)], `no marker or label overlaps another; outlines and highlights keep ${gapPx} px apart; no marker crosses an outline stroke or a background edge; nothing covers a target or keep-clear region`);
  }

  // ---- redaction
  {
    const p = [];
    const R = t.styles.redaction;
    const sens = m.sensitive || [];
    const pad = R.minPaddingPx;
    if (!sens.length) {
      review('redaction-declared', 'no sensitive regions were declared for this shot; confirm it shows no personal or credential data');
    }
    const how = 'replace the data with fake data before capture, or pixelate the region in the capture before it goes to Figma';
    for (const r of retired) {
      const style = r.n.component?.variant?.Style;
      const why = style === 'Solid' ? 'solid boxes are not allowed' : style === 'Blur' ? 'blur can be reversed and is not allowed' : 'redaction boxes are not allowed';
      p.push(`"${r.n.name}" is a ${r.comp}${style ? ` (Style=${style})` : ''} layer: ${why}. Delete it; ${how}`);
    }
    const sx = exp.width / W, sy = exp.height / H;
    const minBlock = sc => R.pixelate.minBlockCssPx * sc;
    const scaled = (b, kx, ky) => [b[0] * kx, b[1] * ky, b[2] * kx, b[3] * ky];
    const opts = (s, kx, ky) => ({ minBlock: minBlock(kx), edgeTol: R.pixelate.edgeTolerancePx, colorTol: R.pixelate.colorTolerance, core: scaled(s.bbox, kx, ky) });
    const describe = (res, where, s, sc) => (res.status === 'flat'
      ? `${where} shows sensitive region "${s.id}" (${s.kind}) as one flat color (${res.hex}), which reads as a solid box; ${how}`
      : res.status === 'box'
        ? `${where} shows sensitive region "${s.id}" (${s.kind}) as a plain box (${res.hex}), not pixelation: it has one edge on each side instead of a grid of blocks; ${how}`
        : `${where} shows sensitive region "${s.id}" (${s.kind}) unredacted: its pixels are not uniform blocks (edges ${res.block === 1 ? 'everywhere' : `${Math.round(res.block)} px apart`}; pixelation needs blocks of at least ${Math.round(minBlock(sc) * 10) / 10} px, ${R.pixelate.minBlockCssPx} CSS px, with ${pad} px of padding); ${how}`);
    for (const s of sens) {
      if (!bboxOk(s.bbox)) { p.push(`sensitive region "${s.id}" has no bounding box`); continue; }
      if (!R.kinds.includes(s.kind)) p.push(`sensitive region "${s.id}" has an unknown kind "${s.kind}" (known: ${R.kinds.join(', ')})`);
      const method = s.method || 'pixelate';
      if (!R.methods.includes(method)) { p.push(`sensitive region "${s.id}" has an unknown method "${method}" (use ${R.methods.join(' or ')})`); continue; }
      if (method === 'fake-data') { review('redaction-fake-data', `sensitive region "${s.id}" (${s.kind}) is declared as fake data; confirm the export shows invented values, such as "Anita Agency" or jordan.lee@example.com, not a real person's`); continue; }
      // Pixelated: the export, and the clean capture it came from (which is delivered too), must show blocks.
      // Under a Redact layer the export shows the box, already reported above; the clean capture still counts.
      const padded = intersect(frame, grow(s.bbox, pad)) || s.bbox;
      const boxed = retired.some(r => bboxOk(r.n.bbox) && overlapArea(r.n.bbox, s.bbox) > 0);
      const inExport = boxed ? null : pixelation(exp.png, scaled(padded, sx, sy), opts(s, sx, sy));
      if (inExport && inExport.status !== 'pixelated') p.push(describe(inExport, 'the export', s, sx));
      const inClean = pixelation(clean.png, scaled(padded, px, py), opts(s, px, py));
      if (inClean.status !== 'pixelated') p.push(describe(inClean, 'the clean capture', s, px));
    }
    results('redaction', p, sens.length ? `${sens.length} declared sensitive regions: pixelated in the export and the clean capture (blocks of at least ${R.pixelate.minBlockCssPx} CSS px), or declared as fake data; no Redact boxes` : 'no sensitive regions declared; no Redact boxes');
  }
  review('redaction-complete', 'Confirm the export shows no personal, credential, or customer data outside the declared regions. The repository cannot detect data nobody declared.');

  // ---- contrast, tone, grayscale (text from the manifest; marks against the clean screenshot under them)
  {
    const p = [], g = [], tone = [];
    for (const x of marks) {
      for (const tx of x.n.texts || []) {
        if (!tx.fillHex || !tx.surfaceHex) continue;
        const bold = /bold/i.test(tx.style);
        const need = isLargeText(t, tx.size, bold) ? t.contrast.textLarge : t.contrast.textNormal;
        const got = contrast(tx.fillHex, tx.surfaceHex);
        if (got < need) p.push(`text in "${x.n.name}" is ${round2(got)}:1 (${tx.fillHex} on ${tx.surfaceHex}); needs ${need}:1`);
      }
      if (x.role === 'highlight') continue;
      const fill = x.n.markHex || (x.role === 'outline' || x.role === 'arrow' ? (x.n.strokes?.[0]?.hex || x.n.fills?.[0]?.hex) : (x.n.fills?.[0]?.hex || x.n.strokes?.[0]?.hex));
      if (!fill) continue;
      const halo = roleHex(t, 'halo');
      const around = surroundLuminance(clean.png, [x.bbox[0] * px, x.bbox[1] * py, x.bbox[2] * px, x.bbox[3] * py], 8 * px);
      if (!around.length) continue;
      const worst = around.map(L => {
        const viaFill = contrastL(luminance(fill), L);
        const viaHalo = Math.min(contrastL(luminance(halo), L), contrast(fill, halo));
        return Math.max(viaFill, viaHalo);
      }).reduce((a, b) => Math.min(a, b), Infinity);
      if (worst < t.contrast.graphicalObject) p.push(`"${x.n.name}" reaches only ${round2(worst)}:1 against the screenshot beside it; needs ${t.contrast.graphicalObject}:1 through its fill or its halo`);
      const gFill = grayOf(fill), gHalo = grayOf(halo);
      const gWorst = around.map(L => Math.max(contrastL(luminance(gFill), L), Math.min(contrastL(luminance(gHalo), L), contrast(gFill, gHalo)))).reduce((a, b) => Math.min(a, b), Infinity);
      if (gWorst < t.contrast.graphicalObject) g.push(`"${x.n.name}" drops to ${round2(gWorst)}:1 in grayscale; it must stay distinguishable without its hue`);
      const mean = around.reduce((a, b) => a + b, 0) / around.length;
      const klass = Math.min(...around) >= t.backgroundVariants.classify.lightMinLuminance ? 'light' : Math.max(...around) < t.backgroundVariants.classify.lightMinLuminance ? 'dark' : 'mixed';
      x.background = klass;
      const tn = t.tones[x.tone];
      if (tn && klass !== 'mixed' && !tn.backgrounds.includes(klass)) tone.push(`"${x.n.name}" uses the ${x.tone} tone on a ${klass} part of the screenshot (mean luminance ${round2(mean)}); ${x.tone} is for ${tn.backgrounds.join(' and ')} regions`);
      if (tn && klass === 'mixed' && tn.backgrounds.length < 2) tone.push(`"${x.n.name}" straddles light and dark regions; ${x.tone} only works on ${tn.backgrounds.join(' and ')}. Use Purple`);
    }
    results('contrast', p, 'text meets WCAG AA; every mark reaches 3:1 against the screenshot through its fill or halo');
    results('grayscale', g, 'every mark stays distinguishable after a grayscale conversion');
    results('background-variant', tone, 'each tone sits on a screenshot region it is approved for');
  }

  // ---- display size
  {
    const p = [];
    for (const x of marks) {
      for (const tx of x.n.texts || []) {
        const need = x.role === 'marker' ? t.display.minRenderedTextPx.numeral : tx.style === 'Regular' ? t.display.minRenderedTextPx.body : t.display.minRenderedTextPx.label;
        if (tx.size * scale < need - 1e-9) p.push(`text in "${x.n.name}" renders at ${round2(tx.size * scale)} px at the ${t.display.docsColumnWidthPx} px docs width; the minimum is ${need} px`);
      }
      if (['outline', 'arrow'].includes(x.role) && x.n.strokeMax !== undefined && x.n.strokeMax * scale < t.display.minRenderedStrokePx - 1e-9) {
        p.push(`stroke in "${x.n.name}" renders at ${round2(x.n.strokeMax * scale)} px; the minimum is ${t.display.minRenderedStrokePx} px (scale marks for a ${W} px frame)`);
      }
    }
    results('display-size', p, `text and strokes stay readable at ${t.display.docsColumnWidthPx} px (scale ${round2(scale)})`);
  }

  // ---- meaning without color
  {
    const p = [];
    for (const kind of ['Do', 'Dont']) {
      const used = marks.some(x => x.tone === kind);
      const marker = marks.some(x => x.comp === 'Do / Dont marker' && x.n.component.variant?.Kind === kind);
      if (used && !marker) p.push(`the ${kind} tone is used without a ${kind === 'Do' ? 'check' : 'cross'} (add a Do / Dont marker, Kind=${kind}); Green and Pink look alike in grayscale`);
    }
    results('color-independence', p, 'step numbers, line style, and check and cross shapes carry meaning, not hue');
  }

  // ---- export
  {
    const p = [];
    const sc = t.display.exportScale;
    if (exp.width !== W * sc || exp.height !== H * sc) p.push(`the export is ${exp.width}x${exp.height}; ${sc}x of the ${W}x${H} frame is ${W * sc}x${H * sc}`);
    results('export', p, `${exp.width}x${exp.height} (${sc}x of the ${W}x${H} frame)`);
  }

  // ---- alt text
  if (alt?.text) {
    const steps = marks.filter(x => x.role === 'marker').map(x => /^Step (\d+): (.+)$/.exec(x.n.name)).filter(Boolean).map(r => ({ n: Number(r[1]), label: r[2] })).sort((a, b) => a.n - b.n);
    const r = checkAltAgainstSteps(alt.text, steps, alt.subject || '');
    if (r.status === 'fail') add('alt-text', 'fail', r.reasons.join('; '));
    else if (r.status === 'review') { add('alt-text', 'review', r.reasons.join('; ')); review('alt-text', r.reasons.join('; ')); }
    else add('alt-text', 'pass', 'alt text names every step in order and describes the interface');
  } else add('alt-text', 'skipped', 'no alt text was given (--alt-text or an inventory record)');
  review('alt-task', 'Read the alt text against the export: it should say what the screen is and what the reader does there, not only name the marked areas.');
  review('render-fidelity', 'Open the export. This repository checks geometry, tokens, and pixels it can measure; it does not render the Figma file or compare outside the marks.');

  return finish();

  function finish() {
    const failed = checks.filter(c => c.status === 'fail');
    return {
      status: failed.length ? 'fail' : 'pass',
      checks,
      humanReview: [...human].map(([hid, reason]) => ({ id: hid, reason })),
      summary: { failed: failed.map(c => c.id), passed: checks.filter(c => c.status === 'pass').map(c => c.id), reviewed: checks.filter(c => c.status === 'review').map(c => c.id), skipped: checks.filter(c => c.status === 'skipped').map(c => c.id), tokens: tokensIdentity(t) },
    };
  }
}

export { decodePng };

// ---------------------------------------------------------------- run folders and the handoff gate

export const RECORD_FILE = 'annotation-record.json';

/** The clean capture PNG for a shot of a run: { file, buf, sha256, width, height } or throws. */
export function cleanCapture(runDir, report, slug) {
  const row = (report.results || []).find(r => r.slug === slug && r.side === 'next');
  if (!row || !row.ok || !row.file) throw new Error(`"${slug}" has no captured PNG in this run's capture-report.json`);
  const local = join(runDir, basename(row.file));
  const file = existsSync(local) ? local : row.file;
  if (!existsSync(file)) throw new Error(`the clean capture ${file} is missing`);
  const buf = readFileSync(file);
  const png = decodePng(buf);
  return { file, buf, png, sha256: sha256(buf), width: png.w, height: png.h, row };
}

/**
 * Reasons a recorded frame can't be trusted for a handoff. Checks the record against the files on disk and
 * the current tokens: a re-capture, a replaced export, a rebuilt kit, or an unreviewed shot all show here.
 */
export function recordProblems(runDir, slug, f, report, tokens = loadTokens()) {
  const p = [];
  if (!f || typeof f !== 'object') return ['no annotation recorded'];
  if (f.status === 'pending-human-review') p.push('the checks passed but nobody has recorded the human review (re-run record-annotation.mjs with --human-reviewed "<name>")');
  else if (f.status !== 'complete') p.push(`status is ${f.status || 'missing'}, not complete`);
  if (!f.annotatedNodeId) p.push('no annotated frame node ID');
  if (!f.cleanNodeId) p.push('no clean frame node ID');
  if (f.cleanNodeId && f.cleanNodeId === f.annotatedNodeId) p.push('the annotated node ID is the clean frame');
  if (!f.verification || f.verification.status !== 'pass') p.push('the annotation was not machine-verified (record it with --manifest and --export)');
  const id = tokensIdentity(tokens);
  if (!f.tokens || f.tokens.hash !== id.hash) p.push(`recorded against token hash ${String(f.tokens?.hash || 'none').slice(0, 12)}, but the tokens are now ${id.hash.slice(0, 12)} (stale: re-verify)`);
  if (f.humanReview && !f.humanReview.confirmedBy) p.push('human review is not confirmed');
  try {
    const clean = cleanCapture(runDir, report, slug);
    if (!f.source || f.source.sha256 !== clean.sha256) p.push('the clean capture changed after this annotation was recorded (stale: re-annotate)');
  } catch (e) { p.push(e.message); }
  if (f.export) {
    const file = join(runDir, f.export.path || '');
    if (!f.export.path || !existsSync(file) || !statSync(file).isFile()) p.push(`the annotated export ${f.export.path || '(none)'} is missing`);
    else if (sha256(readFileSync(file)) !== f.export.sha256) p.push('the annotated export no longer matches its recorded checksum');
  } else p.push('no annotated export recorded');
  return p;
}

// ---------------------------------------------------------------- documentation

export const CHECK_DOCS = {
  'manifest-shape': 'The extracted manifest has the fields every other check reads.',
  'token-identity': "The Figma file's kit was built from this repository's token schema and hash, and its variables still hold the token values (a hand-edited variable fails).",
  'frame-mapping': 'The annotated frame is not the clean frame, is the size Figma draws the capture (the pixels of the PNG divided by its dpr), and shows the same image (same Figma image hash); frame names and the clean node ID match the inventory when one is given.',
  provenance: "The clean capture's checksum matches the inventory's clean asset, and the export is not the clean capture.",
  'kit-components': 'Every layer is an instance of an approved kit component built by the plugin from the current tokens, with a real variant, visible, and with no gradient or image paint. A hand-drawn shape fails.',
  'token-colors': 'Every fill, stroke, and text color is a token color.',
  typography: 'Text is Poppins Bold or Inter Regular; Aleo and other fonts fail. The Inter Bold fallback passes and is flagged for review.',
  targets: 'Every marker, outline, and arrow has a target (bounding box or selector); markers carry numerals 1 to N with no gaps, named "Step N: the element"; markers sit beside their target, outlines surround it, arrows reach it.',
  bounds: 'Every mark and its halo is inside the image; text is not truncated, clipped by its component, or (by estimate) overflowing its box; a Callout label is at most four words.',
  collisions: 'Markers and labels do not overlap each other or arrows. Outlines and highlights, grown by their halo, keep 3 px of clear space between their outer edges; a mark nested inside another clears its inner stroke edge by 3 px. A marker sits wholly inside a box or clear of its stroke, and does not straddle a background edge in the clean capture (opposite sides of a ring 4 to 14 export px outside the badge differ by more than 40 in median luma). Nothing covers a step target or keep-clear region; outlines are unfilled.',
  redaction: 'No Redact box (Solid or Blur) is in the frame. Each declared sensitive region is either declared as fake data, or pixelated, with padding, in both the export and the clean capture: uniform blocks of at least 7 CSS px (14 px at 2x). A flat color fails as a solid box; text, photos, and blur fail as unredacted.',
  contrast: 'Text meets WCAG AA (3:1 for large text); each mark reaches 3:1 against the screenshot beside it through its fill or its halo, measured from the clean capture.',
  grayscale: 'Each mark still reaches 3:1 after a grayscale conversion.',
  'background-variant': 'A tone sits only on screenshot regions it is approved for (Gold on dark; Purple on light, dark, or mixed).',
  'display-size': 'Text and strokes stay above the minimum size at the docs display width.',
  'color-independence': 'Do and Dont tones are paired with a check or cross marker; steps are carried by numerals, not color.',
  export: 'The export is the frame size times the export scale.',
  'alt-text': 'The alt text names every step in order and does not describe colored shapes; ambiguous text goes to a person.',
};

export const HUMAN_REVIEW_DOCS = {
  'redaction-complete': 'No personal, credential, or customer data remains outside the declared regions. Nothing can detect data nobody declared. Always required.',
  'redaction-declared': 'No sensitive regions were declared: confirm the shot shows none.',
  'redaction-fake-data': 'A region is declared as fake data: confirm the values shown are invented (for example "Anita Agency" or jordan.lee@example.com), not a real person\'s.',
  'target-geometry': 'A target has a selector but no bounding box, so its position was not checked.',
  'text-fit': "Text is close to its box width. The overflow check is an estimate, because Figma doesn't expose measured overflow.",
  'font-fallback': 'Labels use the Inter Bold fallback because Poppins was unavailable when the kit was built.',
  'alt-text': 'The alt text is ambiguous (generic step labels, a one-word subject, or annotation words).',
  'alt-task': 'The alt text says what the screen is and what the reader does there. Always required.',
  'render-fidelity': 'The export looks right. The repository measures geometry, tokens, and the pixels it can; it does not render the Figma file. Always required.',
};

/** The generated sections of docs/reference/annotation-kit.md, between the token markers. */
export function docBlock(t = loadTokens()) {
  const id = tokensIdentity(t);
  const r = n => (Math.round(n * 100) / 100).toFixed(2);
  const L = [];
  L.push('## Token contract', '',
    `The canonical contract is \`figma-plugin/annotation-tokens.json\`. Everything below is generated from it by \`npm run build:figma-plugin\`, and CI fails when this page is stale. Change a value there, run the build, rebuild the kit in Figma with the plugin, and re-annotate: the verifier rejects annotations made with an older kit.`, '',
    `- Schema version ${id.schemaVersion}.`,
    `- Identity hash (SHA-256 of the canonical JSON): \`${id.hash}\``,
    '- The plugin stamps this hash on the Figma file and on every kit component. The extraction reads it back, and `record-annotation.mjs` compares it with this repository.', '',
    '### Annotation components', '',
    ...Object.entries(t.taxonomy).map(([role, d]) => `- **${role}**: ${d.purpose} Components: ${d.components.map(c => `\`${c}\``).join(', ')}.`), '',
    'Use only these. Placing a hand-drawn shape, an unlisted component, or a component from another kit fails `kit-components`.', '',
    '### Colors', '',
    ...['primary', 'secondary', 'gray'].map(g => `- ${g[0].toUpperCase() + g.slice(1)}: ${Object.entries(t.brand).filter(([, b]) => b.group === g).map(([k, b]) => `${k} \`${b.hex}\``).join(', ')}.`), '',
    ...Object.entries(t.roles).map(([k, d]) => `- Role \`${k}\` is ${d.color} \`${t.brand[d.color].hex}\`. ${d.note}`), '',
    '### Tones and contrast', '',
    ...Object.entries(t.tones).map(([name, d]) => { const c = toneColors(t, name); return `- **${name}**: ${c.text} text on ${c.fill} is ${r(contrast(c.text, c.fill))}:1; mark against halo ${r(contrast(c.fill, c.halo))}:1; for ${d.backgrounds.join(' and ')} screenshot regions${d.requiresShapeMarker ? `; needs a ${d.requiresShapeMarker === 'Do' ? 'check' : 'cross'} marker` : ''}.`; }), '',
    `Rules: text ${t.contrast.textNormal}:1, or ${t.contrast.textLarge}:1 for large text (${t.contrast.largeTextMinPx} px, or ${t.contrast.largeTextMinPxBold} px bold). A mark reaches ${t.contrast.graphicalObject}:1 against the screenshot beside it through its fill or, failing that, its halo (which must itself reach ${t.contrast.markVersusHalo}:1 against the fill). Light regions are those whose mean luminance is at least ${t.backgroundVariants.classify.lightMinLuminance}. ${t.logo.policy} ${t.forbidden.note}`, '',
    '### Typography', '',
    `- Labels and headings: ${t.typography.label.family} ${t.typography.label.style}. Body text: ${t.typography.body.family} ${t.typography.body.style}. Not allowed: ${t.typography.disallowed.join(', ')}.`,
    `- Fallback: ${t.typography.fallbackBehavior}`, '',
    '### Strokes, spacing, and size', '',
    `- Strokes are authored for a ${t.metrics.referenceFrameWidth} px wide frame: ${t.metrics.strokePx} px mark stroke, ${t.metrics.haloStrokePx} px halo stroke, ${t.metrics.haloOutlinePx} px halo outline. ${t.metrics.strokeRule}`,
    `- Strokes and arrowheads: ${t.styles.arrow.strokeCap.toLowerCase()} caps and ${t.styles.arrow.strokeJoin.toLowerCase()} joins; ${t.styles.arrow.head}`,
    `- Badges: ${Object.entries(t.metrics.badgePx).map(([k, v]) => `${k} ${v} px`).join(', ')}. Label padding ${t.metrics.labelPaddingPx.x} by ${t.metrics.labelPaddingPx.y} px; corner radius ${t.metrics.cornerRadiusPx.label} px (labels) and ${t.metrics.cornerRadiusPx.highlight} px (outlines).`,
    `- Minimum rendered size at the ${t.display.docsColumnWidthPx} px docs width: ${t.display.minRenderedTextPx.label} px label text, ${t.display.minRenderedTextPx.numeral} px numerals, ${t.display.minRenderedTextPx.body} px body text, ${t.display.minRenderedStrokePx} px strokes. ${t.display.note} Export at ${t.display.exportScale}x.`,
    `- A Callout label holds at most ${t.styles.label.maxWords} words. ${t.styles.label.longText}`,
    `- Spacing between marks: ${t.styles.outline.nesting.replace('metrics.outlineGapPx', `${t.metrics.outlineGapPx} px`)} ${t.styles.marker.edgeRing.note.replace('edgeLuma', String(t.styles.marker.edgeRing.edgeLuma)).replace('skipDistance', String(t.styles.marker.edgeRing.skipDistance))} The ring runs ${t.styles.marker.edgeRing.innerPx} to ${t.styles.marker.edgeRing.outerPx} ${t.styles.marker.edgeRing.unit}.`,
    `- Personal data: ${t.styles.redaction.note} Methods: ${t.styles.redaction.methods.map(x => `\`${x}\``).join(' (preferred) or ')}. Pixelate at the ${t.styles.redaction.pixelate.stage} stage in blocks of at least ${t.styles.redaction.pixelate.minBlockCssPx} CSS px (${t.styles.redaction.pixelate.minBlockCssPx * t.display.exportScale} px at ${t.display.exportScale}x), with ${t.styles.redaction.minPaddingPx} px of padding around the declared region. ${t.styles.redaction.pixelate.resample} Retired components: ${t.styles.redaction.retiredComponents.map(c => `\`${c}\``).join(', ')}. Kinds: ${t.styles.redaction.kinds.join(', ')}.`, '',
    '### Variables', '',
    `Collection **Annotation**, created by the plugin from the tokens. Color variables alias the \`brand/*\` primitives in the **Annotation primitives** collection.`, '',
    ...t.figmaVariables.collections.find(c => c.name === 'Annotation').vars.map(v => `- \`${v.name}\`: ${v.type === 'COLOR' ? `${t.roles[v.role].color} ${roleHex(t, v.role)}` : (v.metric ? metric(t, v.metric) : v.value)}`), '',
    '### What the verifier checks', '',
    ...Object.entries(CHECK_DOCS).map(([k, v]) => `- \`${k}\`: ${v}`), '',
    '### What a person still reviews', '',
    ...Object.entries(HUMAN_REVIEW_DOCS).map(([k, v]) => `- \`${k}\`: ${v}`), '');
  return L.join('\n');
}

export const DOC_FILE = join(TOOL_DIR, 'docs', 'reference', 'annotation-kit.md');
export const DOC_BEGIN = '<!-- tokens:begin (generated by npm run build:figma-plugin; do not edit) -->';
export const DOC_END = '<!-- tokens:end -->';

/** The doc with its generated block replaced. Throws if the markers are missing. */
export function withDocBlock(doc, block) {
  const a = doc.indexOf(DOC_BEGIN), b = doc.indexOf(DOC_END);
  if (a < 0 || b < a) throw new Error(`${DOC_FILE} needs ${DOC_BEGIN} and ${DOC_END} markers`);
  return doc.slice(0, a + DOC_BEGIN.length) + '\n\n' + block + '\n' + doc.slice(b);
}
