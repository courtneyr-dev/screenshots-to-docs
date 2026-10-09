#!/usr/bin/env node
/**
 * screenshots-to-docs / watch
 *
 * Checks every product in a watchlist for a new release, reads new release-notes entries, and says which
 * screenshots in the inventory each change can affect. Read-only: nothing is reopened (use release-check
 * --reopen for that), and the state file is written only with --update.
 *
 * Usage:
 *   node scripts/watch.mjs --watchlist pantheon --state watch-state.json [--inventory <file>] [--update]
 *   node scripts/watch.mjs --watchlist ./my-watchlist.json --state s.json --since-days 30 --json
 *
 * --watchlist  a name in watchlists/ (for example "pantheon") or a path to a watchlist file
 * --state      what was seen last time; created by --update. Commit it next to the inventory so the team shares it.
 *
 * Exit code: 0 nothing new, 3 something new, 1 a source failed or the input is invalid.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateWatchlist, runWatch, renderWatch } from './lib/watch.mjs';

const { values } = parseArgs({
  options: {
    watchlist: { type: 'string' }, state: { type: 'string' }, inventory: { type: 'string' },
    update: { type: 'boolean' }, json: { type: 'boolean' }, 'since-days': { type: 'string', default: '14' }, help: { type: 'boolean' },
  },
});
const fail = m => { console.error(`FAIL: ${m}`); process.exit(1); };
if (values.help || !values.watchlist || !values.state) {
  console.log('Usage: node scripts/watch.mjs --watchlist <name|file> --state <file> [--inventory <file>] [--update] [--json] [--since-days 14]');
  process.exit(values.help ? 0 : 1);
}

const builtIn = join(dirname(fileURLToPath(import.meta.url)), '..', 'watchlists', `${values.watchlist}.json`);
const wlFile = /^[a-z0-9-]+$/.test(values.watchlist) && existsSync(builtIn) ? builtIn : resolve(values.watchlist);
const readJson = (f, what) => { try { return JSON.parse(readFileSync(f, 'utf-8')); } catch (e) { return fail(`cannot read ${what} ${f}: ${e.message}`); } };
const watchlist = readJson(wlFile, 'watchlist');
const problems = validateWatchlist(watchlist);
if (problems.length) fail(`watchlist ${wlFile} is invalid:\n  ${problems.join('\n  ')}`);
const statePath = resolve(values.state);
const state = existsSync(statePath) ? readJson(statePath, 'state file') : {};
const doc = values.inventory ? readJson(resolve(values.inventory), 'inventory') : null;
const sinceDays = Number(values['since-days']);
if (!Number.isFinite(sinceDays) || sinceDays <= 0) fail('--since-days must be a positive number');

const r = await runWatch({ watchlist, state, doc, sinceDays });
if (values.json) console.log(JSON.stringify({ products: r.products, feeds: r.feeds, changed: r.changed, failed: r.failed }, null, 2));
else {
  console.log(renderWatch(r));
  if (!existsSync(statePath)) console.log(`\nFirst check: no state file yet. Feeds show the last ${sinceDays} days.`);
}
if (values.update) {
  writeFileSync(statePath, JSON.stringify(r.nextState, null, 2) + '\n');
  if (!values.json) console.log(`\nSaved what was seen to ${statePath}.`);
} else if (!values.json && r.changed) console.log(`\nRun again with --update to mark these as seen.`);
process.exit(r.failed ? 1 : r.changed ? 3 : 0);
