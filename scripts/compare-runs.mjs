#!/usr/bin/env node
/**
 * p1-editor-screenshots / compare-runs
 *
 * Compares two capture runs shot by shot, so a release refresh yields a reviewable list of what changed
 * in the UI. It reads each run's capture-report.json and PNGs, and reports one of:
 *
 *   identical   same pixels, or only isolated pixel noise (see below)
 *   changed     same size, with a cluster of differing pixels (reports how many blocks and what percent of pixels differ)
 *   resized     the image dimensions differ
 *   new         captured now, not in the old run
 *   removed     in the old run, not captured now
 *   failed      captured in the old run, failed or skipped in the new one
 *
 * Usage:
 *   node compare-runs.mjs --old <previous run dir> --new <new run dir> [--json out.json] [--fail-on-change]
 *                         [--exact] [--block 16] [--min-diff 8]
 *
 * Headless Chrome occasionally renders a handful of pixels differently between identical runs (about 10 of
 * 5 million in testing), so an exact comparison reports false changes. A real UI change, such as a reworded
 * label, differs in a dense cluster. The image is split into --block x --block pixel squares (default 16);
 * a shot is "changed" when any square has at least --min-diff differing pixels (default 8). Differing pixels
 * outside those squares are counted as noise and reported, not as a change. --exact treats any difference
 * as a change.
 * It decodes 8-bit RGB/RGBA non-interlaced PNGs, which is what capture.mjs writes. Only the editor
 * shots ("next" side) are compared.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { parseArgs } from 'node:util';
import { join, resolve } from 'node:path';

export function decodePng(buf) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (!buf.subarray(0, 8).equals(sig)) throw new Error('not a PNG');
  let off = 8, w = 0, h = 0, depth = 0, ctype = 0, interlace = 0;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off), type = buf.toString('ascii', off + 4, off + 8), data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); depth = data[8]; ctype = data[9]; interlace = data[12]; }
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  if (depth !== 8 || ![2, 6].includes(ctype) || interlace) throw new Error(`unsupported PNG (depth ${depth}, color type ${ctype}, interlace ${interlace})`);
  const bpp = ctype === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * bpp;
  const out = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    const src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const row = out.subarray(y * stride, (y + 1) * stride);
    const prev = y ? out.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? row[x - bpp] : 0, b = prev ? prev[x] : 0, c = prev && x >= bpp ? prev[x - bpp] : 0;
      let v = src[x];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      row[x] = v & 255;
    }
  }
  return { w, h, bpp, pixels: out };
}

export function diffStats(a, b, { block = 16, minDiff = 8 } = {}) {
  const bw = Math.ceil(a.w / block), bh = Math.ceil(a.h / block);
  const perBlock = new Uint32Array(bw * bh);
  let diff = 0;
  for (let y = 0; y < a.h; y++) {
    for (let x = 0; x < a.w; x++) {
      const i = y * a.w + x;
      for (let k = 0; k < 3; k++) {
        if (a.pixels[i * a.bpp + k] !== b.pixels[i * b.bpp + k]) { diff++; perBlock[Math.floor(y / block) * bw + Math.floor(x / block)]++; break; }
      }
    }
  }
  let changedBlocks = 0, inChanged = 0;
  for (const c of perBlock) if (c >= minDiff) { changedBlocks++; inChanged += c; }
  return { diffPixels: diff, diffPercent: (diff / (a.w * a.h)) * 100, changedBlocks, noisePixels: diff - inChanged };
}

function shotsOf(dir) {
  const p = join(dir, 'capture-report.json');
  if (!existsSync(p)) throw new Error(`${p} not found`);
  const report = JSON.parse(readFileSync(p, 'utf-8'));
  const map = new Map();
  for (const r of report.results) if (r.side === 'next') map.set(r.slug, r);
  return { report, map, skipped: new Map((report.skipped || []).map(s => [s.slug, s])) };
}

export function compareRuns(oldDir, newDir, opts = {}) {
  const { exact = false, block = 16, minDiff = 8 } = opts;
  const o = shotsOf(resolve(oldDir)), n = shotsOf(resolve(newDir));
  const slugs = [...new Set([...o.map.keys(), ...n.map.keys(), ...o.skipped.keys(), ...n.skipped.keys()])];
  const rows = slugs.map(slug => {
    const a = o.map.get(slug), b = n.map.get(slug);
    const usable = r => r && r.ok && r.file && existsSync(r.file);
    if (usable(a) && !usable(b)) return { slug, status: 'failed', detail: b ? b.error || 'failed' : n.skipped.get(slug)?.reason || 'not captured' };
    if (!usable(a) && usable(b)) return { slug, status: 'new', detail: '' };
    if (!usable(a) && !usable(b)) return { slug, status: 'removed', detail: 'not captured in either run' };
    const pa = decodePng(readFileSync(a.file)), pb = decodePng(readFileSync(b.file));
    if (pa.w !== pb.w || pa.h !== pb.h) return { slug, status: 'resized', detail: `${pa.w}x${pa.h} -> ${pb.w}x${pb.h}` };
    const st = diffStats(pa, pb, { block, minDiff });
    const changed = exact ? st.diffPixels > 0 : st.changedBlocks > 0;
    const base = { slug, diffPercent: Number(st.diffPercent.toFixed(4)), changedBlocks: st.changedBlocks, noisePixels: st.noisePixels };
    return changed
      ? { ...base, status: 'changed', detail: `${st.diffPercent.toFixed(2)}% of pixels differ (${st.changedBlocks} blocks)` }
      : { ...base, status: 'identical', detail: st.noisePixels ? `${st.noisePixels} isolated pixels ignored as noise` : '' };
  });
  return { old: { runDir: resolve(oldDir), capturedAt: o.report.capturedAt }, new: { runDir: resolve(newDir), capturedAt: n.report.capturedAt }, exact, block, minDiff, rows };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { values } = parseArgs({
    options: { old: { type: 'string' }, new: { type: 'string' }, exact: { type: 'boolean' }, block: { type: 'string', default: '16' }, 'min-diff': { type: 'string', default: '8' }, json: { type: 'string' }, 'fail-on-change': { type: 'boolean' }, help: { type: 'boolean', short: 'h' } },
  });
  if (values.help || !values.old || !values.new) {
    console.log('Usage: node compare-runs.mjs --old <run dir> --new <run dir> [--json <file>] [--fail-on-change] [--exact] [--block 16] [--min-diff 8]');
    process.exit(values.help ? 0 : 1);
  }
  let result;
  try {
    result = compareRuns(values.old, values.new, { exact: values.exact, block: Number(values.block), minDiff: Number(values['min-diff']) });
  } catch (e) {
    console.error(`FAIL: ${e.message}`);
    process.exit(1);
  }
  for (const r of result.rows) console.log(`${r.status.padEnd(10)} ${r.slug}${r.detail ? `  (${r.detail})` : ''}`);
  const changed = result.rows.filter(r => r.status !== 'identical');
  console.log(`\n${result.rows.length - changed.length} identical, ${changed.length} not identical.`);
  if (values.json) writeFileSync(resolve(values.json), JSON.stringify(result, null, 2) + '\n');
  process.exit(values['fail-on-change'] && changed.length ? 2 : 0);
}
