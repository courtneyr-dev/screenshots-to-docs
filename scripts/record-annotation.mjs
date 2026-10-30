#!/usr/bin/env node
/**
 * screenshots-to-docs / record-annotation
 *
 * Verifies and records the annotated frame of one shot of a run, so `handoff.mjs` can check that every shot
 * was annotated before it writes the docs handoff note.
 *
 * It does not accept a claim. It reads the annotation manifest extracted from Figma (scripts/figma-annotation.mjs)
 * and the exported annotated PNG, runs the checks in scripts/lib/annotation.mjs against the token contract
 * (figma-plugin/annotation-tokens.json), and writes the proof:
 *
 *   <run>/review/<slug>.manifest.json     the manifest that was verified
 *   <run>/review/<slug>.validation.json   every check, its result, and what still needs a person
 *   <run>/annotated/<slug>.png            the annotated export (never the clean capture)
 *   <run>/annotation-record.json          the record the handoff gate reads
 *
 * The clean capture stays where capture.mjs wrote it, unmodified; its checksum is recorded.
 * A shot is `complete` only when every automated check passes and a named person has confirmed the human
 * review items (--human-reviewed "<name>"). Without that name the status is `pending-human-review`.
 *
 * Usage:
 *   node record-annotation.mjs --dir <out>/run1 --slug editor-shell --manifest manifest.json --export annotated.png
 *     [--human-reviewed "<name>"] [--inventory <file>] [--alt-text "<text>" --alt-subject "<screen>"]
 *     [--sensitive <file>] [--clean-node-id 84:13] [--annotated-node-id 87:2]
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { resolve, join } from 'node:path';
import { loadInventory } from './lib/inventory.mjs';
import { loadTokens, kitDefs, verifyAnnotation, tokensIdentity, cleanCapture, decodePng, sha256, RECORD_FILE } from './lib/annotation.mjs';

const { values } = parseArgs({
  options: {
    dir: { type: 'string' },
    slug: { type: 'string' },
    manifest: { type: 'string' },
    export: { type: 'string' },
    inventory: { type: 'string' },
    'alt-text': { type: 'string' },
    'alt-subject': { type: 'string' },
    sensitive: { type: 'string' },
    'human-reviewed': { type: 'string' },
    'annotated-node-id': { type: 'string' },
    'clean-node-id': { type: 'string' },
    'kit-only': { type: 'boolean' },
    redacted: { type: 'boolean' },
    help: { type: 'boolean', short: 'h' },
  },
});

const fail = msg => { console.error(`FAIL: ${msg}`); process.exit(1); };

if (values.help || !values.dir || !values.slug || !values.manifest || !values.export) {
  console.log(`Usage: node record-annotation.mjs --dir <run folder> --slug <shot slug> --manifest <manifest.json> --export <annotated.png>
       [--human-reviewed "<name>"] [--inventory <file>] [--alt-text "<text>"] [--alt-subject "<screen>"] [--sensitive <file>]
       [--clean-node-id <id>] [--annotated-node-id <id>]

Get the manifest by running the code from: node scripts/figma-annotation.mjs --clean-node-id <id> --annotated-node-id <id>`);
  process.exit(values.help ? 0 : 1);
}
if (values['kit-only'] || values.redacted) {
  fail('--kit-only and --redacted were claims, and are no longer accepted. Pass --manifest (read out of Figma by scripts/figma-annotation.mjs) and --export (the annotated PNG) so the repository can check them, and --human-reviewed "<name>" once a person has looked at the export.');
}

const dir = resolve(values.dir);
const planFile = join(dir, 'figma-plan.json');
if (!existsSync(planFile)) fail(`${planFile} not found. Run scripts/figma-plan.mjs for this run first.`);
const plan = JSON.parse(readFileSync(planFile, 'utf-8'));
const slugs = [...new Set((plan.rows || []).map(r => r.slug))];
if (!slugs.includes(values.slug)) fail(`"${values.slug}" is not a shot in this run. Shots: ${slugs.join(', ')}.`);
const reportFile = join(dir, 'capture-report.json');
if (!existsSync(reportFile)) fail(`${reportFile} not found. Run scripts/capture.mjs first.`);
const report = JSON.parse(readFileSync(reportFile, 'utf-8'));

const readJson = (file, what) => {
  const p = resolve(file);
  if (!existsSync(p)) fail(`${what} ${p} not found.`);
  try { return JSON.parse(readFileSync(p, 'utf-8')); } catch (e) { return fail(`${what} ${p} is not valid JSON: ${e.message}`); }
};
const manifest = readJson(values.manifest, 'the manifest');
if (values.sensitive) manifest.sensitive = readJson(values.sensitive, 'the sensitive regions file');

let clean;
try { clean = cleanCapture(dir, report, values.slug); } catch (e) { fail(e.message); }
const exportFile = resolve(values.export);
if (!existsSync(exportFile)) fail(`the export ${exportFile} not found.`);
if (exportFile === resolve(clean.file)) fail('the export is the clean capture file. The annotated export must be a different file; the clean capture is never replaced.');
const exportBuf = readFileSync(exportFile);
let exportPng;
try { exportPng = decodePng(exportBuf); } catch (e) { fail(`${exportFile}: ${e.message}. Export the annotated frame as an 8-bit RGB or RGBA PNG without interlacing.`); }

let inventory = null;
let alt = values['alt-text'] ? { text: values['alt-text'], subject: values['alt-subject'] || '' } : null;
if (values.inventory) {
  const inv = loadInventory(resolve(values.inventory));
  const id = clean.row.screenshotId;
  inventory = inv.doc.records.find(r => r.screenshot_id === id) || null;
  if (!inventory) fail(`${id || values.slug} is not in ${inv.file} (inventory gap).`);
  if (!alt && inventory.content?.alt_text) alt = { text: inventory.content.alt_text, subject: values['alt-subject'] || '' };
}

const tokens = loadTokens();
const result = verifyAnnotation({
  tokens,
  kit: kitDefs(),
  manifest,
  clean: { sha256: clean.sha256, width: clean.width, height: clean.height, dpr: clean.row.dpr || 1, png: clean.png },
  export: { sha256: sha256(exportBuf), width: exportPng.w, height: exportPng.h, png: exportPng },
  inventory,
  recorded: { cleanNodeId: values['clean-node-id']?.replace('-', ':'), annotatedNodeId: values['annotated-node-id']?.replace('-', ':') },
  alt,
});

const reviewDir = join(dir, 'review');
mkdirSync(reviewDir, { recursive: true });
const now = new Date().toISOString();
const exportRel = join('annotated', `${values.slug}.png`);
const source = { path: clean.file, sha256: clean.sha256, width: clean.width, height: clean.height, dpr: clean.row.dpr || 1 };
writeFileSync(join(reviewDir, `${values.slug}.manifest.json`), JSON.stringify(manifest, null, 2) + '\n');
writeFileSync(join(reviewDir, `${values.slug}.validation.json`), JSON.stringify({
  slug: values.slug, runId: plan.runId, verifiedAt: now, status: result.status, tokens: tokensIdentity(tokens),
  source, export: { path: exportRel, sha256: sha256(exportBuf), width: exportPng.w, height: exportPng.h },
  cleanFrameId: manifest.cleanFrame?.id || null, annotatedFrameId: manifest.annotatedFrame?.id || null,
  checks: result.checks, humanReview: result.humanReview,
}, null, 2) + '\n');

const recFile = join(dir, RECORD_FILE);
const rec = existsSync(recFile) ? JSON.parse(readFileSync(recFile, 'utf-8')) : { runId: plan.runId, frames: {} };
rec.runId = plan.runId;

for (const c of result.checks) {
  const mark = c.status === 'pass' ? 'PASS' : c.status === 'fail' ? 'FAIL' : c.status === 'review' ? 'REVIEW' : 'SKIP';
  console.log(`${mark.padEnd(6)} ${c.id}: ${c.detail}`);
}

if (result.status === 'fail') {
  rec.frames[values.slug] = { status: 'rejected', recordedAt: now, annotatedNodeId: manifest.annotatedFrame?.id, verification: { status: 'fail', failed: result.summary.failed, report: join('review', `${values.slug}.validation.json`) } };
  writeFileSync(recFile, JSON.stringify(rec, null, 2) + '\n');
  fail(`${values.slug}: ${result.summary.failed.length} check${result.summary.failed.length === 1 ? '' : 's'} failed (${result.summary.failed.join(', ')}). Fix the Figma frame and re-run. The proof is in ${join(reviewDir, `${values.slug}.validation.json`)}.`);
}

mkdirSync(join(dir, 'annotated'), { recursive: true });
copyFileSync(exportFile, join(dir, exportRel));
const reviewer = values['human-reviewed']?.trim();
rec.frames[values.slug] = {
  annotatedNodeId: manifest.annotatedFrame.id,
  cleanNodeId: manifest.cleanFrame.id,
  status: reviewer ? 'complete' : 'pending-human-review',
  recordedAt: now,
  tokens: tokensIdentity(tokens),
  source,
  export: { path: exportRel, sha256: sha256(exportBuf), width: exportPng.w, height: exportPng.h, scale: exportPng.w / manifest.annotatedFrame.width },
  verification: { status: 'pass', checks: result.checks.length, reviewed: result.summary.reviewed, skipped: result.summary.skipped, report: join('review', `${values.slug}.validation.json`) },
  humanReview: { required: result.humanReview, ...(reviewer ? { confirmedBy: reviewer, confirmedAt: now } : {}) },
};
writeFileSync(recFile, JSON.stringify(rec, null, 2) + '\n');
const left = slugs.filter(s => rec.frames[s]?.status !== 'complete');
console.log(`\nVerified ${values.slug} (annotated frame ${manifest.annotatedFrame.id}): ${result.checks.filter(c => c.status === 'pass').length} checks passed, ${result.humanReview.length} items for a person.`);
if (!reviewer) {
  console.log(`Status: pending-human-review. Open ${join(dir, exportRel)} and read ${join('review', `${values.slug}.validation.json`)}. Then re-run this command with --human-reviewed "<your name>":`);
  for (const h of result.humanReview) console.log(`  - ${h.id}: ${h.reason}`);
}
console.log(left.length ? `Still to complete: ${left.join(', ')}.` : 'All shots in this run are complete.');
