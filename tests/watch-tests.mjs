#!/usr/bin/env node
/**
 * Tests for the release watch (scripts/watch.mjs, scripts/lib/watch.mjs), the product filter on release-check,
 * and the wporg-plugin and drupal:<project> sources. Every response is a saved string behind a fake fetch, so
 * no network is used. Prints PASS/FAIL lines in the format tests/run-tests.sh counts.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseFeed, tagsFrom, dateVersion, validateWatchlist, runWatch, renderWatch } from '../scripts/lib/watch.mjs';
import { parseSource, versionFrom } from '../scripts/lib/release-sources.mjs';
import { releaseCheck, validateInventory } from '../scripts/lib/inventory.mjs';

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), '..');

let passed = 0, failed = 0;
const test = async (name, fn) => {
  try { await fn(); console.log(`PASS  ${name}`); passed += 1; }
  catch (e) { console.log(`FAIL  ${name}`); console.log('        ' + String(e.message || e).split('\n').slice(0, 8).join('\n        ')); failed += 1; }
};

const RSS = `<?xml version="1.0"?><rss><channel><title>Notes</title>
<item><title><![CDATA[Dashboard home now in beta]]></title><link>https://notes.example.com/a</link><pubDate>Tue, 06 Oct 2026 20:23:18 GMT</pubDate></item>
<item><title><![CDATA[Tools &amp; APIs update]]></title><link>https://notes.example.com/b</link><pubDate>Fri, 02 Oct 2026 10:00:00 GMT</pubDate></item>
<item><title>Old news</title><link>https://notes.example.com/c</link><pubDate>Mon, 01 Jun 2026 10:00:00 GMT</pubDate></item>
</channel></rss>`;
const ATOM = `<feed><entry><title>Atom one</title><link href="https://x.example.com/1"/><updated>2026-10-07T09:00:00Z</updated></entry></feed>`;
const PAGE_A = '<span class="tag__label" title="User interface">User interface</span><span class="tag__label" title="New feature">x</span>';
const PAGE_B = '<span class="tag__label" title="Tools &amp; APIs">Tools</span>';

// A fake fetch that answers from a map of URL → [status, body].
const fakeFetch = (routes, seen = []) => async url => {
  seen.push(url);
  const hit = Object.entries(routes).find(([k]) => url.startsWith(k));
  if (!hit) return { ok: false, status: 404, text: async () => 'not found' };
  const [status, body] = hit[1];
  return { ok: status === 200, status, text: async () => body };
};

const WATCHLIST = {
  products: [
    { id: 'terminus', name: 'Terminus', source: 'github:o/terminus' },
    { id: 'p1-editor', name: 'P1', source: 'npm:@o/p1' },
    { id: 'broken', name: 'Broken', source: 'github:o/broken' },
  ],
  feeds: [{ id: 'notes', name: 'Notes', url: 'https://notes.example.com/rss.xml', tagPattern: 'tag__label" title="([^"]+)"', tagProducts: { 'User interface': ['dashboard'] } }],
};
const ROUTES = {
  'https://api.github.com/repos/o/terminus/releases/latest': [200, '{"tag_name":"4.3.3"}'],
  'https://registry.npmjs.org/@o%2Fp1/latest': [200, '{"version":"0.20.1"}'],
  'https://notes.example.com/rss.xml': [200, RSS],
  'https://notes.example.com/a': [200, PAGE_A],
  'https://notes.example.com/b': [200, PAGE_B],
};

const inventory = () => {
  const doc = JSON.parse(readFileSync(join(ROOT, 'tests/fixtures/inventory/inventory.valid.json'), 'utf-8'));
  const base = doc.records.find(r => ['inserted', 'verified'].includes(r.status)) || doc.records[0];
  return { doc, base };
};

// ---------- feed parsing ----------
await test('RSS and Atom entries parse newest first, with CDATA and entities decoded', () => {
  const r = parseFeed(RSS);
  assert.deepEqual(r.map(e => e.title), ['Dashboard home now in beta', 'Tools & APIs update', 'Old news']);
  assert.equal(r[0].link, 'https://notes.example.com/a'); assert.equal(r[0].date, '2026-10-06T20:23:18.000Z');
  const a = parseFeed(ATOM);
  assert.equal(a[0].link, 'https://x.example.com/1'); assert.equal(a[0].title, 'Atom one');
});

await test('tags come from the entry page by pattern, and a release without a version gets a date label', () => {
  assert.deepEqual(tagsFrom(PAGE_A + PAGE_A, 'tag__label" title="([^"]+)"'), ['User interface', 'New feature']);
  assert.deepEqual(tagsFrom(PAGE_B, 'tag__label" title="([^"]+)"'), ['Tools & APIs']);
  assert.equal(dateVersion('2026-10-06T20:23:18Z'), '2026.10.6');
});

// ---------- watchlists ----------
await test('the built-in Pantheon watchlist is valid: unique IDs, known sources, a feed with a tag pattern', () => {
  const w = JSON.parse(readFileSync(join(ROOT, 'watchlists/pantheon.json'), 'utf-8'));
  assert.deepEqual(validateWatchlist(w), []);
  assert.ok(w.products.length >= 20);
  for (const id of ['p1-editor', 'terminus', 'wordpress-core', 'drupal-core', 'content-publisher-wordpress']) assert.ok(w.products.some(p => p.id === id), id);
  assert.ok(w.feeds[0].tagProducts['User interface'].includes('pantheon-dashboard'));
});

await test('an invalid watchlist names every problem', () => {
  const errs = validateWatchlist({ products: [{ id: 'A', source: 'x' }, { id: 'b', source: 'page:https://e.com/' }, { id: 'b', source: 'wordpress' }], feeds: [{ id: 'f', url: 'ftp://x', tagPattern: '(' }] });
  for (const re of [/products\[0\]\.id/, /unknown release source "x"/, /needs "pattern"/, /duplicate id "b"/, /url must be/, /tagPattern/]) assert.ok(errs.some(e => re.test(e)), `${re} in ${errs.join(' | ')}`);
  assert.deepEqual(validateWatchlist({}), ['the watchlist has no products and no feeds']);
});

// ---------- runWatch ----------
await test('first check records every version; a failed source is reported and doesn\'t stop the rest', async () => {
  const r = await runWatch({ watchlist: WATCHLIST, fetchImpl: fakeFetch(ROUTES), now: new Date('2026-10-09T12:00:00Z'), sinceDays: 14 });
  const by = Object.fromEntries(r.products.map(p => [p.id, p]));
  assert.equal(by.terminus.change, 'first'); assert.equal(by.terminus.latest, '4.3.3');
  assert.equal(by.broken.change, 'error'); assert.match(by.broken.error, /HTTP 404/);
  assert.equal(r.failed, true);
  assert.deepEqual(r.nextState.products, { terminus: '4.3.3', 'p1-editor': '0.20.1' });
  // Feed: only entries inside the window, each with its page's tags, mapped to products.
  assert.deepEqual(r.feeds[0].entries.map(e => e.title), ['Dashboard home now in beta', 'Tools & APIs update']);
  assert.deepEqual(r.feeds[0].entries[0].products, ['dashboard']);
  assert.equal(r.nextState.feeds.notes.last, '2026-10-06T20:23:18.000Z');
});

await test('a second check reports only what changed since the saved state', async () => {
  const state = { products: { terminus: '4.3.2', 'p1-editor': '0.20.1' }, feeds: { notes: { last: '2026-10-03T00:00:00.000Z' } } };
  const r = await runWatch({ watchlist: { ...WATCHLIST, products: WATCHLIST.products.slice(0, 2) }, state, fetchImpl: fakeFetch(ROUTES), now: new Date('2026-10-09T12:00:00Z') });
  const by = Object.fromEntries(r.products.map(p => [p.id, p]));
  assert.equal(by.terminus.change, 'changed'); assert.equal(by.terminus.previous, '4.3.2');
  assert.equal(by['p1-editor'].change, 'same');
  assert.deepEqual(r.feeds[0].entries.map(e => e.title), ['Dashboard home now in beta']);
  assert.equal(r.changed, true); assert.equal(r.failed, false);
  const quiet = await runWatch({ watchlist: { products: WATCHLIST.products.slice(0, 2), feeds: WATCHLIST.feeds }, state: r.nextState, fetchImpl: fakeFetch(ROUTES), now: new Date('2026-10-10T12:00:00Z') });
  assert.equal(quiet.changed, false);
});

await test('only screenshots of the released product are matched: a Terminus release leaves P1 and dashboard shots alone', async () => {
  const { doc, base } = inventory();
  const mk = (id, product, release) => ({ ...JSON.parse(JSON.stringify(base)), screenshot_id: id, product, capture: { ...base.capture, release } });
  doc.records = [mk('qa.terminus.help', 'terminus', '4.3.2'), mk('qa.p1.shell', 'p1-editor', '0.20.0'), mk('qa.dash.home', 'dashboard', '2026.9.1')];
  const r = await runWatch({ watchlist: { products: WATCHLIST.products.slice(0, 2), feeds: WATCHLIST.feeds }, doc, fetchImpl: fakeFetch(ROUTES), now: new Date('2026-10-09T12:00:00Z') });
  const by = Object.fromEntries(r.products.map(p => [p.id, p]));
  const terminusIds = [...by.terminus.screenshots.refresh, ...by.terminus.screenshots.behind];
  assert.deepEqual(terminusIds, ['qa.terminus.help']);
  assert.deepEqual([...by['p1-editor'].screenshots.refresh, ...by['p1-editor'].screenshots.behind], ['qa.p1.shell']);
  assert.deepEqual(r.feeds[0].review.dashboard, { label: '2026.10.6', title: 'Dashboard home now in beta', screenshots: ['qa.dash.home'] });
  const text = renderWatch(r);
  assert.match(text, /release-check --product terminus --version 4\.3\.3/);
  assert.match(text, /release-check --product dashboard --version 2026\.10\.6/);
});

await test('release-check --product compares only that product\'s records, and product is validated', () => {
  const { doc, base } = inventory();
  const a = { ...JSON.parse(JSON.stringify(base)), screenshot_id: 'qa.a.one', product: 'terminus', capture: { ...base.capture, release: '1.0.0' } };
  const b = { ...JSON.parse(JSON.stringify(base)), screenshot_id: 'qa.b.one', product: 'wp-redis', capture: { ...base.capture, release: '1.0.0' } };
  doc.records = [a, b];
  const ids = res => [...res.candidates.map(c => c.id), ...res.behind.map(c => c.id)];
  assert.deepEqual(ids(releaseCheck(doc, '2.0.0', { product: 'terminus' })), ['qa.a.one']);
  assert.deepEqual(ids(releaseCheck(doc, '2.0.0')).sort(), ['qa.a.one', 'qa.b.one']);
  b.product = 'WP Redis';
  assert.ok(validateInventory(doc).errors.some(e => /product must be/.test(e.message)));
});

// ---------- more sources ----------
await test('wporg-plugin and drupal:<project> sources parse and read their saved responses', () => {
  assert.deepEqual(parseSource('wporg-plugin:wp-redis'), { kind: 'wporg-plugin', slug: 'wp-redis' });
  assert.deepEqual(parseSource('drupal:search_api_pantheon'), { kind: 'drupal', project: 'search_api_pantheon' });
  assert.deepEqual(parseSource('drupal'), { kind: 'drupal', project: 'drupal' });
  assert.throws(() => parseSource('drupal:Bad-Name'));
  assert.equal(versionFrom({ kind: 'wporg-plugin', slug: 'x' }, '{"version":"1.4.7"}'), '1.4.7');
  assert.throws(() => versionFrom({ kind: 'wporg-plugin', slug: 'x' }, '{"error":"Plugin not found."}'), /Plugin not found/);
  const xml = '<project><releases><release><version>8.x-2.0-beta1</version></release><release><version>2.4.1</version></release><release><version>2.10.0</version></release><release><version>3.0.0-rc1</version></release></releases></project>';
  assert.equal(versionFrom({ kind: 'drupal', project: 'x' }, xml), '2.10.0');
});

await test('a GitHub repo whose latest release is another package\'s tag is refused with the npm hint', () => {
  assert.throws(() => versionFrom({ kind: 'github', repo: 'o/r' }, '{"tag_name":"@scope/lib@5.3.0"}'), /isn't a version.*npm:<package>/);
});

await test('the watch command refuses an invalid watchlist and needs --state', () => {
  const run = args => spawnSync(process.execPath, [join(ROOT, 'scripts/watch.mjs'), ...args], { encoding: 'utf-8' });
  assert.equal(run(['--watchlist', 'pantheon']).status, 1);
  const bad = run(['--watchlist', join(ROOT, 'package.json'), '--state', '/nonexistent/s.json']);
  assert.equal(bad.status, 1); assert.match(bad.stderr, /no products and no feeds/);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
