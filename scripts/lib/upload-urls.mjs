/**
 * Allowlist for Figma upload URLs. figma-upload.mjs POSTs editor screenshots to every URL in
 * urls.json, so a wrong URL would send them to another host.
 *
 * Allowed: https on figma.com or any subdomain of it.
 * Test escape hatch: P1_UPLOAD_ALLOW_LOOPBACK=1 also allows http or https on 127.0.0.1, localhost
 * and [::1]. It allows no other host and no other scheme.
 * Confirmed 2026-10-06: Figma's upload_assets returns submitUrl values on https://mcp.figma.com.
 *
 * Redirects: postUpload() never lets fetch follow a redirect on its own. It follows only 307 and 308
 * (which keep the POST and its body), checks every target with checkUploadUrl before sending to it,
 * and stops after MAX_REDIRECTS hops.
 */

export const LOOPBACK_ENV = 'P1_UPLOAD_ALLOW_LOOPBACK';
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

export function checkUploadUrl(raw, env = process.env) {
  let u;
  try { u = new URL(raw); } catch { return { ok: false, host: '(unparseable)', reason: 'not a valid URL' }; }
  const host = u.hostname;
  if (u.username || u.password) return { ok: false, host, reason: 'URL contains credentials' };
  if (env[LOOPBACK_ENV] === '1' && LOOPBACK_HOSTS.has(host) && (u.protocol === 'http:' || u.protocol === 'https:')) return { ok: true, host };
  if (u.protocol !== 'https:') return { ok: false, host, reason: `scheme ${u.protocol} is not https` };
  if (host === 'figma.com' || host.endsWith('.figma.com')) return { ok: true, host };
  return { ok: false, host, reason: 'host is not figma.com or a figma.com subdomain' };
}

export function findBadUploadUrl(urls, env = process.env) {
  for (let i = 0; i < urls.length; i++) {
    const r = checkUploadUrl(urls[i], env);
    if (!r.ok) return { index: i, ...r };
  }
  return null;
}

export const MAX_REDIRECTS = 3;

const refuse = message => { const e = new Error(message); e.refused = true; return e; };

/**
 * POST a PNG to an upload URL without trusting redirects. Returns { res, url, hops } for the final
 * non-redirect response. Throws an Error with `refused: true`, before sending anything to the new
 * target, when a redirect is not 307/308, has no or a bad Location, points at a host checkUploadUrl
 * rejects, or exceeds maxRedirects.
 */
export async function postUpload(url, body, { env = process.env, fetchImpl = fetch, maxRedirects = MAX_REDIRECTS } = {}) {
  let current = url;
  for (let hops = 0; ; hops++) {
    const ok = checkUploadUrl(current, env);
    if (!ok.ok) throw refuse(`${hops ? 'redirect target' : 'URL'} ${ok.host} refused: ${ok.reason}`);
    const res = await fetchImpl(current, { method: 'POST', headers: { 'Content-Type': 'image/png' }, body, redirect: 'manual' });
    if (res.status < 300 || res.status > 399) return { res, url: current, hops };
    const location = res.headers.get('location');
    try { await res.arrayBuffer(); } catch { /* drain the redirect body; nothing to keep */ }
    if (res.status !== 307 && res.status !== 308) throw refuse(`HTTP ${res.status} redirect refused: only 307 and 308 keep the POST and its body`);
    if (!location) throw refuse(`HTTP ${res.status} redirect without a Location header`);
    if (hops >= maxRedirects) throw refuse(`more than ${maxRedirects} redirects`);
    try { current = new URL(location, current).href; } catch { throw refuse('redirect Location is not a valid URL'); }
  }
}
