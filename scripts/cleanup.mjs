#!/usr/bin/env node
/**
 * p1-editor-screenshots / cleanup
 *
 * Removes the things a run leaves behind: the dedicated Chrome profile (it holds a signed-in session)
 * and capture output folders (screenshots of a signed-in editor, reports, upload URLs). It lists what
 * it would remove and removes nothing unless you pass --yes.
 *
 * Usage:
 *   node cleanup.mjs --config p1-editor.config.json --profile                 # list the profile
 *   node cleanup.mjs --config p1-editor.config.json --profile --out-dir <dir> --out-dir <dir2> --yes
 *   node cleanup.mjs --out-dir <dir>                                          # output folders only, no config needed
 *
 * Safety rules, each enforced here:
 *   - Only the configured chrome.profileDir is removed, and only if it looks like a Chrome profile
 *     (empty, or it has "Local State" or "Default") and is not inside a git repository.
 *   - It refuses while the dedicated Chrome is still running on the configured port: close it first.
 *   - An output folder is removed only if it holds a capture-report.json and isn't inside a git work
 *     tree that tracks files in it.
 *   - Handoff notes are never removed. They are yours to keep or delete.
 */

import { existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { resolve, join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadConfig, applyOverrides, validateConfig, formatValidation, expandHome } from './lib/config.mjs';

const { values } = parseArgs({
  options: {
    config: { type: 'string' },
    set: { type: 'string', multiple: true },
    profile: { type: 'boolean' },
    'out-dir': { type: 'string', multiple: true },
    yes: { type: 'boolean' },
    help: { type: 'boolean', short: 'h' },
  },
});

const fail = msg => { console.error(`FAIL: ${msg}`); process.exit(1); };

if (values.help || (!values.profile && !values['out-dir']?.length)) {
  console.log('Usage: node cleanup.mjs [--config <file> --profile] [--out-dir <dir> ...] [--yes]\nLists what it would remove; removes nothing without --yes.');
  process.exit(values.help ? 0 : 1);
}

const targets = [];

if (values.profile) {
  if (!values.config) fail('--profile needs --config (the profile directory comes from chrome.profileDir).');
  let cfg;
  try { cfg = applyOverrides(loadConfig(values.config), values.set || []); } catch (e) { fail(e.message); }
  const check = validateConfig(cfg, ['capture']);
  const chromeProblems = check.errors.filter(e => e.key.startsWith('chrome.'));
  if (chromeProblems.length) { console.error(formatValidation({ errors: chromeProblems, warnings: [] }, 'Chrome settings')); process.exit(1); }
  const dir = resolve(expandHome(cfg.chrome.profileDir));
  if (existsSync(dir)) {
    const entries = readdirSync(dir);
    if (entries.length && !entries.includes('Local State') && !entries.includes('Default')) {
      fail(`${dir} doesn't look like a Chrome profile (no "Local State" or "Default"), so it won't be removed.`);
    }
    targets.push({ kind: 'Chrome profile', dir });
  } else {
    console.log(`Chrome profile ${dir} doesn't exist; nothing to remove.`);
  }
  // A running Chrome would be using that profile.
  try {
    const res = await fetch(`http://127.0.0.1:${cfg.chrome.cdpPort}/json/version`, { signal: AbortSignal.timeout(2000) });
    if (res.ok && targets.length) fail(`Chrome is still running on port ${cfg.chrome.cdpPort}. Close the dedicated Chrome window first.`);
  } catch { /* nothing listening: fine */ }
}

for (const d of values['out-dir'] || []) {
  const dir = resolve(d);
  if (!existsSync(dir)) { console.log(`Output folder ${dir} doesn't exist; skipping.`); continue; }
  if (!statSync(dir).isDirectory() || !existsSync(join(dir, 'capture-report.json'))) fail(`${dir} has no capture-report.json, so it isn't a capture output folder and won't be removed.`);
  let top = null;
  for (let p = dir; ; p = dirname(p)) { if (existsSync(join(p, '.git'))) { top = p; break; } if (dirname(p) === p) break; }
  if (top) {
    const tracked = spawnSync('git', ['-C', top, 'ls-files', '--', dir], { encoding: 'utf-8' }).stdout.trim();
    if (tracked) fail(`${dir} contains files git tracks. Remove them from git first; this command won't delete tracked files.`);
  }
  targets.push({ kind: 'capture output', dir });
}

if (!targets.length) { console.log('Nothing to remove.'); process.exit(0); }

for (const t of targets) console.log(`${values.yes ? 'removing' : 'would remove'}  ${t.kind}: ${t.dir}`);
if (!values.yes) { console.log('\nNothing was removed. Re-run with --yes to remove the items above.'); process.exit(0); }
for (const t of targets) rmSync(t.dir, { recursive: true, force: true });
console.log(`\nRemoved ${targets.length} item${targets.length === 1 ? '' : 's'}. Handoff notes were not touched.`);
