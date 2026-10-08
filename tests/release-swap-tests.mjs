#!/usr/bin/env node
/**
 * Tests for the release swap (references/release-swap.md): draft-alt.mjs, figma-export.mjs against a local
 * mock of the Figma API, gdocs-manifest.mjs, and templates/gdocs-swap/Code.gs in a sandbox with fake
 * DocumentApp, UrlFetchApp, Utilities, and PropertiesService. No Figma, GitHub, or Google access.
 * Prints PASS/FAIL lines in the format tests/run-tests.sh counts.
 */

import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync, existsSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import { altFingerprint, frameName } from '../scripts/lib/inventory.mjs';
import { layerNames, stepsFrom, draftAlt } from '../scripts/draft-alt.mjs';
import { checkImageUrl, apiBase, fileKeyFrom } from '../scripts/figma-export.mjs';
import { buildManifest } from '../scripts/gdocs-manifest.mjs';

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), '..');
const TMP = realpathSync(mkdtempSync(join(tmpdir(), 'release-swap-test-')));
process.on('exit', () => rmSync(TMP, { recursive: true, force: true }));
const valid = () => JSON.parse(readFileSync(join(ROOT, 'tests/fixtures/inventory/inventory.valid.json'), 'utf-8'));
const rec = (d, id) => d.records.find(r => r.screenshot_id === id);
const sha = b => createHash('sha256').update(b).digest('hex');
const png = (w, h, seed = 0) => { const b = Buffer.alloc(64, seed); Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(b); b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20); return b; };
const SHA40 = 'a'.repeat(40);
const GDOC = '1sTEEdS19BnroIecMWXjJzhbchpwh2Ftv7_TEST';

let passed = 0, failed = 0;
const test = async (name, fn) => {
  try { await fn(); console.log(`PASS  ${name}`); passed += 1; }
  catch (e) { console.log(`FAIL  ${name}`); console.log('        ' + String(e.message || e).split('\n').slice(0, 8).join('\n        ')); failed += 1; }
};

// ---------- draft-alt ----------
const STEPS = ['screenshot', 'Redact: avatar', 'Highlight 1: Blocks panel', 'Step 2: the page canvas', 'Step 1: the Blocks panel', 'Step 4: the Review button', 'Step 3: page settings'];
await test('draft-alt numbers the areas from the step layers, in order, with the count in words', () => {
  assert.equal(draftAlt(stepsFrom(STEPS)), 'The P1 editor with four numbered areas: 1 the Blocks panel, 2 the page canvas, 3 page settings, 4 the Review button.');
  assert.equal(draftAlt(stepsFrom(['Step 1: the button.']), "The P1 editor's menu"), "The P1 editor's menu with one numbered area: 1 the button.");
});
await test('draft-alt refuses gaps, repeats, and frames without step layers', () => {
  assert.throws(() => stepsFrom(['Step 1: a', 'Step 3: c']), /no gaps/);
  assert.throws(() => stepsFrom(['Step 1: a', 'Step 1: b']), /more than once/);
  assert.throws(() => stepsFrom(['Highlight 1: a']), /no layers named/);
});
await test('draft-alt reads a name list, { marks }, and a Figma REST nodes response', () => {
  assert.deepEqual(layerNames(['a']), ['a']);
  assert.deepEqual(layerNames({ marks: ['b'] }), ['b']);
  assert.deepEqual(layerNames({ nodes: { '63:38': { document: { children: [{ name: 'Step 1: x' }, { name: 'screenshot' }] } } } }), ['Step 1: x', 'screenshot']);
  assert.throws(() => layerNames({}), /must be a list/);
});
await test('draft-alt --apply saves the draft through set-alt, and without --apply writes nothing', () => {
  const inv = join(TMP, 'alt.json'); writeFileSync(inv, JSON.stringify(valid()));
  const marks = join(TMP, 'marks.json'); writeFileSync(marks, JSON.stringify(STEPS));
  const before = readFileSync(inv, 'utf-8');
  const dry = spawnSync(process.execPath, [join(ROOT, 'scripts/draft-alt.mjs'), '--marks', marks, '--id', 'p1.editor.blocks-browser', '--inventory', inv], { encoding: 'utf-8' });
  assert.equal(dry.status, 0, dry.stderr); assert.match(dry.stdout, /--apply/);
  assert.equal(readFileSync(inv, 'utf-8'), before);
  const r = spawnSync(process.execPath, [join(ROOT, 'scripts/draft-alt.mjs'), '--marks', marks, '--id', 'p1.editor.blocks-browser', '--inventory', inv, '--apply'], { encoding: 'utf-8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(rec(JSON.parse(readFileSync(inv, 'utf-8')), 'p1.editor.blocks-browser').content.alt_text, draftAlt(stepsFrom(STEPS)));
});

// ---------- figma-export ----------
await test('figma-export allows only https Figma image hosts, and the API base only as api.figma.com or a loopback mock', () => {
  assert.ok(checkImageUrl('https://figma-alpha-api.s3.us-west-2.amazonaws.com/images/x').ok);
  assert.ok(checkImageUrl('https://s3-alpha.figma.com/x').ok);
  for (const bad of ['http://s3-alpha.figma.com/x', 'https://figma.com.evil.example/x', 'https://evil.s3.amazonaws.com/x', `https://u:p${'@'}www.figma.com/x`, 'not a url', 'http://127.0.0.1/x']) assert.equal(checkImageUrl(bad, {}).ok, false, bad);
  assert.equal(apiBase({}), 'https://api.figma.com');
  assert.throws(() => apiBase({ P1_FIGMA_API_BASE: 'https://evil.example' }), /loopback/);
  assert.throws(() => apiBase({ P1_FIGMA_API_BASE: 'http://127.0.0.1:1' }), /loopback/, 'loopback needs the opt-in');
  assert.equal(fileKeyFrom('https://www.figma.com/design/sbxkkpRoLcAxaSx5Doem4U/x'), 'sbxkkpRoLcAxaSx5Doem4U');
  assert.equal(fileKeyFrom('https://evil.example/design/sbxkkpRoLcAxaSx5Doem4U'), null);
});

function annotatedInventory() {
  const d = valid();
  const r = rec(d, 'p1.editor.publish-menu');
  r.status = 'annotated';
  r.figma = { evidence: 'uploaded', file_url: 'https://www.figma.com/design/FxFxFxFxFxFxFxFxFxFxFx/Fixture', page_name: 'RUN-2026-10-01', node_id: '9:9', annotated_node_id: '9:20', annotation_status: 'complete' };
  r.figma.frame_name = frameName(r, 'clean'); r.figma.annotated_frame_name = frameName(r, 'annotated');
  return { d };
}
async function withMockFigma(handler, fn) {
  const seen = [];
  const server = createServer((req, res) => { seen.push({ url: req.url, token: req.headers['x-figma-token'] || null }); handler(req, res, server.address().port); });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  try { return await fn(`http://127.0.0.1:${server.address().port}`, seen); } finally { server.close(); }
}
const runExport = (base, args, extraEnv = {}) => new Promise(res => {
  const p = spawn(process.execPath, [join(ROOT, 'scripts/figma-export.mjs'), ...args], { env: { ...process.env, FIGMA_TOKEN: 'test-token', P1_FIGMA_ALLOW_LOOPBACK: '1', P1_FIGMA_API_BASE: base, ...extraEnv } });
  let out = ''; p.stdout.on('data', d => out += d); p.stderr.on('data', d => out += d);
  p.on('close', code => res({ code, out }));
});
const IMG = png(2880, 1800, 7);
const figmaHandler = (images) => (req, res, port) => {
  if (req.url.startsWith('/v1/images/')) {
    if (req.headers['x-figma-token'] !== 'test-token') { res.writeHead(403); return res.end('{}'); }
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ err: null, images: images(port) }));
  }
  if (req.url === '/img/ok') { res.writeHead(200); return res.end(IMG); }
  if (req.url === '/img/redirect') { res.writeHead(302, { location: '/img/ok' }); return res.end(); }
  if (req.url === '/img/notpng') { res.writeHead(200); return res.end('hello'); }
  res.writeHead(404); res.end();
};

await test('figma-export renders the annotated node only, never sends the token to the image host, and records the asset', async () => {
  const { d } = annotatedInventory();
  const inv = join(TMP, 'export.json'); writeFileSync(inv, JSON.stringify(d));
  await withMockFigma(figmaHandler(port => ({ '9:20': `http://127.0.0.1:${port}/img/ok` })), async (base, seen) => {
    const out = join(TMP, 'export-out'), assets = join(TMP, 'export-assets');
    const r = await runExport(base, ['--inventory', inv, '--id', 'p1.editor.publish-menu', '--out', out, '--record', '--assets-dir', assets]);
    assert.equal(r.code, 0, r.out);
    const api = seen.find(s => s.url.startsWith('/v1/images/'));
    assert.match(api.url, /^\/v1\/images\/FxFxFxFxFxFxFxFxFxFxFx\?ids=9%3A20&scale=2&format=png$/, 'the annotated node, not the clean 9:9');
    assert.equal(api.token, 'test-token');
    assert.equal(seen.find(s => s.url === '/img/ok').token, null, 'the token is not sent to the image URL');
    assert.doesNotMatch(r.out, /test-token/, 'the token is never printed');
    assert.equal(sha(readFileSync(join(out, 'p1.editor.publish-menu.png'))), sha(IMG));
    assert.equal(rec(JSON.parse(readFileSync(inv, 'utf-8')), 'p1.editor.publish-menu').asset.sha256, sha(IMG));
  });
});
await test('figma-export skips a record without an annotated node and refuses bad hosts, redirects, and non-PNG downloads', async () => {
  const { d } = annotatedInventory();
  delete rec(d, 'p1.editor.publish-menu').figma.annotated_node_id;
  const inv = join(TMP, 'export2.json'); writeFileSync(inv, JSON.stringify(d));
  await withMockFigma(figmaHandler(() => ({})), async base => {
    const r = await runExport(base, ['--inventory', inv, '--id', 'p1.editor.publish-menu', '--out', join(TMP, 'o2')]);
    assert.equal(r.code, 1); assert.match(r.out, /no figma\.annotated_node_id .* the clean frame is never exported/); assert.match(r.out, /nothing to export/);
  });
  const { d: d3 } = annotatedInventory();
  const inv3 = join(TMP, 'export3.json'); writeFileSync(inv3, JSON.stringify(d3));
  for (const [img, why] of [['https://evil.example/x.png', /refused/], ['/img/redirect', /redirects are refused/], ['/img/notpng', /not a PNG/]]) {
    await withMockFigma(figmaHandler(port => ({ '9:20': img.startsWith('/') ? `http://127.0.0.1:${port}${img}` : img })), async (base, seen) => {
      const r = await runExport(base, ['--inventory', inv3, '--id', 'p1.editor.publish-menu', '--out', join(TMP, 'o3')]);
      assert.equal(r.code, 1, r.out); assert.match(r.out, why);
      assert.ok(!seen.some(s => s.url === '/img/ok'), 'a redirect is never followed');
    });
  }
  assert.equal(existsSync(join(TMP, 'o3', 'p1.editor.publish-menu.png')), false);
});
await test('figma-export needs FIGMA_TOKEN and reports a token the API refuses', async () => {
  const { d } = annotatedInventory();
  const inv = join(TMP, 'export4.json'); writeFileSync(inv, JSON.stringify(d));
  await withMockFigma(figmaHandler(() => ({})), async base => {
    assert.match((await runExport(base, ['--inventory', inv, '--id', 'p1.editor.publish-menu', '--out', join(TMP, 'o4')], { FIGMA_TOKEN: '' })).out, /set FIGMA_TOKEN/);
    const r = await runExport(base, ['--inventory', inv, '--id', 'p1.editor.publish-menu', '--out', join(TMP, 'o4')], { FIGMA_TOKEN: 'wrong' });
    assert.equal(r.code, 1); assert.match(r.out, /HTTP 403/); assert.doesNotMatch(r.out, /wrong/);
  });
});

// ---------- gdocs-manifest ----------
function handedOff() {
  const d = valid();
  const r = rec(d, 'p1.editor.shell');
  r.source.docs_document_id = GDOC;
  return d;
}
await test('gdocs-manifest pins each image to a commit, carries the alt text and match fingerprints, and lists what it skips', () => {
  const m = buildManifest(handedOff(), { repo: 'owner/docs', ref: SHA40, assetsRoot: 'assets/' });
  assert.equal(m.entries.length, 1);
  const e = m.entries[0], r = rec(valid(), 'p1.editor.shell');
  assert.equal(e.document_id, GDOC);
  assert.deepEqual(e.image, { repo: 'owner/docs', ref: SHA40, path: `assets/${r.asset.path}`, sha256: r.asset.sha256, width: r.asset.width, height: r.asset.height });
  assert.deepEqual(e.alt, { title: r.content.alt_text, description: r.content.alt_text });
  assert.deepEqual(e.match, { title: null, fingerprints: [altFingerprint(r.content.alt_text)] });
  assert.ok(m.skipped.some(s => s.id === 'p1.editor.blocks-browser' && /status is approved/.test(s.reason)));
  const anchored = buildManifest(handedOff(), { repo: 'owner/docs', ref: SHA40, titleAnchor: true }).entries[0];
  assert.equal(anchored.alt.title, 'p1.editor.shell'); assert.equal(anchored.match.title, 'p1.editor.shell'); assert.equal(anchored.image.path, r.asset.path);
});
await test('gdocs-manifest refuses a branch name, a malformed repo, and an assets root outside the repository, and skips non-Google doc IDs', () => {
  assert.throws(() => buildManifest(handedOff(), { repo: 'owner/docs', ref: 'main' }), /40-character commit/);
  assert.throws(() => buildManifest(handedOff(), { repo: 'not a repo', ref: SHA40 }), /owner\/name/);
  assert.throws(() => buildManifest(handedOff(), { repo: 'owner/docs', ref: SHA40, assetsRoot: '../up' }), /inside the repository/);
  const m = buildManifest(valid(), { repo: 'owner/docs', ref: SHA40 });
  assert.equal(m.entries.length, 0); assert.ok(m.skipped.some(s => s.id === 'p1.editor.shell' && /not a Google Doc ID/.test(s.reason)));
});

// ---------- Code.gs ----------
const CODE = readFileSync(join(ROOT, 'templates/gdocs-swap/Code.gs'), 'utf-8');
const signed = buf => [...buf].map(b => (b > 127 ? b - 256 : b));
class FakeImage {
  constructor(o) { Object.assign(this, { title: '', desc: '', width: 100, height: 50, parent: null }, o); }
  getAltTitle() { return this.title; } getAltDescription() { return this.desc; }
  getWidth() { return this.width; } getHeight() { return this.height; } getParent() { return this.parent; }
  setWidth(w) { this.width = w; return this; } setHeight(h) { this.height = h; return this; }
  setAltTitle(t) { this.title = t; return this; } setAltDescription(t) { this.desc = t; return this; }
  removeFromParent() { this.parent.children.splice(this.parent.children.indexOf(this), 1); this.parent = null; }
}
class FakePara {
  constructor(imgs) { this.children = imgs; imgs.forEach(i => { i.parent = this; }); }
  getChildIndex(c) { return this.children.indexOf(c); }
  insertInlineImage(i, blob) { const img = new FakeImage({ width: blob.w, height: blob.h, parent: this, bytes: blob.bytes }); this.children.splice(i, 0, img); return img; }
}
function sandbox({ docs, files, props }) {
  const calls = [], saved = [];
  const blob = buf => ({ getBytes: () => signed(buf), getDataAsString: () => buf.toString('utf-8'), w: buf.length > 23 ? buf.readUInt32BE(16) : 0, h: buf.length > 23 ? buf.readUInt32BE(20) : 0, bytes: buf });
  const ctx = {
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] ?? null }) },
    DocumentApp: { openById: id => { if (!docs[id]) throw new Error('no access'); return { getBody: () => ({ getImages: () => docs[id].flatMap(p => p.children) }), saveAndClose: () => saved.push(id) }; } },
    UrlFetchApp: { fetch: (url, opts) => { calls.push({ url, opts }); const f = files[url]; return { getResponseCode: () => (f ? 200 : 404), getBlob: () => blob(f) }; } },
    Utilities: { DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' }, computeDigest: (_a, input) => signed(createHash('sha256').update(typeof input === 'string' ? Buffer.from(input, 'utf-8') : Buffer.from(input.map(b => b & 255))).digest()) },
    Logger: { log: () => {} },
  };
  vm.createContext(ctx); vm.runInContext(CODE, ctx);
  return { ctx, calls, saved };
}
const ghUrl = (path, ref = SHA40) => `https://api.github.com/repos/owner/docs/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${ref}`;
const OLD_ALT = 'An older description of the editor header and panels.';
function swapWorld({ newBytes = png(2880, 1800, 3), recordedSha, extraImage = false, altInDoc = OLD_ALT } = {}) {
  const old = new FakeImage({ desc: altInDoc, width: 600, height: 375 });
  const other = new FakeImage({ desc: 'A photo of a dragon.', width: 300, height: 300 });
  const imgs = [other, old]; if (extraImage) imgs.push(new FakeImage({ desc: OLD_ALT }));
  const para = new FakePara(imgs);
  const NEW_ALT = 'The P1 editor with four numbered areas: 1 the Blocks panel, 2 the page canvas, 3 page settings, 4 the Review button.';
  const manifest = { version: 1, repo: 'owner/docs', ref: SHA40, entries: [{
    screenshot_id: 'p1.editor.shell', release: '0.20.0', document_id: GDOC,
    image: { repo: 'owner/docs', ref: SHA40, path: 'screenshots/p1.editor.shell/0.20.0.png', sha256: recordedSha || sha(newBytes), width: 2880, height: 1800 },
    alt: { title: NEW_ALT, description: NEW_ALT }, match: { title: null, fingerprints: [altFingerprint(OLD_ALT)] } }], skipped: [] };
  const files = { [ghUrl('swap/manifest.json')]: Buffer.from(JSON.stringify(manifest)), [ghUrl('screenshots/p1.editor.shell/0.20.0.png')]: newBytes };
  const props = { GITHUB_TOKEN: 'gh-test', MANIFEST_REPO: 'owner/docs', MANIFEST_PATH: 'swap/manifest.json', MANIFEST_REF: SHA40 };
  return { ...sandbox({ docs: { [GDOC]: [para] }, files, props }), para, old, other, NEW_ALT, newBytes };
}

await test('Code.gs fingerprints alt text exactly like the inventory', () => {
  const { ctx } = swapWorld();
  for (const t of ['The P1 editor  with\nfour areas', 'ＡＢＣ caps', '']) assert.equal(ctx.fingerprint_(t), altFingerprint(t), JSON.stringify(t));
});
await test('Code.gs dry run fetches and checks everything but edits nothing', () => {
  const w = swapWorld();
  const rep = w.ctx.dryRunSwap();
  assert.equal(rep.dryRun, true);
  assert.equal(rep.results[0].status, 'would-replace');
  assert.equal(rep.results[0].old_alt, OLD_ALT);
  assert.deepEqual(w.para.children, [w.other, w.old]); assert.equal(w.old.desc, OLD_ALT);
  assert.deepEqual(w.saved, []);
});
await test('Code.gs replaces the matched image in place at the same width, writes the alt text, and leaves other images alone', () => {
  const w = swapWorld();
  const rep = w.ctx.runSwap();
  assert.equal(rep.results[0].status, 'replaced', JSON.stringify(rep));
  const [first, fresh] = w.para.children;
  assert.equal(first, w.other, 'the unrelated image is untouched and order is kept');
  assert.equal(w.para.children.length, 2); assert.equal(w.old.parent, null, 'the old image is removed');
  assert.equal(fresh.bytes, w.newBytes);
  assert.equal(fresh.width, 600); assert.equal(fresh.height, 375, 'height follows the 2880x1800 ratio');
  assert.equal(fresh.desc, w.NEW_ALT); assert.equal(fresh.title, w.NEW_ALT);
  assert.deepEqual(w.saved, [GDOC]);
  for (const c of w.calls) {
    assert.match(c.url, /^https:\/\/api\.github\.com\/repos\/owner\/docs\/contents\/.+\?ref=a{40}$/);
    assert.equal(c.opts.headers.Authorization, 'Bearer gh-test'); assert.equal(c.opts.followRedirects, false);
  }
});
await test('Code.gs never inserts bytes whose checksum differs from the manifest, and reports missing and ambiguous matches', () => {
  let w = swapWorld({ recordedSha: 'b'.repeat(64) });
  assert.equal(w.ctx.runSwap().results[0].status, 'checksum-mismatch');
  assert.equal(w.old.parent, w.para, 'nothing replaced');
  w = swapWorld({ altInDoc: 'Something else entirely, not this record.' });
  assert.equal(w.ctx.runSwap().results[0].status, 'not-found');
  w = swapWorld({ extraImage: true });
  assert.equal(w.ctx.runSwap().results[0].status, 'ambiguous');
  assert.equal(w.old.parent, w.para);
});
await test('Code.gs refuses missing properties, a branch name as the ref, and images from another repository', () => {
  const w = swapWorld();
  const ctx = sandbox({ docs: {}, files: {}, props: { GITHUB_TOKEN: 't', MANIFEST_REPO: 'owner/docs', MANIFEST_PATH: 'm.json' } }).ctx;
  assert.throws(() => ctx.dryRunSwap(), /MANIFEST_REF/);
  const ctx2 = sandbox({ docs: {}, files: {}, props: { GITHUB_TOKEN: 't', MANIFEST_REPO: 'owner/docs', MANIFEST_PATH: 'm.json', MANIFEST_REF: 'main' } }).ctx;
  assert.throws(() => ctx2.dryRunSwap(), /40-character/);
  assert.throws(() => w.ctx.githubFile_({ repo: 'owner/docs', token: 't' }, 'other/repo', 'x.png', SHA40), /only used for MANIFEST_REPO/);
  assert.throws(() => w.ctx.githubFile_({ repo: 'owner/docs', token: 't' }, 'owner/docs', '../x.png', SHA40), /refusing path/);
});

await test('Code.gs takes the manifest settings from Config.gs but never the token, and a script property overrides the file', () => {
  const props = { GITHUB_TOKEN: 'gh-test' };
  const { ctx } = sandbox({ docs: {}, files: {}, props });
  ctx.SWAP_CONFIG = { MANIFEST_REPO: 'owner/docs', MANIFEST_PATH: 'swap/manifest.json', MANIFEST_REF: SHA40, GITHUB_TOKEN: 'from-file' };
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.props_())), { token: 'gh-test', repo: 'owner/docs', path: 'swap/manifest.json', ref: SHA40 });
  props.MANIFEST_PATH = 'other/manifest.json';
  assert.equal(ctx.props_().path, 'other/manifest.json', 'a script property wins over Config.gs');
  delete props.GITHUB_TOKEN;
  assert.throws(() => ctx.props_(), /GITHUB_TOKEN/, 'a token in Config.gs is never used');
});

const { tokenUrl, writeAppsScriptProject } = await import('../scripts/setup.mjs');
await test('setup prefills a read-only, one-owner, expiring GitHub token form and refuses a malformed repository', () => {
  const u = new URL(tokenUrl('owner/docs'));
  assert.equal(u.origin + u.pathname, 'https://github.com/settings/personal-access-tokens/new');
  assert.equal(u.searchParams.get('contents'), 'read');
  assert.equal(u.searchParams.get('target_name'), 'owner');
  assert.equal(u.searchParams.get('expires_in'), '90');
  assert.ok(u.searchParams.get('name').length <= 40);
  assert.deepEqual([...u.searchParams.keys()].sort(), ['contents', 'description', 'expires_in', 'name', 'target_name'], 'no other permission is requested');
  assert.throws(() => tokenUrl('not a repo'), /owner\/name/);
});
await test('setup writes the Apps Script project with non-secret config only, and refuses unsafe values', () => {
  const dir = join(TMP, 'gas');
  const cfg = writeAppsScriptProject(dir, { repo: 'owner/docs', manifestPath: 'release-swap/0.20.0.json', manifestRef: SHA40 });
  assert.deepEqual(cfg, { MANIFEST_REPO: 'owner/docs', MANIFEST_PATH: 'release-swap/0.20.0.json', MANIFEST_REF: SHA40 });
  assert.equal(readFileSync(join(dir, 'Code.gs'), 'utf-8'), CODE);
  const config = readFileSync(join(dir, 'Config.gs'), 'utf-8');
  assert.doesNotMatch(config, /"GITHUB_TOKEN"|ghp_|github_pat_/);
  const ctx = vm.createContext({}); vm.runInContext(config, ctx);
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.SWAP_CONFIG)), cfg);
  assert.deepEqual(JSON.parse(readFileSync(join(dir, 'appsscript.json'), 'utf-8')).oauthScopes, ['https://www.googleapis.com/auth/documents', 'https://www.googleapis.com/auth/script.external_request'], 'only the two scopes the swap needs');
  assert.throws(() => writeAppsScriptProject(dir, { repo: 'owner/docs', manifestPath: '../x.json' }), /inside the repository/);
  assert.throws(() => writeAppsScriptProject(dir, { repo: 'owner/docs', manifestPath: 'm.json', manifestRef: 'main' }), /40-character/);
});
await test('the Figma plugin build is current and embeds every kit component', () => {
  const r = spawnSync(process.execPath, [join(ROOT, 'scripts/build-figma-plugin.mjs'), '--check'], { encoding: 'utf-8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const kit = JSON.parse(readFileSync(join(ROOT, 'figma-plugin/kit.json'), 'utf-8'));
  assert.deepEqual(kit.components.map(c => c.n), ['Step badge', 'Callout label', 'Highlight box', 'Arrow', 'Key cap', 'Redact', 'Dim overlay', 'Click indicator', 'Note box', 'Do / Dont marker', 'Highlight ellipse', 'Underline', 'Cursor']);
  const variants = kit.components.reduce((n, c) => n + (c.k === 'COMPONENT_SET' ? c.ch.length : 1), 0);
  assert.equal(variants, 72, '70 variants in 11 sets plus 2 single components');
  const manifest = JSON.parse(readFileSync(join(ROOT, 'figma-plugin/manifest.json'), 'utf-8'));
  assert.deepEqual(manifest.networkAccess, { allowedDomains: ['none'] }, 'the plugin makes no network requests');
  assert.equal(manifest.main, 'code.js');
});

console.log(`${passed} passed, ${failed} failed (release-swap)`);
process.exit(failed ? 1 : 0);
