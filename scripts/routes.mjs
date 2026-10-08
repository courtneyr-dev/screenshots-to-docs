#!/usr/bin/env node
/**
 * nextjs-screenshots / routes
 *
 * Generate a starter brief from a site's sitemap or a Next.js project's
 * app/ (and pages/) directory. Dynamic routes ([slug]) can't be enumerated
 * from the filesystem; they're listed as skipped so you can add real URLs.
 *
 * Usage:
 *   node routes.mjs --topic acme --site https://acme.test --sitemap
 *   node routes.mjs --topic acme --site http://localhost:3000 --app-dir ~/code/acme
 *   node routes.mjs --topic acme --site http://localhost:3000 \
 *                   --baseline https://acme.com --sitemap-url https://acme.com/sitemap_index.xml
 */

import { readdirSync, statSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const { values } = parseArgs({
  options: {
    topic:         { type: 'string' },
    site:          { type: 'string' },
    baseline:      { type: 'string' },
    sitemap:       { type: 'boolean' },
    'sitemap-url': { type: 'string' },
    'app-dir':     { type: 'string' },
    include:       { type: 'string' },
    exclude:       { type: 'string' },
    limit:         { type: 'string' },
    mobile:        { type: 'boolean' },
    out:           { type: 'string' },
    force:         { type: 'boolean' },
    help:          { type: 'boolean' },
  },
  strict: false,
});

if (values.help || !values.topic || !values.site || !(values.sitemap || values['sitemap-url'] || values['app-dir'])) {
  console.log(`Usage: node routes.mjs --topic <slug> --site <url> (--sitemap | --sitemap-url <url> | --app-dir <project>) [options]

Sources:
  --sitemap             Read <site>/sitemap.xml (falls back to /sitemap_index.xml)
  --sitemap-url <url>   Read this sitemap (e.g. the WordPress site's sitemap_index.xml)
  --app-dir <path>      Scan a Next.js project's app/ and pages/ directories

Options:
  --baseline <url>      Site being replaced; written into the brief for parity runs
  --include <regex>     Keep only paths matching
  --exclude <regex>     Drop paths matching
  --limit <n>           Cap the number of paths
  --mobile              Add a 390x844 variant of every shot
  --out <file>          Brief path (default: briefs/<topic>.json in the skill folder)
  --force               Overwrite an existing brief
`);
  process.exit(values.help ? 0 : 1);
}

const trim = u => u.replace(/\/+$/, '');
const SITE = trim(values.site);

async function fetchText(url) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return res.text();
}

// Handles plain sitemaps and sitemap indexes (WordPress core, Yoast, Rank Math, Next's app/sitemap.ts).
async function sitemapPaths(url, seen = new Set()) {
  if (seen.has(url) || seen.size > 200) return [];
  seen.add(url);
  const xml = await fetchText(url);
  const locs = [...xml.matchAll(/<loc>\s*(?:<!\[CDATA\[)?\s*([^<\]\s]+)\s*(?:\]\]>)?\s*<\/loc>/g)].map(m => m[1].replace(/&amp;/g, '&'));
  if (/<sitemapindex[\s>]/.test(xml)) {
    const nested = [];
    for (const loc of locs) nested.push(...await sitemapPaths(loc, seen).catch(e => { console.log(`  WARN: ${e.message}`); return []; }));
    return nested;
  }
  return locs.map(loc => {
    const u = new URL(loc);
    return u.pathname + u.search;
  });
}

function appDirPaths(projectDir) {
  const paths = [];
  const skipped = [];
  const pageFile = /^page\.(tsx|ts|jsx|js|mdx)$/;

  function walkApp(dir, segments) {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) {
        if (name.startsWith('_') || name.startsWith('@') || name === 'api' || name === 'node_modules') continue;
        walkApp(full, [...segments, name]);
      } else if (pageFile.test(name)) {
        const routeSegs = segments.filter(s => !/^\(.*\)$/.test(s)); // drop (route groups)
        const route = '/' + routeSegs.join('/');
        if (routeSegs.some(s => s.startsWith('['))) skipped.push(route);
        else paths.push(route);
      }
    }
  }

  function walkPages(dir, segments) {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) {
        if (name === 'api') continue;
        walkPages(full, [...segments, name]);
      } else if (/\.(tsx|ts|jsx|js|mdx)$/.test(name) && !/^_(app|document|error)\./.test(name) && !/^(404|500)\./.test(name)) {
        const base = name.replace(/\.(tsx|ts|jsx|js|mdx)$/, '');
        const routeSegs = base === 'index' ? segments : [...segments, base];
        const route = '/' + routeSegs.join('/');
        if (routeSegs.some(s => s.startsWith('['))) skipped.push(route);
        else paths.push(route);
      }
    }
  }

  for (const root of ['app', 'src/app']) {
    const d = join(projectDir, root);
    if (existsSync(d)) walkApp(d, []);
  }
  for (const root of ['pages', 'src/pages']) {
    const d = join(projectDir, root);
    if (existsSync(d)) walkPages(d, []);
  }
  return { paths, skipped };
}

function slugFor(path, i) {
  const s = path.replace(/[?#].*$/, '').replace(/^\/|\/$/g, '').replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase() || 'home';
  return `${String(i + 1).padStart(2, '0')}-${s}`.slice(0, 80);
}

let paths = [];
let skipped = [];
if (values['app-dir']) {
  const r = appDirPaths(resolve(values['app-dir'].replace(/^~/, process.env.HOME)));
  paths = r.paths;
  skipped = r.skipped;
} else {
  const url = values['sitemap-url'] || `${SITE}/sitemap.xml`;
  try {
    paths = await sitemapPaths(url);
  } catch (e) {
    if (values['sitemap-url']) throw e;
    console.log(`  ${e.message}; trying /sitemap_index.xml`);
    paths = await sitemapPaths(`${SITE}/sitemap_index.xml`);
  }
}

paths = [...new Set(paths)].sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b));
if (values.include) paths = paths.filter(p => new RegExp(values.include).test(p));
if (values.exclude) paths = paths.filter(p => !new RegExp(values.exclude).test(p));
if (values.limit) paths = paths.slice(0, Number(values.limit));

if (paths.length === 0) {
  console.error('FAIL: no routes found.');
  process.exit(1);
}

const shots = [];
paths.forEach((p, i) => {
  const slug = slugFor(p, i);
  const section = p.split('/').filter(Boolean)[0] || 'home';
  shots.push({ slug, label: p, url: p, fullPage: true, section });
  if (values.mobile) shots.push({ slug: `${slug}-mobile`, label: `${p} (mobile)`, url: p, viewport: [390, 844], fullPage: true, section });
});

const brief = {
  topic: values.topic,
  site: SITE,
  ...(values.baseline ? { baseline: trim(values.baseline) } : {}),
  dpr: 2,
  shots,
};

const skillDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(values.out || join(skillDir, 'briefs', `${values.topic}.json`));
if (existsSync(out) && !values.force) {
  console.error(`FAIL: ${out} exists. Pass --force to overwrite.`);
  process.exit(1);
}
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(brief, null, 2) + '\n');

console.log(`Brief:  ${out}`);
console.log(`Routes: ${paths.length}${values.mobile ? ` (x2 with mobile = ${shots.length} shots)` : ''}`);
if (skipped.length) {
  console.log(`Skipped ${skipped.length} dynamic route(s); add real URLs for these by hand:`);
  for (const s of skipped) console.log(`  ${s}`);
}
