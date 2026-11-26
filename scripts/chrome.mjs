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
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { loadConfig, applyOverrides, validateConfig, formatValidation, expandHome, presetNameOf, signInModeOf, targetParams } from './lib/config.mjs';
import { loadPreset } from './lib/presets.mjs';

// Chrome for Testing, if installed. A fresh profile in branded Chrome makes macOS ask to switch the default
// browser, and --no-default-browser-check doesn't stop it, so prefer this build (CHROME_BIN overrides).
function chromeForTesting() {
  if (process.env.CHROME_BIN && existsSync(process.env.CHROME_BIN)) return process.env.CHROME_BIN;
  const root = join(homedir(), 'Library/Caches/ms-playwright');
  if (!existsSync(root)) return null;
  const builds = readdirSync(root).filter(n => /^chromium-\d+$/.test(n)).sort((a, b) => parseInt(b.slice(9), 10) - parseInt(a.slice(9), 10));
  for (const b of builds) {
    for (const arch of ['chrome-mac-arm64', 'chrome-mac-x64']) {
      const p = join(root, b, arch, 'Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
      if (existsSync(p)) return p;
    }
  }
  return null;
}

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
if (signInModeOf(cfg) !== 'chrome') {
  console.log(`The "${presetNameOf(cfg)}" preset signs in with mode "${signInModeOf(cfg)}": capture starts its own headless browser, so there is no dedicated Chrome to open.`);
  process.exit(0);
}
const check = validateConfig(cfg, ['capture']);
const chromeProblems = check.errors.filter(e => e.key.startsWith('chrome.') || e.key === 'baseUrl');
if (chromeProblems.length) {
  console.error(formatValidation({ errors: chromeProblems, warnings: [] }, 'Chrome settings'));
  process.exit(1);
}

const port = cfg.chrome.cdpPort;
const profile = resolve(expandHome(cfg.chrome.profileDir));
// P1 opens its editor route; a preset with a sign-in form (such as wordpress-admin) opens its login page.
const startPath = presetNameOf(cfg) === 'p1-editor' ? targetParams(cfg).editorRoute : (loadPreset(presetNameOf(cfg)).signIn?.login?.url || '/');
const start = `${cfg.baseUrl.replace(/\/+$/, '')}${startPath}`;
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

const cft = chromeForTesting();
const macCommand = cft
  ? `nohup ${q(cft)} --no-first-run --no-default-browser-check --remote-debugging-port=${port} --user-data-dir=${q(profile)} ${q(start)} >/dev/null 2>&1 &`
  : `open -na "Google Chrome" --args --no-first-run --no-default-browser-check --remote-debugging-port=${port} --user-data-dir=${q(profile)} ${q(start)}`;

console.log(`Start the dedicated Chrome with this profile and debugging port, then sign in to the app in that window yourself.

macOS${cft ? ' (Chrome for Testing, so macOS does not ask to change your default browser)' : ' (no Chrome for Testing found: this opens Google Chrome, and a fresh profile may make macOS ask to change your default browser; install one with `npx playwright install chromium`, or set CHROME_BIN)'}:
  ${macCommand}

Linux:
  google-chrome --no-first-run --no-default-browser-check --remote-debugging-port=${port} --user-data-dir=${q(profile)} ${q(start)}

Then check it is up:
  node scripts/chrome.mjs --config ${values.config} --check

Notes:
  - This is a separate Chrome instance with its own profile; your regular Chrome is not used.
  - The debugging port is open to local processes while this Chrome runs. Close the window when you're done.
  - The profile directory stores the login. Keep it outside every repository and delete it when the work is finished.`);
