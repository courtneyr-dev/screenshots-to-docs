#!/usr/bin/env node
/**
 * nextjs-screenshots / verify-site
 *
 * Pre-flight check before a capture run. Fetches the homepage (and the
 * baseline's, if given) and reports: HTTP status, whether it's Next.js,
 * which router, whether it looks like a dev server, and whether a sitemap
 * exists. The dev-server check is a heuristic on the HTML, not a guarantee.
 *
 * Usage:
 *   node verify-site.mjs --site http://localhost:3000 [--baseline https://old-site.com]
 */

import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    site:     { type: 'string' },
    baseline: { type: 'string' },
    help:     { type: 'boolean' },
  },
  strict: false,
});

if (values.help || !values.site) {
  console.log('Usage: node verify-site.mjs --site <url> [--baseline <url>]');
  process.exit(values.help ? 0 : 1);
}

let failed = false;
const line = (level, msg) => {
  if (level === 'FAIL') failed = true;
  console.log(`  ${level.padEnd(4)} ${msg}`);
};

async function get(url) {
  try {
    const res = await fetch(url, { redirect: 'follow' });
    return { res, body: await res.text() };
  } catch (e) {
    return { error: e.message };
  }
}

async function check(label, base, expectNext) {
  base = base.replace(/\/+$/, '');
  console.log(`${label}: ${base}`);
  const { res, body, error } = await get(`${base}/`);
  if (error) return line('FAIL', `homepage unreachable: ${error}`);
  line(res.ok ? 'OK' : 'FAIL', `homepage HTTP ${res.status}`);

  const isNext = body.includes('/_next/') || /next\.js/i.test(res.headers.get('x-powered-by') || '');
  if (expectNext) {
    if (!isNext) line('WARN', 'no /_next/ assets in the HTML; this may not be a Next.js site');
    else {
      const router = body.includes('self.__next_f') ? 'app router' : body.includes('__NEXT_DATA__') ? 'pages router' : 'router unknown';
      line('OK', `Next.js (${router})`);
      // Pages router: buildId "development". Webpack dev: webpack-hmr / react-refresh. Turbopack dev (Next 15-16): hmr-client and next-devtools chunks.
      const dev = /"buildId":"development"|webpack-hmr|react-refresh|hmr-client|next-devtools|\/_next\/static\/development\//.test(body);
      if (dev) line('WARN', 'looks like `next dev`: capture final shots against `next build && next start`');
    }
  } else if (/wp-content|wp-includes/.test(body)) {
    line('OK', 'WordPress markup detected');
  }

  for (const path of ['/sitemap.xml', '/sitemap_index.xml']) {
    const r = await get(`${base}${path}`);
    if (r.res?.ok && /<(urlset|sitemapindex)[\s>]/.test(r.body)) {
      const count = (r.body.match(/<loc>/g) || []).length;
      line('OK', `${path} (${count} <loc> entries)`);
      return;
    }
  }
  line('WARN', 'no sitemap.xml or sitemap_index.xml; use routes.mjs --app-dir instead');
}

await check('Site', values.site, true);
if (values.baseline) await check('Baseline', values.baseline, false);
process.exit(failed ? 1 : 0);
