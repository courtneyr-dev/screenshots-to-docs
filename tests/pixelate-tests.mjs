/**
 * Tests for scripts/pixelate.mjs and encodePng: the output must pass the validator's own
 * pixelation check, change nothing outside the padded regions, and leave fake-data regions alone.
 * Prints PASS/FAIL lines in the format tests/run-tests.sh counts.
 *
 * Usage: node tests/pixelate-tests.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { decodePng, encodePng } from '../scripts/compare-runs.mjs';
import { blockFor, pixelateRegions, DEFAULT_BLOCK } from '../scripts/pixelate.mjs';
import { loadTokens, pixelation } from '../scripts/lib/annotation.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const R = loadTokens().styles.redaction;
const TMP = mkdtempSync(join(tmpdir(), 'pixelate-'));
let failed = 0;
const t = (name, fn) => {
  try { fn(); console.log(`PASS  ${name}`); }
  catch (e) { failed++; console.log(`FAIL  ${name}`); for (const l of String(e.message).split('\n').slice(0, 6)) console.log(`        ${l}`); }
};

/** A w x h capture with per-pixel detail, like text or a photo: no two neighbors match. */
function detailed(w, h, bpp = 3) {
  const pixels = Buffer.alloc(w * h * bpp);
  let s = 12345;
  for (let i = 0; i < pixels.length; i++) { s = (s * 1103515245 + 12345) & 0x7fffffff; pixels[i] = s >> 16 & 255; }
  if (bpp === 4) for (let i = 3; i < pixels.length; i += 4) pixels[i] = 255;
  return { w, h, bpp, pixels };
}
const scaled = (b, k) => b.map(v => v * k);
const padded = (bbox, frameW, frameH) => {
  const [x, y, w, h] = bbox, p = R.minPaddingPx;
  const x0 = Math.max(0, x - p), y0 = Math.max(0, y - p);
  return [x0, y0, Math.min(frameW, x + w + p) - x0, Math.min(frameH, y + h + p) - y0];
};
// The validator's own check for a sensitive region in the clean capture.
const check = (png, bbox, dpr) => pixelation(png, scaled(padded(bbox, png.w / dpr, png.h / dpr), dpr), {
  minBlock: R.pixelate.minBlockCssPx * dpr, edgeTol: R.pixelate.edgeTolerancePx, colorTol: R.pixelate.colorTolerance, core: scaled(bbox, dpr),
});
const cli = (...args) => spawnSync(process.execPath, [join(ROOT, 'scripts/pixelate.mjs'), ...args], { encoding: 'utf8' });

const AVATAR = { id: 'avatar', kind: 'avatar', bbox: [20, 20, 60, 30] };
const EMAIL = { id: 'email', kind: 'email', bbox: [110, 90, 70, 20], method: 'fake-data' };

t('encodePng round-trips RGB and RGBA through decodePng', () => {
  for (const bpp of [3, 4]) {
    const png = detailed(37, 23, bpp);
    const back = decodePng(encodePng(png));
    assert.equal(back.w, 37); assert.equal(back.h, 23); assert.equal(back.bpp, bpp);
    assert.ok(back.pixels.equals(png.pixels), `bpp ${bpp} pixels differ after a round trip`);
  }
});

t('blockFor: 14 px at dpr 2, raised to 16 px at dpr 2.2, and too-small blocks refused', () => {
  assert.equal(DEFAULT_BLOCK, 14);
  assert.equal(blockFor(2, undefined, R.pixelate.minBlockCssPx), 14);
  assert.equal(blockFor(2.2, undefined, R.pixelate.minBlockCssPx), 16);
  assert.equal(blockFor(2, 20, R.pixelate.minBlockCssPx), 20);
  assert.throws(() => blockFor(2, 10, R.pixelate.minBlockCssPx), /below the minimum of 14 px/);
  assert.throws(() => blockFor(2.2, 14, R.pixelate.minBlockCssPx), /below the minimum of 16 px/);
});

// One CLI run at dpr 2, shared by the next four tests.
const before = detailed(400, 300);
writeFileSync(join(TMP, 'capture.png'), encodePng(before));
writeFileSync(join(TMP, 'regions.json'), JSON.stringify([AVATAR, EMAIL]));
const run = cli('--in', join(TMP, 'capture.png'), '--sensitive', join(TMP, 'regions.json'), '--out', join(TMP, 'out.png'), '--json');
const after = run.status === 0 ? decodePng(readFileSync(join(TMP, 'out.png'))) : null;

t('the CLI pixelates a declared region in 14 px blocks at dpr 2', () => {
  assert.equal(run.status, 0, run.stderr);
  const report = JSON.parse(run.stdout);
  assert.equal(report.block, 14);
  assert.deepEqual(report.regions.find(r => r.id === 'avatar').box, [32, 32, 136, 76], 'the region plus 4 CSS px of padding, at 2x');
});

t("the validator's pixelation check fails the unredacted capture and passes the output", () => {
  assert.notEqual(check(before, AVATAR.bbox, 2).status, 'pixelated', 'the detailed input should not read as pixelated');
  const res = check(after, AVATAR.bbox, 2);
  assert.equal(res.status, 'pixelated', JSON.stringify(res));
  assert.ok(res.block >= 13, `blocks ${res.block} px apart`);
});

t('every block in the region is one color, the average of the pixels under it', () => {
  const [x0, y0, w, h] = [32, 32, 136, 76];
  for (let by = y0; by < y0 + h; by += 14) for (let bx = x0; bx < x0 + w; bx += 14) {
    const ex = Math.min(bx + 14, x0 + w), ey = Math.min(by + 14, y0 + h);
    const first = after.pixels.subarray((by * 400 + bx) * 3, (by * 400 + bx) * 3 + 3);
    let sum = 0, n = 0;
    for (let y = by; y < ey; y++) for (let x = bx; x < ex; x++) {
      const i = (y * 400 + x) * 3;
      assert.ok(after.pixels.subarray(i, i + 3).equals(first), `block at ${bx},${by} isn't uniform`);
      sum += before.pixels[i]; n++;
    }
    assert.equal(first[0], Math.round(sum / n), `block at ${bx},${by} isn't the average of its pixels`);
  }
});

t('pixels outside the padded region, including the fake-data region, are unchanged', () => {
  let changedOutside = 0;
  for (let y = 0; y < 300; y++) for (let x = 0; x < 400; x++) {
    const inside = x >= 32 && x < 168 && y >= 32 && y < 108;
    const i = (y * 400 + x) * 3;
    if (!inside && !after.pixels.subarray(i, i + 3).equals(before.pixels.subarray(i, i + 3))) changedOutside++;
  }
  assert.equal(changedOutside, 0, `${changedOutside} pixels changed outside the region`);
  assert.ok(JSON.parse(run.stdout).regions.find(r => r.id === 'email').skipped, 'the fake-data region is reported as skipped');
});

t('at dpr 2.2 the default block rises to 16 px and the output still passes the check', () => {
  const png = detailed(440, 330);
  const [res] = pixelateRegions(png, [AVATAR], { dpr: 2.2, block: blockFor(2.2, undefined, R.pixelate.minBlockCssPx), padCssPx: R.minPaddingPx });
  assert.equal(res.block, 16);
  assert.equal(check(png, AVATAR.bbox, 2.2).status, 'pixelated');
});

t('an RGBA capture keeps its alpha channel and passes the check', () => {
  const png = detailed(400, 300, 4);
  pixelateRegions(png, [AVATAR], { dpr: 2, block: 14, padCssPx: R.minPaddingPx });
  const back = decodePng(encodePng(png));
  assert.equal(back.bpp, 4);
  assert.equal(check(back, AVATAR.bbox, 2).status, 'pixelated');
});

t('the CLI refuses a block below the minimum and a silent overwrite of the capture', () => {
  const small = cli('--in', join(TMP, 'capture.png'), '--sensitive', join(TMP, 'regions.json'), '--out', join(TMP, 'x.png'), '--block', '10');
  assert.equal(small.status, 1);
  assert.match(small.stderr, /below the minimum of 14 px/);
  const same = cli('--in', join(TMP, 'capture.png'), '--sensitive', join(TMP, 'regions.json'), '--out', join(TMP, 'capture.png'));
  assert.equal(same.status, 1);
  assert.match(same.stderr, /pass --in-place/);
});

t('the CLI reads a manifest object and rejects a region with no bbox', () => {
  writeFileSync(join(TMP, 'manifest.json'), JSON.stringify({ sensitive: [AVATAR] }));
  const ok = cli('--in', join(TMP, 'capture.png'), '--sensitive', join(TMP, 'manifest.json'), '--out', join(TMP, 'm.png'));
  assert.equal(ok.status, 0, ok.stderr);
  writeFileSync(join(TMP, 'bad.json'), JSON.stringify([{ id: 'name', kind: 'name' }]));
  const bad = cli('--in', join(TMP, 'capture.png'), '--sensitive', join(TMP, 'bad.json'), '--out', join(TMP, 'b.png'));
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /no valid bbox/);
});

rmSync(TMP, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
