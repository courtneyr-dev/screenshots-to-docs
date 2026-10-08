#!/usr/bin/env node
/**
 * p1-editor-screenshots / figma-export
 *
 * Exports each record's annotated Figma frame (figma.annotated_node_id) as a PNG through the Figma REST
 * API, so a release does not need anyone to click Export in Figma.
 *
 * Usage:
 *   FIGMA_TOKEN=... node figma-export.mjs --inventory <file> (--id a,b | --status annotated) --out <dir>
 *     [--scale 2] [--record --assets-dir <dir>]
 *
 * The token comes from FIGMA_TOKEN only. It is sent to api.figma.com and nowhere else, and never printed.
 * Image URLs Figma returns are downloaded only from allowed hosts (see checkImageUrl), with redirects
 * refused. --record runs `inventory.mjs record-asset` for each exported file. See references/release-swap.md.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { resolve, join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadInventory, pngInfo, sha256 } from './lib/inventory.mjs';

export const API_BASE = 'https://api.figma.com';
/** Test escape hatch, as in figma-upload: also allows http(s) on loopback for the API base and images. */
export const LOOPBACK_ENV = 'P1_FIGMA_ALLOW_LOOPBACK';
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]']);
// figma-alpha-api.s3… is unconfirmed (Figma's reference names no host); see references/release-swap.md.
const IMAGE_HOSTS = new Set(['figma-alpha-api.s3.us-west-2.amazonaws.com']);

export function checkImageUrl(raw, env = process.env) {
  let u;
  try { u = new URL(raw); } catch { return { ok: false, host: '(unparseable)', reason: 'not a valid URL' }; }
  const host = u.hostname;
  if (u.username || u.password) return { ok: false, host, reason: 'URL contains credentials' };
  if (env[LOOPBACK_ENV] === '1' && LOOPBACK.has(host) && /^https?:$/.test(u.protocol)) return { ok: true, host };
  if (u.protocol !== 'https:') return { ok: false, host, reason: `scheme ${u.protocol} is not https` };
  if (host === 'figma.com' || host.endsWith('.figma.com') || IMAGE_HOSTS.has(host)) return { ok: true, host };
  return { ok: false, host, reason: 'host is not figma.com, a figma.com subdomain, or a known Figma image host' };
}

/** The API base: api.figma.com, or a loopback mock when LOOPBACK_ENV is set. */
export function apiBase(env = process.env) {
  const b = env.P1_FIGMA_API_BASE;
  if (!b) return API_BASE;
  const u = new URL(b);
  if (env[LOOPBACK_ENV] === '1' && LOOPBACK.has(u.hostname)) return b.replace(/\/$/, '');
  throw new Error('P1_FIGMA_API_BASE is only for a loopback test server (with P1_FIGMA_ALLOW_LOOPBACK=1)');
}

export function fileKeyFrom(fileUrl) {
  const m = /^https:\/\/(?:www\.)?figma\.com\/(?:design|file)\/([0-9A-Za-z]{22,128})(?:[/?#]|$)/.exec(fileUrl || '');
  return m ? m[1] : null;
}

async function main() {
  const { values } = parseArgs({ options: {
    inventory: { type: 'string' }, id: { type: 'string' }, status: { type: 'string' }, out: { type: 'string' },
    scale: { type: 'string', default: '2' }, record: { type: 'boolean' }, 'assets-dir': { type: 'string' }, help: { type: 'boolean', short: 'h' },
  } });
  const fail = msg => { console.error(`FAIL: ${msg}`); process.exit(1); };
  if (values.help || !values.inventory || !values.out || (!values.id && !values.status)) {
    console.log('Usage: FIGMA_TOKEN=... node figma-export.mjs --inventory <file> (--id a,b | --status annotated) --out <dir> [--scale 2] [--record --assets-dir <dir>]');
    process.exit(values.help ? 0 : 1);
  }
  const token = process.env.FIGMA_TOKEN;
  if (!token) fail('set FIGMA_TOKEN (a Figma token with file_content:read) in the environment');
  const scale = Number(values.scale);
  if (!(scale >= 0.01 && scale <= 4)) fail('--scale must be between 0.01 and 4');
  if (values.record && !values['assets-dir']) fail('--record needs --assets-dir');
  let base;
  try { base = apiBase(); } catch (e) { fail(e.message); }

  const { doc } = loadInventory(values.inventory);
  const ids = values.id ? values.id.split(',') : null;
  const picked = doc.records.filter(r => ids ? ids.includes(r.screenshot_id) : r.status === values.status);
  if (ids) for (const id of ids) if (!picked.some(r => r.screenshot_id === id)) fail(`no record "${id}"`);
  const jobs = [], skipped = [];
  for (const r of picked) {
    const f = r.figma || {};
    const key = fileKeyFrom(f.file_url);
    if (!f.annotated_node_id) skipped.push(`${r.screenshot_id}: no figma.annotated_node_id (record-figma --annotated-node-id); the clean frame is never exported`);
    else if (!key) skipped.push(`${r.screenshot_id}: figma.file_url is not a figma.com design URL`);
    else jobs.push({ id: r.screenshot_id, key, node: f.annotated_node_id });
  }
  for (const s of skipped) console.log(`  skip ${s}`);
  if (!jobs.length) fail('nothing to export');

  const outDir = resolve(values.out);
  mkdirSync(outDir, { recursive: true });
  const byKey = new Map();
  for (const j of jobs) byKey.set(j.key, [...(byKey.get(j.key) || []), j]);
  let failed = 0;
  for (const [key, list] of byKey) {
    const url = `${base}/v1/images/${key}?ids=${encodeURIComponent(list.map(j => j.node).join(','))}&scale=${scale}&format=png`;
    const res = await fetch(url, { headers: { 'X-Figma-Token': token }, redirect: 'manual' });
    if (res.status !== 200) fail(`Figma API answered HTTP ${res.status} for file ${key}${res.status === 403 ? ' (the token cannot read this file, or the seat lacks API access)' : ''}`);
    const body = await res.json();
    if (body.err) fail(`Figma API error for file ${key}: ${body.err}`);
    for (const j of list) {
      const src = body.images?.[j.node];
      const tag = `${j.id} (node ${j.node})`;
      if (!src) { console.log(`FAIL ${tag}: Figma rendered no image`); failed++; continue; }
      const ok = checkImageUrl(src);
      if (!ok.ok) { console.log(`FAIL ${tag}: image host ${ok.host} refused: ${ok.reason}. Nothing downloaded from it.`); failed++; continue; }
      const img = await fetch(src, { redirect: 'manual' }); // no token: the image URL is pre-signed
      if (img.status !== 200) { console.log(`FAIL ${tag}: image download HTTP ${img.status}${img.status >= 300 && img.status < 400 ? ' (redirects are refused)' : ''}`); failed++; continue; }
      const buf = Buffer.from(await img.arrayBuffer());
      let info;
      try { info = pngInfo(buf); } catch { console.log(`FAIL ${tag}: the download is not a PNG`); failed++; continue; }
      const file = join(outDir, `${j.id}.png`);
      writeFileSync(file, buf);
      console.log(`OK   ${tag}  ${info.width}x${info.height}  sha256 ${sha256(buf).slice(0, 16)}…  -> ${file}`);
      if (values.record) {
        const r = spawnSync(process.execPath, [join(dirname(new URL(import.meta.url).pathname), 'inventory.mjs'), 'record-asset', '--inventory', values.inventory, '--id', j.id, '--file', file, '--assets-dir', values['assets-dir']], { encoding: 'utf-8' });
        if (r.status !== 0) { console.log(`FAIL ${tag}: record-asset: ${(r.stderr || r.stdout).trim()}`); failed++; } else console.log(`     ${r.stdout.trim()}`);
      }
    }
  }
  console.log(`\nDone: ${jobs.length - failed}/${jobs.length} exported${skipped.length ? `, ${skipped.length} skipped` : ''}.`);
  process.exit(failed ? 1 : 0);
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
