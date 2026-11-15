#!/usr/bin/env node
/**
 * Pixelate the declared sensitive regions of a capture, before it goes to Figma.
 *
 *   node scripts/pixelate.mjs --in <capture.png> --sensitive <regions.json> --out <pixelated.png>
 *     [--dpr 2] [--block 14] [--json]
 *   node scripts/pixelate.mjs --in <capture.png> --sensitive <regions.json> --in-place [--dpr 2] ...
 *
 * <regions.json> is the same file record-annotation.mjs takes with --sensitive: an array of
 * { id, kind, bbox: [x, y, w, h], method } in frame (CSS) px, or an object with a `sensitive` array.
 * Regions declared `method: "fake-data"` are left alone. Every other region is grown by the token
 * contract's padding (styles.redaction.minPaddingPx), clipped to the frame, scaled by --dpr to capture
 * px, and pixelated: blocks start at the region's top-left corner, and each block becomes the average
 * of the unredacted pixels under it (shrink, then enlarge with nearest neighbor), so the validator's
 * redaction check sees a grid of uniform blocks.
 *
 * Blocks are 14 capture px by default. A block must be at least styles.redaction.pixelate.minBlockCssPx
 * CSS px (7), so at --dpr 2.2 the default rises to 16 px and a --block below the minimum is refused.
 * The unredacted capture holds personal data: write --out to a new file and keep the original out of
 * anything delivered, or use --in-place to overwrite it.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { decodePng, encodePng } from './compare-runs.mjs';
import { loadTokens } from './lib/annotation.mjs';

export const DEFAULT_BLOCK = 14;

/** The block size in capture px: the request (default 14), raised to the contract's minimum at this dpr. */
export function blockFor(dpr, requested, minBlockCssPx) {
  const min = Math.ceil(minBlockCssPx * dpr - 1e-9);
  if (requested !== undefined) {
    if (!Number.isInteger(requested) || requested < min) throw new Error(`--block ${requested} is below the minimum of ${min} px (${minBlockCssPx} CSS px at dpr ${dpr})`);
    return requested;
  }
  return Math.max(DEFAULT_BLOCK, min);
}

/** Read a sensitive-regions file: an array, or an object with a `sensitive` array (a manifest). */
export function readRegions(file) {
  const data = JSON.parse(readFileSync(file, 'utf8'));
  const regions = Array.isArray(data) ? data : data.sensitive;
  if (!Array.isArray(regions)) throw new Error(`${file} has no sensitive regions (an array, or an object with a "sensitive" array)`);
  for (const r of regions) {
    const ok = Array.isArray(r.bbox) && r.bbox.length === 4 && r.bbox.every(v => Number.isFinite(v)) && r.bbox[2] > 0 && r.bbox[3] > 0;
    if (!ok) throw new Error(`sensitive region "${r.id ?? '?'}" has no valid bbox [x, y, w, h]`);
  }
  return regions;
}

/**
 * Pixelate `regions` in a decoded PNG ({ w, h, bpp, pixels }), in place. Returns one entry per region:
 * { id, method, skipped, box: [x, y, w, h] in capture px, block }.
 */
export function pixelateRegions(png, regions, { dpr, block, padCssPx }) {
  const frameW = png.w / dpr, frameH = png.h / dpr;
  const done = [];
  for (const r of regions) {
    const method = r.method || 'pixelate';
    if (method === 'fake-data') { done.push({ id: r.id, method, skipped: true }); continue; }
    if (method !== 'pixelate') throw new Error(`sensitive region "${r.id}" has an unknown method "${method}" (use pixelate or fake-data)`);
    const [x, y, w, h] = r.bbox;
    // Pad in CSS px, clip to the frame, then cover the region fully in whole capture px.
    const cx0 = Math.max(0, x - padCssPx), cy0 = Math.max(0, y - padCssPx);
    const cx1 = Math.min(frameW, x + w + padCssPx), cy1 = Math.min(frameH, y + h + padCssPx);
    const x0 = Math.floor(cx0 * dpr), y0 = Math.floor(cy0 * dpr);
    const x1 = Math.min(png.w, Math.ceil(cx1 * dpr)), y1 = Math.min(png.h, Math.ceil(cy1 * dpr));
    if (x1 <= x0 || y1 <= y0) throw new Error(`sensitive region "${r.id}" lies outside the ${png.w}x${png.h} capture`);
    for (let by = y0; by < y1; by += block) {
      for (let bx = x0; bx < x1; bx += block) {
        const ex = Math.min(bx + block, x1), ey = Math.min(by + block, y1);
        const sum = new Array(png.bpp).fill(0);
        for (let py = by; py < ey; py++) for (let px = bx; px < ex; px++) {
          const i = (py * png.w + px) * png.bpp;
          for (let k = 0; k < png.bpp; k++) sum[k] += png.pixels[i + k];
        }
        const n = (ex - bx) * (ey - by);
        const avg = sum.map(v => Math.round(v / n));
        for (let py = by; py < ey; py++) for (let px = bx; px < ex; px++) {
          const i = (py * png.w + px) * png.bpp;
          for (let k = 0; k < png.bpp; k++) png.pixels[i + k] = avg[k];
        }
      }
    }
    done.push({ id: r.id, method, skipped: false, box: [x0, y0, x1 - x0, y1 - y0], block });
  }
  return done;
}

function main() {
  const { values } = parseArgs({
    options: {
      in: { type: 'string' },
      sensitive: { type: 'string' },
      out: { type: 'string' },
      'in-place': { type: 'boolean', default: false },
      dpr: { type: 'string', default: '2' },
      block: { type: 'string' },
      json: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });
  const usage = 'Usage: node scripts/pixelate.mjs --in <capture.png> --sensitive <regions.json> (--out <file> | --in-place) [--dpr 2] [--block 14] [--json]';
  if (values.help || !values.in || !values.sensitive || (!values.out && !values['in-place'])) {
    console.log(usage);
    process.exit(values.help ? 0 : 1);
  }
  try {
    const input = resolve(values.in);
    if (!existsSync(input)) throw new Error(`${values.in} not found`);
    if (values.out && resolve(values.out) === input && !values['in-place']) throw new Error('--out is the input file; pass --in-place to overwrite the capture');
    const dpr = Number(values.dpr);
    if (!(dpr > 0)) throw new Error(`--dpr must be a positive number, not ${values.dpr}`);
    const R = loadTokens().styles.redaction;
    const block = blockFor(dpr, values.block === undefined ? undefined : Number(values.block), R.pixelate.minBlockCssPx);
    const png = decodePng(readFileSync(input));
    const result = pixelateRegions(png, readRegions(values.sensitive), { dpr, block, padCssPx: R.minPaddingPx });
    const out = values['in-place'] ? input : resolve(values.out);
    writeFileSync(out, encodePng(png));
    if (values.json) console.log(JSON.stringify({ out, dpr, block, regions: result }, null, 2));
    else {
      for (const r of result) console.log(r.skipped ? `skipped    ${r.id} (fake data)` : `pixelated  ${r.id}  ${r.box[2]}x${r.box[3]} px at ${r.box[0]},${r.box[1]}, ${r.block} px blocks`);
      console.log(`wrote ${out}`);
    }
  } catch (e) {
    console.error(`FAIL: ${e.message}`);
    process.exit(1);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
