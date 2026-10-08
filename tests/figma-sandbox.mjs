#!/usr/bin/env node
/**
 * Runs a run's generated figma-page.js against a mock of the Figma plugin API, to check what the code
 * does without Figma access. The mock behaves like the real API where it matters here: new auto-layout
 * frames get a default white fill (so the code has to clear it), pages are appended to figma.root, and
 * node IDs are assigned in creation order.
 *
 * Usage: node figma-sandbox.mjs <run dir> [<second run dir>]
 *        (needs figma-plan.json and figma-page.js in each; without a second dir it simulates one)
 * Exit code 0 when every assertion holds; otherwise 1 with the first failing assertion.
 */

import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';

const dir = resolve(process.argv[2] || '.');
const plan = JSON.parse(readFileSync(join(dir, 'figma-plan.json'), 'utf-8'));
const code = readFileSync(join(dir, 'figma-page.js'), 'utf-8');

let counter = 0;
const created = [];
class FNode {
  constructor(type) {
    this.type = type; this.id = `${type}:${++counter}`; this.children = []; this.fills = []; this.strokes = []; this.name = ''; created.push(this);
  }
  appendChild(c) { this.children.push(c); c.parent = this; }
  resize(w, h) { this.width = w; this.height = h; }
  findAll(fn) { const out = []; const walk = n => { for (const c of n.children) { if (fn(c)) out.push(c); walk(c); } }; walk(this); return out; }
}
const makeFigma = () => {
  const page0 = new FNode('PAGE'); page0.name = 'Page 1';
  const figma = {
    root: { children: [page0] },
    async loadFontAsync() {},
    async setCurrentPageAsync() {},
    createPage() { const p = new FNode('PAGE'); figma.root.children.push(p); return p; },
    createAutoLayout(_dir, props = {}) { const f = new FNode('FRAME'); f.fills = [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }]; Object.assign(f, props); return f; },
    createRectangle() { return new FNode('RECTANGLE'); },
    createText() { return new FNode('TEXT'); },
  };
  return figma;
};

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const run = figma => new AsyncFunction('figma', code)(figma);

const figma = makeFigma();
const before = created.length;
const result = await run(figma);

// One new page, named from the plan.
assert.equal(figma.root.children.length, 2, 'one page should be added');
const page = figma.root.children[1];
assert.equal(page.name, plan.pageName, 'page name should come from the plan');

// One named, empty rectangle per upload, with the planned size, and node IDs returned in upload order.
const rects = page.findAll(n => n.type === 'RECTANGLE');
assert.equal(rects.length, plan.uploads.length, 'one rectangle per uploaded PNG');
assert.deepEqual(rects.map(r => r.name).sort(), plan.uploads.map(u => u.key).sort(), 'rectangle names should be the upload keys');
assert.equal(new Set(rects.map(r => r.name)).size, rects.length, 'rectangle names must be unique');
assert.deepEqual(result.nodeIds, plan.uploads.map(u => rects.find(r => r.name === u.key).id), 'nodeIds follow upload order');
assert.equal(result.pageId, page.id);

// Wrapper frames must not cover the background: only the run's root frame keeps a fill.
const pageFrames = page.findAll(n => n.type === 'FRAME');
const root = pageFrames.find(f => f.id === result.rootId);
assert.ok(root && root.fills.length === 1, 'the root frame keeps its background fill');
assert.deepEqual(pageFrames.filter(f => f.id !== result.rootId && /\(no image\)/.test(f.name) === false).filter(f => f.fills.length > 0).map(f => f.name), [], 'wrapper frames must have no fill');

// Rows that need attention are marked, and cells without an image get a dashed box instead of a rectangle.
const texts = page.findAll(n => n.type === 'TEXT').map(t => t.characters);
for (const row of plan.rows.filter(r => r.attention)) assert.ok(texts.some(t => t.startsWith(row.slug) && t.includes('NEEDS ATTENTION')), `row ${row.slug} should be marked`);
const noImage = plan.rows.flatMap(r => r.cells).filter(c => c.state !== 'ok');
assert.equal(page.findAll(n => n.type === 'FRAME' && /\(no image\)/.test(n.name)).length, noImage.length, 'a no-image box per missing or failed cell');

// Duplicate guard: the same code on the same file must throw before it creates anything.
const nodesBefore = created.length;
let thrown = null;
try { await run(figma); } catch (e) { thrown = e; }
assert.ok(thrown && /Page already exists/.test(thrown.message), 'a repeat run should be rejected with "Page already exists"');
assert.ok(thrown.message.includes(plan.pageName), 'the error should name the page');
assert.equal(created.length, nodesBefore, 'the rejected run must not create any node');
assert.equal(figma.root.children.length, 2, 'the rejected run must not add a page');

// A different run (another run ID) can coexist, and the first run's page is left exactly as it was.
const firstPageSnapshot = JSON.stringify({ id: page.id, name: page.name, kids: page.children.length, rects: page.findAll(n => n.type === 'RECTANGLE').map(r => r.id) });
const otherDir = process.argv[3] ? resolve(process.argv[3]) : null;
let otherCode = code.replaceAll(plan.runId, `${plan.runId}-2`);
let otherName = plan.pageName.replaceAll(plan.runId, `${plan.runId}-2`);
if (otherDir) {
  const otherPlan = JSON.parse(readFileSync(join(otherDir, 'figma-plan.json'), 'utf-8'));
  assert.notEqual(otherPlan.pageName, plan.pageName, 'the two runs must have different page names');
  otherCode = readFileSync(join(otherDir, 'figma-page.js'), 'utf-8');
  otherName = otherPlan.pageName;
}
await new AsyncFunction('figma', otherCode)(figma);
assert.equal(figma.root.children.length, 3, 'a second run with a different name must create a separate page');
assert.equal(figma.root.children[2].name, otherName);
assert.equal(JSON.stringify({ id: page.id, name: page.name, kids: page.children.length, rects: page.findAll(n => n.type === 'RECTANGLE').map(r => r.id) }), firstPageSnapshot, "the first run's page must be untouched by the second run");
let again = null;
try { await run(figma); } catch (e) { again = e; }
assert.ok(again && /Page already exists/.test(again.message), 'the first run is still rejected as a duplicate after the second run exists');
assert.equal(figma.root.children.length, 3, 'no extra page after the repeat attempts');
void before;

console.log(`ok: ${rects.length} rectangles, ${noImage.length} no-image boxes, duplicate rejected, second run coexists, first run untouched`);
