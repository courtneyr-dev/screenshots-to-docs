#!/usr/bin/env node
/**
 * Tests for scripts/publish-markdown.mjs: swapping release screenshots into a Markdown docs repo.
 * Needs Node and git. Prints PASS/FAIL lines in the format tests/run-tests.sh counts.
 */

import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, realpathSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), '..');
const SCRIPT = join(ROOT, 'scripts', 'publish-markdown.mjs');
const TMP = realpathSync(mkdtempSync(join(tmpdir(), 'publish-md-test-')));
process.on('exit', () => rmSync(TMP, { recursive: true, force: true }));

let passed = 0, failed = 0;
const test = (name, fn) => {
  try { fn(); console.log(`PASS  ${name}`); passed += 1; }
  catch (e) { console.log(`FAIL  ${name}`); console.log('        ' + String(e.message || e).split('\n').slice(0, 6).join('\n        ')); failed += 1; }
};
const sha = b => createHash('sha256').update(b).digest('hex');
const png = () => Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), randomBytes(64)]);
const git = (dir, ...a) => spawnSync('git', ['-C', dir, ...a], { encoding: 'utf-8' });

let n = 0;
// A fresh workspace: inventory + assets for one release, and a docs repo at the previous release.
function workspace({ alt = 'The P1 editor: 1 the Blocks panel, 2 the page canvas.', mapPath = 'docs/images/editor-shell.png', gitInit = false } = {}) {
  const w = join(TMP, `w${++n}`); mkdirSync(w);
  const buf = png();
  const assets = join(w, 'assets'); mkdirSync(join(assets, 'screenshots', 'p1.editor.shell'), { recursive: true });
  writeFileSync(join(assets, 'screenshots', 'p1.editor.shell', '0.20.0.png'), buf);
  const inv = { version: 1, records: [{ screenshot_id: 'p1.editor.shell', status: 'handed_off', capture: { release: '0.20.0' }, content: { alt_text: alt },
    asset: { path: 'screenshots/p1.editor.shell/0.20.0.png', sha256: sha(buf) } }] };
  writeFileSync(join(w, 'inventory.json'), JSON.stringify(inv));
  const repo = join(w, 'docs-repo'); mkdirSync(join(repo, 'docs', 'images'), { recursive: true });
  writeFileSync(join(repo, 'docs', 'images', 'editor-shell.png'), png());
  writeFileSync(join(repo, 'docs', 'tour.md'), '# Tour\n\n![old alt](images/editor-shell.png)\n\nText.\n\n![Other](images/other.png)\n');
  writeFileSync(join(repo, 'screenshots.map.json'), JSON.stringify({ images: { 'p1.editor.shell': mapPath } }));
  if (gitInit) {
    git(repo, 'init', '-q', '-b', 'main'); git(repo, 'config', 'user.email', 'test@example.com'); git(repo, 'config', 'user.name', 'test');
    git(repo, 'add', '.'); git(repo, 'commit', '-q', '-m', 'docs at 0.16.0');
  }
  return { w, buf, repo, inv: join(w, 'inventory.json'), assets };
}
const run = (ws, extra = []) => spawnSync(process.execPath, [SCRIPT, '--inventory', ws.inv, '--assets-dir', ws.assets, '--repo', ws.repo, ...extra], { encoding: 'utf-8' });

test('swaps the image file for the recorded asset and sets the inventory alt text', () => {
  const ws = workspace(); const r = run(ws);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(sha(readFileSync(join(ws.repo, 'docs/images/editor-shell.png'))), sha(ws.buf));
  const md = readFileSync(join(ws.repo, 'docs/tour.md'), 'utf-8');
  assert.match(md, /!\[The P1 editor: 1 the Blocks panel, 2 the page canvas\.\]\(images\/editor-shell\.png\)/);
  assert.match(md, /!\[Other\]\(images\/other\.png\)/, 'unmapped images are untouched');
  assert.match(r.stdout, /SWAP {2}p1\.editor\.shell/);
});
test('a second run changes nothing', () => {
  const ws = workspace(); run(ws); const r = run(ws);
  assert.equal(r.status, 0, r.stderr); assert.match(r.stdout, /same {2}p1\.editor\.shell/); assert.match(r.stdout, /0 file\(s\) changed/);
});
test('--dry-run reports the swap and writes nothing', () => {
  const ws = workspace(); const before = readFileSync(join(ws.repo, 'docs/images/editor-shell.png'));
  const r = run(ws, ['--dry-run']);
  assert.equal(r.status, 0, r.stderr); assert.match(r.stdout, /would change/);
  assert.deepEqual(readFileSync(join(ws.repo, 'docs/images/editor-shell.png')), before);
});
test('a map path that leaves the docs repo is refused before anything is written', () => {
  const ws = workspace({ mapPath: '../escape.png' }); const r = run(ws);
  assert.equal(r.status, 1); assert.match(r.stderr, /must be a \.png inside the docs repo/); assert.equal(existsSync(join(ws.w, 'escape.png')), false);
});
test('a map path through a symlinked folder that points outside the repo is refused', () => {
  const ws = workspace({ mapPath: 'docs/linked/escape.png' });
  const outside = join(ws.w, 'outside'); mkdirSync(outside);
  symlinkSync(outside, join(ws.repo, 'docs', 'linked'));
  const r = run(ws);
  assert.equal(r.status, 1); assert.match(r.stderr, /must be a \.png inside the docs repo/); assert.equal(existsSync(join(outside, 'escape.png')), false);
});
test('a record without alt text is refused', () => {
  const ws = workspace({ alt: '' }); const r = run(ws);
  assert.equal(r.status, 1); assert.match(r.stderr, /alt text is missing/);
});
test('an asset whose bytes do not match the recorded checksum is refused', () => {
  const ws = workspace(); writeFileSync(join(ws.assets, 'screenshots/p1.editor.shell/0.20.0.png'), png());
  const r = run(ws); assert.equal(r.status, 1); assert.match(r.stderr, /does not match the recorded checksum/);
});
test('--branch commits only the changed files on a new branch and pushes nothing', () => {
  const ws = workspace({ gitInit: true }); const r = run(ws, ['--branch', 'screenshots/0.20.0']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(git(ws.repo, 'rev-parse', '--abbrev-ref', 'HEAD').stdout.trim(), 'screenshots/0.20.0');
  const files = git(ws.repo, 'show', '--name-only', '--format=', 'HEAD').stdout.trim().split('\n').sort();
  assert.deepEqual(files, ['docs/images/editor-shell.png', 'docs/tour.md']);
  assert.match(git(ws.repo, 'log', '-1', '--format=%s').stdout, /Refresh P1 screenshots for 0\.20\.0/);
  assert.match(r.stdout, /Nothing was pushed/);
  assert.equal(git(ws.repo, 'remote').stdout.trim(), '');
});

console.log(`${passed} passed, ${failed} failed (publish-markdown)`);
process.exit(failed ? 1 : 0);
