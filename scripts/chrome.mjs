#!/usr/bin/env node
/**
 * p1-editor-screenshots / chrome
 *
 * Prints the command that starts the dedicated Chrome for the capture, using the profile directory
 * and debugging port from the config. It prints; it doesn't start anything, so a person runs it,
 * signs in to Google in that window, and chooses the workstream in the editor.
 *
 * Usage:
 *   node chrome.mjs --config p1-editor.config.json
 *   node chrome.mjs --config p1-editor.config.json --check     # is the debugging endpoint up?
 */

import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { loadConfig, applyOverrides, validateConfig, formatValidation, expandHome, DEFAULTS } from './lib/config.mjs';

const { values } = parseArgs({
  options: {
    config: { type: 'string' },
    set: { type: 'string', multiple: true },
    check: { type: 'boolean' },
    help: { type: 'boolean', short: 'h' },
  },
});

if (values.help || !values.config) {
  console.log('Usage: node chrome.mjs --config <file> [--check]');
  process.exit(values.help ? 0 : 1);
}

let cfg;
try {
  cfg = applyOverrides(loadConfig(values.config), values.set || []);
} catch (e) {
  console.error(`FAIL: ${e.message}`);
  process.exit(1);
}
const check = validateConfig(cfg, ['capture']);
const chromeProblems = check.errors.filter(e => e.key.startsWith('chrome.') || e.key === 'baseUrl');
if (chromeProblems.length) {
  console.error(formatValidation({ errors: chromeProblems, warnings: [] }, 'Chrome settings'));
  process.exit(1);
}

const port = cfg.chrome.cdpPort;
const profile = resolve(expandHome(cfg.chrome.profileDir));
const start = `${cfg.baseUrl.replace(/\/+$/, '')}${cfg.editorRoute || DEFAULTS.editorRoute}`;
const q = s => `"${s.replace(/(["\\$`])/g, '\\$1')}"`;

if (values.check) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(3000) });
    const info = await res.json();
    console.log(`Up: port ${port} (${info.Browser}).`);
    process.exit(0);
  } catch {
    console.error(`Not reachable: nothing is listening on port ${port}.`);
    process.exit(1);
  }
}

console.log(`Start the dedicated Chrome with this profile and debugging port, then sign in to Google in that window yourself.

macOS:
  open -na "Google Chrome" --args --no-first-run --no-default-browser-check --remote-debugging-port=${port} --user-data-dir=${q(profile)} ${q(start)}

Linux:
  google-chrome --no-first-run --no-default-browser-check --remote-debugging-port=${port} --user-data-dir=${q(profile)} ${q(start)}

Then check it is up:
  node scripts/chrome.mjs --config ${values.config} --check

Notes:
  - This is a separate Chrome instance with its own profile; your regular Chrome is not used.
  - The debugging port is open to local processes while this Chrome runs. Close the window when you're done.
  - The profile directory stores the login. Keep it outside every repository and delete it when the work is finished.`);
