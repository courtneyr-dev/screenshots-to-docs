/**
 * Watch everything a company ships, not one package: a watchlist names each product and where its releases
 * show up, and a state file remembers what was seen last time.
 *
 * Watchlist (JSON):
 *   products  [{ id, name, source, pattern?, docs? }]  a versioned product; source is a release source
 *                                                     (lib/release-sources.mjs), id matches records' "product"
 *   feeds     [{ id, name, url, tagPattern?, tagProducts?, maxEntries? }]
 *             a release-notes RSS or Atom feed, for changes with no version (a dashboard, the platform).
 *             tagPattern is a regular expression run on each new entry's page; group 1 is a tag.
 *             tagProducts maps a tag to the product IDs it can change, for example
 *             { "User interface": ["pantheon-dashboard"] }.
 *
 * State (JSON): { checked_at, products: { id: version }, feeds: { id: { last: ISO date } } }
 */

import { latestVersion, parseSource } from './release-sources.mjs';
import { releaseCheck, parseVersion } from './inventory.mjs';

const ID_RE = /^[a-z0-9][a-z0-9-]*$/;

export function validateWatchlist(w) {
  const errors = [];
  if (!w || typeof w !== 'object') return ['the watchlist must be a JSON object'];
  const ids = new Set();
  const seen = id => { if (ids.has(id)) errors.push(`duplicate id "${id}"`); ids.add(id); };
  for (const [i, p] of (w.products || []).entries()) {
    if (!ID_RE.test(p.id || '')) errors.push(`products[${i}].id must be lowercase letters, digits, "-"`);
    else seen(p.id);
    try { parseSource(p.source); } catch (e) { errors.push(`products[${i}] (${p.id}): ${e.message}`); }
    if (p.source?.startsWith('page:') && !p.pattern) errors.push(`products[${i}] (${p.id}): a page source needs "pattern"`);
  }
  for (const [i, f] of (w.feeds || []).entries()) {
    if (!ID_RE.test(f.id || '')) errors.push(`feeds[${i}].id must be lowercase letters, digits, "-"`);
    else seen(f.id);
    try { const u = new URL(f.url); if (!/^https?:$/.test(u.protocol)) throw new Error(); } catch { errors.push(`feeds[${i}] (${f.id}): url must be an http(s) URL`); }
    if (f.tagPattern) { try { new RegExp(f.tagPattern); } catch (e) { errors.push(`feeds[${i}] (${f.id}): tagPattern: ${e.message}`); } }
    for (const [tag, list] of Object.entries(f.tagProducts || {})) {
      if (!Array.isArray(list) || list.some(x => !ID_RE.test(x))) errors.push(`feeds[${i}] (${f.id}): tagProducts["${tag}"] must be a list of product IDs`);
    }
  }
  if (!(w.products || []).length && !(w.feeds || []).length) errors.push('the watchlist has no products and no feeds');
  return errors;
}

const decode = s => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'").trim();

// RSS <item> or Atom <entry> → { title, link, date (ISO) }, newest first.
export function parseFeed(xml) {
  const blocks = [...xml.matchAll(/<(item|entry)\b[\s\S]*?<\/\1>/g)].map(m => m[0]);
  const pick = (b, re) => { const m = re.exec(b); return m ? decode(m[1]) : null; };
  return blocks.map(b => {
    const date = pick(b, /<(?:pubDate|published|updated)>([\s\S]*?)<\//);
    return {
      title: pick(b, /<title[^>]*>([\s\S]*?)<\/title>/) || '(untitled)',
      link: pick(b, /<link>([\s\S]*?)<\/link>/) || (/<link[^>]*href="([^"]+)"/.exec(b) || [])[1] || null,
      date: date && !Number.isNaN(Date.parse(date)) ? new Date(date).toISOString() : null,
    };
  }).filter(e => e.date).sort((a, b) => b.date.localeCompare(a.date));
}

export function tagsFrom(html, pattern) {
  return [...new Set([...html.matchAll(new RegExp(pattern, 'g'))].map(m => decode(m[1])))];
}

// A release with no version, labeled by its date so it compares like one: 2026-10-06 → 2026.10.6.
export function dateVersion(iso) {
  const d = new Date(iso);
  return `${d.getUTCFullYear()}.${d.getUTCMonth() + 1}.${d.getUTCDate()}`;
}

async function pool(items, n, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); }
  }));
  return out;
}

async function getText(fetchImpl, url, accept) {
  const res = await fetchImpl(url, { headers: { accept, 'user-agent': 'screenshots-to-docs watch' }, redirect: 'follow' });
  if (!res.ok) throw new Error(`${url} answered HTTP ${res.status}`);
  return res.text();
}

/**
 * One pass over the watchlist. Nothing is written: the caller saves `nextState` when asked to.
 * doc: the inventory (optional). sinceDays: how far back to read a feed that has no state yet.
 */
export async function runWatch({ watchlist, state = {}, doc = null, fetchImpl = fetch, now = new Date(), sinceDays = 14 }) {
  const prev = { products: state.products || {}, feeds: state.feeds || {} };
  const next = { checked_at: now.toISOString(), products: { ...prev.products }, feeds: { ...prev.feeds } };
  const recordsFor = id => (doc?.records || []).filter(r => r.product === id && r.status !== 'retired');

  const products = await pool(watchlist.products || [], 6, async p => {
    const row = { id: p.id, name: p.name || p.id, source: p.source, previous: prev.products[p.id] || null, records: recordsFor(p.id).length };
    try {
      row.latest = await latestVersion(p.source, { pattern: p.pattern, fetchImpl });
    } catch (e) {
      return { ...row, change: 'error', error: e.message };
    }
    row.change = !row.previous ? 'first' : row.previous === row.latest ? 'same' : 'changed';
    next.products[p.id] = row.latest;
    if (doc && row.records && parseVersion(row.latest) && !parseVersion(row.latest).pre) {
      const res = releaseCheck(doc, row.latest, { product: p.id });
      row.screenshots = { refresh: res.candidates.map(c => c.id), behind: res.behind.map(b => b.id), current: res.current.length };
    }
    return row;
  });

  const feeds = [];
  for (const f of watchlist.feeds || []) {
    const since = prev.feeds[f.id]?.last || new Date(now.getTime() - sinceDays * 864e5).toISOString();
    const row = { id: f.id, name: f.name || f.id, url: f.url, since, entries: [] };
    try {
      const all = parseFeed(await getText(fetchImpl, f.url, 'application/rss+xml, application/atom+xml, application/xml'));
      const fresh = all.filter(e => e.date > since).slice(0, f.maxEntries || 30);
      row.entries = await pool(fresh, 4, async e => {
        let tags = [];
        if (f.tagPattern && e.link) {
          try { tags = tagsFrom(await getText(fetchImpl, e.link, 'text/html'), f.tagPattern); } catch (err) { e.tagError = err.message; }
        }
        const products = [...new Set(tags.flatMap(t => f.tagProducts?.[t] || []))];
        return { ...e, tags, products, label: dateVersion(e.date) };
      });
      if (all.length) next.feeds[f.id] = { last: [all[0].date, prev.feeds[f.id]?.last].filter(Boolean).sort().at(-1) };
    } catch (e) {
      row.error = e.message;
    }
    // A feed-only product (no version) is reviewed against the newest entry that names it.
    row.review = {};
    for (const e of row.entries) for (const id of e.products) {
      if (row.review[id]) continue;
      const recs = recordsFor(id);
      if (recs.length) row.review[id] = { label: e.label, title: e.title, screenshots: recs.map(r => r.screenshot_id) };
    }
    feeds.push(row);
  }

  const changed = products.some(p => p.change === 'changed') || feeds.some(f => f.entries.length);
  const failed = products.some(p => p.change === 'error') || feeds.some(f => f.error);
  return { products, feeds, nextState: next, changed, failed };
}

// onlyNew hides products whose version didn't change and says how many were hidden.
export function renderWatch(r, { onlyNew = false } = {}) {
  const lines = [];
  const hidden = onlyNew ? r.products.filter(p => p.change === 'same').length : 0;
  const width = Math.max(...r.products.map(p => p.name.length), 10);
  if (r.products.length) lines.push('Products');
  for (const p of r.products) {
    if (onlyNew && p.change === 'same') continue;
    const mark = { changed: 'NEW RELEASE', first: 'first check', same: 'no change', error: 'ERROR' }[p.change];
    const ver = p.change === 'error' ? p.error : p.change === 'changed' ? `${p.previous} → ${p.latest}` : p.latest;
    lines.push(`  ${p.name.padEnd(width)}  ${mark.padEnd(11)}  ${ver}`);
    if (p.screenshots && (p.screenshots.refresh.length || p.screenshots.behind.length)) {
      if (p.screenshots.refresh.length) lines.push(`  ${''.padEnd(width)}  → ${p.screenshots.refresh.length} screenshot(s) to refresh: ${p.screenshots.refresh.join(', ')}`);
      if (p.screenshots.behind.length) lines.push(`  ${''.padEnd(width)}  → ${p.screenshots.behind.length} in progress for an older version: ${p.screenshots.behind.join(', ')}`);
      lines.push(`  ${''.padEnd(width)}    release-check --product ${p.id} --version ${p.latest}`);
    }
  }
  if (hidden) lines.push(`  ${hidden} more with no change`);
  for (const f of r.feeds) {
    lines.push('', `${f.name}: ${f.error ? `ERROR ${f.error}` : `${f.entries.length} new since ${f.since.slice(0, 10)}`}`);
    for (const e of f.entries) {
      lines.push(`  ${e.date.slice(0, 10)}  ${e.title}${e.tags.length ? `  [${e.tags.join(', ')}]` : ''}`);
      if (e.link) lines.push(`              ${e.link}`);
    }
    for (const [id, v] of Object.entries(f.review || {})) {
      lines.push(`  → ${id}: ${v.screenshots.length} screenshot(s) to review after "${v.title}": ${v.screenshots.join(', ')}`);
      lines.push(`      release-check --product ${id} --version ${v.label}`);
    }
  }
  return lines.join('\n');
}
