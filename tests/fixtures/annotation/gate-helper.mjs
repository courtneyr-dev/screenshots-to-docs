#!/usr/bin/env node
/**
 * Test helper for tests/run-tests.sh. For one shot of a real capture run, writes a manifest that passes
 * verification (one badge and one outline over the capture) and a 2x export, so the gate tests can run
 * record-annotation.mjs against real captures.
 *
 * Usage: node gate-helper.mjs --dir <run folder> --slug <slug> --out <folder>
 * Writes <out>/<slug>.manifest.json and <out>/<slug>.png.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { resolve, join } from 'node:path';
import { cleanCapture } from '../../../scripts/lib/annotation.mjs';
import { badge, outline, manifestFor, exportCanvas } from '../../lib/annotation-fixtures.mjs';

const { values } = parseArgs({ options: { dir: { type: 'string' }, slug: { type: 'string' }, out: { type: 'string' } } });
const dir = resolve(values.dir);
const clean = cleanCapture(dir, JSON.parse(readFileSync(join(dir, 'capture-report.json'), 'utf-8')), values.slug);
const target = [90, 30, 120, 40];
const fixture = { name: values.slug, w: Math.round(clean.width / (clean.row.dpr || 1)), h: Math.round(clean.height / (clean.row.dpr || 1)), bg: '#FFFFFF', regions: [], sensitive: [], keepClear: [], alt: null, marks: [outline(target), badge(1, 20, 24, { label: 'the control', target })] };
mkdirSync(values.out, { recursive: true });
const manifest = manifestFor(fixture);
manifest.cleanFrame.name = manifest.annotatedFrame.name = values.slug;
writeFileSync(join(values.out, `${values.slug}.manifest.json`), JSON.stringify(manifest));
writeFileSync(join(values.out, `${values.slug}.png`), exportCanvas(fixture).png());
