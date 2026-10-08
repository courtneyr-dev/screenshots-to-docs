#!/usr/bin/env node
/**
 * p1-editor-screenshots / gdocs-manifest
 *
 * Writes the manifest the Google Docs swap script (templates/gdocs-swap/Code.gs) reads: one entry per
 * image to replace, pinned to a git commit, with the alt text to write and how to find the image in the doc.
 *
 * Usage:
 *   node gdocs-manifest.mjs --inventory <file> --repo <owner/name> --ref <40-char commit>
 *     [--assets-root <folder holding screenshots/>] [--title-anchor] [--out manifest.json]
 *
 * Included: records at handed_off or later with an asset and a Google Doc ID in source.docs_document_id.
 * Everything else is listed as skipped, with the reason. See references/release-swap.md.
 */

import { writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { loadInventory, altFingerprint } from './lib/inventory.mjs';

const FROM = ['handed_off', 'inserted', 'verified'];
export const GDOC_ID_RE = /^[A-Za-z0-9_-]{25,}$/;
const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const SHA_RE = /^[0-9a-f]{40}$/;

export function buildManifest(doc, { repo, ref, assetsRoot = '', titleAnchor = false }) {
  if (!REPO_RE.test(repo || '')) throw new Error('--repo must look like owner/name');
  if (!SHA_RE.test(ref || '')) throw new Error('--ref must be a full 40-character commit SHA, so the manifest always means the same bytes');
  const root = String(assetsRoot).replace(/^\/+|\/+$/g, '');
  if (root.split('/').includes('..')) throw new Error('--assets-root must stay inside the repository');
  const entries = [], skipped = [];
  for (const r of doc.records) {
    const id = r.screenshot_id, a = r.asset || {}, c = r.content || {}, docId = r.source?.docs_document_id;
    if (!FROM.includes(r.status)) { skipped.push({ id, reason: `status is ${r.status}; only handed_off or later is swapped` }); continue; }
    if (!GDOC_ID_RE.test(docId || '')) { skipped.push({ id, reason: 'source.docs_document_id is not a Google Doc ID' }); continue; }
    if (!a.path || !a.sha256) { skipped.push({ id, reason: 'no recorded asset (record-asset)' }); continue; }
    if (!c.alt_text) { skipped.push({ id, reason: 'no alt text' }); continue; }
    const fingerprints = [...new Set([altFingerprint(c.alt_text), r.publication?.alt_text_fingerprint].filter(Boolean))];
    entries.push({
      screenshot_id: id,
      release: r.capture?.release || null,
      document_id: docId,
      image: { repo, ref, path: root ? `${root}/${a.path}` : a.path, sha256: a.sha256, width: a.width ?? null, height: a.height ?? null },
      alt: { title: titleAnchor ? id : c.alt_text, description: c.alt_text },
      match: { title: titleAnchor ? id : null, fingerprints },
    });
  }
  return { version: 1, repo, ref, entries, skipped };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { values } = parseArgs({ options: {
    inventory: { type: 'string' }, repo: { type: 'string' }, ref: { type: 'string' }, 'assets-root': { type: 'string' },
    'title-anchor': { type: 'boolean' }, out: { type: 'string' }, help: { type: 'boolean', short: 'h' },
  } });
  if (values.help || !values.inventory || !values.repo || !values.ref) {
    console.log('Usage: node gdocs-manifest.mjs --inventory <file> --repo <owner/name> --ref <commit> [--assets-root <folder>] [--title-anchor] [--out manifest.json]');
    process.exit(values.help ? 0 : 1);
  }
  let m;
  try { m = buildManifest(loadInventory(values.inventory).doc, { repo: values.repo, ref: values.ref, assetsRoot: values['assets-root'] ?? '', titleAnchor: values['title-anchor'] }); }
  catch (e) { console.error(`FAIL: ${e.message}`); process.exit(1); }
  const text = JSON.stringify(m, null, 2) + '\n';
  if (values.out) writeFileSync(resolve(values.out), text); else process.stdout.write(text);
  for (const e of m.entries) console.error(`  swap ${e.screenshot_id} [${e.release}] in doc ${e.document_id} <- ${e.image.path}@${e.image.ref.slice(0, 7)}`);
  for (const s of m.skipped) console.error(`  skip ${s.id}: ${s.reason}`);
  console.error(`${m.entries.length} to swap, ${m.skipped.length} skipped.${values.out ? ` Wrote ${resolve(values.out)}.` : ''}`);
}
