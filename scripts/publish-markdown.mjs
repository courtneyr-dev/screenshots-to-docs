#!/usr/bin/env node
/**
 * p1-editor-screenshots / publish-markdown
 *
 * Swaps screenshots in a Markdown docs repository for the release recorded in the inventory.
 * The docs repo keeps a map from screenshot ID to the image file its pages embed:
 *
 *   screenshots.map.json  { "images": { "p1.editor.shell": "docs/images/editor-shell.png" } }
 *
 * For each mapped ID, the recorded asset (assets/screenshots/<id>/<release>.png) is copied over the
 * mapped file, and every Markdown image that points at that file gets the inventory's alt text.
 * Image paths never change, so a release swap is a file replacement and a reviewable diff.
 *
 * Usage:
 *   node publish-markdown.mjs --inventory inventory.json --assets-dir assets --repo ../docs-repo
 *     [--map <repo>/screenshots.map.json] [--branch screenshots/0.20.0] [--dry-run]
 *
 * --branch creates that branch in the docs repo and commits only the changed files. Nothing is
 * pushed: the script prints the push command for a person to run.
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, realpathSync, copyFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { join, resolve, relative, dirname, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadInventory, sha256 } from './lib/inventory.mjs';

const { values } = parseArgs({
  options: {
    inventory: { type: 'string' }, 'assets-dir': { type: 'string' }, repo: { type: 'string' },
    map: { type: 'string' }, branch: { type: 'string' }, 'dry-run': { type: 'boolean' }, help: { type: 'boolean', short: 'h' },
  },
});
const fail = msg => { console.error(`FAIL: ${msg}`); process.exit(1); };
if (values.help || !values.inventory || !values['assets-dir'] || !values.repo) {
  console.log('Usage: node publish-markdown.mjs --inventory <file> --assets-dir <dir> --repo <docs repo> [--map <file>] [--branch <name>] [--dry-run]');
  process.exit(values.help ? 0 : 1);
}

const repo = realpathSync(resolve(values.repo));
const assetsDir = resolve(values['assets-dir']);
const mapFile = resolve(values.map || join(repo, 'screenshots.map.json'));
if (!existsSync(mapFile)) fail(`no screenshot map at ${mapFile}`);
let map;
try { map = JSON.parse(readFileSync(mapFile, 'utf-8')).images; } catch (e) { fail(`${mapFile} is not valid JSON: ${e.message}`); }
if (!map || typeof map !== 'object') fail(`${mapFile} needs an "images" object`);
const { doc } = loadInventory(values.inventory);
const byId = new Map(doc.records.map(r => [r.screenshot_id, r]));

// Resolve a mapped path inside the repo, refusing anything that escapes it or isn't a PNG.
const inRepo = p => {
  if (typeof p !== 'string' || !/\.png$/i.test(p)) return null;
  const abs = resolve(repo, p);
  const rel = relative(repo, abs);
  if (!rel || rel.startsWith('..') || rel.split(sep).includes('.git')) return null;
  const parent = existsSync(dirname(abs)) ? realpathSync(dirname(abs)) : null;
  if (parent && relative(repo, parent).startsWith('..')) return null;
  return abs;
};

// Check everything before writing anything.
const plan = [];
for (const [id, target] of Object.entries(map)) {
  const r = byId.get(id);
  if (!r) fail(`map names ${id}, which is not in the inventory`);
  if (r.status === 'retired') fail(`${id} is retired; remove it from the map and the docs`);
  const dest = inRepo(target);
  if (!dest) fail(`${id}: map path "${target}" must be a .png inside the docs repo`);
  if (!r.asset?.path || !r.asset?.sha256) fail(`${id}: no recorded asset; run record-capture or record-asset first`);
  const src = join(assetsDir, r.asset.path);
  if (!existsSync(src)) fail(`${id}: asset file ${src} not found`);
  const buf = readFileSync(src);
  if (sha256(buf) !== r.asset.sha256) fail(`${id}: ${src} does not match the recorded checksum`);
  const alt = (r.content?.alt_text || '').trim();
  if (!alt) fail(`${id}: alt text is missing in the inventory; the docs image needs it`);
  plan.push({ id, release: r.capture?.release, src, buf, dest, alt });
}

const mdFiles = [];
const walk = d => { for (const n of readdirSync(d)) { if (n === '.git' || n === 'node_modules') continue; const p = join(d, n); const s = statSync(p); if (s.isDirectory()) walk(p); else if (/\.mdx?$/i.test(n)) mdFiles.push(p); } };
walk(repo);
const escAlt = s => s.replace(/[\r\n]+/g, ' ').replace(/([[\]\\])/g, '\\$1');

const changed = new Set();
const report = [];
for (const p of plan) {
  const before = existsSync(p.dest) ? sha256(readFileSync(p.dest)) : null;
  const imageChanged = before !== sha256(p.buf);
  let altEdits = 0;
  for (const md of mdFiles) {
    const text = readFileSync(md, 'utf-8');
    const next = text.replace(/!\[((?:\\.|[^\]\\])*)\]\(([^)\s]+)((?:\s+"[^"]*")?)\)/g, (m, alt, url, title) => {
      if (/^[a-z]+:/i.test(url) || resolve(dirname(md), decodeURI(url)) !== p.dest) return m;
      const want = escAlt(p.alt);
      if (alt === want) return m;
      altEdits++;
      return `![${want}](${url}${title})`;
    });
    if (next !== text) { if (!values['dry-run']) writeFileSync(md, next); changed.add(md); }
  }
  if (imageChanged) { if (!values['dry-run']) copyFileSync(p.src, p.dest); changed.add(p.dest); }
  report.push(`${imageChanged ? 'SWAP' : 'same'}  ${p.id}  -> ${relative(repo, p.dest)}${altEdits ? `  (alt text updated in ${altEdits} place${altEdits > 1 ? 's' : ''})` : ''}`);
}
console.log(report.join('\n'));
const releases = [...new Set(plan.map(p => p.release).filter(Boolean))].join(', ');
console.log(`\n${changed.size} file(s) ${values['dry-run'] ? 'would change' : 'changed'} for release ${releases || '(unknown)'}.`);

if (values.branch && changed.size && !values['dry-run']) {
  const git = (...a) => { const r = spawnSync('git', ['-C', repo, ...a], { encoding: 'utf-8' }); if (r.status !== 0) fail(`git ${a.join(' ')}: ${r.stderr.trim()}`); return r.stdout.trim(); };
  const current = git('rev-parse', '--abbrev-ref', 'HEAD');
  if (current !== values.branch) git('checkout', '-b', values.branch);
  git('add', '--', ...[...changed].map(f => relative(repo, f)));
  git('commit', '-m', `Refresh P1 screenshots for ${releases}`, '-m', plan.map(p => `- ${p.id}`).join('\n'));
  console.log(`Committed on ${values.branch}: ${git('rev-parse', '--short', 'HEAD')}. Nothing was pushed.`);
  console.log(`Push when reviewed: git -C ${values.repo} push -u origin ${values.branch}`);
}
