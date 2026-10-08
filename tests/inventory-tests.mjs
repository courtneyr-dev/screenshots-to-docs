#!/usr/bin/env node
/**
 * Tests for the screenshot inventory (scripts/lib/inventory.mjs and scripts/inventory.mjs).
 * Needs only Node: no browser, no network, no P1, Figma, or Google access.
 * Prints PASS/FAIL lines in the format tests/run-tests.sh counts, and exits 1 if any test fails.
 */

import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve, delimiter } from 'node:path';
import { spawnSync } from 'node:child_process';
import { deflateSync, crc32 } from 'node:zlib';
import { createHash } from 'node:crypto';
import {
  validateInventory, gateErrors, transitionError, generateBrief, assetPath, altFingerprint, composeAnchor, publicationHealth,
  lookup, releaseReport, mappingFor, renderDocsHandoff, frameName, checkText, prerequisites, listRecords,
  parseVersion, compareVersions, releaseCheck, traceInventory, renderTrace,
} from '../scripts/lib/inventory.mjs';

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), '..');
const FX = join(ROOT, 'tests', 'fixtures', 'inventory');
const TMP = mkdtempSync(join(tmpdir(), 'inv-test-'));
process.on('exit', () => rmSync(TMP, { recursive: true, force: true }));

const load = name => JSON.parse(readFileSync(join(FX, name), 'utf-8'));
const valid = () => load('inventory.valid.json');
const rec = (doc, id) => doc.records.find(r => r.screenshot_id === id);
const clone = o => structuredClone(o);
const errs = (doc, opts) => validateInventory(doc, opts).errors;
const has = (list, id, field, text) => list.some(e => e.id === id && (!field || e.field === field) && (!text || e.message.includes(text)));
const cli = (args, opts = {}) => spawnSync('node', [join(ROOT, 'scripts', 'inventory.mjs'), ...args], { encoding: 'utf-8', ...opts });
const writeInv = (name, doc) => { const f = join(TMP, name); writeFileSync(f, JSON.stringify(doc, null, 2)); return f; };

// Strings that look like secrets or personal data are assembled here so no scanner flags this file.
const FAKE_TOKEN = 'gh' + 'p_' + 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4';
const FAKE_EMAIL = 'someone' + '@' + 'personal-mail.net';
const LOCAL_PATH = '/Us' + 'ers/someone/shot.png';

function png(w, h, seed = 0) {
  const rows = [];
  for (let y = 0; y < h; y++) { const row = Buffer.alloc(1 + w * 3); for (let x = 0; x < w * 3; x++) row[1 + x] = (x * 7 + y * 13 + seed) & 255; rows.push(row); }
  const chunk = (t, d) => { const b = Buffer.concat([Buffer.from(t), d]); const len = Buffer.alloc(4); len.writeUInt32BE(d.length); const c = Buffer.alloc(4); c.writeUInt32BE(crc32(b) >>> 0); return Buffer.concat([len, b, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))]);
}

let failed = 0, passed = 0;
const test = (name, fn) => {
  try { fn(); console.log(`PASS  ${name}`); passed += 1; }
  catch (e) { console.log(`FAIL  ${name}`); console.log('        ' + String(e.message || e).split('\n').slice(0, 8).join('\n        ')); failed += 1; }
};

console.log('== inventory: loading and schema');
test('the valid fixture loads with no errors (new, refresh, unchanged, retired, no-Figma, and a verified Google Docs mapping)', () => {
  const d = valid();
  assert.equal(d.records.length, 5);
  assert.deepEqual(errs(d), []);
  assert.deepEqual(new Set(d.records.map(r => r.release_status)), new Set(['new', 'refresh', 'unchanged', 'retire']));
});
test('the shipped empty inventory and the worked example validate', () => {
  assert.deepEqual(errs(JSON.parse(readFileSync(join(ROOT, 'inventory', 'screenshots.json'), 'utf-8'))), []);
  assert.deepEqual(errs(JSON.parse(readFileSync(join(ROOT, 'examples', 'inventory.example.json'), 'utf-8'))), []);
});
test('IDs must look like p1.topic.short-purpose; every bad ID is named', () => {
  for (const bad of ['P1.Editor.Shell', 'shell', 'p1..shell', 'p1.editor.shell!', 'p1.editor.-shell', '1p.editor.shell']) {
    const d = valid(); rec(d, 'p1.editor.publish-menu').screenshot_id = bad;
    assert.ok(has(errs(d), bad, 'screenshot_id'), `${bad} should be rejected`);
  }
});
test('duplicate IDs are rejected and name the field', () => {
  const d = valid(); d.records.push(clone(rec(d, 'p1.editor.publish-menu')));
  assert.ok(has(errs(d), 'p1.editor.publish-menu', 'screenshot_id', 'duplicate'));
});
test('invalid lifecycle, release-status, and priority values are rejected per field', () => {
  const d = valid(); const r = rec(d, 'p1.editor.publish-menu'); r.status = 'done'; r.release_status = 'maybe'; r.priority = 'urgent';
  const e = errs(d);
  assert.ok(has(e, r.screenshot_id, 'status') && has(e, r.screenshot_id, 'release_status') && has(e, r.screenshot_id, 'priority'));
});
test('unknown fields and wrongly typed sections are rejected (typos do not pass silently)', () => {
  const d = valid(); const r = rec(d, 'p1.editor.publish-menu'); r.sorce = {}; r.capture.actons = []; r.content.annotations = 'none';
  const e = errs(d);
  assert.ok(has(e, r.screenshot_id, '', 'sorce') && has(e, r.screenshot_id, 'capture.actons') && has(e, r.screenshot_id, 'content.annotations', 'list'));
});
test('duplicate active documentation anchors are rejected; a retired record may keep its anchor', () => {
  const d = valid();
  const dup = clone(rec(d, 'p1.editor.shell')); dup.screenshot_id = 'p1.editor.shell-copy'; dup.release_status = 'refresh'; dup.status = 'approved';
  d.records.push(dup);
  assert.ok(has(errs(d), 'p1.editor.shell-copy', 'publication.docs_image_slot', 'duplicate active'));
  const d2 = valid(); // the retired record uses slot "Tour the editor #2": a new active record may take it
  const next = clone(rec(d2, 'p1.editor.publish-menu')); next.screenshot_id = 'p1.editor.other'; next.source.docs_document_id = 'doc-fixture-0001'; next.source.docs_heading = 'Tour the editor'; next.publication.docs_image_slot = 'Tour the editor #2'; next.asset.path = assetPath('p1.editor.other', '2026.10');
  d2.records.push(next);
  assert.deepEqual(errs(d2), []);
});

console.log('== inventory: lifecycle and gates');
test('transitions: one step forward, back to approved, retire; skips and reviving a retired record are rejected', () => {
  assert.equal(transitionError('proposed', 'approved'), null);
  assert.equal(transitionError('verified', 'approved'), null);
  assert.equal(transitionError('captured', 'approved'), null);
  assert.equal(transitionError('inserted', 'retired'), null);
  assert.match(transitionError('approved', 'verified'), /not allowed/);
  assert.match(transitionError('proposed', 'captured'), /not allowed/);
  assert.match(transitionError('retired', 'approved'), /cannot be reactivated/);
});
test('comparing with an earlier inventory catches a skipped status, a deleted record, and an edited retired record', () => {
  const before = valid();
  const skip = valid(); rec(skip, 'p1.editor.blocks-browser').status = 'verified';
  assert.ok(has(errs(skip, { previous: before }), 'p1.editor.blocks-browser', 'status', 'not allowed'));
  const del = valid(); del.records = del.records.filter(r => r.screenshot_id !== 'p1.editor.shell');
  assert.ok(has(errs(del, { previous: before }), 'p1.editor.shell', '', 'retire it instead'));
  const edit = valid(); rec(edit, 'p1.editor.legacy-banner').owner = 'someone-else';
  assert.ok(has(errs(edit, { previous: before }), 'p1.editor.legacy-banner', '', 'must not change'));
});
test('contradictory statuses are rejected (retired without retire, unchanged before insertion, retired without a reason)', () => {
  const d = valid(); const r = rec(d, 'p1.editor.legacy-banner'); r.release_status = 'refresh'; delete r.retired_reason;
  const u = rec(d, 'p1.editor.publish-menu'); u.release_status = 'unchanged';
  const e = errs(d);
  assert.ok(has(e, r.screenshot_id, 'release_status', 'retire') && has(e, r.screenshot_id, 'retired_reason') && has(e, u.screenshot_id, 'release_status', 'unchanged'));
});
test('missing source and missing documentation destination fail before approval, naming each field', () => {
  const e = errs(load('inventory.missing-source.json'));
  for (const f of ['source.reason', 'source.docs_heading', 'source.docs_document_id']) assert.ok(has(e, 'p1.editor.no-source', f), `${f} should be required`);
  const d = valid(); delete rec(d, 'p1.editor.workstream-selector').publication.docs_image_slot; delete rec(d, 'p1.editor.workstream-selector').source.request_url;
  const e2 = errs(d);
  assert.ok(has(e2, 'p1.editor.workstream-selector', 'publication.docs_image_slot') && has(e2, 'p1.editor.workstream-selector', 'source.request_url'));
});
test('a proposed record needs no source yet, and prerequisites list exactly what approval needs', () => {
  const d = JSON.parse(readFileSync(join(ROOT, 'examples', 'inventory.example.json'), 'utf-8'));
  const p = rec(d, 'p1.editor.page-navigator');
  const pre = prerequisites(p);
  assert.equal(pre.next, 'approved');
  assert.deepEqual(pre.missing.map(m => m.field).sort(), ['publication.docs_image_slot', 'source.docs_document_id', 'source.docs_heading']);
});
test('capture state, actions, and checks are required before a record can be captured', () => {
  const g = rec(valid(), 'p1.editor.blocks-browser');
  for (const f of ['state', 'checks', 'actions']) { const r = clone(g); delete r.capture[f]; assert.ok(gateErrors(r, 'captured').some(x => x.field === `capture.${f}`), f); }
  const r = clone(g); r.capture.checks = []; assert.ok(gateErrors(r, 'captured').some(x => x.field === 'capture.checks'));
});
test('a captured record needs a checksum, size, time, and the deterministic asset path', () => {
  const r = clone(rec(valid(), 'p1.editor.publish-menu'));
  assert.deepEqual(gateErrors(r, 'captured'), []);
  for (const [f, v] of [['sha256', 'xyz'], ['width', 0], ['height', -1], ['captured_at', 'yesterday'], ['path', 'screenshots/wrong.png']]) {
    const x = clone(r); x.asset[f] = v; assert.ok(gateErrors(x, 'captured').some(g => g.field === `asset.${f}`), f);
  }
});
test('annotation needs Figma evidence, the exact clean frame name, and completed annotation (or a stated reason Figma was not used)', () => {
  const r = clone(rec(valid(), 'p1.editor.publish-menu'));
  assert.ok(gateErrors(r, 'annotated').some(g => g.field === 'figma.evidence'));
  r.figma = { evidence: 'uploaded', file_url: 'https://www.figma.com/design/ZzZzZzZzZzZzZzZzZzZzZz/Fixture', node_id: '9:9', annotation_status: 'complete', frame_name: frameName(r, 'clean') };
  assert.deepEqual(gateErrors(r, 'annotated'), []);
  r.figma.frame_name = frameName(r, 'annotated');
  assert.ok(gateErrors(r, 'annotated').some(g => g.field === 'figma.frame_name'), 'the annotated frame must not stand in for the clean frame');
  const n = clone(r); n.figma = { evidence: 'not_used' };
  assert.ok(gateErrors(n, 'annotated').some(g => g.field === 'figma.not_used_reason'));
  n.figma.not_used_reason = 'The image is a direct capture with no callouts.';
  assert.deepEqual(gateErrors(n, 'annotated'), []);
});
test('insertion needs the checksum and a time; verification needs published URL, published checksum, fingerprint, release, and verified checksum', () => {
  const r = clone(rec(valid(), 'p1.editor.shell'));
  assert.deepEqual(gateErrors(r, 'verified'), []);
  for (const f of ['published_url', 'published_sha256', 'verified_at', 'verified_release', 'alt_text_fingerprint', 'verified_asset_sha256']) {
    const x = clone(r); delete x.publication[f]; assert.ok(gateErrors(x, 'verified').some(g => g.field === `publication.${f}`), f);
  }
  const y = clone(r); delete y.publication.inserted_at; assert.ok(gateErrors(y, 'inserted').some(g => g.field === 'publication.inserted_at'));
  const z = clone(r); z.publication.published_url = 'http://cdn.example.com/x.png'; assert.ok(gateErrors(z, 'verified').some(g => g.field === 'publication.published_url'), 'http is not enough');
  const h = clone(r); h.publication.published_sha256 = 'not-a-checksum'; assert.ok(gateErrors(h, 'verified').some(g => g.field === 'publication.published_sha256'), 'a malformed published checksum is refused');
});
test('the published checksum may differ from the capture: publishing can resize or re-encode the image', () => {
  const r = clone(rec(valid(), 'p1.editor.shell'));
  assert.notEqual(r.publication.published_sha256, r.asset.sha256, 'the fixture models a resized published image');
  assert.deepEqual(gateErrors(r, 'verified'), []);
  assert.equal(publicationHealth(r).state, 'verified');
  const x = clone(r); delete x.publication.published_sha256;
  assert.equal(publicationHealth(x).state, 'unverifiable');
  assert.ok(publicationHealth(x).reasons.includes('no published_sha256'));
});

console.log('== inventory: captions, alt text, and secrets');
test('a missing alt text fails at handoff, and the fixture error names the record and field', () => {
  assert.ok(has(errs(load('inventory.missing-alt.json')), 'p1.editor.no-alt', 'content.alt_text', 'missing'));
});
test('mutation: removing the alt text from every record at handoff or later fails every one (no generic fallback)', () => {
  const d = valid();
  for (const r of d.records.filter(x => ['verified'].includes(x.status))) delete r.content.alt_text;
  assert.ok(has(errs(d), 'p1.editor.shell', 'content.alt_text'));
  const e = errs(load('inventory.missing-alt.json'));
  assert.equal(e.filter(x => x.field === 'content.alt_text').length, 1);
  // The handoff command refuses instead of substituting text.
  const f = writeInv('noalt.json', load('inventory.missing-alt.json'));
  const r = cli(['handoff', '--inventory', f]);
  assert.equal(r.status, 1);
  assert.ok(!/Generic|generic text/.test(r.stdout));
});
test('placeholder, generic, test-data, URL, local-path, and ID text is rejected in alt text and captions', () => {
  const id = 'p1.editor.shell';
  const bad = {
    placeholder: 'TO FILL', todo: 'TODO describe this later', braces: 'The {{pageLabel}} page in the editor shown here', angle: 'The <describe the page> in the editor',
    generic: 'Screenshot', short: 'P1 editor', lorem: 'Lorem ipsum dolor sit amet in the editor',
    url: 'The editor at https://example.org/p1 with the Blocks panel open on the left', local: `The editor saved at ${LOCAL_PATH} with the panel open`,
    id: `The editor shown in ${id} with the Blocks panel open on the left`, whitespace: ' The editor with the Blocks panel open on the left ', pipe: 'The editor | the Blocks panel open on the left',
  };
  for (const [k, text] of Object.entries(bad)) assert.ok(checkText('alt_text', text, id).errors.length > 0, `${k} should be rejected`);
  assert.ok(checkText('caption', 'See p1.editor.shell here', id).errors.length > 0, 'caption with the ID');
  assert.deepEqual(checkText('alt_text', 'The P1 editor with the Blocks panel open on the left and the page in the center.', id).errors, []);
  assert.ok(checkText('alt_text', 'Screenshot of the editor with the Blocks panel open on the left', id).warnings.length > 0, 'a leading "screenshot of" is a warning');
});
test('text is copied without mutation: the same strings appear in the brief, mapping, and handoff report', () => {
  const d = valid(); const r = rec(d, 'p1.editor.blocks-browser');
  const { brief } = generateBrief(d, { file: 'x.json' });
  const shot = brief.shots.find(s => s.screenshotId === r.screenshot_id);
  assert.equal(shot.caption, r.content.caption); assert.equal(shot.altText, r.content.alt_text);
  const m = mappingFor(r); assert.equal(m.content.caption, r.content.caption); assert.equal(m.content.alt_text, r.content.alt_text);
  assert.ok(renderDocsHandoff(d).markdown.includes(`- Alt text: ${r.content.alt_text}\n`));
});
test('secrets, tokens, signed URLs, credentials in URLs, and emails in metadata are rejected', () => {
  const cases = {
    token: FAKE_TOKEN, email: `contact ${FAKE_EMAIL}`, signed: 'https://cdn.example.com/a.png?X-Amz-Signature=abcdef123456', cred: 'https://user:hunter2x@example.com/a',
    assignment: 'password = hunter2hunter2', bearer: 'Bearer abcdefghijklmnopqrstuvwxyz',
  };
  for (const [k, v] of Object.entries(cases)) {
    const d = valid(); rec(d, 'p1.editor.publish-menu').capture.constraints = [v];
    assert.ok(errs(d).some(e => e.id === 'p1.editor.publish-menu' && /secrets|customer data/.test(e.message)), `${k} should be rejected`);
  }
  const ok = valid(); rec(ok, 'p1.editor.publish-menu').capture.constraints = ['Use a project with no customers listed. Contact docs-team@example.com.'];
  assert.deepEqual(errs(ok), []);
});
test('unresolved placeholders in record text are rejected', () => {
  const d = valid(); rec(d, 'p1.editor.publish-menu').capture.state = 'Menu open on {{pagePath}}';
  assert.ok(has(errs(d), 'p1.editor.publish-menu', 'capture.state', 'placeholder'));
});

console.log('== inventory: assets, briefs, identity');
test('asset paths are deterministic from ID and release, and a different path is rejected', () => {
  assert.equal(assetPath('p1.editor.shell', '2026.10'), 'screenshots/p1.editor.shell/2026.10.png');
  assert.equal(cli(['asset-path', '--id', 'p1.editor.blocks-browser', '--inventory', join(FX, 'inventory.valid.json')]).stdout.trim(), 'screenshots/p1.editor.blocks-browser/2026.10.png');
  assert.equal(cli(['asset-path', '--id', 'p1.editor.shell', '--release', 'v1.2', '--inventory', join(FX, 'inventory.valid.json')]).stdout.trim(), 'screenshots/p1.editor.shell/v1.2.png');
  assert.equal(cli(['asset-path', '--id', 'p1.editor.shell', '--release', '../x', '--inventory', join(FX, 'inventory.valid.json')]).status, 1);
});
test('the capture brief holds only approved records that need a new image, with their identity, text, actions, and checks', () => {
  const d = valid();
  const g = generateBrief(d, { file: 'inventory/screenshots.json', commit: 'abc1234' });
  assert.deepEqual(g.ready.sort(), ['p1.editor.blocks-browser', 'p1.editor.workstream-selector']);
  assert.deepEqual(g.blocked, []);
  const sel = g.brief.shots.find(s => s.screenshotId === 'p1.editor.workstream-selector');
  assert.equal(sel.slug, sel.screenshotId);
  assert.equal(sel.release, '2026.10');
  assert.deepEqual(sel.expectAfter, rec(d, sel.screenshotId).capture.checks);
  assert.ok('editorReady' in sel.actions[0] && 'selectWorkstream' in sel.actions[1]);
  assert.equal(sel.actions[2], 'openWorkstreamMenu');
  assert.equal(sel.actions.at(-1), 'openWorkstreamMenu', 'the menu a record opens on purpose is not closed again');
  const blk = g.brief.shots.find(s => s.screenshotId === 'p1.editor.blocks-browser');
  assert.equal(blk.actions.at(-1), 'workstreamMenuClosed');
  assert.deepEqual(g.brief.inventory, { file: 'inventory/screenshots.json', commit: 'abc1234', target: 'Fixture Project | qa-workstream | /about' });
});
test('a record that is not approved is never captured, and nothing is invented from other records', () => {
  const d = valid(); for (const r of d.records) if (r.status === 'approved') r.status = 'proposed';
  const g = generateBrief(d, { file: 'x' });
  assert.deepEqual(g.brief.shots, []); assert.deepEqual(g.ready, []);
  const f = writeInv('none-approved.json', d);
  const r = cli(['brief', '--inventory', f, '--out', join(TMP, 'b.json')]);
  assert.equal(r.status, 1); assert.match(r.stderr, /no approved records/);
});
test('an approved record missing capture inputs blocks the brief loudly, naming the fields', () => {
  const d = valid(); const r = rec(d, 'p1.editor.workstream-selector'); delete r.capture.state; r.capture.checks = [];
  const g = generateBrief(d, { file: 'x' });
  assert.deepEqual(g.blocked.map(b => b.id), ['p1.editor.workstream-selector']);
  assert.ok(g.blocked[0].missing.includes('capture.state') && g.blocked[0].missing.includes('capture.checks'));
  const f = writeInv('blocked.json', d);
  const c = cli(['brief', '--inventory', f, '--out', join(TMP, 'b2.json')]);
  assert.equal(c.status, 1); assert.match(c.stderr, /capture\.state/);
  assert.ok(!existsSync(join(TMP, 'b2.json')), 'no brief is written');
});
test('records for different capture targets need separate runs; the target must be chosen', () => {
  const d = valid(); const r = rec(d, 'p1.editor.workstream-selector'); r.capture.page = '/pricing';
  const g = generateBrief(d, { file: 'x' });
  assert.equal(g.brief.shots.length, 0); assert.equal(g.groups.length, 2);
  const t = generateBrief(d, { file: 'x', target: 'Fixture Project | qa-workstream | /pricing' });
  assert.deepEqual(t.brief.shots.map(s => s.screenshotId), ['p1.editor.workstream-selector']);
  assert.deepEqual(t.otherTargets.map(o => o.ids), [['p1.editor.blocks-browser']]);
  const f = writeInv('targets.json', d);
  assert.match(cli(['brief', '--inventory', f, '--out', join(TMP, 'b3.json')]).stderr, /none matches/);
});
test('asking for a record that is not approved by ID fails instead of skipping it', () => {
  const f = join(FX, 'inventory.valid.json');
  const r = cli(['brief', '--inventory', f, '--id', 'p1.editor.shell', '--out', join(TMP, 'b4.json')]);
  assert.equal(r.status, 1); assert.match(r.stderr, /not an approved record/);
});
test('list filters by status, release, owner, workstream, and release status', () => {
  const d = valid();
  assert.equal(listRecords(d, { status: 'approved' }).length, 2);
  assert.equal(listRecords(d, { release: '2026.09' }).length, 1);
  assert.equal(listRecords(d, { owner: 'docs-team' }).length, 5);
  assert.equal(listRecords(d, { workstream: 'qa-workstream', releaseStatus: 'refresh' }).length, 2);
  assert.equal(listRecords(d, { owner: 'nobody' }).length, 0);
});
test('recording an exported PNG sets checksum, size, and the deterministic path, and copies it into the assets folder', () => {
  const d = valid(); const f = writeInv('asset.json', d);
  const file = join(TMP, 'export.png'); const buf = png(40, 20); writeFileSync(file, buf);
  const r = cli(['record-asset', '--inventory', f, '--id', 'p1.editor.publish-menu', '--file', file, '--assets-dir', join(TMP, 'assets')]);
  assert.equal(r.status, 0, r.stderr);
  const saved = JSON.parse(readFileSync(f, 'utf-8')); const a = rec(saved, 'p1.editor.publish-menu').asset;
  assert.equal(a.sha256, createHash('sha256').update(buf).digest('hex'));
  assert.deepEqual([a.width, a.height, a.path, a.source], [40, 20, 'screenshots/p1.editor.publish-menu/2026.10.png', 'figma_export']);
  assert.ok(readFileSync(join(TMP, 'assets', a.path)).equals(buf));
  assert.equal(mappingFor(rec(saved, 'p1.editor.publish-menu')).asset.sha256, a.sha256);
  assert.equal(cli(['record-asset', '--inventory', f, '--id', 'p1.editor.publish-menu', '--file', join(TMP, 'missing.png')]).status, 1);
});

console.log('== inventory: Figma evidence');
test('Figma evidence is absent, planned, or verified, and never reported as uploaded unless recorded', () => {
  const d = valid();
  assert.equal(mappingFor(rec(d, 'p1.editor.publish-menu')).figma.evidence_state, 'unverified');
  const p = clone(rec(d, 'p1.editor.publish-menu')); p.figma = { evidence: 'planned' };
  assert.equal(mappingFor(p).figma.evidence_state, 'planned');
  assert.equal(mappingFor(rec(d, 'p1.editor.shell')).figma.evidence_state, 'verified');
  assert.ok(mappingFor(rec(d, 'p1.editor.publish-menu')).unverified.some(u => u.includes('figma')), 'absent evidence is listed as unverified');
});
test('recording Figma evidence writes only what is passed, with frame names derived, and refuses a claim without a node', () => {
  const f = writeInv('figma.json', valid());
  let r = cli(['record-figma', '--inventory', f, '--id', 'p1.editor.publish-menu', '--file-url', 'https://www.figma.com/design/ZzZzZzZzZzZzZzZzZzZzZz/Fixture']);
  assert.equal(r.status, 0, r.stderr);
  let saved = rec(JSON.parse(readFileSync(f, 'utf-8')), 'p1.editor.publish-menu');
  assert.equal(saved.figma.evidence, undefined, 'the evidence level is never inferred');
  assert.equal(saved.figma.node_id, undefined);
  assert.equal(mappingFor(saved).figma.evidence_state, 'unverified');
  r = cli(['record-figma', '--inventory', f, '--id', 'p1.editor.publish-menu', '--evidence', 'uploaded', '--node-id', '9:9', '--page-name', 'RUN-2026-10-01', '--annotation-status', 'complete']);
  assert.equal(r.status, 0, r.stderr);
  saved = rec(JSON.parse(readFileSync(f, 'utf-8')), 'p1.editor.publish-menu');
  assert.equal(saved.figma.frame_name, '[p1.editor.publish-menu] — Publish menu — 2026.10 — clean');
  assert.equal(saved.figma.annotated_frame_name, '[p1.editor.publish-menu] — Publish menu — 2026.10 — annotated');
  const bad = cli(['record-figma', '--inventory', f, '--id', 'p1.editor.publish-menu', '--evidence', 'bogus']);
  assert.equal(bad.status, 1);
});
test('record-figma stores the annotated frame node, the handoff links it and labels the clean node, and the clean node is refused', () => {
  const f = writeInv('figma-annotated.json', valid());
  const r = cli(['record-figma', '--inventory', f, '--id', 'p1.editor.publish-menu', '--evidence', 'uploaded', '--file-url', 'https://www.figma.com/design/ZzZzZzZzZzZzZzZzZzZzZz/Fixture', '--node-id', '9:9', '--annotated-node-id', '9:20']);
  assert.equal(r.status, 0, r.stderr);
  const saved = rec(JSON.parse(readFileSync(f, 'utf-8')), 'p1.editor.publish-menu');
  assert.equal(saved.figma.annotated_node_id, '9:20');
  const h = cli(['handoff', '--inventory', f, '--id', 'p1.editor.publish-menu']);
  assert.equal(h.status, 0, h.stderr);
  assert.match(h.stdout, /export the annotated frame `[^`]+ — annotated` \(annotation [a-z]+\), file https:\/\/www\.figma\.com\/design\/Z+[^,]*, node 9:20\./);
  assert.match(h.stdout, /The clean frame `[^`]+ — clean` \(node 9:9\) is the unannotated capture/);
  const before = readFileSync(f, 'utf-8');
  const same = cli(['record-figma', '--inventory', f, '--id', 'p1.editor.publish-menu', '--annotated-node-id', '9:9']);
  assert.equal(same.status, 1); assert.match(same.stderr, /annotated_node_id/);
  assert.equal(readFileSync(f, 'utf-8'), before, 'the clean node as the annotated node writes nothing');
  const d = valid(); delete rec(d, 'p1.editor.shell').figma.annotated_node_id;
  assert.ok(traceInventory(d).assets.find(a => a.screenshot_id === 'p1.editor.shell').problems.some(x => /annotated frame node ID is missing/.test(x)), 'trace fails without the annotated node');
  assert.ok(mappingFor(rec(d, 'p1.editor.shell')).unverified.includes('figma.annotated_node_id'));
});
test('clean and annotated frames are named apart, and the handoff says to export the annotated one', () => {
  const r = rec(valid(), 'p1.editor.shell');
  assert.match(frameName(r, 'clean'), /^\[p1\.editor\.shell\] — Editor shell — 2026\.09 — clean$/);
  assert.match(frameName(r, 'annotated'), / — annotated$/);
  const md = renderDocsHandoff(valid(), { ids: ['p1.editor.blocks-browser'] }).markdown;
  assert.match(md, /export the annotated frame `\[p1\.editor\.blocks-browser\] — Blocks browser — 2026\.10 — annotated`/);
  assert.match(md, /The clean frame `\[p1\.editor\.blocks-browser\] — Blocks browser — 2026\.10 — clean` is the unannotated capture; don't embed it/);
  assert.match(md, /record it with `scripts\/inventory\.mjs record-asset`/);
});
test('Figma metadata includes version, branch, Dev Resource links, manifest commit, and annotation status', () => {
  const m = mappingFor(rec(valid(), 'p1.editor.shell'));
  assert.deepEqual([m.figma.version_name, m.figma.manifest_commit, m.figma.annotation_status], ['Approved 2026.09', 'abcdef1234567', 'complete']);
  assert.ok(m.figma.branch_url.includes('branch-id') && m.figma.dev_resource_urls.length === 1 && m.figma.node_id === '12:34');
});

console.log('== inventory: reverse mapping and lookup');
test('the composite manual anchor holds document, heading, slot, ordinal, caption, and alt fingerprint (Google Docs has no stable image ID)', () => {
  const a = composeAnchor(rec(valid(), 'p1.editor.shell'));
  assert.deepEqual([a.document_id, a.heading, a.image_slot, a.image_ordinal], ['doc-fixture-0001', 'Tour the editor', 'Tour the editor #1', 1]);
  assert.equal(a.alt_text_fingerprint, altFingerprint(rec(valid(), 'p1.editor.shell').content.alt_text));
  assert.equal(a.alt_text_fingerprint.length, 16);
  assert.equal(altFingerprint('  The   Editor  '), altFingerprint('the editor'), 'fingerprints ignore case and spacing');
});
test('the full mapping chain is available for a verified record', () => {
  const m = mappingFor(rec(valid(), 'p1.editor.shell'));
  assert.equal(m.screenshot_id, 'p1.editor.shell');
  assert.ok(m.figma.file_url && m.figma.node_id && m.figma.version_name);
  assert.ok(m.asset.sha256 && m.docs.document_id && m.docs.heading && m.docs.image_slot);
  assert.ok(m.content.alt_text_fingerprint && m.publication.published_url && m.publication.verified_release && m.publication.verified_at);
  assert.equal(m.publication.state, 'verified');
  assert.deepEqual(m.unverified, []);
});
test('lookup: which locations use an ID, which IDs an article or section serves', () => {
  const d = valid();
  const byId = lookup(d, { id: 'p1.editor.shell' }).records[0];
  assert.deepEqual([byId.docs.document_id, byId.docs.heading, byId.docs.image_slot], ['doc-fixture-0001', 'Tour the editor', 'Tour the editor #1']);
  assert.deepEqual(lookup(d, { doc: 'doc-fixture-0001' }).records.map(r => r.screenshot_id).sort(), ['p1.editor.legacy-banner', 'p1.editor.shell']);
  assert.deepEqual(lookup(d, { doc: 'doc-fixture-0001', heading: 'tour the editor' }).records.length, 2);
  assert.deepEqual(lookup(d, { doc: 'https://docs.example.com/guides/blocks/' }).records.map(r => r.screenshot_id), ['p1.editor.blocks-browser']);
  assert.equal(lookup(d, { doc: 'doc-nope' }).records.length, 0);
  assert.ok(lookup(d, { id: 'p1.nope.x' }).error);
});
test('lookup: images to refresh for a release, records with no verified mapping, and stale or unverifiable publications', () => {
  const d = valid();
  assert.deepEqual(lookup(d, { refresh: '2026.10' }).records.map(r => r.screenshot_id).sort(), ['p1.editor.blocks-browser', 'p1.editor.publish-menu', 'p1.editor.workstream-selector']);
  assert.deepEqual(lookup(d, { unverified: true }).records.map(r => r.screenshot_id).sort(), ['p1.editor.blocks-browser', 'p1.editor.publish-menu', 'p1.editor.workstream-selector']);
  assert.deepEqual(lookup(d, { stale: true }).records, []);
  const s = valid(); rec(s, 'p1.editor.shell').content.alt_text = 'The P1 editor with a new header, the Blocks panel on the left, and the page in the center.';
  assert.deepEqual(lookup(s, { stale: true }).records.map(r => r.screenshot_id), ['p1.editor.shell']);
});
test('publication health: verified, stale (alt, release, or asset changed), unverifiable (no URL or time), unverified, retired', () => {
  const base = rec(valid(), 'p1.editor.shell');
  assert.equal(publicationHealth(base).state, 'verified');
  const alt = clone(base); alt.content.alt_text = 'A different description of the editor with several panels visible at once.';
  const rel = clone(base); rel.capture.release = '2026.10';
  const sha = clone(base); sha.asset.sha256 = 'f'.repeat(64);
  for (const x of [alt, rel, sha]) assert.equal(publicationHealth(x).state, 'stale');
  const noUrl = clone(base); delete noUrl.publication.published_url;
  const noTime = clone(base); delete noTime.publication.verified_at;
  assert.equal(publicationHealth(noUrl).state, 'unverifiable'); assert.equal(publicationHealth(noTime).state, 'unverifiable');
  assert.equal(publicationHealth(rec(valid(), 'p1.editor.publish-menu')).state, 'unverified');
  assert.equal(publicationHealth(rec(valid(), 'p1.editor.legacy-banner')).state, 'retired');
  // The validator fails loudly on stale evidence too.
  const d = valid(); rec(d, 'p1.editor.shell').content.alt_text = alt.content.alt_text;
  assert.ok(has(errs(d), 'p1.editor.shell', 'publication.alt_text_fingerprint'));
});
test('the docs handoff report lists ID, request, article, heading, slot, asset, text, Figma links, reviewer, publication, and unverified fields', () => {
  const md = renderDocsHandoff(valid(), { release: '2026.10', ids: ['p1.editor.blocks-browser'], inventory: { file: 'inventory/screenshots.json', commit: 'abcdef1234567', dirty: false } }).markdown;
  for (const needle of ['## p1.editor.blocks-browser: Blocks browser', 'Source request: release https://github.com/example-org/example-repo/releases/tag/v2026.10', 'Target article: doc-fixture-0002', 'Heading: Browse blocks', 'Image slot: Browse blocks #1', 'screenshots/p1.editor.blocks-browser/2026.10.png', 'Required reviewer: devrel-team', 'Publication: unverified', 'Unverified:', 'Inventory: `inventory/screenshots.json` at commit `abcdef123`']) assert.ok(md.includes(needle), needle);
  const all = renderDocsHandoff(valid(), {}).markdown;
  assert.ok(!all.includes('p1.editor.shell'), 'unchanged records need no handoff');
  assert.ok(!all.includes('legacy-banner'), 'retired records need no handoff');
});

console.log('== inventory: release comparison');
test('only records that need action are affected; unchanged records are counted, not listed as work', () => {
  const rep = releaseReport(valid(), '2026.10');
  assert.deepEqual(rep.affected.map(a => [a.screenshot_id, a.action]).sort(), [['p1.editor.blocks-browser', 'refresh'], ['p1.editor.legacy-banner', 'retire'], ['p1.editor.publish-menu', 'refresh'], ['p1.editor.workstream-selector', 'new']]);
  assert.deepEqual(rep.unchanged, ['p1.editor.shell']);
  const b = rep.affected.find(a => a.screenshot_id === 'p1.editor.blocks-browser');
  assert.deepEqual([b.replacement_asset_path, b.current_asset, b.docs_location.heading, b.handoff_state, b.verification_state], ['screenshots/p1.editor.blocks-browser/2026.10.png', 'screenshots/p1.editor.blocks-browser/2026.09.png', 'Browse blocks', 'approved', 'unverified']);
  assert.equal(rep.affected.find(a => a.action === 'retire').replacement_asset_path, null);
  assert.equal(releaseReport(valid(), '2026.11').affected.length, 0);
});
test('a shot with no inventory record is an inventory gap, never silently a refresh', () => {
  const newReport = { results: [
    { slug: 'p1.editor.blocks-browser', side: 'next', ok: true },
    { slug: 'p1.editor.uncovered-shot', side: 'next', ok: true },
  ] };
  const rep = releaseReport(valid(), '2026.10', { newReport });
  assert.deepEqual(rep.gaps.map(g => g.shot), ['p1.editor.uncovered-shot']);
  assert.ok(!rep.affected.some(a => a.screenshot_id === 'p1.editor.uncovered-shot'));
  assert.deepEqual(rep.notCaptured.sort(), ['p1.editor.publish-menu', 'p1.editor.workstream-selector']);
});
test('a record marked unchanged whose pixels changed is flagged for review, not turned into a refresh', () => {
  const rep = releaseReport(valid(), '2026.10', { runRows: [{ slug: 'p1.editor.shell', status: 'changed' }, { slug: 'p1.editor.blocks-browser', status: 'changed' }] });
  assert.deepEqual(rep.review.map(r => r.screenshot_id), ['p1.editor.shell']);
  assert.equal(rep.affected.find(a => a.screenshot_id === 'p1.editor.blocks-browser').pixels, 'changed');
  assert.ok(!rep.affected.some(a => a.screenshot_id === 'p1.editor.shell'));
});
test('the release command exits 2 on an inventory gap and 0 otherwise', () => {
  const f = join(FX, 'inventory.valid.json');
  assert.equal(cli(['release', '--inventory', f, '--release', '2026.10']).status, 0);
  const dir = join(TMP, 'run-gap'); mkdirSync(dir, { recursive: true });
  const p = join(dir, 'a.png'); writeFileSync(p, png(32, 32));
  const mk = slug => ({ slug, side: 'next', ok: true, file: p });
  for (const n of ['old', 'new']) { mkdirSync(join(TMP, n), { recursive: true }); writeFileSync(join(TMP, n, 'capture-report.json'), JSON.stringify({ capturedAt: '2026-10-01T00:00:00Z', results: [mk('p1.editor.blocks-browser'), mk('p1.editor.uncovered-shot')] })); }
  const r = cli(['release', '--inventory', f, '--release', '2026.10', '--old', join(TMP, 'old'), '--new', join(TMP, 'new')]);
  assert.equal(r.status, 2); assert.match(r.stdout, /INVENTORY GAPS/); assert.match(r.stdout, /uncovered-shot/);
});

console.log('== inventory: commands that write');
test('moving a record along the lifecycle works one step at a time and refuses to skip or to write an invalid record', () => {
  const f = writeInv('flow.json', valid());
  let r = cli(['transition', '--inventory', f, '--id', 'p1.editor.publish-menu', '--to', 'verified']);
  assert.equal(r.status, 1); assert.match(r.stderr, /not allowed/);
  r = cli(['transition', '--inventory', f, '--id', 'p1.editor.publish-menu', '--to', 'annotated']);
  assert.equal(r.status, 1, 'annotated needs Figma evidence');
  assert.equal(rec(JSON.parse(readFileSync(f, 'utf-8')), 'p1.editor.publish-menu').status, 'captured', 'nothing was written');
  r = cli(['transition', '--inventory', f, '--id', 'p1.editor.blocks-browser', '--to', 'proposed']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /p1\.editor\.blocks-browser: approved -> proposed/, 'the message shows the status before the change');
});
test('reopening a verified record for a new release keeps its history and clears the per-release evidence', () => {
  const f = writeInv('reopen.json', valid());
  const r = cli(['transition', '--inventory', f, '--id', 'p1.editor.shell', '--to', 'approved']);
  assert.equal(r.status, 1, 'reopening an "unchanged" record without a new release is contradictory');
  assert.match(r.stderr, /unchanged/);
  assert.equal(rec(JSON.parse(readFileSync(f, 'utf-8')), 'p1.editor.shell').status, 'verified', 'nothing was written');
  const f2 = writeInv('reopen2.json', valid());
  const r2 = cli(['transition', '--inventory', f2, '--id', 'p1.editor.shell', '--to', 'approved', '--release', '2026.11']);
  assert.equal(r2.status, 0, r2.stderr);
  const s = rec(JSON.parse(readFileSync(f2, 'utf-8')), 'p1.editor.shell');
  assert.deepEqual([s.status, s.release_status, s.capture.release, s.asset, s.figma], ['approved', 'refresh', '2026.11', undefined, undefined]);
  assert.equal(s.history.length, 1);
  assert.deepEqual([s.history[0].release, s.history[0].asset.path, s.history[0].published_url], ['2026.09', 'screenshots/p1.editor.shell/2026.09.png', 'https://cdn.example.com/images/editor-shell-2026.09.png']);
  assert.equal(s.publication.docs_image_slot, 'Tour the editor #1', 'the docs slot stays');
  assert.equal(cli(['validate', '--inventory', f2]).status, 0);
});
test('retiring needs a reason, keeps the record and its history, and a retired record cannot return', () => {
  const f = writeInv('retire.json', valid());
  assert.equal(cli(['transition', '--inventory', f, '--id', 'p1.editor.shell', '--to', 'retired']).status, 1);
  const r = cli(['transition', '--inventory', f, '--id', 'p1.editor.shell', '--to', 'retired', '--reason', 'The tour section was removed from the docs.']);
  assert.equal(r.status, 0, r.stderr);
  const s = rec(JSON.parse(readFileSync(f, 'utf-8')), 'p1.editor.shell');
  assert.deepEqual([s.status, s.release_status], ['retired', 'retire']);
  assert.equal(s.asset.sha256, 'a'.repeat(64), 'the historical asset is kept');
  assert.equal(cli(['transition', '--inventory', f, '--id', 'p1.editor.shell', '--to', 'approved']).status, 1);
});
test('recording a publication stores the alt fingerprint and the verified checksum from the record, and the published checksum from the served file', () => {
  const d = valid(); const r = rec(d, 'p1.editor.shell'); r.status = 'inserted';
  for (const k of ['published_url', 'published_sha256', 'verified_at', 'verified_release', 'alt_text_fingerprint', 'verified_asset_sha256']) delete r.publication[k];
  const f = writeInv('pub.json', d);
  const served = png(20, 12); const servedFile = join(TMP, 'served.png'); writeFileSync(servedFile, served);
  const c = cli(['record-publication', '--inventory', f, '--id', 'p1.editor.shell', '--published-url', 'https://cdn.example.com/images/shell.png', '--published-file', servedFile, '--verified-at', '2026-10-02T10:00:00Z', '--notes', 'Checked the live page.']);
  assert.equal(c.status, 0, c.stderr);
  const t = cli(['transition', '--inventory', f, '--id', 'p1.editor.shell', '--to', 'verified']);
  assert.equal(t.status, 0, t.stderr);
  const s = rec(JSON.parse(readFileSync(f, 'utf-8')), 'p1.editor.shell');
  assert.equal(s.publication.alt_text_fingerprint, altFingerprint(s.content.alt_text));
  assert.equal(s.publication.verified_asset_sha256, s.asset.sha256);
  assert.equal(s.publication.published_sha256, createHash('sha256').update(served).digest('hex'));
  assert.notEqual(s.publication.published_sha256, s.asset.sha256);
  assert.equal(publicationHealth(s).state, 'verified');
  const hex = cli(['record-publication', '--inventory', f, '--id', 'p1.editor.shell', '--published-sha256', 'C'.repeat(64)]);
  assert.equal(hex.status, 0, hex.stderr);
  assert.equal(rec(JSON.parse(readFileSync(f, 'utf-8')), 'p1.editor.shell').publication.published_sha256, 'c'.repeat(64), 'a hex checksum is stored lowercase');
  assert.equal(cli(['record-publication', '--inventory', f, '--id', 'p1.editor.shell', '--published-sha256', 'abc']).status, 1, 'a malformed checksum is refused');
  assert.equal(cli(['record-publication', '--inventory', f, '--id', 'p1.editor.shell', '--published-sha256', 'c'.repeat(64), '--published-file', servedFile]).status, 1, 'two checksum sources are refused');
  assert.equal(cli(['record-publication', '--inventory', f, '--id', 'p1.editor.shell', '--published-file', join(TMP, 'nope.png')]).status, 1, 'a missing file is refused');
  const bad = cli(['record-publication', '--inventory', f, '--id', 'p1.editor.shell', '--published-url', `https://cdn.example.com/a.png?token=${'x'.repeat(12)}`]);
  assert.equal(bad.status, 1, 'a signed URL is refused');
});
test('validate --against catches a status skip between two inventory files', () => {
  const before = writeInv('before.json', valid());
  const d = valid(); rec(d, 'p1.editor.blocks-browser').status = 'handed_off';
  const after = writeInv('after.json', d);
  const r = cli(['validate', '--inventory', after, '--against', before]);
  assert.equal(r.status, 1); assert.match(r.stderr, /blocks-browser.*not allowed/s);
});

test('check-alt compares the published alt text with the record, ignoring case and spacing, and fails on a difference', () => {
  const f = join(FX, 'inventory.valid.json');
  const alt = rec(valid(), 'p1.editor.shell').content.alt_text;
  assert.equal(cli(['check-alt', '--inventory', f, '--id', 'p1.editor.shell', '--notes', `  ${alt.toUpperCase()}  `]).status, 0);
  const bad = cli(['check-alt', '--inventory', f, '--id', 'p1.editor.shell', '--notes', 'An older description of the editor header and panels.']);
  assert.equal(bad.status, 1); assert.match(bad.stderr, /differs/);
});

test('set-alt replaces the alt text, refuses unusable text, and reminds that an existing brief carries the old text', () => {
  const f = writeInv('setalt.json', valid());
  const text = 'The P1 editor with two numbered areas: 1 the Blocks browser, 2 the search field.';
  const c = cli(['set-alt', '--inventory', f, '--id', 'p1.editor.blocks-browser', '--text', `  ${text} `]);
  assert.equal(c.status, 0, c.stderr);
  assert.match(c.stdout, /alt text updated/); assert.match(c.stdout, /regenerate it with `brief`/);
  assert.equal(rec(JSON.parse(readFileSync(f, 'utf-8')), 'p1.editor.blocks-browser').content.alt_text, text, 'stored trimmed');
  const before = readFileSync(f, 'utf-8');
  const generic = cli(['set-alt', '--inventory', f, '--id', 'p1.editor.blocks-browser', '--text', 'Screenshot']);
  assert.equal(generic.status, 1); assert.match(generic.stderr, /too generic/);
  assert.equal(readFileSync(f, 'utf-8'), before, 'a refused change writes nothing');
  assert.equal(cli(['set-alt', '--inventory', f, '--id', 'p1.editor.blocks-browser']).status, 1, '--text is required');
  assert.equal(cli(['set-alt', '--inventory', f, '--id', 'p1.editor.nope', '--text', text]).status, 1, 'an unknown ID is refused');
  assert.equal(cli(['set-alt', '--inventory', f, '--id', 'p1.editor.blocks-browser', '--text', text, '--verified-at', '2026-10-07T12:00:00Z']).status, 1, '--verified-at only applies to verified records');
});
test('set-alt on a verified record needs --verified-at, then re-stamps the fingerprint so the record stays verified', () => {
  const f = writeInv('setalt-verified.json', valid());
  const text = 'The P1 editor with four numbered areas: 1 the Blocks panel, 2 the page canvas, 3 page settings, 4 the Review button.';
  const before = readFileSync(f, 'utf-8');
  const no = cli(['set-alt', '--inventory', f, '--id', 'p1.editor.shell', '--text', text]);
  assert.equal(no.status, 1); assert.match(no.stderr, /--verified-at/);
  assert.equal(readFileSync(f, 'utf-8'), before);
  const ok = cli(['set-alt', '--inventory', f, '--id', 'p1.editor.shell', '--text', text, '--verified-at', '2026-10-07T12:00:00Z']);
  assert.equal(ok.status, 0, ok.stderr);
  const s = rec(JSON.parse(readFileSync(f, 'utf-8')), 'p1.editor.shell');
  assert.equal(s.publication.alt_text_fingerprint, altFingerprint(text));
  assert.equal(s.publication.verified_at, '2026-10-07T12:00:00Z');
  assert.equal(publicationHealth(s).state, 'verified');
  assert.equal(cli(['check-alt', '--inventory', f, '--id', 'p1.editor.shell', '--notes', text]).status, 0, 'check-alt now matches the new text');
  assert.equal(cli(['validate', '--inventory', f]).status, 0);
});

console.log('== inventory: new product versions');
// A small inventory whose releases are SDK versions: published at 0.15.0 and 0.18.0, one in flight, one retired.
const versioned = () => {
  const d = valid();
  const mk = (id, release, status, extra = {}) => {
    const r = clone(rec(d, 'p1.editor.shell'));
    r.screenshot_id = id; r.title = id.split('.').pop();
    r.publication.docs_image_slot = `${id} #1`; r.source.docs_heading = id;
    r.capture.release = release; r.asset.path = assetPath(id, release);
    r.publication.verified_release = release;
    r.figma.frame_name = frameName(r, 'clean'); r.figma.annotated_frame_name = frameName(r, 'annotated');
    if (status === 'inserted') { r.status = 'inserted'; for (const k of ['published_url', 'verified_at', 'verified_release', 'alt_text_fingerprint', 'verified_asset_sha256']) delete r.publication[k]; }
    return Object.assign(r, extra);
  };
  d.records = [
    mk('p1.v.old-verified', '0.15.0', 'verified'),
    mk('p1.v.old-inserted', '0.15.0', 'inserted'),
    mk('p1.v.current', '0.20.0', 'verified'),
    mk('p1.v.newer', '0.21.0', 'verified'),
    mk('p1.v.calendar', '2026.09', 'verified'),
    mk('p1.v.retired', '0.15.0', 'verified', { status: 'retired', release_status: 'retire', retired_at: '2026-10-01', retired_reason: 'Removed from the product.' }),
  ];
  const inflight = clone(rec(valid(), 'p1.editor.blocks-browser')); inflight.screenshot_id = 'p1.v.in-flight'; inflight.capture.release = '0.19.0'; inflight.publication.docs_image_slot = 'in flight #1'; inflight.source.docs_heading = 'In flight'; delete inflight.history;
  d.records.push(inflight);
  return d;
};
test('version parsing and ordering: numbers compare as numbers, a prerelease sorts before its release, non-versions give null', () => {
  assert.deepEqual(parseVersion('v0.20.0'), { nums: [0, 20, 0], pre: null });
  assert.equal(parseVersion('2026.09'), null); assert.equal(parseVersion('latest'), null);
  assert.equal(compareVersions('0.9.0', '0.10.0'), -1, '0.9 is older than 0.10, not newer as text');
  assert.equal(compareVersions('1.0.0', '1.0.0'), 0); assert.equal(compareVersions('0.20.1', '0.20.0'), 1);
  assert.equal(compareVersions('0.18.1-canary-20260929', '0.18.1'), -1);
  assert.equal(compareVersions('2026.09', '0.20.0'), null);
});
test('a new version makes older published screenshots candidates; current, newer, retired, in-flight, and non-version records are sorted apart', () => {
  const r = releaseCheck(versioned(), '0.20.0');
  assert.deepEqual(r.candidates.map(c => c.id).sort(), ['p1.v.old-inserted', 'p1.v.old-verified']);
  assert.deepEqual(r.current, ['p1.v.current']);
  assert.deepEqual(r.behind.map(b => b.id), ['p1.v.in-flight']);
  assert.deepEqual(r.unversioned.map(u => u.id), ['p1.v.calendar']);
  const all = JSON.stringify(r);
  assert.ok(!all.includes('p1.v.retired') && !all.includes('p1.v.newer'), 'a retired record and one captured on a newer version are never listed');
  assert.ok(releaseCheck(versioned(), 'banana').error);
  assert.deepEqual(releaseCheck(versioned(), '0.15.0').candidates, [], 'nothing is older than the oldest version');
});
test('release-check lists candidates and exits 3 without writing; with --reopen it reopens them as "refresh" in one write', () => {
  const f = writeInv('versioned.json', versioned());
  const dry = cli(['release-check', '--inventory', f, '--version', '0.20.0']);
  assert.equal(dry.status, 3, dry.stdout + dry.stderr);
  assert.match(dry.stdout, /REFRESH p1\.v\.old-verified/); assert.match(dry.stdout, /UNVERSIONED p1\.v\.calendar/); assert.match(dry.stdout, /BEHIND\s+p1\.v\.in-flight/);
  assert.equal(rec(JSON.parse(readFileSync(f, 'utf-8')), 'p1.v.old-verified').status, 'verified', 'the dry run wrote nothing');
  const go = cli(['release-check', '--inventory', f, '--version', '0.20.0', '--reopen']);
  assert.equal(go.status, 0, go.stdout + go.stderr);
  const after = JSON.parse(readFileSync(f, 'utf-8'));
  for (const id of ['p1.v.old-verified', 'p1.v.old-inserted']) {
    const s = rec(after, id);
    assert.deepEqual([s.status, s.release_status, s.capture.release, s.asset, s.figma], ['approved', 'refresh', '0.20.0', undefined, undefined], id);
    assert.equal(s.history.at(-1).release, '0.15.0', 'the old release is kept in history');
    assert.ok(s.publication.docs_image_slot, 'the docs slot stays');
  }
  for (const id of ['p1.v.current', 'p1.v.newer', 'p1.v.calendar', 'p1.v.retired', 'p1.v.in-flight']) assert.deepEqual(rec(after, id), rec(versioned(), id), `${id} is untouched`);
  assert.equal(cli(['validate', '--inventory', f]).status, 0);
  const again = cli(['release-check', '--inventory', f, '--version', '0.20.0']);
  assert.equal(again.status, 0, 'running it again finds nothing new (idempotent)');
});
test('reopened records feed straight into a capture brief for the new version', () => {
  const f = writeInv('versioned2.json', versioned());
  assert.equal(cli(['release-check', '--inventory', f, '--version', '0.20.0', '--reopen']).status, 0);
  const g = generateBrief(JSON.parse(readFileSync(f, 'utf-8')), { file: 'x', release: '0.20.0' });
  assert.deepEqual(g.ready.sort(), ['p1.v.old-inserted', 'p1.v.old-verified']);
});
test('a prerelease version is refused, and the version can come from the app lockfile or the npm registry', () => {
  const f = writeInv('versioned3.json', versioned());
  const pre = cli(['release-check', '--inventory', f, '--version', '0.21.0-canary-1']);
  assert.equal(pre.status, 1); assert.match(pre.stderr, /prerelease/);
  const app = join(TMP, 'app'); mkdirSync(app, { recursive: true });
  writeFileSync(join(app, 'package-lock.json'), JSON.stringify({ packages: { 'node_modules/@pantheon-systems/p1-next-sdk': { version: '0.20.0' } } }));
  const fromApp = cli(['release-check', '--inventory', f, '--app', app]);
  assert.equal(fromApp.status, 3); assert.match(fromApp.stdout, /p1-next-sdk 0\.20\.0 \(installed in the app\)/);
  assert.equal(cli(['release-check', '--inventory', f, '--app', join(TMP, 'no-such-app')]).status, 1);
  // npm is stubbed, so the test needs no network: the registry says 0.21.0, the app runs 0.20.0.
  const bin = join(TMP, 'bin'); mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, 'npm'), '#!/bin/sh\necho 0.21.0\n', { mode: 0o755 });
  const both = cli(['release-check', '--inventory', f, '--app', app, '--registry'], { env: { ...process.env, PATH: bin + delimiter + process.env.PATH } });
  assert.match(both.stdout, /latest published 0\.21\.0/); assert.match(both.stdout, /WARN: the app you would capture runs .* 0\.20\.0, but 0\.21\.0 is the latest/);
  const reg = cli(['release-check', '--inventory', f, '--registry', '--json'], { env: { ...process.env, PATH: bin + delimiter + process.env.PATH } });
  assert.equal(JSON.parse(reg.stdout).version, '0.21.0');
  const broken = join(TMP, 'bin2'); mkdirSync(broken, { recursive: true });
  writeFileSync(join(broken, 'npm'), '#!/bin/sh\necho "E404 not found" >&2\nexit 1\n', { mode: 0o755 });
  const bad = cli(['release-check', '--inventory', f, '--registry'], { env: { ...process.env, PATH: broken + delimiter + process.env.PATH } });
  assert.equal(bad.status, 1); assert.match(bad.stderr, /npm view .* failed/);
});

console.log('== inventory: image traceability audit (trace)');
test('trace on an empty inventory checks nothing and passes', () => {
  const t = traceInventory({ version: 1, records: [] });
  assert.deepEqual([t.assets.length, t.gaps.length, t.ok], [0, 0, true]);
});
test('trace follows each image from release to verification; a complete record passes, a missing Figma link fails, uncaptured and retired records are not images', () => {
  const t = traceInventory(valid());
  const shell = t.assets.find(a => a.screenshot_id === 'p1.editor.shell');
  assert.deepEqual(shell.problems, []);
  assert.deepEqual([shell.release, shell.figma.run_page, shell.figma.node_id, shell.docs.image_slot, shell.verification], ['2026.09', 'RUN-2026-09-14', '12:34', 'Tour the editor #1', 'verified']);
  const menu = t.assets.find(a => a.screenshot_id === 'p1.editor.publish-menu');
  assert.ok(menu.problems.some(p => /no Figma reference/.test(p)));
  assert.deepEqual(t.notCaptured.map(n => n.id).sort(), ['p1.editor.blocks-browser', 'p1.editor.workstream-selector']);
  assert.ok(!t.assets.some(a => a.screenshot_id === 'p1.editor.legacy-banner'), 'retired records are not traced');
  assert.equal(t.ok, false);
  assert.match(renderTrace(t), /p1\.editor\.publish-menu \(FAILS\)/);
  const c = cli(['trace', '--inventory', join(FX, 'inventory.valid.json')]);
  assert.equal(c.status, 1);
});
test('trace fails an unfinished or misnamed annotated frame, missing text, reviewer, docs slot, and a bad history path', () => {
  const d = valid(); const r = rec(d, 'p1.editor.shell');
  assert.deepEqual(traceInventory(valid()).assets.find(a => a.screenshot_id === 'p1.editor.shell').problems.filter(x => /annotat/.test(x)), [], 'a complete, correctly named annotated frame passes');
  r.figma.annotation_status = 'in_progress'; r.figma.annotated_frame_name = r.figma.frame_name;
  delete r.content.caption; delete r.reviewer; delete r.publication.docs_image_slot;
  r.history = [{ release: '2026.08', asset: { path: 'screenshots/somewhere-else.png', sha256: 'b'.repeat(64) } }];
  const p = traceInventory(d).assets.find(a => a.screenshot_id === 'p1.editor.shell').problems.join('\n');
  for (const needle of ['annotation is not complete', 'the docs embed the annotated frame', 'caption', 'reviewer is missing', 'docs image slot is missing', 'history 2026.08']) assert.ok(p.includes(needle), needle);
  assert.match(p, /annotated frame must be "\[p1\.editor\.shell\] — Editor shell — 2026\.09 — annotated"/);
});
test('trace with an assets folder checks each file: missing, wrong checksum, wrong size, and a matching file', () => {
  const d = { version: 1, records: [clone(rec(valid(), 'p1.editor.shell'))] };
  const r = d.records[0]; const buf = png(30, 20);
  r.asset.sha256 = createHash('sha256').update(buf).digest('hex'); r.asset.width = 30; r.asset.height = 20;
  r.publication.verified_asset_sha256 = r.asset.sha256;
  const f = writeInv('trace-assets.json', d); const dir = join(TMP, 'trace-assets');
  let c = cli(['trace', '--inventory', f, '--assets-dir', dir]);
  assert.equal(c.status, 1); assert.match(c.stdout, /asset file not found/);
  mkdirSync(join(dir, dirname(r.asset.path)), { recursive: true }); writeFileSync(join(dir, r.asset.path), buf);
  c = cli(['trace', '--inventory', f, '--assets-dir', dir]);
  assert.equal(c.status, 0, c.stdout); assert.match(c.stdout, /\(file checked\)/);
  writeFileSync(join(dir, r.asset.path), png(30, 20, 9));
  c = cli(['trace', '--inventory', f, '--assets-dir', dir]);
  assert.equal(c.status, 1); assert.match(c.stdout, /checksum differs/);
  writeFileSync(join(dir, r.asset.path), png(31, 20));
  assert.match(cli(['trace', '--inventory', f, '--assets-dir', dir]).stdout, /dimensions differ/);
});
test('trace with a capture run reports images that no inventory record covers as gaps', () => {
  const run = join(TMP, 'trace-run'); mkdirSync(run, { recursive: true });
  writeFileSync(join(run, 'capture-report.json'), JSON.stringify({ results: [
    { slug: 'p1.editor.shell', screenshotId: 'p1.editor.shell', side: 'next', ok: true },
    { slug: 'p1.editor.mystery', screenshotId: 'p1.editor.mystery', side: 'next', ok: true },
    { slug: 'editor-shell', side: 'next', ok: true },
  ] }));
  const j = JSON.parse(cli(['trace', '--inventory', join(FX, 'inventory.valid.json'), '--run', run, '--json']).stdout);
  assert.deepEqual(j.gaps.map(g => g.shot).sort(), ['editor-shell', 'p1.editor.mystery']);
});

console.log(`\n${passed} passed, ${failed} failed (inventory)`);
process.exit(failed ? 1 : 0);
