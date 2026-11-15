#!/usr/bin/env node
/**
 * Tests for the branded annotation system: the token contract, the kit's agreement with it, the Figma
 * extraction (against a mock of the Plugin API), the verifier on representative fixtures with snapshots, a
 * matrix of invalid annotations, alt text, the clean/annotated separation in the inventory, and the
 * record-annotation and handoff commands end to end. No Figma, Chrome, or network.
 *
 * UPDATE_SNAPSHOTS=1 rewrites tests/fixtures/annotation/snapshots/*.json after an intended change.
 * Prints PASS/FAIL lines in the format tests/run-tests.sh counts.
 */

import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, existsSync, realpathSync, copyFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve, basename } from 'node:path';
import { spawnSync } from 'node:child_process';
import { extractCode } from '../scripts/figma-annotation.mjs';
import { validateInventory } from '../scripts/lib/inventory.mjs';
import {
  loadTokens, tokensIdentity, canonicalJson, contrast, coverage, toneColors, metric, figmaVariables, expectedVariableValues,
  roleOfComponent, kitDefs, verifyAnnotation, docBlock, withDocBlock, CHECK_DOCS, HUMAN_REVIEW_DOCS, checkAltAgainstSteps, manifestShapeErrors, displayScale, isLargeText, estimateTextWidth,
  pixelation, decodePng, grow,
} from '../scripts/lib/annotation.mjs';
import { T, fixtures, inputFor, snapshotOf, PASSING, doDont, dim, badge, outline, redact, Canvas, TOKENS_HASH, sha, cleanCanvas, exportCanvas, manifestFor } from './lib/annotation-fixtures.mjs';

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), '..');
const TMP = realpathSync(mkdtempSync(join(tmpdir(), 'annotation-test-')));
process.on('exit', () => rmSync(TMP, { recursive: true, force: true }));
const SNAP_DIR = join(ROOT, 'tests/fixtures/annotation/snapshots');
const kitJson = JSON.parse(readFileSync(join(ROOT, 'figma-plugin/kit.json'), 'utf-8'));
const F = fixtures();

let passed = 0, failed = 0;
const test = async (name, fn) => {
  try { await fn(); console.log(`PASS  ${name}`); passed += 1; }
  catch (e) { console.log(`FAIL  ${name}`); console.log('        ' + String(e.message || e).split('\n').slice(0, 8).join('\n        ')); failed += 1; }
};
const failedIds = r => r.checks.filter(c => c.status === 'fail').map(c => c.id);
const verify = (name, opts) => verifyAnnotation(inputFor(F[name], opts));
const clone = o => JSON.parse(JSON.stringify(o));
const node = (m, re) => m.nodes.find(n => re.test(n.name));

// =================================================================== token contract

await test('the token file has the 2026 brand palette (guidelines v4.0 pp. 33-34), with the right group for each color', () => {
  const want = { ink: '#000000', paper: '#FFFFFF', yellow: '#FFCA28', whiteSmoke: '#F3F3F3', travertine: '#EBE6DC', marble: '#8E9094', shadow: '#1A1A1A', brick: '#C95A3D', sky: '#B8C9D6' };
  assert.deepEqual(Object.keys(T.brand).sort(), Object.keys(want).sort(), 'no color outside the named palette');
  for (const [k, hex] of Object.entries(want)) assert.equal(T.brand[k].hex, hex, k);
  for (const k of ['ink', 'paper', 'yellow', 'whiteSmoke']) assert.equal(T.brand[k].group, 'primary');
  for (const k of ['travertine', 'marble', 'shadow', 'brick', 'sky']) assert.equal(T.brand[k].group, 'secondary');
  for (const old of ['purple', 'midPurple', 'lightPurple', 'pink', 'green', 'blue', 'white', 'black']) assert.equal(T.brand[old], undefined, `${old} is not a 2026 brand color`);
  assert.equal(T.schemaVersion, 1);
});

await test('every role, tone, and variable points at something that exists', () => {
  for (const [r, d] of Object.entries(T.roles)) assert.ok(T.brand[d.color], `role ${r}`);
  for (const [n, d] of Object.entries(T.tones)) for (const k of ['fill', 'text', 'halo']) assert.ok(T.roles[d[k]], `${n}.${k}`);
  for (const col of T.figmaVariables.collections) for (const v of col.vars) {
    if (v.brand) assert.ok(T.brand[v.brand], v.name);
    if (v.role) assert.ok(T.roles[v.role], v.name);
    if (v.metric) assert.notEqual(metric(T, v.metric), undefined, `${v.name} metric ${v.metric}`);
  }
});

await test('the identity is a stable hash that changes with any token value, and ignores key order', () => {
  const a = tokensIdentity(T), b = tokensIdentity(clone(T));
  assert.equal(a.hash, b.hash);
  assert.match(a.hash, /^[0-9a-f]{64}$/);
  const edited = clone(T); edited.brand.yellow.hex = '#FFCA29';
  assert.notEqual(tokensIdentity(edited).hash, a.hash);
  const reordered = Object.fromEntries(Object.entries(clone(T)).reverse());
  assert.equal(canonicalJson(reordered), canonicalJson(T));
});

await test('every tone meets WCAG AA for its text, and Yellow never takes white type', () => {
  const sizes = new Map();
  const walk = (n, tone) => {
    const m = /Tone=(\w+)/.exec(n.n || ''); const t = m ? m[1] : tone;
    if (n.k === 'TEXT') { const k = t || '-'; sizes.set(k, Math.min(sizes.get(k) ?? 1e9, n.tx[3])); }
    for (const c of n.ch || []) walk(c, t);
  };
  for (const c of kitJson.components) walk(c, null);
  for (const tone of Object.keys(T.tones)) {
    const c = toneColors(T, tone), ratio = contrast(c.text, c.fill);
    const minText = sizes.get(tone);
    if (minText === undefined) continue;
    assert.ok(ratio >= T.contrast.textLarge, `${tone} ${ratio.toFixed(2)}:1`);
    if (ratio < T.contrast.textNormal) assert.ok(isLargeText(T, minText, true), `${tone} is ${ratio.toFixed(2)}:1, so its text must be large bold; the smallest is ${minText}px`);
    assert.ok(!(c.fill === T.brand.yellow.hex && c.text === T.brand.paper.hex), `${tone} sets white type on Yellow`);
    assert.ok(contrast(c.fill, c.halo) >= T.contrast.markVersusHalo || T.tones[tone].backgrounds.length === 1, `${tone} mark against its halo`);
  }
  assert.equal(T.roles.mark.color, 'ink', 'Ink leads');
  assert.equal(T.roles.onYellow.color, 'ink', 'text on Yellow is Ink, never white');
  for (const [r, d] of Object.entries(T.roles)) assert.ok(!['brick', 'sky'].includes(d.color), `role ${r} uses a reserved color (one accent per artifact, never beside Yellow)`);
  assert.equal(T.tones.Yellow.halo, 'haloInk', 'Yellow sits in an Ink halo: Yellow alone is 1.5:1 on white');
});

await test('Do and Dont differ in fill (Ink vs Paper) and still carry a check or cross, so meaning never rides on color alone', () => {
  assert.notEqual(toneColors(T, 'Do').fill, toneColors(T, 'Dont').fill);
  assert.equal(T.tones.Do.requiresShapeMarker, 'Do');
  assert.equal(T.tones.Dont.requiresShapeMarker, 'Dont');
});

await test('typography: Inter Semi Bold for labels, Inter Regular for body, Poppins and Aleo disallowed, no fallback', () => {
  assert.deepEqual([T.typography.label.family, T.typography.label.style], ['Inter', 'Semi Bold']);
  assert.deepEqual([T.typography.body.family, T.typography.body.style], ['Inter', 'Regular']);
  assert.deepEqual(T.typography.disallowed, ['Poppins', 'Aleo']);
  assert.equal(T.typography.label.fallback, undefined, 'Inter loads in every Figma file');
});

await test('stroke scales with the frame: it stays at 2 px or more at the docs width, and the minimum text size holds for the kit', () => {
  assert.equal(displayScale(T, 1440).toFixed(4), (800 / 1440).toFixed(4));
  assert.equal(displayScale(T, 390), 1);
  assert.ok(metric(T, 'strokePx') * displayScale(T, T.metrics.referenceFrameWidth) >= T.display.minRenderedStrokePx);
  assert.ok(metric(T, 'strokePx') * displayScale(T, 4000) < T.display.minRenderedStrokePx, 'a 4000 px frame needs a thicker stroke');
});

// =================================================================== kit and tokens agree

await test('every variable the kit uses is defined by the tokens, and every kit component has exactly one taxonomy role', () => {
  const defined = new Set(T.figmaVariables.collections.flatMap(c => c.vars.map(v => v.name)));
  const used = new Set();
  const walk = n => { for (const k of ['f', 's']) for (const p of n[k] || []) if (p.v) used.add(p.v); for (const v of Object.values(n.b || {})) used.add(v); for (const c of n.ch || []) walk(c); };
  kitJson.components.forEach(walk);
  for (const v of used) assert.ok(defined.has(v), `kit uses ${v}, which the tokens do not define`);
  for (const c of kitJson.components) assert.ok(roleOfComponent(T, c.n), `${c.n} has no taxonomy role`);
  const listed = Object.values(T.taxonomy).flatMap(d => d.components);
  assert.deepEqual([...listed].sort(), kitJson.components.map(c => c.n).sort(), 'the taxonomy lists exactly the kit components, each once');
  assert.deepEqual(Object.keys(T.taxonomy).sort(), ['arrow', 'highlight', 'label', 'marker', 'outline']);
  for (const c of T.styles.redaction.retiredComponents) assert.ok(!kitJson.components.some(k => k.n === c), `the retired ${c} component is still in the kit`);
  assert.equal(kitJson.variables, undefined, 'kit.json holds components only; variables come from the tokens');
});

await test('the kit has no gradients or images, uses only brand fonts, and squares its strokes', () => {
  const fonts = new Set(); const bad = [];
  const walk = n => {
    for (const k of ['f', 's']) for (const p of n[k] || []) if (p.t !== 'SOLID') bad.push(`${n.n}: ${p.t}`);
    if (n.k === 'TEXT') fonts.add(`${n.tx[1]} ${n.tx[2]}`);
    if (n.cap) assert.notEqual(n.cap, 'ROUND', `${n.n} has a round cap`);
    if (n.join) assert.equal(n.join, 'MITER', `${n.n} join`);
    for (const v of n.net?.vertices || []) { assert.notEqual(v.strokeCap, 'ROUND', n.n); assert.notEqual(v.strokeJoin, 'ROUND', n.n); }
    for (const c of n.ch || []) walk(c);
  };
  kitJson.components.forEach(walk);
  assert.deepEqual(bad, []);
  assert.deepEqual([...fonts].sort(), ['Inter Regular', 'Inter Semi Bold']);
});

await test('the kit text is large enough at the docs display width', () => {
  const scale = displayScale(T, T.metrics.referenceFrameWidth);
  const walk = (n, top) => {
    if (n.k === 'TEXT') {
      const need = top === 'Step badge' ? T.display.minRenderedTextPx.numeral : n.tx[2] === 'Regular' ? T.display.minRenderedTextPx.body : T.display.minRenderedTextPx.label;
      assert.ok(n.tx[3] * scale >= need - 1e-9, `${top}: ${n.tx[3]}px renders at ${(n.tx[3] * scale).toFixed(1)}px, below ${need}`);
    }
    for (const c of n.ch || []) walk(c, top);
  };
  for (const c of kitJson.components) walk(c, c.n);
});

await test('tone variants in the kit are tones the tokens define', () => {
  for (const c of kitJson.components) for (const [k, d] of Object.entries(c.defs || {})) if (k === 'Tone') for (const o of d.variantOptions) assert.ok(T.tones[o] || ['Light'].includes(o), `${c.n} Tone=${o}`);
});

await test('the built plugin embeds the token hash, the brand colors, and the label font; and is current', () => {
  const r = spawnSync(process.execPath, [join(ROOT, 'scripts/build-figma-plugin.mjs'), '--check'], { encoding: 'utf-8' });
  assert.equal(r.status, 0, r.stderr);
  const code = readFileSync(join(ROOT, 'figma-plugin/code.js'), 'utf-8');
  assert.ok(code.includes(TOKENS_HASH), 'code.js carries the token hash');
  assert.ok(code.includes('setSharedPluginData(\'s2d\', \'kit\''), 'components are stamped');
  assert.ok(!code.includes('7952A8') && !/0\.4745098/.test(code), 'the old design-system purple is gone');
  assert.ok(!/"family":"Poppins"/.test(code) && code.includes('"label":{"family":"Inter","style":"Semi Bold"}'), 'labels are Inter Semi Bold');
  const vars = figmaVariables(T).find(c => c.name === 'Annotation').vars;
  assert.equal(vars.length, T.figmaVariables.collections[1].vars.length);
  const mark = vars.find(v => v.name === 'color/mark');
  assert.equal(mark.values.Value.alias, 'brand/ink');
});

await test('the reference doc shows the current token schema, hash, and every variable', () => {
  const doc = readFileSync(join(ROOT, 'docs/reference/annotation-kit.md'), 'utf-8');
  assert.ok(doc.includes(TOKENS_HASH), 'docs/reference/annotation-kit.md must show the current token hash (update it when the tokens change)');
  assert.ok(doc.includes(`Schema version ${T.schemaVersion}.`));
  for (const name of Object.keys(expectedVariableValues(T))) assert.ok(doc.includes('`' + name + '`'), `${name} missing from the doc`);
  for (const h of Object.values(T.brand).map(b => b.hex)) assert.ok(doc.toUpperCase().includes(h.toUpperCase()), `${h} missing from the doc`);
});

await test('the manifest and plugin carry the repository name, not a stale one', () => {
  const m = JSON.parse(readFileSync(join(ROOT, 'figma-plugin/manifest.json'), 'utf-8'));
  assert.equal(m.id, 'screenshots-to-docs-annotation-kit');
  assert.ok(!/p1-/i.test(m.id) && !/p1-editor-screenshots/.test(readFileSync(join(ROOT, 'scripts/record-annotation.mjs'), 'utf-8') + readFileSync(join(ROOT, 'scripts/handoff.mjs'), 'utf-8')));
});

await test('the generated doc sections go stale when a token changes, and every check and review item is documented', () => {
  const doc = readFileSync(join(ROOT, 'docs/reference/annotation-kit.md'), 'utf-8');
  assert.equal(withDocBlock(doc, docBlock(T)), doc, 'the doc is current');
  const edited = clone(T); edited.brand.yellow.hex = '#FFCA29';
  assert.notEqual(withDocBlock(doc, docBlock(edited)), doc, 'a changed token changes the doc');
  assert.throws(() => withDocBlock('no markers here', 'x'), /markers/);
  const ids = new Set(), human = new Set();
  for (const name of Object.keys(F)) { const r = verify(name); r.checks.forEach(c => ids.add(c.id)); r.humanReview.forEach(h => human.add(h.id)); }
  for (const id of ids) assert.ok(CHECK_DOCS[id], `check ${id} is not documented`);
  for (const id of human) assert.ok(HUMAN_REVIEW_DOCS[id], `review item ${id} is not documented`);
  for (const id of Object.keys(CHECK_DOCS)) assert.ok(doc.includes('`' + id + '`'), `${id} missing from the page`);
});

await test('validate-skill fails when SKILL.md drops an approved component, the review rule, or the human-review step', () => {
  const run = (mutate) => {
    const dir = join(TMP, `skill-${Math.random().toString(36).slice(2)}`, 'screenshots-to-docs'); mkdirSync(dir, { recursive: true });
    for (const d of ['references', 'scripts', 'templates', 'examples', 'briefs', 'tests', 'docs']) symlinkSync(join(ROOT, d), join(dir, d));
    writeFileSync(join(dir, 'SKILL.md'), mutate(readFileSync(join(ROOT, 'SKILL.md'), 'utf-8')));
    return spawnSync(process.execPath, [join(ROOT, 'scripts/validate-skill.mjs'), dir], { encoding: 'utf-8' });
  };
  assert.equal(run(x => x).status, 0, 'the real SKILL.md passes');
  assert.match(run(x => x.replaceAll('`Dim overlay`', 'the dim thing')).stderr, /approved component `Dim overlay`/);
  assert.match(run(x => x.replace('Annotation is mandatory for review', 'Annotation is optional')).stderr, /mandatory/);
  assert.match(run(x => x.replaceAll('--human-reviewed', '--reviewed')).stderr, /human-review confirmation/);
  assert.match(run(x => x + '\nSee p1-editor-screenshots.\n').stderr, /stale name/);
});

// =================================================================== geometry and color helpers

await test('contrast, grayscale, coverage, and the text estimate behave', () => {
  assert.equal(contrast('#000000', '#FFFFFF').toFixed(1), '21.0');
  assert.ok(Math.abs(contrast(T.brand.ink.hex, T.brand.yellow.hex) - 13.7) < 0.1);
  assert.ok(Math.abs(contrast(T.brand.paper.hex, T.brand.yellow.hex) - 1.5) < 0.1, 'white on Yellow is 1.5:1, which is why the brand bans it');
  assert.equal(coverage([0, 0, 10, 10], [[0, 0, 10, 5], [0, 5, 10, 5]]), 1);
  assert.equal(coverage([0, 0, 10, 10], [[0, 0, 10, 5]]), 0.5);
  assert.equal(coverage([0, 0, 10, 10], [[20, 20, 5, 5]]), 0);
  assert.equal(coverage([0, 0, 10, 10], [[0, 0, 6, 10], [4, 0, 6, 10]]), 1, 'overlapping rects are not double counted');
  assert.ok(estimateTextWidth('Blocks panel', 28, 'Inter', 'Semi Bold') > estimateTextWidth('Blocks panel', 28, 'Inter', 'Regular'));
});

// =================================================================== extraction against a mock Plugin API

function mockFigma(f, manifest) {
  const origin = { x: 5000, y: 3000 };
  const hexRgb = hex => ({ r: parseInt(hex.slice(1, 3), 16) / 255, g: parseInt(hex.slice(3, 5), 16) / 255, b: parseInt(hex.slice(5, 7), 16) / 255 });
  const paint = p => (p.type === 'IMAGE' ? { type: 'IMAGE', imageHash: p.imageHash, visible: true } : { type: 'SOLID', color: hexRgb(p.hex), opacity: p.opacity, visible: true });
  const box = (b, o = origin) => ({ x: o.x + b[0], y: o.y + b[1], width: b[2], height: b[3] });
  const walkAll = n => (n.children || []).flatMap(c => [c, ...walkAll(c)]);
  const mk = props => { const n = { children: [], getSharedPluginData: () => '', ...props }; n.findAll = fn => walkAll(n).filter(fn); n.findOne = fn => walkAll(n).find(fn) || null; return n; };

  const shotNode = manifest.nodes.find(n => n.name === 'screenshot');
  const frame = mk({ id: '87:2', name: manifest.annotatedFrame.name, type: 'FRAME', width: f.w, height: f.h, clipsContent: true, absoluteBoundingBox: box([0, 0, f.w, f.h]), getSharedPluginData: (ns, k) => (k === 'sensitive' ? JSON.stringify(manifest.sensitive) : k === 'keepClear' ? JSON.stringify(manifest.keepClear) : '') });
  const rect = mk({ id: '90:1', name: 'screenshot', type: 'RECTANGLE', width: f.w, height: f.h, absoluteBoundingBox: box(shotNode.bbox), fills: shotNode.fills.map(paint), strokes: [], parent: frame });
  frame.children.push(rect);
  for (const n of manifest.nodes.filter(x => x.name !== 'screenshot')) {
    const stamp = n.component.kitStamp;
    const set = { type: 'COMPONENT_SET', name: n.component.set, getSharedPluginData: (ns, k) => (k === 'kit' ? stamp : '') };
    const main = { name: n.component.name, remote: false, parent: set, getSharedPluginData: () => '' };
    const inst = mk({ id: n.id, name: n.name, type: 'INSTANCE', visible: true, opacity: 1, rotation: 0, absoluteBoundingBox: box(n.bbox), fills: (n.fills || []).map(paint), strokes: [], variantProperties: n.component.variant, parent: frame, getMainComponentAsync: async () => main, getSharedPluginData: (ns, k) => (k === 'target' && n.target ? JSON.stringify(n.target) : '') });
    for (const t of n.texts || []) inst.children.push(mk({ type: 'TEXT', name: 'text', characters: t.characters, fontName: { family: t.family, style: t.style }, fontSize: t.size, textAutoResize: t.autoResize, textTruncation: t.truncation, fills: [{ type: 'SOLID', color: hexRgb(t.fillHex), opacity: 1, visible: true }], absoluteBoundingBox: box(t.bbox), parent: inst }));
    if (n.strokeMax === undefined) inst.strokes = (n.strokes || []).map(paint);
    else {
      inst.children.push(mk({ type: 'VECTOR', name: 'halo', fills: [], strokes: [paint(n.strokes[1] || n.strokes[0])], strokeWeight: 12, parent: inst, absoluteBoundingBox: box(n.bbox) }));
      inst.children.push(mk({ type: 'VECTOR', name: 'mark', fills: [], strokes: [paint(n.strokes[0])], strokeWeight: n.strokeMax ?? 0, parent: inst, absoluteBoundingBox: box(n.bbox) }));
    }
    frame.children.push(inst);
  }
  const cleanRect = mk({ id: '84:14', name: 'shot|next', type: 'RECTANGLE', width: f.w, height: f.h, absoluteBoundingBox: box([0, 0, f.w, f.h], { x: 0, y: 0 }), fills: [paint({ type: 'IMAGE', imageHash: manifest.cleanFrame.screenshot.imageHash })] });
  const clean = mk({ id: '84:13', name: manifest.cleanFrame.name, type: 'FRAME', width: f.w + 80, height: f.h + 120, absoluteBoundingBox: box([0, 0, f.w + 80, f.h + 120], { x: 0, y: 0 }) });
  clean.children.push(cleanRect); cleanRect.parent = clean;
  const values = expectedVariableValues(T);
  const vars = Object.entries(values).map(([name, v], i) => ({ id: `V:${i}`, name, valuesByMode: { m1: typeof v === 'string' ? hexRgb(v) : v } }));
  // One variable is an alias, as in a file the plugin built: color/mark -> brand/ink.
  const purple = { id: 'V:brand', name: 'brand/ink', valuesByMode: { m1: hexRgb(T.brand.ink.hex) } };
  vars.find(v => v.name === 'color/mark').valuesByMode.m1 = { type: 'VARIABLE_ALIAS', id: 'V:brand' };
  const all = [...vars, purple];
  const rootData = { tokensHash: manifest.tokens.hash, tokensSchema: String(manifest.tokens.schemaVersion) };
  return {
    mixed: Symbol('mixed'),
    fileKey: 'FxFxFxFxFxFxFxFxFxFxFx',
    root: { getSharedPluginData: (ns, k) => rootData[k] || '' },
    async getNodeByIdAsync(id) { return { '84:13': clean, '87:2': frame }[id] || null; },
    variables: { async getLocalVariableCollectionsAsync() { return [{ name: 'Annotation', defaultModeId: 'm1', variableIds: vars.map(v => v.id) }]; }, async getVariableByIdAsync(id) { return all.find(v => v.id === id); } },
  };
}

const runExtract = async (f, manifest) => {
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  return new AsyncFunction('figma', extractCode({ cleanNodeId: '84:13', annotatedNodeId: '87:2' }))(mockFigma(f, manifest));
};

await test('the extraction code reads a Figma frame into a manifest the verifier accepts (mock Plugin API)', async () => {
  const f = F['multi-annotation'];
  const input = inputFor(f);
  const extracted = await runExtract(f, input.manifest);
  assert.deepEqual(manifestShapeErrors(extracted), []);
  assert.equal(extracted.tokens.hash, TOKENS_HASH);
  assert.equal(extracted.kitVariables['color/mark'], T.brand.ink.hex, 'an aliased variable resolves to its value');
  assert.equal(extracted.cleanFrame.screenshot.imageHash, extracted.annotatedFrame.screenshot.imageHash);
  const badge1 = extracted.nodes.find(n => n.name.startsWith('Step 1'));
  assert.equal(badge1.component.set, 'Step badge');
  assert.equal(badge1.component.kitStamp, TOKENS_HASH);
  assert.equal(badge1.texts[0].family, 'Inter');
  assert.equal(badge1.texts[0].style, 'Semi Bold');
  assert.equal(badge1.texts[0].surfaceHex, T.brand.ink.hex);
  assert.deepEqual(badge1.bbox, input.manifest.nodes.find(n => n.name.startsWith('Step 1')).bbox);
  const hl = extracted.nodes.find(n => n.component?.set === 'Highlight box');
  assert.equal(hl.strokeMax, 6, 'the halo stroke is not counted as the mark stroke');
  assert.ok(hl.target.bbox);
  const result = verifyAnnotation({ ...input, manifest: extracted });
  assert.equal(result.status, 'pass', JSON.stringify(result.checks.filter(c => c.status === 'fail')));
});

await test('extraction of a frame with a hand-drawn rectangle is rejected by the verifier', async () => {
  const f = F['light-ui'];
  const manifest = inputFor(f).manifest;
  const extracted = await runExtract(f, manifest);
  extracted.nodes.push({ id: '99:9', name: 'Rectangle 4', type: 'RECTANGLE', bbox: [10, 10, 50, 50], visible: true, opacity: 1, fills: [{ type: 'SOLID', hex: '#FF0000', opacity: 1 }] });
  assert.ok(failedIds(verifyAnnotation({ ...inputFor(f), manifest: extracted })).includes('kit-components'));
});

await test('the extraction code refuses a malformed node ID', () => {
  assert.throws(() => extractCode({ cleanNodeId: 'abc', annotatedNodeId: '87:2' }), /not a Figma node ID/);
});

// =================================================================== fixtures and snapshots

for (const name of PASSING) {
  await test(`fixture ${name}: verifies, lists what a person must review, and matches its snapshot`, () => {
    const input = inputFor(F[name]);
    const r = verifyAnnotation(input);
    assert.equal(r.status, 'pass', JSON.stringify(r.checks.filter(c => c.status === 'fail')));
    assert.ok(r.humanReview.some(h => h.id === 'redaction-complete'), 'redaction completeness always needs a person');
    assert.ok(r.humanReview.some(h => h.id === 'render-fidelity'));
    const snap = snapshotOf(F[name], r, input);
    const file = join(SNAP_DIR, `${name}.json`);
    if (process.env.UPDATE_SNAPSHOTS) { mkdirSync(SNAP_DIR, { recursive: true }); writeFileSync(file, JSON.stringify(snap, null, 2) + '\n'); }
    assert.ok(existsSync(file), `no snapshot at ${file}; run UPDATE_SNAPSHOTS=1 node tests/annotation-tests.mjs`);
    assert.deepEqual(snap, JSON.parse(readFileSync(file, 'utf-8')), 'geometry, style, check results, or pixels changed; if intended, regenerate with UPDATE_SNAPSHOTS=1');
  });
}

await test('the fixtures cover light, dark, dense, narrow, long-label, multi, redacted, edge, and mixed cases', () => {
  assert.deepEqual(Object.keys(F).sort(), [...PASSING, 'long-label'].sort());
  assert.ok(F['dense-dashboard'].marks.filter(m => m.role === 'marker').length >= 6);
  assert.equal(F['narrow-mobile'].w, 390);
  assert.ok(F['redacted-pii'].sensitive.length >= 3);
  assert.ok(F['mixed-backgrounds'].regions.some(r => r[4] === '#23232D') && F['mixed-backgrounds'].bg === '#FFFFFF');
});

await test('the dark fixture uses a Yellow focal mark and the light one never does', () => {
  assert.ok(F['dark-ui'].marks.some(m => m.node.component.variant.Tone === 'Yellow'));
  assert.ok(!F['light-ui'].marks.some(m => m.node.component.variant.Tone === 'Yellow'));
});

await test('Ink marks pass on light, dark, and mixed regions; the checks recorded which they were', () => {
  for (const n of ['light-ui', 'dark-ui', 'mixed-backgrounds']) assert.equal(verify(n).status, 'pass', n);
});

await test('a dpr-2 capture: the Figma frame is half the PNG, marks are sampled at PNG scale, and a wrong dpr is rejected', () => {
  const f = { ...F['light-ui'], dpr: 2 };
  const ok = verifyAnnotation(inputFor(f));
  assert.equal(ok.status, 'pass', JSON.stringify(ok.checks.filter(c => c.status === 'fail')));
  assert.equal(inputFor(f).clean.width, 2880);
  const wrong = verifyAnnotation(inputFor(f, { mutate: (m, ctx) => { ctx.dpr = 1; } }));
  assert.ok(failedIds(wrong).includes('frame-mapping'));
  const dark = { ...F['dark-ui'], dpr: 2 };
  assert.equal(verifyAnnotation(inputFor(dark)).status, 'pass');
});

// =================================================================== invalid annotations are rejected

const reject = (name, base, mutate, expectIds, opts = {}) => test(`rejects: ${name}`, () => {
  const r = verifyAnnotation(inputFor(F[base], { mutate, ...opts }));
  assert.equal(r.status, 'fail', 'should fail');
  for (const id of expectIds) assert.ok(failedIds(r).includes(id), `${id} should fail; failed: ${failedIds(r).join(', ')}`);
});

await reject('a hand-drawn shape in place of a kit instance', 'light-ui', m => m.nodes.push({ id: '99:9', name: 'Rectangle 7', type: 'RECTANGLE', bbox: [400, 700, 80, 40], visible: true, opacity: 1, fills: [{ type: 'SOLID', hex: T.brand.ink.hex, opacity: 1 }] }), ['kit-components']);
await reject('an instance of a component the kit does not have', 'light-ui', m => { node(m, /^Label: Blocks/).component.set = 'Sticker'; }, ['kit-components']);
await reject('an instance with no kit stamp (not from the plugin)', 'light-ui', m => { node(m, /^Step 1/).component.kitStamp = null; }, ['kit-components']);
await reject('an instance from a kit built with other tokens', 'light-ui', m => { node(m, /^Step 1/).component.kitStamp = 'a'.repeat(64); }, ['kit-components']);
await reject('a variant the component does not have', 'light-ui', m => { node(m, /^Step 1/).component.variant.Tone = 'Rainbow'; }, ['kit-components']);
await reject('a hidden annotation', 'light-ui', m => { node(m, /^Step 2/).visible = false; }, ['kit-components']);
await reject('a gradient fill on a label', 'light-ui', m => { node(m, /^Label: Blocks/).fills = [{ type: 'GRADIENT_LINEAR' }]; }, ['kit-components']);
await reject('a color that is not a token color', 'light-ui', m => { node(m, /^Step 1/).fills = [{ type: 'SOLID', hex: '#FF3B30', opacity: 1 }]; }, ['token-colors']);
await reject('a stale token hash in the Figma file', 'light-ui', m => { m.tokens.hash = 'b'.repeat(64); }, ['token-identity']);
await reject('a stale token schema', 'light-ui', m => { m.tokens.schemaVersion = 0; }, ['token-identity']);
await reject('a kit variable edited by hand in Figma', 'light-ui', m => { m.kitVariables['color/mark'] = '#7952A8'; }, ['token-identity']);
await reject('a missing kit variable', 'light-ui', m => { delete m.kitVariables['size/stroke']; }, ['token-identity']);
await reject('a manifest with no kitVariables', 'light-ui', m => { delete m.kitVariables; }, ['token-identity']);
await reject('a font the contract disallows (Aleo)', 'light-ui', m => { node(m, /^Label: Blocks/).texts[0].family = 'Aleo'; }, ['typography']);
await reject('a font outside the contract', 'light-ui', m => { node(m, /^Label: Blocks/).texts[0].family = 'Comic Sans'; }, ['typography']);
await reject('a marker with no target', 'light-ui', m => { delete node(m, /^Step 1/).target; }, ['targets']);
await reject('a marker far from its target', 'light-ui', m => { const n = node(m, /^Step 3/); n.bbox = [800, 700, 48, 48]; }, ['targets']);
await reject('an outline that does not surround its target', 'light-ui', m => { node(m, /^Highlight/).bbox = [10, 90, 100, 100]; }, ['targets']);
await reject('a target outside the image', 'light-ui', m => { node(m, /^Step 1/).target.bbox = [1400, 880, 100, 100]; }, ['targets']);
await reject('steps with a gap', 'light-ui', m => { const n = node(m, /^Step 2/); n.name = 'Step 4: the page canvas'; n.texts[0].characters = '4'; }, ['targets']);
await reject('a marker without a numeral (color alone)', 'light-ui', m => { node(m, /^Step 1/).texts[0].characters = ''; }, ['targets']);
await reject('a marker whose name and numeral disagree', 'light-ui', m => { node(m, /^Step 1/).texts[0].characters = '7'; }, ['targets']);
await reject('a badge pushed off the canvas', 'light-ui', m => { node(m, /^Step 3/).bbox = [1420, 98, 48, 48]; }, ['bounds']);
await reject('a mark whose halo is clipped by the edge', 'edge-targets', m => { node(m, /^Step 1/).bbox = [-2, 24, 48, 48]; }, ['bounds']);
await reject('a callout label of more than four words', 'light-ui', m => { const n = node(m, /^Label: Blocks/); n.texts[0].characters = 'Open the Blocks panel now'; }, ['bounds']);
await reject('text that overflows a fixed-size label', 'light-ui', m => { const n = node(m, /^Label: Blocks/); n.texts[0].autoResize = 'NONE'; n.texts[0].characters = 'Blocks panel tab'; n.texts[0].bbox = [n.bbox[0] + 16, n.bbox[1] + 8, 60, 36]; }, ['bounds']);
await reject('text clipped by its component', 'light-ui', m => { const n = node(m, /^Label: Blocks/); n.texts[0].bbox = [n.bbox[0] + 16, n.bbox[1] + 8, n.bbox[2], 36]; }, ['bounds']);
await reject('truncated text', 'light-ui', m => { node(m, /^Label: Blocks/).texts[0].truncation = 'ENDING'; }, ['bounds']);
await reject('a long callout (eight words)', 'long-label', () => {}, ['bounds']);
await reject('two labels that overlap', 'light-ui', m => { const a = node(m, /^Label: Blocks/); const b = node(m, /^Label: Review/); b.bbox = [a.bbox[0] + 40, a.bbox[1] + 10, b.bbox[2], b.bbox[3]]; b.texts[0].bbox = [b.bbox[0] + 16, b.bbox[1] + 8, b.bbox[2] - 32, 36]; }, ['collisions']);
await reject('a label that covers the target of a step', 'light-ui', m => { const a = node(m, /^Label: Blocks/); a.bbox = [40, 200, a.bbox[2], a.bbox[3]]; a.texts[0].bbox = [56, 208, a.bbox[2] - 32, 36]; }, ['collisions']);
await reject('a filled outline that hides what it marks', 'light-ui', m => { node(m, /^Highlight/).fills = [{ type: 'SOLID', hex: T.brand.ink.hex, opacity: 0.4 }]; }, ['collisions']);
await reject('a dim overlay over a target', 'light-ui', m => { m.nodes.push(dim([300, 80, 400, 300]).node); }, ['collisions']);
await reject('a sensitive region of an unknown kind', 'redacted-pii', m => { m.sensitive[0].kind = 'secret-sauce'; }, ['redaction']);

// ---- redaction: fake data or pixelation; no boxes, no blur

const PII = F['redacted-pii'];
const EMAIL = PII.sensitive.find(s => s.id === 'email').bbox;
const redactionDetail = r => r.checks.find(c => c.id === 'redaction').detail;
const rejectRedaction = (name, f, opts, re) => test(`rejects: ${name}`, () => {
  const r = verifyAnnotation(inputFor(f, opts));
  assert.ok(failedIds(r).includes('redaction'), `redaction should fail; failed: ${failedIds(r).join(', ')}`);
  for (const x of [].concat(re)) assert.match(redactionDetail(r), x);
  return r;
});

await rejectRedaction('a Solid Redact layer: solid boxes are not allowed', PII, { mutate: m => m.nodes.push(redact(grow(EMAIL, 4), 'Solid', { name: 'Redact email' }).node) }, /"Redact email" is a Redact \(Style=Solid\) layer: solid boxes are not allowed\. Delete it/);
await rejectRedaction('a Blur Redact layer: blur can be reversed', PII, { mutate: m => m.nodes.push(redact(grow(EMAIL, 4), 'Blur', { name: 'Redact email' }).node) }, /\(Style=Blur\) layer: blur can be reversed and is not allowed/);
await test('a Redact layer is reported by the redaction check, not as an unknown kit component', () => {
  const r = verifyAnnotation(inputFor(PII, { mutate: m => m.nodes.push(redact(grow(EMAIL, 4), 'Solid', { name: 'Redact email' }).node) }));
  assert.deepEqual(failedIds(r), ['redaction']);
});
await rejectRedaction('a declared region left uncovered', PII, { skipPixelate: true }, [/the export shows sensitive region "email" \(email\) unredacted: its pixels are not uniform blocks/, /the clean capture shows sensitive region "avatar" \(avatar\) unredacted/]);
await rejectRedaction('a region painted one flat color (a solid box in the capture)', { ...PII, paintOver: [[...grow(EMAIL, 4), '#23232D']] }, {}, /sensitive region "email" \(email\) as one flat color \(#23232D\), which reads as a solid box/);
await rejectRedaction('a plain box inside the region', { ...PII, paintOver: [[...grow(EMAIL, 4), '#FFFFFF'], [EMAIL[0] + 2, EMAIL[1] + 2, EMAIL[2] - 4, EMAIL[3] - 4, '#D9D9D9']] }, {}, /sensitive region "email" \(email\) as a plain box \(#D9D9D9\), not pixelation/);
await rejectRedaction('a blurred region', { ...PII, pixelate: [grow(PII.sensitive[2].bbox, 4)], blurs: [grow(EMAIL, 4)] }, {}, /the export shows sensitive region "email" \(email\) unredacted/);
await rejectRedaction('blocks smaller than 7 CSS px', { ...PII, pixelateBlock: 3 }, {}, /edges 6 px apart; pixelation needs blocks of at least 14 px, 7 CSS px/);
await rejectRedaction('pixelation in the export only: the clean capture is delivered too', PII, { mutate: (m, ctx) => { ctx.cleanBuf = cleanCanvas(PII, { skipPixelate: true }).png(); } }, /the clean capture shows sensitive region "email" \(email\) unredacted/);
await rejectRedaction('an unknown redaction method', PII, { mutate: m => { m.sensitive[0].method = 'blackout'; } }, /unknown method "blackout" \(use fake-data or pixelate\)/);

await test('pixelated regions and fake data pass; fake data asks a person to confirm the values are invented', () => {
  const r = verify('redacted-pii');
  assert.equal(r.status, 'pass', JSON.stringify(r.checks.filter(c => c.status === 'fail')));
  assert.ok(r.humanReview.some(h => h.id === 'redaction-fake-data' && /"name"/.test(h.reason)));
});

await test('the pixelation detector tells blocks from text, blur, a flat fill, and a box', () => {
  const opts = { minBlock: 14, core: [8, 8, 104, 32] };
  const make = fn => { const cv = new Canvas(120, 48, '#FFFFFF'); cv.texture(8, 8, 104, 32, '#333344'); fn(cv); return decodePng(cv.png()); };
  assert.equal(pixelation(make(() => {}), [0, 0, 120, 48], opts).status, 'detail', 'text');
  assert.equal(pixelation(make(cv => cv.pixelate(0, 0, 120, 48, 14)), [0, 0, 120, 48], opts).status, 'pixelated', 'pixelated');
  assert.equal(pixelation(make(cv => cv.pixelate(0, 0, 120, 48, 6)), [0, 0, 120, 48], opts).status, 'detail', 'blocks too small');
  assert.equal(pixelation(make(cv => cv.blur(0, 0, 120, 48, 4)), [0, 0, 120, 48], opts).status, 'detail', 'blur');
  assert.equal(pixelation(make(cv => cv.rect(0, 0, 120, 48, '#23232D')), [0, 0, 120, 48], opts).status, 'flat', 'flat');
  assert.equal(pixelation(make(cv => { cv.rect(0, 0, 120, 48, '#FFFFFF'); cv.rect(12, 12, 96, 24, '#D9D9D9'); }), [0, 0, 120, 48], opts).status, 'box', 'box');
});

// ---- collisions between outlines, markers on strokes, markers on background edges

const LIGHT = F['light-ui'];
const collisionsDetail = r => r.checks.find(c => c.id === 'collisions').detail;
const rejectCollision = (name, f, mutate, re) => test(`rejects: ${name}`, () => {
  const r = verifyAnnotation(inputFor(f, { mutate }));
  assert.ok(failedIds(r).includes('collisions'), `collisions should fail; failed: ${failedIds(r).join(', ')}`);
  assert.match(collisionsDetail(r), re);
});
const addOutline = (m, target, o = {}) => { const x = outline(target, o).node; x.name = o.name || 'Highlight extra'; m.nodes.push(x); return x; };

await rejectCollision('an outline drawn inside another that crosses its stroke', LIGHT, m => addOutline(m, [200, 380, 120, 30], { name: 'Highlight inner' }), /"Highlight inner" lies inside "Highlight" and crosses its stroke by \d+ px; a mark nested in another must clear the outer mark's inner stroke edge by 3 px/);
await rejectCollision('a nested outline 1 px from the outer mark\'s inner stroke edge', LIGHT, m => addOutline(m, [33, 200, 100, 40], { name: 'Highlight inner' }), /"Highlight inner" lies inside "Highlight" but clears its inner stroke edge by only 1 px; nested marks need 3 px/);
await test('a nested outline that clears the inner stroke edge by 3 px or more passes', () => {
  const r = verifyAnnotation(inputFor(LIGHT, { mutate: m => addOutline(m, [60, 200, 120, 40], { name: 'Highlight inner' }) }));
  assert.ok(!failedIds(r).includes('collisions'), collisionsDetail(r));
});
await rejectCollision('two outlines whose outer edges are 2 px apart', LIGHT, m => { addOutline(m, [1180, 400, 140, 40], { name: 'Highlight A' }); addOutline(m, [1180, 474, 140, 40], { name: 'Highlight B' }); }, /"Highlight (A|B)" and "Highlight (A|B)" are 2 px apart at their outer edges \(halo included\); they need 3 px/);
await rejectCollision('two outlines whose halos overlap', LIGHT, m => { addOutline(m, [1180, 400, 140, 40], { name: 'Highlight A' }); addOutline(m, [1180, 460, 140, 40], { name: 'Highlight B' }); }, /"Highlight (A|B)" and "Highlight (A|B)" overlap; outlines and highlights need 3 px of clear space/);
await rejectCollision('a marker that crosses another mark\'s outline stroke', LIGHT, m => { node(m, /^Step 2/).bbox = [270, 200, 48, 48]; }, /marker "Step 2: the page canvas" crosses the edge of "Highlight"; place it wholly inside the box or clear of its stroke/);
await test('a marker wholly inside a box passes', () => {
  const target = [600, 740, 200, 40];
  const r = verifyAnnotation(inputFor(LIGHT, { mutate: (m, ctx) => { addOutline(m, target, { pad: 60, name: 'Highlight footer' }); m.nodes.push(badge(4, 550, 690, { label: 'the footer', target }).node); ctx.alt = null; } }));
  assert.ok(!failedIds(r).includes('collisions'), collisionsDetail(r));
});
await rejectCollision('a marker that straddles a background edge in the screenshot', F['mixed-backgrounds'], m => { node(m, /^Step 1/).bbox = [376, 186, 48, 48]; }, /marker "Step 1: the Switch control" straddles a background edge in the screenshot \(left 255 vs right \d+: median luma 4-14 px outside the badge differs by more than 40\); move it wholly onto one surface/);

// ---- regressions from a real run (p1-docs, 2026-10-24): both passed the old checks

// Recorded with token hash c80fa84b3723 (schema 1), before the redaction and collision changes. The test
// restamps them with the current tokens so the failures below are the geometry and pixels, not the hash.
// clean.png is the run's capture with the avatar pixelated at capture resolution (7 CSS px blocks).
const REG = join(ROOT, 'tests/fixtures/annotation/regressions');
// Recorded under the 2025 brand (Purple, Poppins). They test geometry and redaction, which the brand change doesn't touch, so they
// verify against the contract and kit they were recorded with, kept beside them.
const LEGACY_T = loadTokens(join(REG, 'annotation-tokens.legacy.json')), LEGACY_KIT = kitDefs(join(REG, 'kit.legacy.json'));
const REG_DPR = { 'translations-sync-1': 2.2, 'create-page-2': 2 }; // from the run's capture-report.json
function regression(slug, { mutate } = {}) {
  const dir = join(REG, slug);
  const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf-8'));
  manifest.tokens = tokensIdentity(LEGACY_T);
  for (const n of manifest.nodes) if (n.component) n.component.kitStamp = tokensIdentity(LEGACY_T).hash;
  const cleanBuf = readFileSync(join(dir, 'clean.png')), exportBuf = readFileSync(join(dir, 'export.png'));
  const clean = { sha256: sha(cleanBuf), dpr: REG_DPR[slug], png: decodePng(cleanBuf) }, exp = { sha256: sha(exportBuf), png: decodePng(exportBuf) };
  if (mutate) mutate(manifest, clean.png, exp.png);
  return { tokens: LEGACY_T, kit: LEGACY_KIT, manifest, clean: { ...clean, width: clean.png.w, height: clean.png.h }, export: { ...exp, width: exp.png.w, height: exp.png.h } };
}

await test('regression translations-sync-1: box 3 drawn inside box 2 fails collisions, and its Solid Redact fails redaction', () => {
  const r = verifyAnnotation(regression('translations-sync-1'));
  assert.deepEqual(failedIds(r), ['collisions', 'redaction']);
  assert.match(collisionsDetail(r), /^"Highlight 3: Review changes" lies inside "Highlight 2: Source changed with the change count" and crosses its stroke by 40 px; a mark nested in another must clear the outer mark's inner stroke edge by 3 px$/);
  assert.match(redactionDetail(r), /^"Redact: account avatar \(initials\)" is a Redact \(Style=Solid\) layer: solid boxes are not allowed\. Delete it; replace the data with fake data before capture, or pixelate the region in the capture before it goes to Figma$/);
});

await test('regression create-page-2: all three badges straddle the dialog edge (dimmed backdrop left, dialog right) and fail collisions', () => {
  const r = verifyAnnotation(regression('create-page-2'));
  assert.deepEqual(failedIds(r), ['collisions', 'redaction']);
  const d = collisionsDetail(r);
  for (const step of ['Step 1: Blank page', 'Step 2: the Page title field', 'Step 3: the URL slug field']) {
    assert.match(d, new RegExp(`marker "${step}" straddles a background edge in the screenshot \\(left 18\\d vs right 255: median luma 4-14 px outside the badge differs by more than 40\\); move it wholly onto one surface`));
  }
});

await test('regression, fixed: translations-sync-1 without box 3 or the Redact layer, with the avatar pixelated in the export, passes', () => {
  const r = verifyAnnotation(regression('translations-sync-1', {
    mutate(m, clean, exp) {
      m.nodes = m.nodes.filter(n => !/^(Highlight 3|Redact)/.test(n.name));
      // What Figma exports once the pixelated capture is in the frame: the clean region, resampled to 2x.
      const [x, y, w, h] = grow(m.sensitive[0].bbox, LEGACY_T.styles.redaction.minPaddingPx).map(v => v * 2);
      for (let v = y; v < y + h; v++) for (let u = x; u < x + w; u++) {
        const s = (Math.floor(((v + 0.5) * clean.h) / exp.h) * clean.w + Math.floor(((u + 0.5) * clean.w) / exp.w)) * clean.bpp, d = (v * exp.w + u) * exp.bpp;
        for (let c = 0; c < 3; c++) exp.pixels[d + c] = clean.pixels[s + c];
      }
    },
  }));
  assert.equal(r.status, 'pass', JSON.stringify(r.checks.filter(c => c.status === 'fail')));
});
await reject('white type on a Yellow mark', 'light-ui', m => { const n = node(m, /^Step 1/); n.component.variant.Tone = 'Yellow'; n.fills = [{ type: 'SOLID', hex: T.brand.yellow.hex, opacity: 1 }]; n.markHex = T.brand.yellow.hex; n.texts[0].fillHex = T.brand.paper.hex; n.texts[0].surfaceHex = T.brand.yellow.hex; }, ['contrast']);
await test('rejects: a tone used on a region its contract does not list (data-driven: Yellow limited to dark, then placed on light)', () => {
  const only = clone(T); only.tones.Yellow.backgrounds = ['dark'];
  const input = inputFor(F['light-ui'], { mutate: m => { const n = node(m, /^Step 1/); n.component.variant.Tone = 'Yellow'; n.fills = [{ type: 'SOLID', hex: T.brand.yellow.hex, opacity: 1 }]; n.markHex = T.brand.yellow.hex; n.texts[0].fillHex = T.brand.ink.hex; n.texts[0].surfaceHex = T.brand.yellow.hex; } });
  const r = verifyAnnotation({ ...input, tokens: only });
  assert.ok(failedIds(r).includes('background-variant'), `failed: ${failedIds(r).join(', ')}`);
});
await test('a Yellow mark raises the yellow-budget review item; an Ink-only frame does not', () => {
  assert.ok(verify('dark-ui').humanReview.some(h => h.id === 'yellow-budget'));
  assert.ok(!verify('light-ui').humanReview.some(h => h.id === 'yellow-budget'));
});
await reject('label text that fails AA', 'light-ui', m => { const n = node(m, /^Label: Blocks/); n.texts[0].fillHex = T.brand.ink.hex; }, ['contrast']);
await reject('a mark that disappears on its background (and in grayscale)', 'light-ui', m => { for (const x of m.nodes) if (/^Step 1/.test(x.name)) { x.markHex = '#F0F0F8'; x.fills = [{ type: 'SOLID', hex: T.brand.paper.hex, opacity: 1 }]; } }, ['contrast']);
await reject('text too small at the docs width', 'light-ui', m => { node(m, /^Label: Blocks/).texts[0].size = 14; }, ['display-size']);
await reject('a stroke too thin for a very wide frame', 'light-ui', m => { m.annotatedFrame.width = 4000; m.cleanFrame.width = 4000; m.cleanFrame.screenshot.width = 4000; m.annotatedFrame.screenshot.width = 4000; }, ['display-size', 'frame-mapping', 'export']);
await reject('a Do tone without a check or cross', 'light-ui', m => { const n = node(m, /^Step 2/); n.component.variant.Tone = 'Do'; }, ['color-independence']);
await reject('the annotated frame is the clean frame', 'light-ui', m => { m.annotatedFrame.id = m.cleanFrame.id; }, ['frame-mapping']);
await reject('the annotated screenshot is a different image', 'light-ui', m => { m.annotatedFrame.screenshot.imageHash = 'something-else'; }, ['frame-mapping']);
await reject('the annotated frame is not the size of the capture', 'light-ui', m => { m.annotatedFrame.height = 899; }, ['frame-mapping']);
await reject('--clean-node-id disagrees with the manifest', 'light-ui', (m, ctx) => { ctx.recorded = { cleanNodeId: '1:1' }; }, ['frame-mapping']);
await reject('frame names that do not follow the inventory convention', 'light-ui', (m, ctx) => { ctx.inventory = { screenshot_id: 'p1.editor.shell', title: 'Editor shell', capture: { release: '2026.09' }, figma: { node_id: '84:13' } }; }, ['frame-mapping']);
await reject('a clean capture that differs from the inventory checksum', 'light-ui', (m, ctx) => { ctx.inventory = { screenshot_id: 'fixture.light-ui', title: 'light-ui', capture: { release: 'fixture' }, clean_asset: { sha256: 'c'.repeat(64) } }; }, ['provenance']);
await reject('an export of the wrong size', 'light-ui', (m, ctx) => { ctx.exportBuf = new Canvas(1440, 900).png(); }, ['export']);
await reject('an export identical to the clean capture', 'light-ui', (m, ctx) => { ctx.exportBuf = ctx.cleanBuf; }, ['provenance', 'export']);
await reject('a manifest that is not a manifest', 'light-ui', m => { delete m.nodes; }, ['manifest-shape']);

await test('shape errors name what is missing', () => {
  assert.ok(manifestShapeErrors({}).length >= 4);
  assert.ok(manifestShapeErrors(null).length === 1);
});

await test('the Do tone passes once a check marker is present, and a Dont needs a cross', () => {
  const ok = verifyAnnotation(inputFor(F['light-ui'], { mutate: (m) => { node(m, /^Step 2/).component.variant.Tone = 'Do'; m.nodes.push(doDont('Do', 700, 700).node); } }));
  assert.ok(!failedIds(ok).includes('color-independence'));
  const bad = verifyAnnotation(inputFor(F['light-ui'], { mutate: (m) => { node(m, /^Step 2/).component.variant.Tone = 'Dont'; m.nodes.push(doDont('Do', 700, 700).node); } }));
  assert.ok(failedIds(bad).includes('color-independence'));
});

await test('a selector with no bounding box is accepted but flagged for a person', () => {
  const r = verifyAnnotation(inputFor(F['light-ui'], { mutate: m => { const n = node(m, /^Highlight/); n.target = { selector: '#blocks-panel' }; } }));
  assert.ok(!failedIds(r).includes('targets'));
  assert.ok(r.humanReview.some(h => h.id === 'target-geometry'));
});

await test('Inter Bold, the old fallback, and Poppins now fail typography: the contract lists no fallback', () => {
  for (const [family, style] of [['Inter', 'Bold'], ['Poppins', 'Bold']]) {
    const r = verifyAnnotation(inputFor(F['light-ui'], { mutate: m => { node(m, /^Label: Blocks/).texts[0].family = family; node(m, /^Label: Blocks/).texts[0].style = style; } }));
    assert.ok(failedIds(r).includes('typography'), `${family} ${style}`);
    assert.ok(!r.humanReview.some(h => h.id === 'font-fallback'));
  }
});

await test('a shot with no declared sensitive regions asks a person to confirm there is no personal data', () => {
  assert.ok(verify('light-ui').humanReview.some(h => h.id === 'redaction-declared'));
});

// =================================================================== alt text

const STEPS = [{ n: 1, label: 'the Blocks panel' }, { n: 2, label: 'the page canvas' }, { n: 3, label: 'the Review button' }];
await test('alt text that names every step in order passes', () => {
  assert.equal(checkAltAgainstSteps('The P1 editor with three numbered areas: 1 the Blocks panel, 2 the page canvas, 3 the Review button.', STEPS, 'The P1 editor').status, 'pass');
});
await test('alt text that describes colored shapes fails', () => {
  const r = checkAltAgainstSteps('A purple box around the left side, a blue arrow to the center, 1 the Blocks panel, 2 the page canvas, 3 the Review button.', STEPS, 'The P1 editor');
  assert.equal(r.status, 'fail');
  assert.match(r.reasons.join(' '), /colored shape/);
});
await test('alt text that skips or reorders a step fails', () => {
  assert.equal(checkAltAgainstSteps('The P1 editor: 1 the Blocks panel, 3 the Review button.', STEPS, 'The P1 editor').status, 'fail');
  assert.equal(checkAltAgainstSteps('The P1 editor: 2 the page canvas, 1 the Blocks panel, 3 the Review button.', STEPS, 'The P1 editor').status, 'fail');
});
await test('ambiguous alt text (generic labels, one-word subject, annotation words) needs human review', () => {
  assert.equal(checkAltAgainstSteps('The editor with 1 button, 2 area.', [{ n: 1, label: 'button' }, { n: 2, label: 'area' }], 'Editor').status, 'review');
  assert.equal(checkAltAgainstSteps('The P1 editor, arrows marking 1 the Blocks panel.', [{ n: 1, label: 'the Blocks panel' }], 'The P1 editor').status, 'review');
  assert.equal(checkAltAgainstSteps('The P1 editor: 1 the Blocks panel, 2 the Blocks panel.', [{ n: 1, label: 'the Blocks panel' }, { n: 2, label: 'the Blocks panel' }], 'The P1 editor').status, 'review');
  assert.equal(checkAltAgainstSteps('', STEPS).status, 'fail');
});
await test('the verifier fails a fixture whose alt text does not match its marks, and asks for review when it is ambiguous', () => {
  const bad = verifyAnnotation(inputFor(F['light-ui'], { mutate: (m, ctx) => { ctx.alt = { text: 'A blue box and an arrow.', subject: 'x' }; } }));
  assert.ok(failedIds(bad).includes('alt-text'));
  const amb = verifyAnnotation(inputFor(F['light-ui'], { mutate: (m, ctx) => { ctx.alt = { text: 'Editor: 1 the Blocks panel, 2 the page canvas, 3 the Review button.', subject: 'Editor' }; } }));
  assert.equal(amb.status, 'pass');
  assert.ok(amb.humanReview.some(h => h.id === 'alt-text'));
  assert.ok(amb.checks.find(c => c.id === 'alt-text').status === 'review');
});
await test('draft-alt refuses --apply on an ambiguous draft until a person is named, and applies it then', () => {
  const marks = join(TMP, 'amb-marks.json'); writeFileSync(marks, JSON.stringify(['Step 1: button', 'Step 2: area']));
  const inv = join(TMP, 'amb-inv.json'); writeFileSync(inv, readFileSync(join(ROOT, 'tests/fixtures/inventory/inventory.valid.json')));
  const args = ['--marks', marks, '--subject', 'Editor', '--id', 'p1.editor.blocks-browser', '--inventory', inv, '--apply'];
  const before = readFileSync(inv, 'utf-8');
  const refused = spawnSync(process.execPath, [join(ROOT, 'scripts/draft-alt.mjs'), ...args], { encoding: 'utf-8' });
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /ambiguous/);
  assert.equal(readFileSync(inv, 'utf-8'), before, 'nothing was saved');
  const clear = spawnSync(process.execPath, [join(ROOT, 'scripts/draft-alt.mjs'), '--marks', marks, '--subject', 'The P1 editor', '--id', 'p1.editor.blocks-browser', '--inventory', inv], { encoding: 'utf-8' });
  assert.equal(clear.status, 0);
  assert.match(clear.stderr, /needs a person/);
});

// =================================================================== clean and annotated stay separate

const FIXTURE_INV = JSON.parse(readFileSync(join(ROOT, 'tests/fixtures/inventory/inventory.valid.json'), 'utf-8'));
const cli = (script, args, opts = {}) => spawnSync(process.execPath, [join(ROOT, 'scripts', script), ...args], { encoding: 'utf-8', ...opts });

await test('record-capture keeps the capture as clean_asset, and an annotated export never replaces it', () => {
  const dir = join(TMP, 'inv'); mkdirSync(dir, { recursive: true });
  const inv = join(dir, 'inventory.json');
  const doc = clone(FIXTURE_INV);
  const rec = doc.records.find(r => r.screenshot_id === 'p1.editor.blocks-browser');
  rec.status = 'approved'; delete rec.asset; delete rec.clean_asset; rec.publication = { docs_image_slot: rec.publication.docs_image_slot }; rec.figma = { evidence: 'none' };
  writeFileSync(inv, JSON.stringify(doc, null, 2));
  const cleanPng = new Canvas(80, 40, '#F4F4F8').png();
  const runDir = join(dir, 'run'); mkdirSync(runDir);
  writeFileSync(join(runDir, 'blocks-browser.png'), cleanPng);
  writeFileSync(join(runDir, 'capture-report.json'), JSON.stringify({ topic: 't', capturedAt: '2026-10-21T10:00:00.000Z', results: [{ slug: 'blocks-browser', side: 'next', ok: true, file: join(runDir, 'blocks-browser.png'), screenshotId: rec.screenshot_id, release: rec.capture.release, caption: rec.content.caption, altText: rec.content.alt_text }] }));
  const assets = join(dir, 'assets');
  const cap = cli('inventory.mjs', ['record-capture', '--run', runDir, '--inventory', inv, '--assets-dir', assets]);
  assert.equal(cap.status, 0, cap.stdout + cap.stderr);
  let r = JSON.parse(readFileSync(inv, 'utf-8')).records.find(x => x.screenshot_id === rec.screenshot_id);
  assert.equal(r.clean_asset.sha256, sha(cleanPng));
  assert.equal(r.clean_asset.path, `screenshots/${rec.screenshot_id}/${rec.capture.release}.clean.png`);
  assert.ok(existsSync(join(assets, r.clean_asset.path)) && existsSync(join(assets, r.asset.path)));
  // An export that is the clean capture is refused.
  const same = join(dir, 'same.png'); copyFileSync(join(runDir, 'blocks-browser.png'), same);
  const refused = cli('inventory.mjs', ['record-asset', '--id', rec.screenshot_id, '--file', same, '--inventory', inv, '--assets-dir', assets]);
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /identical to the clean capture/);
  // A real export becomes the docs asset; the clean capture stays.
  const annotated = new Canvas(80, 40, '#F4F4F8'); annotated.rect(4, 4, 20, 10, '#3017A1');
  const expFile = join(dir, 'annotated.png'); writeFileSync(expFile, annotated.png());
  const ok = cli('inventory.mjs', ['record-asset', '--id', rec.screenshot_id, '--file', expFile, '--inventory', inv, '--assets-dir', assets]);
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  r = JSON.parse(readFileSync(inv, 'utf-8')).records.find(x => x.screenshot_id === rec.screenshot_id);
  assert.equal(r.asset.source, 'figma_export');
  assert.notEqual(r.asset.sha256, r.clean_asset.sha256);
  assert.equal(r.clean_asset.sha256, sha(cleanPng), 'the clean checksum is untouched');
  assert.equal(sha(readFileSync(join(assets, r.clean_asset.path))), sha(cleanPng), 'the clean file is untouched on disk');
  assert.equal(sha(readFileSync(join(assets, r.asset.path))), sha(annotated.png()));
  assert.deepEqual(validateInventory(JSON.parse(readFileSync(inv, 'utf-8'))).errors.filter(e => e.id === rec.screenshot_id && /clean_asset|asset\.sha/.test(e.field)), []);
  // publish-markdown can publish either variant.
  const docs = join(dir, 'docs'); mkdirSync(join(docs, 'images'), { recursive: true });
  writeFileSync(join(docs, 'screenshots.map.json'), JSON.stringify({ images: { [rec.screenshot_id]: 'images/x.png' } }));
  writeFileSync(join(docs, 'page.md'), `![old](images/x.png)\n`);
  for (const [variant, want] of [['annotated', annotated.png()], ['clean', cleanPng]]) {
    const p = cli('publish-markdown.mjs', ['--inventory', inv, '--assets-dir', assets, '--repo', docs, '--variant', variant]);
    assert.equal(p.status, 0, p.stdout + p.stderr);
    assert.equal(sha(readFileSync(join(docs, 'images/x.png'))), sha(want), `${variant} variant`);
  }
  assert.equal(cli('publish-markdown.mjs', ['--inventory', inv, '--assets-dir', assets, '--repo', docs, '--variant', 'both']).status, 1);
});

// =================================================================== record-annotation and handoff, end to end

function makeRun(dirName, fixtureName = 'light-ui') {
  const f = F[fixtureName];
  const dir = join(TMP, dirName); mkdirSync(dir, { recursive: true });
  const slug = 'shell';
  const png = join(dir, `${slug}.png`);
  writeFileSync(png, cleanCanvas(f).png());
  writeFileSync(join(dir, 'capture-report.json'), JSON.stringify({ topic: 'qa-editor', site: 'http://localhost:3000', projectName: 'QA Project', workstream: 'qa-workstream', pagePath: '/docs/example', capturedAt: '2026-10-21T10:00:00.000Z', skipped: [], results: [{ slug, side: 'next', ok: true, file: png, dpr: 1 }] }));
  writeFileSync(join(dir, 'figma-plan.json'), JSON.stringify({ runId: `qa-editor-${dirName}`, pageName: `qa page ${dirName}`, skipped: [], rows: [{ slug }] }));
  const manifest = join(dir, 'manifest.json'); writeFileSync(manifest, JSON.stringify(manifestFor(f)));
  const exp = join(dir, 'export-annotated.png'); writeFileSync(exp, exportCanvas(f).png());
  return { dir, slug, manifest, exp, png, f };
}
const cfgFile = join(TMP, 'cfg.json');
writeFileSync(cfgFile, JSON.stringify({ topic: 'qa-editor', baseUrl: 'http://localhost:3000', projectName: 'QA Project', workstream: 'qa-workstream', pagePath: '/docs/example', blockType: 'QaBlock', chrome: { profileDir: join(TMP, 'qa-profile'), cdpPort: 9555 }, figma: { fileKey: 'QaQaQaQaQaQaQaQaQaQaQa', pageNamePattern: '{topic} · {workstream} · {runId}', runIdPattern: '{topic}_{yyyymmdd}_{hhmm}' }, docs: { handoffDir: join(TMP, 'notes'), format: 'markdown' } }));
const record = (run, extra = []) => cli('record-annotation.mjs', ['--dir', run.dir, '--slug', run.slug, '--manifest', run.manifest, '--export', run.exp, ...extra]);
const handoff = (run, extra = []) => cli('handoff.mjs', ['--config', cfgFile, '--dir', run.dir, '--release', 'QA release', ...extra]);
const recordOf = run => JSON.parse(readFileSync(join(run.dir, 'annotation-record.json'), 'utf-8')).frames[run.slug];
const noteOf = run => readFileSync(join(TMP, 'notes', `handoff-qa-editor-${basename(run.dir)}.md`), 'utf-8');

await test('record-annotation rejects the old --kit-only and --redacted claims and says what to pass instead', () => {
  const run = makeRun('legacy');
  const r = record(run, ['--kit-only', '--redacted']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /claims/);
  assert.ok(!existsSync(join(run.dir, 'annotation-record.json')));
});

await test('record-annotation verifies, writes proof to review/, copies the export to annotated/, and leaves the clean capture untouched', () => {
  const run = makeRun('flow');
  const cleanBefore = sha(readFileSync(run.png));
  const r = record(run);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /pending-human-review/);
  assert.equal(sha(readFileSync(run.png)), cleanBefore, 'the clean capture is unchanged');
  assert.ok(existsSync(join(run.dir, 'annotated', `${run.slug}.png`)));
  assert.notEqual(sha(readFileSync(join(run.dir, 'annotated', `${run.slug}.png`))), cleanBefore);
  const v = JSON.parse(readFileSync(join(run.dir, 'review', `${run.slug}.validation.json`), 'utf-8'));
  assert.equal(v.status, 'pass');
  assert.ok(v.checks.length >= 12 && v.humanReview.length >= 3);
  assert.ok(existsSync(join(run.dir, 'review', `${run.slug}.manifest.json`)));
  const f = recordOf(run);
  assert.equal(f.status, 'pending-human-review');
  assert.equal(f.source.sha256, cleanBefore);
  assert.equal(f.cleanNodeId, '84:13'); assert.equal(f.annotatedNodeId, '87:2');
  assert.deepEqual(f.tokens, tokensIdentity(loadTokens()));
  assert.equal(f.export.width, run.f.w * 2);
  assert.match(f.export.sha256, /^[0-9a-f]{64}$/);
});

await test('handoff refuses a verified shot until a named person has done the human review', () => {
  const run = makeRun('pending');
  assert.equal(record(run).status, 0);
  const h = handoff(run);
  assert.equal(h.status, 1);
  assert.match(h.stderr, /nobody has recorded the human review/);
});

await test('with --human-reviewed the shot is complete, and the handoff note lists the clean and annotated images with their checksums', () => {
  const run = makeRun('done');
  assert.equal(record(run, ['--human-reviewed', 'QA Reviewer']).status, 0);
  assert.equal(recordOf(run).status, 'complete');
  assert.equal(recordOf(run).humanReview.confirmedBy, 'QA Reviewer');
  const h = handoff(run);
  assert.equal(h.status, 0, h.stderr);
  const note = noteOf(run);
  assert.match(note, /Annotation: Complete/);
  assert.match(note, /machine-verified against the token contract/);
  assert.match(note, /QA Reviewer/);
  assert.match(note, /Clean and annotated images/);
  const f = recordOf(run);
  assert.ok(note.includes(f.source.sha256.slice(0, 12)) && note.includes(f.export.sha256.slice(0, 12)));
  assert.ok(note.includes('annotated/shell.png'));
  assert.ok(note.includes(f.tokens.hash.slice(0, 12)));
});

await test('handoff refuses a record after the clean capture is replaced, the export is edited, or the tokens change', () => {
  const run = makeRun('stale');
  assert.equal(record(run, ['--human-reviewed', 'QA Reviewer']).status, 0);
  assert.equal(handoff(run).status, 0);
  const png = readFileSync(run.png);
  writeFileSync(run.png, new Canvas(run.f.w, run.f.h, '#000000').png());
  let h = handoff(run); assert.equal(h.status, 1); assert.match(h.stderr, /clean capture changed/);
  writeFileSync(run.png, png);
  assert.equal(handoff(run).status, 0, 'restoring the capture restores the record');
  const annotated = join(run.dir, 'annotated', `${run.slug}.png`); const exp = readFileSync(annotated);
  writeFileSync(annotated, new Canvas(10, 10).png());
  h = handoff(run); assert.equal(h.status, 1); assert.match(h.stderr, /no longer matches its recorded checksum/);
  writeFileSync(annotated, exp);
  const recFile = join(run.dir, 'annotation-record.json'); const rec = JSON.parse(readFileSync(recFile, 'utf-8'));
  rec.frames[run.slug].tokens.hash = 'd'.repeat(64); writeFileSync(recFile, JSON.stringify(rec));
  h = handoff(run); assert.equal(h.status, 1); assert.match(h.stderr, /stale: re-verify/);
  rec.frames[run.slug].tokens.hash = tokensIdentity(loadTokens()).hash; rec.frames[run.slug].verification.status = 'pass'; delete rec.frames[run.slug].cleanNodeId; writeFileSync(recFile, JSON.stringify(rec));
  h = handoff(run); assert.equal(h.status, 1); assert.match(h.stderr, /no clean frame node ID/);
});

await test('a failing manifest is rejected, leaves proof in review/, records a rejected frame, and blocks the handoff', () => {
  const run = makeRun('reject');
  const m = JSON.parse(readFileSync(run.manifest, 'utf-8'));
  m.nodes.push({ id: '99:9', name: 'Rectangle 7', type: 'RECTANGLE', bbox: [400, 700, 80, 40], visible: true, opacity: 1, fills: [{ type: 'SOLID', hex: '#FF0000', opacity: 1 }] });
  writeFileSync(run.manifest, JSON.stringify(m));
  const r = record(run, ['--human-reviewed', 'QA Reviewer']);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /FAIL\s+kit-components/);
  assert.equal(JSON.parse(readFileSync(join(run.dir, 'review', `${run.slug}.validation.json`), 'utf-8')).status, 'fail');
  assert.equal(recordOf(run).status, 'rejected');
  assert.ok(!existsSync(join(run.dir, 'annotated', `${run.slug}.png`)), 'a rejected export is not placed in annotated/');
  const h = handoff(run); assert.equal(h.status, 1); assert.match(h.stderr, /status is rejected/);
});

await test('record-annotation refuses an export that is the clean capture file, or a slug not in the run', () => {
  const run = makeRun('same');
  const r = cli('record-annotation.mjs', ['--dir', run.dir, '--slug', run.slug, '--manifest', run.manifest, '--export', run.png]);
  assert.equal(r.status, 1); assert.match(r.stderr, /clean capture file/);
  const s = cli('record-annotation.mjs', ['--dir', run.dir, '--slug', 'nope', '--manifest', run.manifest, '--export', run.exp]);
  assert.equal(s.status, 1); assert.match(s.stderr, /not a shot in this run/);
});

await test('--skip-annotation still hands off with a reason, and the note says so', () => {
  const run = makeRun('skip');
  const h = handoff(run, ['--skip-annotation', 'release freeze']);
  assert.equal(h.status, 0, h.stderr);
  assert.match(noteOf(run), /Annotation: SKIPPED by request: release freeze/);
});

await test('--sensitive supplies declared regions from outside the Figma frame', () => {
  const run = makeRun('sens', 'redacted-pii');
  const sens = join(run.dir, 'sens.json'); writeFileSync(sens, JSON.stringify([...run.f.sensitive, { id: 'extra', kind: 'token', bbox: [600, 600, 100, 20], reason: 'api key', declaredBy: 'person' }]));
  const r = record(run, ['--sensitive', sens]);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /sensitive region "extra"/);
});

await test('figma-annotation prints parseable code and refuses a bad ID', () => {
  const ok = cli('figma-annotation.mjs', ['--clean-node-id', '84:13', '--annotated-node-id', '87:2']);
  assert.equal(ok.status, 0);
  assert.ok(ok.stdout.includes('"84:13"') && ok.stdout.includes('getSharedPluginData'));
  assert.equal(cli('figma-annotation.mjs', ['--clean-node-id', 'x', '--annotated-node-id', '87:2']).status, 1);
});

console.log(`${passed} passed, ${failed} failed (annotation)`);
process.exit(failed ? 1 : 0);
