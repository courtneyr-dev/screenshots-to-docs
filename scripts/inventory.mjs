#!/usr/bin/env node
/**
 * p1-editor-screenshots / inventory
 *
 * Works on the screenshot inventory (inventory/screenshots.json): the git-tracked source of truth for
 * which screenshots the P1 docs need. See references/screenshot-inventory.md.
 *
 *   validate            check every record; --against <file|git:REF> also checks status transitions
 *   list                filter records (--status --release --owner --workstream --release-status)
 *   prereqs             what each record still needs to reach its next status
 *   brief               write a capture brief from approved records (--config picks the target)
 *   asset-path          the deterministic asset path for an ID and release
 *   record-capture      attach a capture run's PNGs (checksum, size, time) to their records
 *   record-asset        attach an exported PNG (for example from Figma) to a record
 *   record-figma        record Figma evidence you have (never invents any)
 *   record-publication  record insertion and verification of the published image
 *   transition          move a record along its lifecycle (reopen, retire)
 *   handoff             docs handoff report from the inventory
 *   set-alt             replace a record's alt text (--text "<text>"); a verified record also needs --verified-at
 *   check-alt           compare the alt text on the published page (--notes "<text>") with the record
 *   lookup              reverse lookup: by ID, document, release refresh, unverified, stale
 *   release             records that need work for a release; inventory gaps reported separately
 *   trace               read-only audit of every image: release, checksum, Figma frames, docs slot, verification
 *   release-check       a new product version shipped: which published screenshots may have changed (--reopen)
 *
 * Every command that writes validates the result first and refuses to write an invalid record.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { resolve, join, dirname } from 'node:path';
import {
  loadInventory, writeInventory, validateInventory, formatIssues, listRecords, prerequisites, generateBrief,
  assetPath, pngInfo, sha256, altFingerprint, transitionError, inventoryCommit, inventoryAtRef,
  renderDocsHandoff, lookup, releaseReport, mappingFor, frameName, STATUSES, RELEASE_RE,
  releaseCheck, reopenForRelease, parseVersion, compareVersions, traceInventory, renderTrace,
} from './lib/inventory.mjs';
import { loadConfig, applyOverrides, validateConfig, formatValidation, targetParams, presetNameOf } from './lib/config.mjs';
import { loadPreset } from './lib/presets.mjs';
import { parseSource, latestVersion } from './lib/release-sources.mjs';
import { compareRuns } from './compare-runs.mjs';

const TOOL_DIR = resolve(dirname(new URL(import.meta.url).pathname), '..');
const DEFAULT_FILE = join(TOOL_DIR, 'inventory', 'screenshots.json');

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    inventory: { type: 'string' }, against: { type: 'string' }, json: { type: 'boolean' },
    status: { type: 'string' }, release: { type: 'string' }, owner: { type: 'string' }, workstream: { type: 'string' }, 'release-status': { type: 'string' },
    id: { type: 'string' }, config: { type: 'string' }, set: { type: 'string', multiple: true }, target: { type: 'string' }, out: { type: 'string' },
    run: { type: 'string' }, version: { type: 'string' }, app: { type: 'string' }, package: { type: 'string' }, pattern: { type: 'string' }, registry: { type: 'boolean' }, reopen: { type: 'boolean' }, file: { type: 'string' }, 'assets-dir': { type: 'string' }, source: { type: 'string' },
    evidence: { type: 'string' }, 'file-url': { type: 'string' }, 'page-name': { type: 'string' }, 'node-id': { type: 'string' }, 'annotated-node-id': { type: 'string' }, 'version-name': { type: 'string' },
    'branch-url': { type: 'string' }, 'manifest-commit': { type: 'string' }, 'annotation-status': { type: 'string' }, 'dev-resource': { type: 'string', multiple: true }, 'not-used-reason': { type: 'string' },
    'inserted-at': { type: 'string' }, 'published-url': { type: 'string' }, 'published-file': { type: 'string' }, 'published-sha256': { type: 'string' }, 'verified-at': { type: 'string' }, 'verified-release': { type: 'string' }, notes: { type: 'string' },
    to: { type: 'string' }, reason: { type: 'string' }, 'release-status-new': { type: 'string' },
    format: { type: 'string' }, old: { type: 'string' }, new: { type: 'string' }, text: { type: 'string' },
    doc: { type: 'string' }, heading: { type: 'string' }, refresh: { type: 'string' }, unverified: { type: 'boolean' }, stale: { type: 'boolean' },
    help: { type: 'boolean', short: 'h' },
  },
});

const cmd = positionals[0];
const fail = (msg, code = 1) => { console.error(`FAIL: ${msg}`); process.exit(code); };
if (values.help || !cmd) {
  const lines = readFileSync(new URL(import.meta.url), 'utf-8').split('\n');
  console.log(lines.slice(2, lines.indexOf(' */')).map(l => l.replace(/^ \* ?/, '')).join('\n'));
  process.exit(values.help ? 0 : 1);
}

const file = resolve(values.inventory || DEFAULT_FILE);
let inv;
try { inv = loadInventory(file); } catch (e) { fail(e.message); }
const doc = inv.doc;
const records = Array.isArray(doc.records) ? doc.records : [];
const byId = id => records.find(r => r.screenshot_id === id);
const need = (v, flag) => { if (!v) fail(`--${flag} is required`); return v; };
const out = obj => console.log(JSON.stringify(obj, null, 2));
const today = () => new Date().toISOString();

function previousDoc() {
  if (!values.against) return null;
  try {
    if (values.against.startsWith('git:')) return inventoryAtRef(file, values.against.slice(4));
    return JSON.parse(readFileSync(resolve(values.against), 'utf-8'));
  } catch (e) { fail(`cannot read --against ${values.against}: ${e.message}`); }
}

function report(result, { strictAll = true, only = null } = {}) {
  for (const w of result.warnings) console.error(`  WARN   ${w.id}  ${w.field}: ${w.message}`);
  const errors = only ? result.errors.filter(e => e.id === only || e.id === '(file)') : result.errors;
  if (errors.length) {
    console.error(`${errors.length} problem${errors.length === 1 ? '' : 's'} in ${file}:`);
    console.error(formatIssues(errors));
    if (strictAll) process.exit(1);
  }
  return errors.length;
}

/** Mutate one record, validate, and write only if that record is valid. */
function update(id, mutate) {
  const before = JSON.parse(JSON.stringify(doc));
  const r = records.find(x => x.screenshot_id === id);
  if (!r) fail(`no record "${id}" in ${file}`);
  mutate(r);
  const result = validateInventory(doc, { previous: before });
  if (report(result, { strictAll: false, only: id })) fail(`not written: record ${id} would be invalid.`);
  writeInventory(file, doc);
  return r;
}

const RANK_AFTER_APPROVED = ['captured', 'annotated', 'handed_off', 'inserted', 'verified'];

switch (cmd) {
  case 'validate': {
    const result = validateInventory(doc, { previous: previousDoc() });
    const n = report(result, { strictAll: false });
    if (values.json) out(result);
    if (n) process.exit(1);
    console.log(`Inventory OK: ${records.length} record${records.length === 1 ? '' : 's'} (${STATUSES.map(s => [s, records.filter(r => r.status === s).length]).filter(([, c]) => c).map(([s, c]) => `${c} ${s}`).join(', ') || 'none'}).`);
    break;
  }
  case 'list': {
    const rs = listRecords(doc, { status: values.status, release: values.release, owner: values.owner, workstream: values.workstream, releaseStatus: values['release-status'], id: values.id });
    if (values.json) { out(rs.map(r => mappingFor(r))); break; }
    for (const r of rs) console.log(`${r.screenshot_id.padEnd(44)} ${r.status.padEnd(10)} ${r.release_status.padEnd(9)} ${(r.capture?.release || '-').padEnd(12)} ${r.owner}`);
    console.log(`\n${rs.length} of ${records.length} records.`);
    break;
  }
  case 'prereqs': {
    const ids = records.map(r => r.screenshot_id);
    const rs = records.filter(r => r.status !== 'retired' && (!values.id || r.screenshot_id === values.id) && (!values.status || r.status === values.status));
    let missingTotal = 0;
    const rows = rs.map(r => ({ id: r.screenshot_id, status: r.status, ...prerequisites(r, { allIds: ids.filter(x => x !== r.screenshot_id) }) }));
    if (values.json) { out(rows); break; }
    for (const row of rows) {
      if (!row.next) { console.log(`${row.id} (${row.status}): complete`); continue; }
      if (!row.missing.length) { console.log(`${row.id} (${row.status}): ready for ${row.next}`); continue; }
      missingTotal += row.missing.length;
      console.log(`${row.id} (${row.status}): needs before ${row.next}`);
      for (const m of row.missing) console.log(`    ${m.field}: ${m.message}`);
    }
    if (missingTotal) process.exit(1);
    break;
  }
  case 'brief': {
    const result = validateInventory(doc);
    report(result);
    const ids = values.id ? values.id.split(',') : null;
    let target = values.target || null;
    if (!target && values.config) {
      let cfg;
      try { cfg = applyOverrides(loadConfig(values.config), values.set || []); } catch (e) { fail(e.message); }
      const check = validateConfig(cfg, ['capture']);
      if (check.errors?.length) { console.error(formatValidation(check)); process.exit(1); }
      const p = targetParams(cfg);
      target = presetNameOf(cfg) === 'p1-editor' ? `${p.projectName} | ${p.workstream} | ${p.pagePath}` : `${presetNameOf(cfg)} | ${cfg.baseUrl}`;
    }
    const c = inventoryCommit(file);
    const g = generateBrief(doc, { file: file.startsWith(TOOL_DIR) ? file.slice(TOOL_DIR.length + 1) : file, release: values.release, ids, target, commit: c.commit });
    if (ids) for (const id of ids) if (!g.candidates.includes(id)) fail(`${id} is not an approved record that needs a new image (status must be "approved" and release_status "new" or "refresh")`);
    if (g.blocked.length) {
      console.error('FAIL: approved records are missing what a reproducible capture needs:');
      for (const b of g.blocked) console.error(`  ${b.id}: ${b.missing.join(', ')}`);
      process.exit(1);
    }
    if (!g.ready.length) fail('no approved records need a new image' + (values.release ? ` for release ${values.release}` : '') + '. Nothing is invented from routes or existing files.');
    if (!g.brief.shots.length) {
      console.error(`FAIL: ${g.groups.length} capture targets are ready and none matches ${target ? `"${target}"` : 'a choice'}. Pass --config (its projectName, workstream and pagePath select a target) or --target "project | workstream | page". Targets:`);
      for (const k of g.groups) console.error(`  ${k}`);
      process.exit(1);
    }
    const dest = resolve(values.out || 'inventory-brief.json');
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, JSON.stringify(g.brief, null, 2) + '\n');
    console.log(`Brief: ${dest} (${g.brief.shots.length} shot${g.brief.shots.length === 1 ? '' : 's'} for ${g.chosenKey})`);
    for (const s of g.brief.shots) console.log(`  ${s.screenshotId}  [${s.release}]`);
    if (c.dirty) console.log('  WARN: the inventory has uncommitted changes, so the commit recorded in the brief is not what ran. Commit first for final runs.');
    for (const o of g.otherTargets) console.log(`  Separate run needed for ${o.target}: ${o.ids.join(', ')}`);
    console.log('Run it with: node scripts/capture.mjs --brief <brief> --config <config> --out-dir <dir>');
    break;
  }
  case 'asset-path': {
    const r = byId(need(values.id, 'id'));
    const rel = values.release || r?.capture?.release;
    if (!rel || !RELEASE_RE.test(rel)) fail('give --release (or set capture.release on the record) using letters, digits, ".", "_", "-"');
    console.log(assetPath(values.id, rel));
    break;
  }
  case 'record-capture': {
    const dir = resolve(need(values.run, 'run'));
    const rp = join(dir, 'capture-report.json');
    if (!existsSync(rp)) fail(`${rp} not found`);
    const rep = JSON.parse(readFileSync(rp, 'utf-8'));
    const rows = rep.results.filter(r => r.side === 'next' && r.screenshotId);
    if (!rows.length) fail('this run has no inventory-driven shots (no screenshotId in the report). Generate the brief with `inventory.mjs brief`.');
    let done = 0;
    for (const row of rows) {
      const r = byId(row.screenshotId);
      if (!r) fail(`the run captured ${row.screenshotId}, which is not in the inventory (inventory gap)`);
      if (!row.ok) { console.log(`  skip ${row.screenshotId}: capture failed (${row.error})`); continue; }
      if (row.release !== r.capture?.release) fail(`${row.screenshotId}: the run captured release "${row.release}" but the record says "${r.capture?.release}"`);
      if (row.caption !== undefined && row.caption !== r.content?.caption) fail(`${row.screenshotId}: the report's caption differs from the inventory (the record changed after the brief was made); regenerate the brief`);
      if (row.altText !== undefined && row.altText !== r.content?.alt_text) fail(`${row.screenshotId}: the report's alt text differs from the inventory; regenerate the brief`);
      ingest(r, row.file, rep.capturedAt, 'capture');
      if (r.status === 'approved') r.status = 'captured';
      done += 1;
    }
    const result = validateInventory(doc);
    if (report(result, { strictAll: false, only: null })) fail('not written: a recorded capture would make the inventory invalid.');
    writeInventory(file, doc);
    console.log(`Recorded ${done} capture${done === 1 ? '' : 's'} in ${file}.`);
    break;
  }
  case 'record-asset': {
    const id = need(values.id, 'id');
    const src = resolve(need(values.file, 'file'));
    update(id, r => ingest(r, src, today(), values.source || 'figma_export'));
    console.log(`Recorded asset for ${id}.`);
    break;
  }
  case 'record-figma': {
    const id = need(values.id, 'id');
    update(id, r => {
      const f = r.figma || (r.figma = {});
      const set = (k, v) => { if (v !== undefined) f[k] = v; };
      set('evidence', values.evidence); set('not_used_reason', values['not-used-reason']);
      set('file_url', values['file-url']); set('page_name', values['page-name']); set('node_id', values['node-id']); set('annotated_node_id', values['annotated-node-id']);
      set('version_name', values['version-name']); set('branch_url', values['branch-url']);
      set('manifest_commit', values['manifest-commit']); set('annotation_status', values['annotation-status']);
      if (values['dev-resource']) f.dev_resource_urls = [...new Set([...(f.dev_resource_urls || []), ...values['dev-resource']])];
      if (f.evidence && f.evidence !== 'not_used' && f.evidence !== 'none') { f.frame_name = frameName(r, 'clean'); f.annotated_frame_name = frameName(r, 'annotated'); }
    });
    console.log(`Recorded Figma evidence for ${id}. Only what you passed was written.`);
    break;
  }
  case 'record-publication': {
    const id = need(values.id, 'id');
    // The checksum of what the published URL serves. It can differ from asset.sha256: publishing may resize or re-encode.
    if (values['published-file'] && values['published-sha256']) fail('give --published-file or --published-sha256, not both');
    let publishedSha;
    if (values['published-file']) {
      if (!existsSync(values['published-file'])) fail(`--published-file ${values['published-file']} does not exist`);
      publishedSha = sha256(readFileSync(values['published-file']));
    } else if (values['published-sha256']) {
      publishedSha = values['published-sha256'].toLowerCase();
      if (!/^[0-9a-f]{64}$/.test(publishedSha)) fail('--published-sha256 must be 64 hex characters');
    }
    update(id, r => {
      const p = r.publication || (r.publication = {});
      if (values['inserted-at']) p.inserted_at = values['inserted-at'];
      if (values['published-url']) p.published_url = values['published-url'];
      if (publishedSha) p.published_sha256 = publishedSha;
      if (values['verified-at']) {
        p.verified_at = values['verified-at'];
        p.verified_release = values['verified-release'] || r.capture?.release;
        p.verified_asset_sha256 = r.asset?.sha256;
        p.alt_text_fingerprint = altFingerprint(r.content?.alt_text);
      }
      if (values.notes) p.verification_notes = values.notes;
    });
    console.log(`Recorded publication details for ${id}. Move the status with: transition --id ${id} --to <status>`);
    break;
  }
  case 'transition': {
    const id = need(values.id, 'id');
    const to = need(values.to, 'to');
    const r0 = byId(id);
    if (!r0) fail(`no record "${id}"`);
    const fromStatus = r0.status; // update() mutates the same record object
    const bad = transitionError(r0.status, to);
    if (bad) fail(bad);
    if (to === 'verified' && r0.status !== 'inserted') fail('only an inserted record can be verified');
    update(id, r => {
      const from = r.status;
      if (to === 'retired') {
        r.retired_reason = need(values.reason, 'reason'); r.retired_at = today(); r.release_status = 'retire';
      } else if (to === 'approved' && RANK_AFTER_APPROVED.includes(from) && values.release) {
        // Reopen for a new release: keep what was published in history, then clear per-release evidence.
        if (!RELEASE_RE.test(values.release)) fail('--release must use letters, digits, ".", "_", "-"');
        if (values.release === r.capture?.release) fail(`--release ${values.release} is the release already recorded; give the new release`);
        reopenForRelease(r, values.release, values['release-status-new'] || 'refresh');
      }
      r.status = to;
    });
    console.log(`${id}: ${fromStatus} -> ${to}`);
    break;
  }
  case 'handoff': {
    const result = validateInventory(doc);
    report(result);
    const c = inventoryCommit(file);
    const h = renderDocsHandoff(doc, { release: values.release, ids: values.id ? values.id.split(',') : null, inventory: { file: file.startsWith(TOOL_DIR) ? file.slice(TOOL_DIR.length + 1) : file, ...c } });
    const text = (values.format || 'markdown') === 'json' ? JSON.stringify({ inventory: { file, ...c }, records: h.records }, null, 2) + '\n' : h.markdown + '\n';
    if (values.out) { writeFileSync(resolve(values.out), text); console.log(`Wrote ${resolve(values.out)} (${h.records.length} records)`); } else process.stdout.write(text);
    break;
  }
  case 'set-alt': {
    const id = need(values.id, 'id');
    const text = need(values.text, 'text').trim();
    const r0 = byId(id);
    if (!r0) fail(`no record "${id}"`);
    // A verified record's fingerprint vouches for the alt text on the live page. Changing it needs a fresh check
    // of that page, so the same command re-stamps the fingerprint only when the person says when they checked.
    const verified = r0.status === 'verified';
    if (!verified && values['verified-at']) fail('--verified-at applies only to a verified record');
    if (r0.content?.alt_text === text) { console.log(`${id}: alt text unchanged.`); break; }
    if (verified && !values['verified-at']) fail(`${id} is verified, so the published page still shows the old alt text. Update it in the document, check the live page, then rerun with --verified-at <ISO time of that check>.`);
    update(id, r => {
      (r.content || (r.content = {})).alt_text = text;
      if (verified) {
        r.publication.alt_text_fingerprint = altFingerprint(text);
        r.publication.verified_at = values['verified-at'];
      }
    });
    console.log(`${id}: alt text updated (fingerprint ${altFingerprint(text)}).`);
    if (r0.status === 'approved') console.log('  A capture brief made before this change carries the old alt text; regenerate it with `brief` before capturing.');
    if (r0.status === 'handed_off') console.log('  The docs handoff already sent has the old alt text; send a new one with `handoff`.');
    if (r0.status === 'inserted') console.log('  Update the alt text in the document too; record-publication --verified-at records the check.');
    break;
  }
  case 'check-alt': {
    const r = byId(need(values.id, 'id'));
    if (!r) fail(`no record "${values.id}"`);
    const published = need(values.notes, 'notes');
    const want = altFingerprint(r.content?.alt_text), got = altFingerprint(published);
    console.log(`inventory alt fingerprint:  ${want}\npublished alt fingerprint:  ${got}`);
    if (want !== got) { console.error('FAIL: the published alt text differs from the inventory (ignoring case and spacing). Fix the document, or update the record and re-verify.'); process.exit(1); }
    console.log('OK: the published alt text matches the inventory.');
    break;
  }
  case 'lookup': {
    const res = lookup(doc, { id: values.id, doc: values.doc, heading: values.heading, refresh: values.refresh, unverified: values.unverified, stale: values.stale });
    if (res.error) fail(res.error);
    if (values.json) { out(res.records); break; }
    if (!res.records.length) console.log('No matching records.');
    for (const m of res.records) {
      console.log(`${m.screenshot_id}  [${m.status}, publication ${m.publication.state}]`);
      console.log(`    article ${m.docs.document_id || m.docs.document_url || '(none)'} / "${m.docs.heading}" / slot ${m.docs.image_slot}`);
      if (m.unverified.length) console.log(`    unverified: ${m.unverified.join('; ')}`);
    }
    break;
  }
  case 'trace': {
    // Read-only audit of every image's chain. Writes only the --out report, if asked.
    const files = {};
    if (values['assets-dir']) {
      const root = resolve(values['assets-dir']);
      files.assets = {};
      for (const r of records) {
        for (const pth of [r.asset?.path, ...(r.history || []).map(h => h.asset?.path)].filter(Boolean)) {
          const full = join(root, pth);
          if (!existsSync(full)) { files.assets[pth] = { exists: false }; continue; }
          const buf = readFileSync(full);
          let info = {};
          try { info = pngInfo(buf); } catch { /* not a PNG: dimensions stay unknown */ }
          files.assets[pth] = { exists: true, sha256: sha256(buf), width: info.width, height: info.height };
        }
      }
    }
    if (values.run) {
      const rp = join(resolve(values.run), 'capture-report.json');
      if (!existsSync(rp)) fail(`${rp} not found`);
      files.runShots = JSON.parse(readFileSync(rp, 'utf-8')).results.filter(x => x.side === 'next' && x.ok).map(x => ({ slug: x.slug, screenshotId: x.screenshotId }));
    }
    const t = traceInventory(doc, files);
    const text = values.json ? JSON.stringify(t, null, 2) + '\n' : renderTrace(t) + '\n';
    if (values.out) { writeFileSync(resolve(values.out), text); console.log(`Wrote ${resolve(values.out)}`); } else process.stdout.write(text);
    if (!t.ok) process.exit(1);
    break;
  }
  case 'release-check': {
    // Where the latest version comes from: --source, --package (npm), or the config's preset.
    let source = values.source || (values.package ? `npm:${values.package}` : null);
    if (!source && values.config) {
      let cfg;
      try { cfg = loadConfig(values.config); } catch (e) { fail(e.message); }
      source = loadPreset(presetNameOf(cfg)).release?.source || null;
    }
    let src = null;
    if (source) { try { src = parseSource(source); } catch (e) { fail(e.message); } }
    const pkg = src?.kind === 'npm' ? src.name : null;
    const label = src ? (pkg || source) : 'Release';
    let appVersion = null, latest = null;
    if ((values.app || values.registry) && !src) fail('say where releases come from: --source npm:<package> | github:<owner>/<repo> | wordpress | drupal | page:<url> (with --pattern), --package <npm package>, or --config <file> to use its preset\'s source');
    if (values.app) {
      if (!pkg) fail(`--app reads an installed npm package, but the source is ${source}. Use --source npm:<package> or --package.`);
      const appDir = resolve(values.app);
      const tryJson = f => { try { return JSON.parse(readFileSync(f, 'utf-8')); } catch { return null; } };
      appVersion = tryJson(join(appDir, 'package-lock.json'))?.packages?.[`node_modules/${pkg}`]?.version
        || tryJson(join(appDir, 'node_modules', pkg, 'package.json'))?.version || null;
      if (!appVersion) fail(`cannot find the installed version of ${pkg} in ${appDir} (looked in package-lock.json and node_modules). Run npm install there, or pass --version.`);
    }
    if (values.registry) {
      if (pkg) {
        // npm itself, so a private registry and its auth in .npmrc apply.
        const r = spawnSync('npm', ['view', pkg, 'dist-tags.latest'], { encoding: 'utf-8' });
        latest = r.status === 0 ? r.stdout.trim() : null;
        if (!latest) fail(`npm view ${pkg} failed: ${(r.stderr || '').trim().split('\n')[0] || 'no output'}`);
      } else {
        try { latest = await latestVersion(source, { pattern: values.pattern }); } catch (e) { fail(`${source}: ${e.message}`); }
      }
    }
    // The version that matters is the one the captured app runs (for the P1 editor, the UI ships inside the SDK).
    const version = values.version || appVersion || latest;
    if (!version) fail('give --version <x.y.z>, --app <dir> (the app you will capture), or --registry with a source (the latest published version)');
    if (parseVersion(version)?.pre) fail(`${version} is a prerelease; screenshots track shipped versions. Pass a released version.`);
    const warn = [];
    if (appVersion && latest && compareVersions(appVersion, latest) < 0) warn.push(`the app you would capture runs ${pkg} ${appVersion}, but ${latest} is the latest published. Screenshots show the UI of the installed version; update the app first to capture the new release.`);
    const res = releaseCheck(doc, version);
    if (res.error) fail(res.error);
    if (values.json) { out({ ...res, source, package: pkg, app_version: appVersion, latest, warnings: warn }); }
    else {
      console.log(`${label} ${version}${appVersion ? ` (installed in the app)` : ''}${latest ? `, latest published ${latest}` : ''}`);
      for (const w of warn) console.log(`  WARN: ${w}`);
      console.log(`  ${res.current.length} screenshot(s) already captured for ${version}`);
      for (const c of res.candidates) console.log(`  REFRESH ${c.id}  (${c.status}, captured for ${c.captured_for})`);
      for (const b of res.behind) console.log(`  BEHIND  ${b.id}  (${b.status}, still targets ${b.targets}); finish or retarget it with: transition --id ${b.id} --to approved --release ${version}`);
      for (const u of res.unversioned) console.log(`  UNVERSIONED ${u.id}  (release "${u.release}" isn't a version, so it can't be compared)`);
    }
    if (!res.candidates.length) { if (!values.json) console.log('  Nothing to reopen.'); break; }
    if (!values.reopen) {
      if (!values.json) console.log(`\n${res.candidates.length} screenshot(s) may have changed. Reopen them for ${version} with: node scripts/inventory.mjs release-check --version ${version} --reopen`);
      process.exit(3);
    }
    // Reopen every candidate in one step: all of them become valid, or nothing is written.
    const before = JSON.parse(JSON.stringify(doc));
    for (const c of res.candidates) {
      const r = byId(c.id);
      reopenForRelease(r, version, 'refresh');
      r.status = 'approved';
    }
    const result = validateInventory(doc, { previous: before });
    if (report(result, { strictAll: false, only: null })) fail('not written: reopening would make the inventory invalid.');
    writeInventory(file, doc);
    console.log(`Reopened ${res.candidates.length} screenshot(s) for ${version} as "refresh". Next: brief, capture (needs your signed-in Chrome), then \`release --release ${version} --old <previous run> --new <new run>\` to see which pixels really changed.`);
    break;
  }
  case 'release': {
    const rel = need(values.release, 'release');
    let rows = null, newReport = null;
    if (values.old || values.new) {
      if (!values.old || !values.new) fail('give both --old and --new run folders, or neither');
      try { rows = compareRuns(values.old, values.new).rows; } catch (e) { fail(e.message); }
      newReport = JSON.parse(readFileSync(join(resolve(values.new), 'capture-report.json'), 'utf-8'));
    }
    const rep = releaseReport(doc, rel, { runRows: rows, newReport });
    if (values.json) { out(rep); break; }
    console.log(`Release ${rel}: ${rep.affected.length} record(s) need action, ${rep.unchanged.length} unchanged.`);
    for (const a of rep.affected) {
      console.log(`\n${a.screenshot_id}  ${a.action.toUpperCase()}${a.pixels ? `  (pixels: ${a.pixels})` : ''}`);
      console.log(`    reason: ${a.reason}`);
      console.log(`    capture: ${a.capture_target ? `${a.capture_target.project} | ${a.capture_target.workstream} | ${a.capture_target.page}` : '(not recorded)'}`);
      console.log(`    docs: ${a.docs_location.document} / "${a.docs_location.heading}" / ${a.docs_location.image_slot}`);
      console.log(`    figma: ${a.figma_evidence}   replacement asset: ${a.replacement_asset_path || '(none: retiring)'}`);
      console.log(`    handoff: ${a.handoff_state}   publication: ${a.verification_state}`);
    }
    for (const x of rep.review) console.log(`\nREVIEW ${x.screenshot_id}: ${x.note}`);
    if (rep.notCaptured.length) console.log(`\nNot captured in the new run: ${rep.notCaptured.join(', ')}`);
    if (rep.gaps.length) {
      console.log('\nINVENTORY GAPS (not refreshes):');
      for (const g of rep.gaps) console.log(`    ${g.shot}: ${g.gap}`);
      process.exit(2);
    }
    break;
  }
  default:
    fail(`unknown command "${cmd}". Run with --help.`);
}

function ingest(r, srcFile, capturedAt, source) {
  if (!existsSync(srcFile)) fail(`${srcFile} not found`);
  const buf = readFileSync(srcFile);
  let info;
  try { info = pngInfo(buf); } catch (e) { fail(`${srcFile}: ${e.message}`); }
  const release = r.capture?.release;
  if (!release || !RELEASE_RE.test(release)) fail(`${r.screenshot_id}: set capture.release before recording an asset`);
  const rel = assetPath(r.screenshot_id, release);
  if (values['assets-dir']) {
    const dest = join(resolve(values['assets-dir']), rel);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, buf);
  }
  r.asset = { path: rel, sha256: sha256(buf), width: info.width, height: info.height, captured_at: capturedAt, source };
}
