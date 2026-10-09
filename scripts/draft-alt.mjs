#!/usr/bin/env node
/**
 * screenshots-to-docs / draft-alt
 *
 * Drafts alt text from an annotated frame's step marks, so the numbers in the image and in the text
 * always match. Step layers are named "Step <n>: <label>"; the label is used as written.
 *
 * Usage:
 *   node draft-alt.mjs --marks marks.json --subject "<what the screen is>" [--id <id> --inventory <file> --apply]
 *
 * marks.json: a list of layer names, { "marks": [...] }, or a Figma REST GET /v1/files/:key/nodes response.
 * Without --apply it prints the draft only. --apply saves it with `inventory.mjs set-alt`, which runs the
 * inventory's alt text checks. See references/release-swap.md.
 */

import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { resolve, join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';

const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
const STEP_RE = /^Step (\d+):\s*(.+?)\s*$/;

/** Layer names from any supported marks.json shape. */
export function layerNames(data) {
  if (Array.isArray(data)) return data.map(String);
  if (Array.isArray(data?.marks)) return data.marks.map(String);
  if (data?.nodes && typeof data.nodes === 'object') {
    const names = [];
    for (const n of Object.values(data.nodes)) for (const c of n?.document?.children || []) names.push(String(c.name));
    return names;
  }
  throw new Error('marks.json must be a list of layer names, { "marks": [...] }, or a Figma nodes response');
}

/** Ordered steps from layer names. Throws unless they are numbered 1..N with no gaps or repeats. */
export function stepsFrom(names) {
  const steps = new Map();
  for (const name of names) {
    const m = STEP_RE.exec(name);
    if (!m) continue;
    const n = Number(m[1]);
    if (steps.has(n)) throw new Error(`step ${n} appears more than once`);
    steps.set(n, m[2]);
  }
  if (!steps.size) throw new Error('no layers named "Step <n>: <label>"');
  const nums = [...steps.keys()].sort((a, b) => a - b);
  nums.forEach((n, i) => { if (n !== i + 1) throw new Error(`steps must be numbered 1 to ${nums.length} with no gaps (found ${nums.join(', ')})`); });
  return nums.map(n => ({ n, label: steps.get(n) }));
}

// subject names the screen, as the alt text should open: "The P1 editor", "The WordPress dashboard".
export function draftAlt(steps, subject) {
  if (typeof subject !== 'string' || !subject.trim()) throw new Error('give --subject, what the screenshot shows, for example "The WordPress dashboard" or "The P1 editor"');
  const count = WORDS[steps.length] || String(steps.length);
  const list = steps.map(s => `${s.n} ${s.label.replace(/[.\s]+$/, '')}`).join(', ');
  return `${subject.trim()} with ${count} numbered area${steps.length === 1 ? '' : 's'}: ${list}.`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { values } = parseArgs({ options: {
    marks: { type: 'string' }, subject: { type: 'string' }, id: { type: 'string' }, inventory: { type: 'string' },
    apply: { type: 'boolean' }, help: { type: 'boolean', short: 'h' },
  } });
  const fail = msg => { console.error(`FAIL: ${msg}`); process.exit(1); };
  if (values.help || !values.marks) {
    console.log('Usage: node draft-alt.mjs --marks marks.json --subject "<what the screen is>" [--id <id> --inventory <file> --apply]');
    process.exit(values.help ? 0 : 1);
  }
  let text;
  try { text = draftAlt(stepsFrom(layerNames(JSON.parse(readFileSync(resolve(values.marks), 'utf-8')))), values.subject); } catch (e) { fail(e.message); }
  console.log(text);
  if (values.apply) {
    if (!values.id) fail('--apply needs --id');
    const args = [join(dirname(new URL(import.meta.url).pathname), 'inventory.mjs'), 'set-alt', '--id', values.id, '--text', text];
    if (values.inventory) args.push('--inventory', values.inventory);
    const r = spawnSync(process.execPath, args, { stdio: 'inherit' });
    process.exit(r.status ?? 1);
  } else if (values.id) {
    console.log(`\nRead it, then save it with: node scripts/draft-alt.mjs --marks ${values.marks} --id ${values.id} --subject "${values.subject}" --apply`);
  }
}
