#!/usr/bin/env node
/**
 * nextjs-screenshots / figma-upload
 *
 * POSTs the PNG bytes for one upload_assets batch to the single-use URLs the
 * Figma MCP returned. Each URL fills the placeholder rectangle whose node id
 * you passed in the same position.
 *
 * Usage:
 *   node figma-upload.mjs --dir screenshots/acme --urls urls.json [--chunk 0] [--only key,key]
 *
 * urls.json is the `uploads` array from the upload_assets result, saved as is
 * (objects with a `submitUrl` field), or a plain array of URL strings. The
 * URLs are single-use and expire after 10 minutes.
 * --chunk picks the batch of up to 60 in figma-plan.json (default 0).
 * Every URL must be https on figma.com (or a subdomain); otherwise nothing is sent and the script
 * exits 1. P1_UPLOAD_ALLOW_LOOPBACK=1 additionally allows loopback hosts, for the test server only.
 * --only key,key retries just those PNGs (keys look like 01-home|next). urls.json
 * then holds one fresh URL per key, in the order given, and the rectangles are
 * the ones whose node ids you passed to upload_assets.
 */

import { readFileSync, existsSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { join, resolve } from 'node:path';
import { findBadUploadUrl, postUpload, LOOPBACK_ENV } from './lib/upload-urls.mjs';

const { values } = parseArgs({
  options: {
    dir: { type: 'string' },
    urls: { type: 'string' },
    chunk: { type: 'string', default: '0' },
    only: { type: 'string' },
    help: { type: 'boolean', short: 'h' },
  },
});

if (values.help || !values.dir || !values.urls) {
  console.log('Usage: node figma-upload.mjs --dir <capture folder> --urls urls.json [--chunk 0] [--only key,key]');
  process.exit(values.help ? 0 : 1);
}

const planPath = join(resolve(values.dir), 'figma-plan.json');
if (!existsSync(planPath)) {
  console.error(`FAIL: ${planPath} not found. Run figma-plan.mjs first.`);
  process.exit(1);
}
const plan = JSON.parse(readFileSync(planPath, 'utf-8'));
const chunkKeys = plan.chunks[Number(values.chunk)];
if (!chunkKeys) {
  console.error(`FAIL: no chunk ${values.chunk}; plan has ${plan.chunks.length}.`);
  process.exit(1);
}

const keys = values.only ? values.only.split(',').map(k => k.trim()) : chunkKeys;
const stray = keys.filter(k => !chunkKeys.includes(k));
if (stray.length) {
  console.error(`FAIL: not in chunk ${values.chunk}: ${stray.join(', ')}`);
  process.exit(1);
}

const raw = JSON.parse(readFileSync(resolve(values.urls), 'utf-8'));
const urls = (Array.isArray(raw) ? raw : raw.uploads || raw.urls || []).map(u => typeof u === 'string' ? u : u.submitUrl || u.url);
if (urls.length !== keys.length || urls.some(u => !u)) {
  console.error(`FAIL: chunk ${values.chunk} has ${keys.length} PNG(s) but urls.json has ${urls.length} usable URL(s).`);
  process.exit(1);
}

const bad = findBadUploadUrl(urls);
if (bad) {
  console.error(`FAIL: urls.json entry ${bad.index + 1} of ${urls.length} (host ${bad.host}) refused: ${bad.reason}. Nothing was uploaded.`);
  console.error(`Upload URLs must be https on figma.com. For a local mock server only, set ${LOOPBACK_ENV}=1 to allow 127.0.0.1, localhost and [::1].`);
  process.exit(1);
}

const failures = [];
for (let i = 0; i < keys.length; i++) {
  const up = plan.uploads.find(u => u.key === keys[i]);
  const tag = `[${i + 1}/${keys.length}] ${keys[i]}`;
  try {
    // Redirects are followed only to hosts that pass the same check (see lib/upload-urls.mjs).
    const { res } = await postUpload(urls[i], readFileSync(up.file));
    const body = (await res.text()).slice(0, 200);
    console.log(`${res.ok ? 'OK  ' : 'FAIL'} ${tag.padEnd(44)} HTTP ${res.status}${res.ok ? '' : `  ${body}  (${up.file})`}`);
    if (!res.ok) failures.push(keys[i]);
  } catch (e) {
    const why = e.refused ? `refused: ${e.message}; nothing was sent there` : e.code === 'ENOENT' ? `cannot read ${up.file}` : `network error: ${e.cause?.code || e.cause?.errors?.[0]?.code || e.cause?.message || e.message}`;
    console.log(`FAIL ${tag.padEnd(44)} ${why}  (${up.file})`);
    failures.push(keys[i]);
  }
}
console.log(`\nDone: ${keys.length - failures.length}/${keys.length} uploaded`);
if (failures.length) {
  console.error(`\nFailed: ${failures.join(', ')}`);
  console.error('Upload URLs are single-use and expire after 10 minutes, so retry with fresh ones:');
  console.error(`  1. Call upload_assets with count=${failures.length} and nodeIds for just the rectangles named above (same order).`);
  console.error(`  2. Save the new uploads array, then run:`);
  console.error(`     node figma-upload.mjs --dir ${values.dir} --urls <new urls.json> --chunk ${values.chunk} --only "${failures.join(',')}"`);
  console.error('Rectangles that uploaded fine keep their image. A 4xx on a fresh URL usually means the file is not a valid PNG or exceeds 10 MB.');
  process.exit(1);
}
