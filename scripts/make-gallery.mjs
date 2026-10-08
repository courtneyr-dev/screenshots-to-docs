#!/usr/bin/env node
/**
 * nextjs-screenshots / make-gallery
 *
 * Build a standalone index.html for a screenshots folder. When the folder has
 * a baseline/ subfolder (a parity run), each shot renders as a pair:
 * baseline (the site being replaced) on the left, Next.js on the right.
 * HTTP status from capture-report.json shows as a badge, and pairs with a
 * missing side or an HTTP error sort first under "Needs attention".
 *
 * Usage:
 *   node make-gallery.mjs --dir screenshots/<topic> [--brief briefs/<topic>.json]
 *                         [--title "..."] [--subtitle "..."]
 */

import { readdirSync, writeFileSync, existsSync, readFileSync, statSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { join, basename, resolve, dirname } from 'node:path';

const { values } = parseArgs({
  options: {
    dir:      { type: 'string' },
    brief:    { type: 'string' },
    title:    { type: 'string' },
    subtitle: { type: 'string' },
    help:     { type: 'boolean' },
  },
  strict: false,
});

if (values.help || !values.dir) {
  console.log('Usage: node make-gallery.mjs --dir <screenshots-folder> [--brief <path>] [--title "..."] [--subtitle "..."]');
  process.exit(values.help ? 0 : 1);
}

const dir = resolve(values.dir);
if (!existsSync(dir) || !statSync(dir).isDirectory()) {
  console.error(`FAIL: ${dir} is not a directory`);
  process.exit(1);
}

const topic = basename(dir);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let briefPath = values.brief ? resolve(values.brief) : null;
if (!briefPath) {
  for (const g of [resolve(dirname(dir), '..', 'briefs', `${topic}.json`), resolve(dirname(dir), 'briefs', `${topic}.json`)]) {
    if (existsSync(g)) { briefPath = g; break; }
  }
}
const meta = new Map();
if (briefPath && existsSync(briefPath)) {
  try {
    for (const s of JSON.parse(readFileSync(briefPath, 'utf-8')).shots || []) meta.set(s.slug, s);
    console.log(`Using brief: ${briefPath}`);
  } catch (e) {
    console.log(`WARN: brief unreadable: ${e.message}`);
  }
}

const byKey = new Map(); // `${side}:${slug}` -> result
let report = null;
const reportPath = join(dir, 'capture-report.json');
if (existsSync(reportPath)) {
  report = JSON.parse(readFileSync(reportPath, 'utf-8'));
  for (const r of report.results) byKey.set(`${r.side}:${r.slug}`, r);
}

const pngs = d => existsSync(d) ? readdirSync(d).filter(f => f.endsWith('.png')) : [];
const nextFiles = new Set(pngs(dir));
const baseFiles = new Set(pngs(join(dir, 'baseline')));
const parity = baseFiles.size > 0;

const slugs = [...new Set([...nextFiles, ...baseFiles].map(f => f.replace(/\.png$/, '')))].sort();
if (slugs.length === 0) {
  console.error(`FAIL: no PNGs in ${dir}`);
  process.exit(1);
}

const shots = slugs.map(slug => {
  const m = meta.get(slug) || {};
  const next = byKey.get(`next:${slug}`);
  const ident = next?.screenshotId ? { screenshotId: next.screenshotId, altText: next.altText } : {};
  const base = byKey.get(`baseline:${slug}`);
  const hasNext = nextFiles.has(`${slug}.png`);
  const hasBase = baseFiles.has(`${slug}.png`);
  const expectBase = m.compare !== false;
  const problem = (next && next.status >= 400) || (base && base.status >= 400) || (parity && (!hasNext || (expectBase && !hasBase)));
  return {
    slug,
    label: m.label || next?.label || slug.replace(/^\d+-/, '').replace(/-/g, ' '),
    ...ident,
    section: problem && parity ? 'Needs attention' : (m.section || 'general'),
    hasNext, hasBase, expectBase, next, base,
  };
});

const sections = [...new Set(shots.map(s => s.section))].sort((a, b) => (b === 'Needs attention') - (a === 'Needs attention'));
const problems = shots.filter(s => s.section === 'Needs attention').length;

const badge = r => {
  if (!r) return '';
  if (!r.ok) return '<span class="tag bad">capture failed</span>';
  const redirected = r.finalUrl && r.url && new URL(r.finalUrl).pathname !== new URL(r.url).pathname;
  return `<span class="tag ${r.status >= 400 ? 'bad' : ''}">HTTP ${r.status ?? '?'}</span>${redirected ? `<span class="tag" title="${esc(r.finalUrl)}">redirected</span>` : ''}`;
};

const tile = (src, label, r, sideName) => src
  ? `<figure data-src="${esc(src)}" data-label="${esc(label)}${sideName ? ` · ${sideName}` : ''}"${r?.screenshotId ? ` data-screenshot-id="${esc(r.screenshotId)}"` : ''}>
      <img src="${esc(src)}" alt="${esc(r?.altText ?? `${label}${sideName ? ` (${sideName})` : ''}`)}" loading="lazy">
      <figcaption>${sideName ? `<b>${sideName}</b> ` : ''}${badge(r)}</figcaption>
    </figure>`
  : `<figure class="missing"><div class="hole">No ${esc(sideName || 'image')} capture</div><figcaption>${sideName ? `<b>${sideName}</b> ` : ''}${badge(r)}</figcaption></figure>`;

const title = values.title || `${topic} screenshots`;
const subtitle = values.subtitle || (report ? [report.baseline && `baseline ${report.baseline}`, `next ${report.site}`, report.capturedAt.slice(0, 16).replace('T', ' ')].filter(Boolean).join(' · ') : '');

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { background: #0f1115; color: #d4d6db; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; min-height: 100vh; padding: 32px 16px; max-width: 1600px; margin: 0 auto; }
header { display: flex; flex-wrap: wrap; gap: 8px; justify-content: space-between; align-items: baseline; border-bottom: 1px solid #232733; padding-bottom: 16px; margin-bottom: 24px; }
h1 { font-size: 16px; font-weight: 600; color: #fff; }
.subtitle, .count { font-size: 12px; color: #8a8f9c; margin-top: 4px; }
.section-label { font-size: 11px; letter-spacing: 0.12em; color: #6b7280; text-transform: uppercase; margin: 28px 0 12px; padding-bottom: 6px; border-bottom: 1px dashed #232733; }
.section-label.attention { color: #f59e0b; }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 14px; }
.pairs { display: grid; gap: 18px; }
.pair { border: 1px solid #232733; border-radius: 8px; padding: 10px; background: #12151c; }
.pair h2 { font-size: 13px; font-weight: 500; color: #fff; margin: 2px 4px 10px; word-break: break-all; }
.pair .row { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
@media (max-width: 700px) { .pair .row { grid-template-columns: 1fr; } }
figure { border: 1px solid #232733; background: #161922; border-radius: 6px; cursor: zoom-in; overflow: hidden; }
figure:hover { border-color: #3b82f6; }
figure.missing { cursor: default; border-style: dashed; border-color: #b45309; }
figure img, .hole { display: block; width: 100%; height: 260px; object-fit: cover; object-position: top center; background: #0f1115; }
.hole { display: flex; align-items: center; justify-content: center; font-size: 12px; color: #f59e0b; }
figcaption { font-size: 12px; color: #d4d6db; padding: 8px 10px; border-top: 1px solid #232733; }
figcaption b { font-weight: 600; margin-right: 4px; }
.sid { font-size: 11px; color: #9ca3af; margin-left: 6px; }
.tag { display: inline-block; font-size: 10px; color: #8a8f9c; margin-left: 6px; padding: 1px 6px; border: 1px solid #2c313d; border-radius: 3px; }
.tag.bad { color: #fca5a5; border-color: #7f1d1d; }
#lightbox { position: fixed; inset: 0; background: rgba(0,0,0,0.95); display: none; align-items: flex-start; justify-content: center; z-index: 100; cursor: zoom-out; padding: 24px; overflow: auto; }
#lightbox.open { display: flex; }
#lightbox img { max-width: 100%; border: 1px solid #232733; }
#lightbox .label { position: fixed; bottom: 22px; left: 50%; transform: translateX(-50%); font-size: 12px; background: rgba(15,17,21,0.85); padding: 6px 14px; border: 1px solid #232733; border-radius: 4px; }
</style>
</head>
<body>
<header>
  <div>
    <h1>${esc(title)}</h1>
    ${subtitle ? `<div class="subtitle">${esc(subtitle)}</div>` : ''}
  </div>
  <div class="count">${shots.length} ${parity ? 'pages' : 'shots'}${parity ? ` · ${problems} need attention` : ''}</div>
</header>
${sections.map(sec => `
<div class="section-label${sec === 'Needs attention' ? ' attention' : ''}">${esc(sec)}</div>
${parity ? `<div class="pairs">${shots.filter(s => s.section === sec).map(s => `
  <div class="pair">
    <h2>${esc(s.label)}${s.screenshotId ? ` <code class="sid">${esc(s.screenshotId)}</code>` : ''}</h2>
    <div class="row">
      ${s.expectBase ? tile(s.hasBase ? `baseline/${s.slug}.png` : null, s.label, s.base, 'Baseline') : '<div class="hole">Next.js only (compare: false)</div>'}
      ${tile(s.hasNext ? `${s.slug}.png` : null, s.label, s.next, 'Next.js')}
    </div>
  </div>`).join('')}</div>`
  : `<div class="grid">${shots.filter(s => s.section === sec).map(s => `
  <figure data-src="${esc(s.slug)}.png" data-label="${esc(s.label)}"${s.screenshotId ? ` data-screenshot-id="${esc(s.screenshotId)}"` : ''}>
    <img src="${esc(s.slug)}.png" alt="${esc(s.altText ?? s.label)}" loading="lazy">
    <figcaption>${esc(s.label)}${s.screenshotId ? ` <code class="sid">${esc(s.screenshotId)}</code>` : ''}${badge(s.next)}</figcaption>
  </figure>`).join('')}</div>`}
`).join('')}
<div id="lightbox"><img src="" alt=""><div class="label"></div></div>
<script>
const lb = document.getElementById('lightbox');
document.querySelectorAll('figure[data-src]').forEach(fig => fig.addEventListener('click', () => {
  lb.querySelector('img').src = fig.dataset.src;
  lb.querySelector('.label').textContent = fig.dataset.label;
  lb.classList.add('open');
  lb.scrollTop = 0;
}));
lb.addEventListener('click', () => lb.classList.remove('open'));
document.addEventListener('keydown', e => { if (e.key === 'Escape') lb.classList.remove('open'); });
</script>
</body>
</html>
`;

const outPath = join(dir, 'index.html');
writeFileSync(outPath, html);
console.log(`Gallery: ${outPath}${parity ? ` (${shots.length} pairs, ${problems} need attention)` : ''}`);
